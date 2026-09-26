const RESTError = require('./RESTError');

const sql_errors = {
    'ADD_GUEST' : {
        1062: {
            'code': 422,
            'msg' : "Person already exists"
        }
    },
    'ACTIVATE_GUESTS' :{
        1062: {
            'code': 422,
            'msg' : "Guest(s) already activated"
        }
    },
    'ADD_BOOKING': {
        1452: {
            'code': 422,
            'msg' : "Player(s) not found"
        },
        1213: {
            'code': 409,
            'msg' : "This court or a player was just booked. Please try again"
        },
        1205: {
            'code': 409,
            'msg' : "This court or a player was just booked. Please try again"
        }
    },
    'GET_BOOKING':{
        
    }
}

function _getError(opcode,sqlerr){

    //Unhandled user-defined exception condition. Pass the message directly
    if( sqlerr.errno === 1644 ){
        return new RESTError(422,sqlerr.sqlMessage);
    }

    //Check if custom error handler is defined for the opcode
    if (Object.prototype.hasOwnProperty.call(sql_errors,  opcode)){
        
        const opcodeErrs = sql_errors[opcode];

        //Check if error handler is defined for a given errno
        if(Object.prototype.hasOwnProperty.call(opcodeErrs, sqlerr.errno)){
            return new RESTError(opcodeErrs[sqlerr.errno].code,opcodeErrs[sqlerr.errno].msg);
        }

    }

    //Lost a lock race with a concurrent write. A deadlock (1213) rolls back
    //the whole transaction; a lock wait timeout (1205) only the statement,
    //and withTransaction rolls back the rest before the error reaches here.
    //Either way nothing was saved, so a retry is safe. ADD_BOOKING above
    //overrides the message with booking-specific wording.
    if( sqlerr.errno === 1213 || sqlerr.errno === 1205 ){
        return new RESTError(409,"Another change was saved at the same time. Please try again");
    }

    return new RESTError(500);

}

module.exports = {
    getError: _getError
}