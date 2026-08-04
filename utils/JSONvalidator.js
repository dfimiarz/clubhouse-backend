const Ajv = require("ajv");
const ajv = new Ajv({allErrors: true});
const ajv_formats = require("ajv-formats");

ajv_formats(ajv);

const batchInsertSchema = {
  $id: "/schemas/batch_booking",
  title: "Batch Booking Insert",
  description: "A schema for batch booking insert",
  type: "array",
  items: {
    $ref: "#/$defs/booking",
  },
  minItems: 1,
  $defs: {
    player: {
      type: "object",
      properties: {
        person_id: {
          type: "number",
        },
        player_type_id: {
          type: "number",
        },
      },
      required: ["person_id", "player_type_id"],
    },
    booking: {
      type: "object",
      properties: {
        date: {
          type: "string",
          format: "date",
        },
        start: {
          type: "string",
          format: "iso-time",
        },
        end: {
          type: "string",
          format: "iso-time",
        },
        court_id: {
          type: "number",
        },
        booking_type_id: {
          type: "number",
        },
        players: {
          type: "array",
          items: {
            $ref: "#/$defs/player",
          },
          minItems: 1,
          maxItems: 4,
        },
        notes: {
          type: "string",
        },
      },
      required: [
        "date",
        "start",
        "end",
        "court_id",
        "booking_type_id",
        "players",
      ],
    },
  },
};

const validateBatchInsertData = ajv.compile(batchInsertSchema);


/**
 * 
 * @param {Object[]} validatorsErrors Array of errors from the validator
 * @param {String} message Error Message
 * @returns 
 */
function formatErrorsForLogging(validatorsErrors, message = "Unable to validate json data"){

    //Check if validatorErrors is an array, if not put object in an array.
    //Do not modify the original object
    let errors = Array.isArray(validatorsErrors) ? validatorsErrors : [validatorsErrors];

    //Looop through all the errors and format them. Make sure that the format is consistent
    let formattedErrors = [];
    for (let i = 0; i < errors.length; i++) {
        let error = errors[i];

        //Make sure that the error object has the required properties
        if (!Object.prototype.hasOwnProperty.call(error, "instancePath") ||
            !Object.prototype.hasOwnProperty.call(error, "message")) {
            continue;
        }

        formattedErrors.push({
            path: error.instancePath,
            message: error.message,
        });
    }

    return {
      text: message,
      errors: formattedErrors,
    }
}

module.exports = { validateBatchInsertData, formatErrorsForLogging };