const BookingValidator = require('./BookingValidator');

/**
 * 
 * @param { String } actiontype Type of validator to run
 * @param { Object } bookinginfo Booking info object. See BookingValidator for format
 * @returns 
 */

function checkPermission( actiontype,bookinginfo ){    

    //get validator functions
    const validators = BookingValidator[actiontype];

    if( ! Array.isArray(validators) ){
        return ["Validator configuration error"]
    }

    //Run each function to check for errors
    return validators.reduce((acc,valFunc) => {
        const result = valFunc(bookinginfo);

        if( result ){
            acc.push(result);
        }
        
        return acc;
    },[] )


}


module.exports = {
    checkPermission
}