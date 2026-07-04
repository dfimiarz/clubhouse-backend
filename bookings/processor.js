const sqlconnector = require('../db/SqlConnector')
const RESTError = require('./../utils/RESTError');
const { checkPermission } = require('./permissions/BookingPermissions');
const { getBooking, insertBooking, getNewBooking, checkOverlap } = require('./BookingUtils');
const { log, appLogLevels } = require('./../utils/logger/logger');
const { transactionType } = require("../utils/dbutils");

const CLUB_ID = process.env.CLUB_ID;



async function endSession(id, cmd) {

    const etag = cmd.hash;

    const connection = await sqlconnector.getConnection();

    //Time will be converted from UTC (server) to club time zone
    const update_activity_q = `UPDATE activity SET end = TIME(convert_tz(from_unixtime(?),@@GLOBAL.time_zone,? )) where id = ?`

    try {
       
        await sqlconnector.runQuery(connection, "START TRANSACTION", []);

        try {

            const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

            if (!booking) {
                log(appLogLevels.ERROR, "Unable to end. Booking access error:  " + JSON.stringify({ id: id, hash: cmd.hash }));
                throw new RESTError(422, "Unable to read booknig data");
            }

            if( booking.club_id != CLUB_ID){
                log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
                throw new RESTError(422, "Booking does not belong to this club");
            }

            if( booking.etag != etag){
                log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
                throw new RESTError(422, "Booking has changed. Please refresh");
            }

            //Check permissions
            const errors = checkPermission('end', booking);

            if (errors.length > 0) {
                log(appLogLevels.WARNING, "Permission to end denied: " + JSON.stringify(errors));
                throw new RESTError(422, "Permission to end denied: " + errors[0]);
            }

            await sqlconnector.runQuery(connection, update_activity_q, [booking.utc_req_time, booking.time_zone, id])

            await sqlconnector.runQuery(connection, "COMMIT", [])

            log(appLogLevels.INFO, "Booking ended: " + JSON.stringify(booking));

            return booking.date;
        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err
        }
    }
    finally {
        connection.release()
    }
}

async function removeSession(id, cmd) {

    const etag = cmd.hash;

    const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

    const connection = await sqlconnector.getConnection()

    try {
        await sqlconnector.runQuery(connection, "START TRANSACTION", [])

        try {
            const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

            if (!booking) {
                log(appLogLevels.ERROR, "Unable to cancel. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
                throw new RESTError(422, "Unable to read booknig data");
            }

            if( booking.club_id != CLUB_ID){
                log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
                throw new RESTError(422, "Booking does not belong to this club");
            }

            if( booking.etag != etag){
                log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
                throw new RESTError(422, "Booking has changed. Please refresh");
            }

            //Check permissions
            const errors = checkPermission('cancel', booking);

            if (errors.length > 0) {
                log(appLogLevels.WARNING, "Permission to remove denied: " + JSON.stringify(errors));
                throw new RESTError(422, "Permission to remove denied: " + errors[0]);
            }

            await sqlconnector.runQuery(connection, remove_activity_q, [id]);

            await sqlconnector.runQuery(connection, "COMMIT", []);

            log(appLogLevels.INFO, "Booking cancelled: " + JSON.stringify(booking));

            return booking.date;
        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", []);
            throw err;

        }
    }
    finally {
        connection.release()
    }


}

async function changeSessionTime(id, cmd) {

    const etag = cmd.hash;

    const connection = await sqlconnector.getConnection()

    const new_start = cmd.start
    const new_end = cmd.end

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION READ WRITE", [])

        try {
            const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

            if (!booking) {
                log(appLogLevels.ERROR, "Unable to change time. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
                throw new RESTError(422, "Unable to read booknig data");
            }

            if( booking.club_id != CLUB_ID){
                log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
                throw new RESTError(422, "Booking does not belong to this club");
            }

            if( booking.etag != etag){
                log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
                throw new RESTError(422, "Booking has changed. Please refresh");
            }

            //Check permissions to move
            const move_errors = checkPermission('move', booking);

            if (move_errors.length > 0) {
                log(appLogLevels.WARNING, "Unable to change time. Permission to move denied: " + JSON.stringify(move_errors));
                throw new RESTError(422, "Permission to move denied: " + move_errors[0]);
            }

            const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

            await sqlconnector.runQuery(connection, remove_activity_q, [id])

            const initValues = {
                court: booking.court_id,
                start: new_start,
                date: booking.date,
                end: new_end,
                notes: booking.notes,
                bumpable: booking.bumpable,
                type: booking.type,
                players: Array.from(booking.players)
            }

            const movedbooking = await getNewBooking(connection, initValues);

            //Check permissions
            const create_errors = checkPermission('create', movedbooking);
            if (create_errors.length > 0) {
                log(appLogLevels.WARNING, "Unable to change time. Create permission denied: " + JSON.stringify(create_errors));
                throw new RESTError(422, "Create permission denied: " + create_errors[0]);
            }

            //START Check for overlapping bookings
            const overlapping_bookings = await checkOverlap(connection, movedbooking.end, movedbooking.start, movedbooking.court_id, movedbooking.date);

            if (overlapping_bookings.length !== 0) {
                const overlap_record = {
                    booking_date: movedbooking.date,
                    booking_start: movedbooking.start,
                    booking_end: movedbooking.end,
                    booking_court_id: movedbooking.court_id,
                    overlapping_ids: Array.from(overlapping_bookings)
                }

                log(appLogLevels.WARNING, "Booking overlap found while changing time: " + JSON.stringify(overlap_record));
                throw new RESTError(422, "Booking overlap found. Pick different time.");
            }
            //END

            const insertid = await insertBooking(connection, movedbooking);

            await sqlconnector.runQuery(connection, "COMMIT", []);

            const change_record = {
                orig_id: booking.id,
                moved_id: insertid
            }

            log(appLogLevels.INFO, "Booking time changed: " + JSON.stringify(change_record));

            return movedbooking.date;
        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err
        }
    }
    finally {
        connection.release()
    }
}



async function changeCourt(id, cmd) {

    const etag = cmd.hash;

    const connection = await sqlconnector.getConnection();

    const new_court = cmd.court;

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION READ WRITE", []);

        try {
            const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

            if (!booking) {
                log(appLogLevels.ERROR, "Unable to change court. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
                throw new RESTError(422, "Unable to read booknig data");
            }

            if( booking.club_id != CLUB_ID){
                log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
                throw new RESTError(422, "Booking does not belong to this club");
            }

            if( booking.etag != etag){
                log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
                throw new RESTError(422, "Booking has changed. Please refresh");
            }

            //Check permissions to move
            const move_errors = checkPermission('move', booking);

            if (move_errors.length > 0) {
                log(appLogLevels.WARNING, "Unable to change court. Permission to move denied: " + JSON.stringify(move_errors));
                throw new RESTError(422, "Permission to move denied: " + move_errors[0]);
            }

            //Check if court is changing
            if (booking.court_id === new_court) {

                const change_record = {
                    booking_id: booking.id,
                    court_id: booking.court_id
                }

                log(appLogLevels.WARNING, "Court has not changed: " + JSON.stringify(change_record));
                throw new RESTError(422, "Court has not changed");
            }

            let initValues = null;

            if (booking.utc_start > booking.utc_req_time) {
                //Session is in the future so change the court right away
                const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

                await sqlconnector.runQuery(connection, remove_activity_q, [id]);

                initValues = {
                    court: new_court,
                    start: booking.start,
                    date: booking.date,
                    end: booking.end,
                    notes: booking.notes,
                    bumpable: booking.bumpable,
                    type: booking.type,
                    players: Array.from(booking.players)
                }

            }
            else {

                const end_booking_q = `UPDATE activity SET end = ? where id = ?`

                await sqlconnector.runQuery(connection, end_booking_q, [booking.loc_req_time, id])

                initValues = {
                    court: new_court,
                    start: booking.loc_req_time,
                    date: booking.date,
                    end: booking.end,
                    notes: booking.notes,
                    bumpable: booking.bumpable,
                    type: booking.type,
                    players: Array.from(booking.players)
                }


            }

            const movedbooking = await getNewBooking(connection, initValues);

            //Check permissions
            const create_errors = checkPermission('create', movedbooking);
            if (create_errors.length > 0) {
                log(appLogLevels.WARNING, "Unable to change court. Permission to create denied: " + JSON.stringify(create_errors));
                throw new RESTError(422, `Create permission denied: ${create_errors[0]} `);
            }

            //START Check for overlapping bookings
            const overlapping_bookings = await checkOverlap(connection, movedbooking.end, movedbooking.start, movedbooking.court_id, movedbooking.date);

            if (overlapping_bookings.length !== 0) {
                const overlap_record = {
                    booking_date: movedbooking.date,
                    booking_start: movedbooking.start,
                    booking_end: movedbooking.end,
                    booking_court_id: movedbooking.court_id,
                    overlapping_ids: Array.from(overlapping_bookings)
                }

                log(appLogLevels.WARNING, "Booking overlap found while changing court: " + JSON.stringify(overlap_record));
                throw new RESTError(422, "Booking overlap found. Pick a different court.");
            }
            //END

            const insertid = await insertBooking(connection, movedbooking);

            await sqlconnector.runQuery(connection, "COMMIT", []);

            const change_record = {
                orig_id: booking.id,
                moved_id: insertid
            }
            
            log(appLogLevels.INFO, "Court changed: " + JSON.stringify(change_record));

            return movedbooking.date;

        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err

        }
    }
    finally {
        connection.release()
    }

}



async function changeNote(id, cmd) {

    const etag = cmd.hash;
    const new_note = typeof cmd.note === "string" ? cmd.note.trim() : "";

    const update_note_q = `UPDATE activity SET notes = ? WHERE id = ?`

    const connection = await sqlconnector.getConnection();

    try {

        await sqlconnector.runQuery(connection, "START TRANSACTION READ WRITE", []);

        try {
            const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

            if (!booking) {
                log(appLogLevels.ERROR, "Unable to change note. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
                throw new RESTError(422, "Unable to read booknig data");
            }

            if( booking.club_id != CLUB_ID){
                log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
                throw new RESTError(422, "Booking does not belong to this club");
            }

            if( booking.etag != etag){
                log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
                throw new RESTError(422, "Booking has changed. Please refresh");
            }

            //Check permissions to change note
            const errors = checkPermission('change_note', booking);

            if (errors.length > 0) {
                log(appLogLevels.WARNING, "Unable to change note. Permission denied: " + JSON.stringify(errors));
                throw new RESTError(422, "Permission to change note denied: " + errors[0]);
            }

            //Unchanged note would not bump activity.updated (ON UPDATE timestamp skips no-op writes),
            //so the etag would stay stale — reject like changeCourt does for an unchanged court
            if ((booking.notes ?? "") === new_note) {
                log(appLogLevels.WARNING, "Note has not changed: " + JSON.stringify({ booking_id: booking.id }));
                throw new RESTError(422, "Note has not changed");
            }

            await sqlconnector.runQuery(connection, update_note_q, [new_note, id]);

            await sqlconnector.runQuery(connection, "COMMIT", []);

            log(appLogLevels.INFO, "Booking note changed: " + JSON.stringify({ booking_id: booking.id }));

            return booking.date;

        }
        catch (err) {

            await sqlconnector.runQuery(connection, "ROLLBACK", [])
            throw err

        }
    }
    finally {
        connection.release()
    }

}



module.exports = {
    endSession,
    removeSession,
    changeSessionTime,
    changeCourt,
    changeNote,
}