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
calendar_style,
member_rebookable,
same_day_only,
min_participant,
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

const { toFiniteNumber } = require("../../utils/dbutils");

const MIN_NEW_BOOKING_DURATION = 5 * 60;
const FRESH_BOOKING_THRESHOLD_SEC = 5 * 60;

const toUnix = toFiniteNumber;

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

/**
 * When activity_type.same_day_only is set, booking date must be club-local today.
 * Uses Abstract Equality so 1 / true both enable the rule.
 */
function checkSameDayOnlyBooking({ loc_req_date, numeric_date, same_day_only }) {
    if (same_day_only == null || same_day_only == 0) {
        return null;
    }
    return toFiniteNumber(loc_req_date) !== toFiniteNumber(numeric_date)
        ? "This activity must be booked for today"
        : null;
}

function checkStartAndEndTime({utc_start,utc_end}){
    return toUnix(utc_start) >= toUnix(utc_end) ? "Session must start before ending " : null;
}

function checkBookingDuration({utc_start,utc_end}){
    return toUnix(utc_end) - toUnix(utc_start) < MIN_NEW_BOOKING_DURATION ? "Session must be at least 5 minutes long" : null
}

function checkBookingNotEnded({utc_end,utc_req_time}){
    
    if(  toUnix(utc_end) < toUnix(utc_req_time) ){
        //Cannot change time for sessions that have ended
        return "Booking has ended";

    } else {
        //Ok to change time for ongoing or future sessions
        return null
    }

}

function checkCancelTimeframe({utc_end,utc_req_time,utc_created,utc_start}){
    const end = toUnix(utc_end);
    const req = toUnix(utc_req_time);
    const created = toUnix(utc_created);
    const start = toUnix(utc_start);

    if(  end < req ){
        //Sessiong that have ended can be cancelled within 5 mintues of creation
        return created + FRESH_BOOKING_THRESHOLD_SEC <= req ? "Sessions that have ended can be cancelled within 5 mintute of creation time" : null;

    } else {

        if( start < req ){

            if( start < created ){
                //Ongoing sessions booked retroactively can be cancelled within 5 mintues of creation
                return created + FRESH_BOOKING_THRESHOLD_SEC <= req ? "Ongoing bookings can be cancelled within 5 mintues of creation time" : null;
            }
            else{
                //Ongoing sessions booked ahead of time can be cancelled within 5 mintues of starting
                return start + FRESH_BOOKING_THRESHOLD_SEC <= req ? "Unable to cancel onging booking" : null;
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
    const start = toUnix(utc_start);
    const end = toUnix(utc_end);
    const req = toUnix(utc_req_time);

    return req < end && req >= start ? null : "Booking must be ongoing";

}

//Fresh booking is one that stared FRESH_BOOKING_THRESHOLD_SEC before utc_req_time
function isNotFreshBooking({utc_start,utc_req_time}){
    return toUnix(utc_start) + FRESH_BOOKING_THRESHOLD_SEC <= toUnix(utc_req_time) ? null : "Booking too fresh"
}

// create does not run checkBookingNotEnded: Fast rebook and other
// backdated follow-ons are allowed to occupy a slot whose end is already past.
const validators = {
                     "create" : [ checkCourtSchedule, checkSameDayOnlyBooking, checkStartAndEndTime, checkBookingDuration ],
                     "cancel" : [ isActive, checkCancelTimeframe],
                     "end": [ isActive, isOngoing, isNotFreshBooking],
                     "move": [ isActive, checkBookingNotEnded ],
                     "change_note": [ isActive, checkBookingNotEnded ]
                    }


module.exports = validators;
