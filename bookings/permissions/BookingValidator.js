/*
TODO: Refactor booking object to use classes to take advantage of OOP features. Typescript?
Booking info properties

id,
utc_start,
utc_end,
utc_day_start,
utc_req_time,
loc_req_date,
loc_req_time,
utc_created,
utc_updated,
date,
numeric_date,
start,
end,
active,
type,
booking_type_desc,
booking_type_lbl,
bumpable,
created,
updated,
notes,
etag,
time_zone,
club_id,
court_id,
court_name,
players: [],
permissions: []

Player properties

person_id,
member_role_id,
player_type_id,

*/

const MATCH_TYPE = 1000;

const MIN_NEW_BOOKING_DURATION = 5 * 60;
const FRESH_BOOKING_THRESHOLD_SEC = 5 * 60;

function checkCourtSchedule({schedule_id}){

    /**
     * Check if there is a schedule_id associated with the booking.
     * Empty schedule_id indicates that booking time is outside court schedule
     * for a given date and court.
     * 
     * Using Abstract Equality Comparison (undefined == null returns true)
     */
    return schedule_id == null ? "Booking time invalid" : null; 
}

function checkMatchBookingDate({ loc_req_date, numeric_date, type }){

        //console.log(loc_req_date,numeric_date)

        if( type === MATCH_TYPE ){
            return loc_req_date !== numeric_date ? "Matches must be booked for today": null;
        }
        else{
            return null;
        }

}

function checkStartAndEndTime({utc_start,utc_end}){
    return utc_start >= utc_end ? "Session must start before ending " : null;
}

function checkBookingDuration({utc_start,utc_end}){
    return utc_end - utc_start < MIN_NEW_BOOKING_DURATION ? "Session must be at least 5 minutes long" : null
}

function checkBookingNotEnded({utc_end,utc_req_time}){
    
    if(  utc_end < utc_req_time ){
        //Cannot change time for sessions that have ended
        return "Booking has ended";

    } else {
        //Ok to change time for ongoing or future sessions
        return null
    }

}

function checkCancelTimeframe({utc_end,utc_req_time,utc_created,utc_start}){

    if(  utc_end < utc_req_time ){
        //Sessiong that have ended can be cancelled within 5 mintues of creation
        return utc_created + (5 * 60) <= utc_req_time ? "Sessions that have ended can be cancelled within 5 mintute of creation time" : null;

    } else {

        if( utc_start < utc_req_time ){

            if( utc_start < utc_created ){
                //Ongoing sessions booked retroactively can be cancelled within 5 mintues of creation
                return utc_created + (5 * 60) <= utc_req_time ? "Ongoing bookings can be cancelled within 5 mintues of creation time" : null;
            }
            else{
                //Ongoing sessions booked ahead of time can be cancelled within 5 mintues of starting
                return utc_start + FRESH_BOOKING_THRESHOLD_SEC <= utc_req_time ? "Unable to cancel onging booking" : null;
            }

        } else {

            //Future session can be cancelled 
            return null;

        }
    }

}

function isActive({active}){
    return active === 1 ? null : "Booking must be active"
}

function isOngoing({utc_start,utc_end,utc_req_time}){

    return utc_req_time < utc_end && utc_req_time >= utc_start ? null : "Booking must be ongoing";

}

//Fresh booking is one that stared FRESH_BOOKING_THRESHOLD_SEC before utc_req_time
function isNotFreshBooking({utc_start,utc_req_time}){
    return utc_start + FRESH_BOOKING_THRESHOLD_SEC <= utc_req_time ? null : "Booking too fresh"
}

const validators = {
                     "create" : [ checkCourtSchedule, checkMatchBookingDate, checkStartAndEndTime, checkBookingDuration ],
                     "cancel" : [ isActive, checkCancelTimeframe],
                     "end": [ isActive, isOngoing, isNotFreshBooking],
                     "move": [ isActive, checkBookingNotEnded ],
                     "change_note": [ isActive, checkBookingNotEnded ]
                    }


module.exports = validators;
