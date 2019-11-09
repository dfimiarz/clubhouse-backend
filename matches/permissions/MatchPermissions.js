
//TO DO: Document all the rueles for granting permissions

var remove_grace_period = 10 * 60 * 1000;
var create_grace_period = 10 * 60 * 1000;
var update_grace_period = 10 * 60 * 1000;

/**
 * Check if a session can be removed
 * Permission granted if start_time + grace_period > current_time
 * See value for remove_grace_period for exact value
 * Grace period of 10 minutes means a session starting at 9:00 am 
 * can be remove up until 9:10 am.
 *  
 * @param { Object } activityTime Should contain utc_start and utc_end in seconds 
 * @param { Date } curr_time Optional current time 
 */
function hasRemovePermission( activityTime, curr_time = new Date() ){

    var curr_time_ms = curr_time.getTime()
    var start_time_ms = activityTime.utc_start * 1000

    return (start_time_ms + remove_grace_period) > curr_time_ms ? true: false

}

function hasEndPermission( match, curr_time = new Date() ){
    
    var curr_time_ms = curr_time.getTime()
    var start_time_ms = match.utc_start * 1000
    var end_time_ms = match.utc_end * 1000


    return ( start_time_ms <= curr_time_ms && end_time_ms >= curr_time_ms ) ? true : false

    

}

function hasChangeStartPermission( match, curr_time = new Date() ){

    var curr_time_ms = curr_time.getTime()
    var start_time_ms = match.utc_start * 1000

    return start_time_ms >= (curr_time_ms - update_grace_period) ? true : false

}

/**
 * Check if a session end can change.
 * Permission granted if end_time >= (now - grace_period)
 * See value for update_grace_period for exact value
 * Grace period of 10 minutes means a session ending at 9:00 am 
 * can have it's end time changed up to 9:10 am.
 *  
 * @param { Object } activityTime Should contain utc_start and utc_end in seconds 
 * @param { Date } curr_time Optional current time 
 */
function hasChangeEndPermission( activityTime, curr_time = new Date() ){

    var curr_time_ms = curr_time.getTime()
    var end_time_ms = activityTime.utc_end * 1000

    return end_time_ms >= ( curr_time_ms - update_grace_period )  ? true : false

}

/**
 * Check if a new session can be created.
 * Permission granted if start_time >= (now - grace_period)
 * See value for create_grace_period for exact value
 * Grace period of 10 minutes means a session starting at 9:00 am 
 * can be created up until 9:10 am
 * @param { Object } activityTime Should contain utc_start and utc_end in seconds 
 * @param { Date } curr_time Optional current time 
 */
function hasCreatePermission(activityTime, curr_time = new Date() ){
    
    var curr_time_ms = curr_time.getTime()
    var start_time_ms = activityTime.utc_start * 1000

    return start_time_ms >= (curr_time_ms - create_grace_period) ? true : false
}

/**
 * Checks if a court can be changed.
 * Permission granted if session_end_time > current_time (session ends in the future) 
 * @param { Object } activityTime Should contain utc_start and utc_end in seconds 
 * @param { Date } curr_time Optional current time
 */
function hasChangeCourtPermission(activityTime, curr_time = new Date()){

    var curr_time_ms = curr_time.getTime()
    var end_time_ms = activityTime.utc_end * 1000

    return end_time_ms > curr_time_ms ? true : false

}




module.exports = {
    hasRemovePermission,
    hasEndPermission,
    hasCreatePermission,
    hasChangeEndPermission,
    hasChangeStartPermission,
    hasChangeCourtPermission
}