const Validator = require("jsonschema").Validator;
const { getSchema, getSupportedCommands } = require("./command");
const { checkPermission } = require("./permissions/BookingPermissions");
const RESTError = require("../utils/RESTError");


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

function validatePatchRequest(req, res, next) {
  const id = req.params.id ? req.params.id : null;

  if (id == null) {
    return next(new RESTError(422, "Booking ID missing"));
  }

  const cmd = req.body.cmd ? req.body.cmd : null;

  if (cmd == null) {
    return next(new RESTError(422, "Command missing"));
  }

  let cmd_errors = validateCommand(cmd);

  if (cmd_errors.length !== 0) {
    return next(new RESTError(422, "Incorrect command"));
  }

  let param_errors = validateCommandParams(cmd);

  if (param_errors.length !== 0) {
    return next(new RESTError(422, "Incorrect command params"));
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
};
