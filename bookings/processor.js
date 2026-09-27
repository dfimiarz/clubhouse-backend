const sqlconnector = require('../db/SqlConnector')
const RESTError = require('./../utils/RESTError');
const { checkPermission } = require('./permissions/BookingPermissions');
const { isFreshStart } = require('./permissions/BookingValidator');
const { getBooking, insertBooking, getNewBooking, checkOverlap } = require('./BookingUtils');
const { assertNoConcurrentMemberBookings, lockRosterIfNeeded } = require('./playerOverlap');
const { assertGuestRules } = require('./guestPass');
const { log, appLogLevels } = require('./../utils/logger/logger');
const { transactionType } = require("../utils/dbutils");

const CLUB_ID = process.env.CLUB_ID;
const { assertRestrictedMembersCanPlay } = require('./restrictedMember');

/** Drop the seconds so a session cut short ends on a whole minute. */
function floorToMinute(utcSeconds) {
    return Math.floor(Number(utcSeconds) / 60) * 60;
}

/**
 * "HH:MM:SS" -> "HH:MM:00". Club offsets are whole minutes, so this is the
 * local-time twin of floorToMinute.
 */
function floorTimeToMinute(time) {
    return String(time).replace(/^(\d{1,2}:\d{2}):\d{2}(\.\d+)?$/, '$1:00');
}

/** loc_req_date (YYYYMMDD, from `DATE + 0`) -> "YYYY-MM-DD". */
function numericDateToIso(numericDate) {
    const s = String(numericDate);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Snapshot a booking, take the person mutex when the concurrent-member rule
 * applies, then re-read the row FOR UPDATE. People before the activity so add
 * and move cannot deadlock.
 *
 * @returns {Promise<{ booking: Object, rosterLocked: boolean }>} rosterLocked
 *   feeds assertNoConcurrentMemberBookings so it does not lock again
 */
async function lockAndReloadForMove(connection, snapshot, etag) {
    const rosterLocked = await lockRosterIfNeeded(connection, snapshot);

    const booking = await getBooking(connection, snapshot.id, transactionType.WRITE_TRANSACTION);

    if (!booking) {
        throw new RESTError(422, "Unable to read booknig data");
    }

    if (booking.club_id != CLUB_ID) {
        throw new RESTError(422, "Booking does not belong to this club");
    }

    if (booking.etag != etag) {
        throw new RESTError(422, "Booking has changed. Please refresh");
    }

    return { booking, rosterLocked };
}

function rejectUnreadableBooking(booking, id, etag, failVerb) {
    if (!booking) {
        log(appLogLevels.ERROR, `Unable to ${failVerb}. Booking access error:  ` + JSON.stringify({ id: id, hash: etag }));
        throw new RESTError(422, "Unable to read booknig data");
    }

    if (booking.club_id != CLUB_ID) {
        log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
        throw new RESTError(422, "Booking does not belong to this club");
    }

    if (booking.etag != etag) {
        log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
        throw new RESTError(422, "Booking has changed. Please refresh");
    }
}

async function endSession(id, cmd) {

    const etag = cmd.hash;

    const update_activity_q = `UPDATE activity SET end_at = FROM_UNIXTIME(?) where id = ?`

    return sqlconnector.withTransaction(async (connection) => {
        const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

        if (!booking) {
            log(appLogLevels.ERROR, "Unable to end. Booking access error:  " + JSON.stringify({ id: id, hash: cmd.hash }));
            throw new RESTError(422, "Unable to read booknig data");
        }

        if (booking.club_id != CLUB_ID) {
            log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
            throw new RESTError(422, "Booking does not belong to this club");
        }

        if (booking.etag != etag) {
            log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
            throw new RESTError(422, "Booking has changed. Please refresh");
        }

        //Check permissions
        const errors = checkPermission('end', booking);

        if (errors.length > 0) {
            log(appLogLevels.WARNING, "Permission to end denied: " + JSON.stringify(errors));
            throw new RESTError(422, "Permission to end denied: " + errors[0]);
        }

        await sqlconnector.runExecute(connection, update_activity_q, [floorToMinute(booking.utc_req_time), id])

        log(appLogLevels.INFO, "Booking ended: " + JSON.stringify(booking));

        return booking.date;
    });
}

async function removeSession(id, cmd) {

    const etag = cmd.hash;

    const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

    return sqlconnector.withTransaction(async (connection) => {
        const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

        if (!booking) {
            log(appLogLevels.ERROR, "Unable to cancel. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
            throw new RESTError(422, "Unable to read booknig data");
        }

        if (booking.club_id != CLUB_ID) {
            log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
            throw new RESTError(422, "Booking does not belong to this club");
        }

        if (booking.etag != etag) {
            log(appLogLevels.ERROR, `Booking ${id} etag mismatch`);
            throw new RESTError(422, "Booking has changed. Please refresh");
        }

        //Check permissions
        const errors = checkPermission('cancel', booking);

        if (errors.length > 0) {
            log(appLogLevels.WARNING, "Permission to remove denied: " + JSON.stringify(errors));
            throw new RESTError(422, "Permission to remove denied: " + errors[0]);
        }

        await sqlconnector.runExecute(connection, remove_activity_q, [id]);

        log(appLogLevels.INFO, "Booking cancelled: " + JSON.stringify(booking));

        return booking.date;
    });
}

async function changeSessionTime(id, cmd) {

    const etag = cmd.hash;

    const new_start = cmd.start
    const new_end = cmd.end

    return sqlconnector.withTransaction(async (connection) => {
        const snapshot = await getBooking(connection, id, transactionType.NO_TRANSACTION);
        rejectUnreadableBooking(snapshot, id, etag, "change time");

        //Check permissions to move
        const move_errors = checkPermission('move', snapshot);

        if (move_errors.length > 0) {
            log(appLogLevels.WARNING, "Unable to change time. Permission to move denied: " + JSON.stringify(move_errors));
            throw new RESTError(422, "Permission to move denied: " + move_errors[0]);
        }

        const { booking, rosterLocked } = await lockAndReloadForMove(connection, snapshot, etag);

        const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

        await sqlconnector.runExecute(connection, remove_activity_q, [id])

        const initValues = {
            court: booking.court_id,
            start: new_start,
            date: booking.date,
            end: new_end,
            notes: booking.notes,
            bumpable: booking.bumpable,
            type: booking.type,
            players: Array.from(booking.players),
            origin_activity_id: booking.origin_activity_id ?? booking.id,
        }

        const movedbooking = await getNewBooking(connection, initValues);

        //Check permissions
        const create_errors = checkPermission('create', movedbooking);
        if (create_errors.length > 0) {
            log(appLogLevels.WARNING, "Unable to change time. Create permission denied: " + JSON.stringify(create_errors));
            throw new RESTError(422, "Create permission denied: " + create_errors[0]);
        }

        //START Check for overlapping bookings
        const overlapping_bookings = await checkOverlap(connection, movedbooking.utc_end, movedbooking.utc_start, movedbooking.court_id);

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

        await assertNoConcurrentMemberBookings(connection, movedbooking, { rosterLocked });

        await assertGuestRules(connection, movedbooking);
        await assertRestrictedMembersCanPlay(connection, movedbooking);

        const insertid = await insertBooking(connection, movedbooking);

        const change_record = {
            orig_id: booking.id,
            moved_id: insertid
        }

        log(appLogLevels.INFO, "Booking time changed: " + JSON.stringify(change_record));

        return movedbooking.date;
    }, { mode: "readWrite" });
}



/**
 * Move a session to another court in one mode: 'whole' deactivates the
 * original and re-creates it on the new court, 'split' ends the original at
 * cutoff and creates the rest on the new court. Every check a court change
 * needs runs here, the roster checks after the original is retired so it does
 * not conflict with its own players. Throws a RESTError when a check fails.
 *
 * @returns {Promise<Object>} the booking to insert
 */
async function applyCourtChange(connection, { id, mode, values, cutoff, rosterLocked }) {
    const movedbooking = await getNewBooking(connection, values);

    if (!movedbooking) {
        log(appLogLevels.WARNING, "Unable to change court. Booking time not found: " + JSON.stringify(values));
        throw new RESTError(422, "Create permission denied: Booking time invalid");
    }

    //Check permissions
    const create_errors = checkPermission('court_change', movedbooking);
    if (create_errors.length > 0) {
        log(appLogLevels.WARNING, "Unable to change court. Permission to create denied: " + JSON.stringify(create_errors));
        throw new RESTError(422, `Create permission denied: ${create_errors[0]} `);
    }

    //START Check for overlapping bookings
    const overlapping_bookings = await checkOverlap(connection, movedbooking.utc_end, movedbooking.utc_start, movedbooking.court_id);

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

    if (mode === 'whole') {
        const remove_activity_q = `UPDATE activity SET active = 0 where id = ?`

        await sqlconnector.runExecute(connection, remove_activity_q, [id]);
    }
    else {
        const end_booking_q = `UPDATE activity SET end_at = FROM_UNIXTIME(?) where id = ?`

        await sqlconnector.runExecute(connection, end_booking_q, [cutoff, id])
    }

    await assertNoConcurrentMemberBookings(connection, movedbooking, { rosterLocked });

    await assertGuestRules(connection, movedbooking);
    await assertRestrictedMembersCanPlay(connection, movedbooking);

    return movedbooking;
}

async function changeCourt(id, cmd) {

    const etag = cmd.hash;

    const new_court = cmd.court;

    return sqlconnector.withTransaction(async (connection) => {
        const snapshot = await getBooking(connection, id, transactionType.NO_TRANSACTION);
        rejectUnreadableBooking(snapshot, id, etag, "change court");

        //Check permissions to move
        const move_errors = checkPermission('move', snapshot);

        if (move_errors.length > 0) {
            log(appLogLevels.WARNING, "Unable to change court. Permission to move denied: " + JSON.stringify(move_errors));
            throw new RESTError(422, "Permission to move denied: " + move_errors[0]);
        }

        //Check if court is changing
        if (snapshot.court_id === new_court) {

            const change_record = {
                booking_id: snapshot.id,
                court_id: snapshot.court_id
            }

            log(appLogLevels.WARNING, "Court has not changed: " + JSON.stringify(change_record));
            throw new RESTError(422, "Court has not changed");
        }

        // Court must belong to this club and support the booking's activity type
        // (same rule as create booking; checked before mutating the original session)
        const court_support_q = `SELECT 1
                                 FROM activity_supported s
                                 JOIN court c ON c.id = s.court
                                 WHERE s.court = ?
                                   AND s.activity_type = ?
                                   AND c.club = ?
                                 LOCK IN SHARE MODE`;
        const court_support_result = await sqlconnector.runQuery(
            connection,
            court_support_q,
            [new_court, snapshot.type, CLUB_ID]
        );

        if (
            !(
                Array.isArray(court_support_result) &&
                court_support_result.length === 1
            )
        ) {
            log(appLogLevels.WARNING, "Unable to change court. Court does not support activity: " + JSON.stringify({
                booking_id: snapshot.id,
                court: new_court,
                activity_type: snapshot.type,
            }));
            throw new RESTError(422, "Court does not support this activity");
        }

        const { booking, rosterLocked } = await lockAndReloadForMove(connection, snapshot, etag);

        const cutoff = floorToMinute(booking.utc_req_time);

        const carriedValues = {
            court: new_court,
            end: booking.end,
            notes: booking.notes,
            bumpable: booking.bumpable,
            type: booking.type,
            players: Array.from(booking.players),
            origin_activity_id: booking.origin_activity_id ?? booking.id,
        }

        //Whole: the session keeps its start and just changes court
        const wholeValues = { ...carriedValues, start: booking.start, date: booking.date };

        //Split: the moved half starts now, so it belongs to today's date: after
        //midnight booking.date is still the day the session started on
        const splitValues = {
            ...carriedValues,
            start: floorTimeToMinute(booking.loc_req_time),
            date: numericDateToIso(booking.loc_req_date),
        };

        const started = Number(booking.utc_start) < cutoff;

        //Future sessions, and sessions that started within the current minute
        //(a split would leave a zero-length original), change court whole.
        //Sessions that started a few minutes ago try whole first rather than
        //leave a stub on the old court. Longer-running sessions split.
        let mode = !started || isFreshStart(booking) ? 'whole' : 'split';
        let movedbooking;

        if (mode === 'split' || !started) {
            const values = mode === 'whole' ? wholeValues : splitValues;
            movedbooking = await applyCourtChange(connection, { id, mode, values, cutoff, rosterLocked });
        }
        else {
            //Any rejected check on the whole move, e.g. the new court was busy
            //during those minutes or a guest pass does not cover the original
            //start, undoes it and splits instead
            await sqlconnector.runQuery(connection, "SAVEPOINT court_change_whole");

            try {
                movedbooking = await applyCourtChange(connection, { id, mode, values: wholeValues, cutoff, rosterLocked });
            }
            catch (err) {
                if (!(err instanceof RESTError)) {
                    throw err;
                }

                log(appLogLevels.INFO, "Unable to move fresh session whole, splitting instead: " + JSON.stringify({
                    booking_id: booking.id,
                    court: new_court,
                    reason: err.payload,
                }));

                await sqlconnector.runQuery(connection, "ROLLBACK TO SAVEPOINT court_change_whole");

                mode = 'split';
                movedbooking = await applyCourtChange(connection, { id, mode, values: splitValues, cutoff, rosterLocked });
            }
        }

        //A whole move keeps the original's creation time, so moving a session
        //that already started does not reopen its cancel window
        if (mode === 'whole') {
            movedbooking.utc_created = booking.utc_created;
        }

        const insertid = await insertBooking(connection, movedbooking);

        const change_record = {
            orig_id: booking.id,
            moved_id: insertid,
            mode: mode
        }

        log(appLogLevels.INFO, "Court changed: " + JSON.stringify(change_record));

        return movedbooking.date;
    }, { mode: "readWrite" });
}



async function changeNote(id, cmd) {

    const etag = cmd.hash;
    const new_note = typeof cmd.note === "string" ? cmd.note.trim() : "";

    const update_note_q = `UPDATE activity SET notes = ? WHERE id = ?`

    return sqlconnector.withTransaction(async (connection) => {
        const booking = await getBooking(connection, id, transactionType.WRITE_TRANSACTION);

        if (!booking) {
            log(appLogLevels.ERROR, "Unable to change note. Booking access error: " + JSON.stringify({ id: id, hash: cmd.hash }));
            throw new RESTError(422, "Unable to read booknig data");
        }

        if (booking.club_id != CLUB_ID) {
            log(appLogLevels.ERROR, `Booking ${id} does not belong to club ${CLUB_ID}`);
            throw new RESTError(422, "Booking does not belong to this club");
        }

        if (booking.etag != etag) {
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

        await sqlconnector.runExecute(connection, update_note_q, [new_note, id]);

        log(appLogLevels.INFO, "Booking note changed: " + JSON.stringify({ booking_id: booking.id }));

        return booking.date;
    }, { mode: "readWrite" });
}



module.exports = {
    endSession,
    removeSession,
    changeSessionTime,
    changeCourt,
    changeNote,
}
