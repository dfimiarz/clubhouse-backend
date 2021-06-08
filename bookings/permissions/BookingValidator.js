// BookingInfoFormat
//{
//  court: activity_result[0].court, 
//  utc_start: activity_result[0].utc_start, 
//  utc_end: activity_result[0].utc_end, 
//  utc_day_start: activity_result[0].utc_day_start,
//  utc_req_time: activity_result[0].utc_req_time,
//  local_req_date: activity_result[0].loc_req_date,
//  booking_date: activity_result[0].booking_date,
//  court_open: activity_result[0].openmin, 
//  court_closed: activity_result[0].closemin, 
//  courtstate: activity_result[0].state,
//  players: playerData,
//  type: booking.type,
//  bumpable: booking.bumpable
//}


const MATCH_TYPE = 1000;

const MIN_NEW_BOOKING_DURATION = 5 * 60

function courtOpen({courtstate}){


    //Check if court state is set and value set to 0 indicating it is closed
    return courtstate === 0 ? "Court Closed" : null; 

}

function checkBookingStart({ utc_day_start,court_open,utc_start}){

    //session must start at or after opening time. Opentime given in minutes since midnight
    const daystart = utc_day_start;
    const opentime = daystart + court_open * 60;

    return utc_start < opentime ? "Booking must start after court opens" : null;

}

function checkBookingEnd({ utc_day_start,court_closed,utc_end}){

    //session must end at or befoer closing time. court_closed given in minutes since midnight
    const daystart = utc_day_start;
    const closedtime = daystart + court_closed * 60;

    return utc_end > closedtime ? "Booking must end before court closes" : null;
}

function checkMatchBookingDate({ local_req_date, booking_date, type }){

        if( type === MATCH_TYPE ){
            return local_req_date !== booking_date ? "Matches must be booked for the same date": null;
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

function checkCancelable({utc_end,utc_req_time,utc_updated,utc_start}){

    if( utc_end <= utc_req_time ){
        return utc_updated + (15 * 60) <= utc_req_time ? "Only recently changed booking can be cancelled" : null
    } else {
        return utc_start + ( 5 + 60 ) <=  utc_req_time ? "Cannot cancel ongoing session" : null 
    }

}

const validators = {
                     "create" : [ courtOpen, checkBookingStart , checkBookingEnd, checkMatchBookingDate, checkStartAndEndTime, checkBookingDuration ],
                     "cancel" : [ checkCancelable ]
                    }


module.exports = validators;
