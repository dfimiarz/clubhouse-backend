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
        }else{
            return new RESTError(500);
        }

    }
    else{
        return new RESTError(500);
    }

}

module.exports = {
    getError: _getError
}