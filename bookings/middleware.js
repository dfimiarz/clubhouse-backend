const Validator = require("jsonschema").Validator;
const { getSchema, getSupportedCommands } = require("./command");
const { checkPermission } = require("./permissions/BookingPermissions");
const { validateBatchInsertData, formatErrorsForLogging } = require("../utils/JSONvalidator");
const { log, appLogLevels } = require('./../utils/logger/logger');


function checkBookingPermissions(req, res, next) {
  const booking = res.locals.booking;

  const permissions = ["cancel", "end", "move", "change_note"];

  permissions.forEach((permission) => {
    //console.log("Checking",permission);
    const errors = checkPermission(permission, booking);

    //console.log(errors)

    if (errors.length === 0) {
      booking.permissions.push(permission);
    }
  });

  next();
}

/**
 * Validate the request body for batch insert
 *
 * @param {Request} req
 * @param {Response} _res
 * @param {NextFunction} next
 */
function validateBatchInsertRequest(req, res, next) {

  const valid = validateBatchInsertData(req.body);

  if (!valid) {
    //Get all errors and extract instance path and messages into separate array of objects
    log(appLogLevels.ERROR, formatErrorsForLogging(validateBatchInsertData.errors, "Unable to validate batch data"));
    return res.status(400).send("Unable to validate batch data");
  }
  next();
}

function validatePatchRequest(req, res, next) {
  const id = req.params.id ? req.params.id : null;

  if (id == null) {
    return next(new Error("Booking ID missing"));
  }

  const cmd = req.body.cmd ? req.body.cmd : null;

  if (cmd == null) {
    return next(new Error("Command missing"));
  }

  let cmd_errors = validateCommand(cmd);

  if (cmd_errors.length !== 0) {
    return next(new Error("Incorrect command"));
  }

  let param_errors = validateCommandParams(cmd);

  if (param_errors.length !== 0) {
    return next(new Error("Incorrect command params"));
  }

  res.locals.cmd = cmd;

  next();
}

function validateCommand(cmd) {
  const command_schema = {
    id: "command_schema",
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: getSupportedCommands(),
      },
      params: {
        type: "object",
      },
    },
    required: ["name", "params"],
  };

  const vresult = validateSchema(cmd, command_schema);

  return vresult.errors.length !== 0 ? vresult.errors : [];
}

function validateCommandParams(cmd) {
  const cmd_name = cmd.name;

  const params_schema = getSchema(cmd_name);

  if (params_schema === null) {
    return ["Failed to get params validation"];
  }

  const vresult = validateSchema(cmd.params, params_schema);

  return vresult.errors.length !== 0 ? vresult.errors : [];
}

function validateSchema(val, schema) {
  const v = new Validator();

  return v.validate(val, schema);
}

module.exports = {
  checkBookingPermissions,
  validatePatchRequest,
  validateBatchInsertRequest,
};
