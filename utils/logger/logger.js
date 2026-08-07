const winston = require("winston");
const { Logging } = require("@google-cloud/logging");

//Log levels for the application
const appLogLevels = Object.freeze({
  DEFAULT: "info",
  EMERG: "emerg",
  ALERT: "alert",
  CRIT: "crit",
  ERROR: "error",
  WARNING: "warning",
  NOTICE: "notice",
  INFO: "info",
  DEBUG: "debug",
});

//Log levels for the cloud, mapped to appLogLevels
const cloudLogLevels = Object.freeze({
  default: "DEFAULT",
  emerg: "EMERGENCY",
  alert: "ALERT",
  crit: "CRITICAL",
  error: "ERROR",
  warning: "WARNING",
  notice: "NOTICE",
  info: "INFO",
  debug: "DEBUG",
});

//Get log name from env var
const logName = process.env.GCLOUD_LOG_NAME;
const projectId = process.env.GCLOUD_PROJECT_ID;

const logging = new Logging({ projectId });

// Selects the log to write to
const gcloudLogger = logging.log(logName);

const localLogger = winston.createLogger({
  levels: winston.config.syslog.levels,
  transports: [
    new winston.transports.Console({
      format: winston.format.json(),
    }),
  ],
});

/**
 * Logs a message based on the specified log level
 * If the environment is production, the message is logged to the cloud.
 * Otherwise, the message is logged locally.
 * @param {string} appLogLevel - The app log level.
 * @param {string|Object} message - The message to be logged.
 */
function log(appLogLevel, message) {
  const useCloudLogging =
    ['production', 'staging'].includes(process.env.NODE_ENV) &&
    Boolean(process.env.GCLOUD_PROJECT_ID) &&
    Boolean(process.env.GCLOUD_LOG_NAME);

  if (useCloudLogging) {
    //Get cloud log level from npm log level
    const cloudLogLevel = cloudLogLevels[appLogLevel] || cloudLogLevels.default;

    cloudLog(cloudLogLevel, message);
  } else {
    localLog(appLogLevel, message);
  }
}

/**
 *
 * @param {String} cloudLogLevel Log level from cloudLogLevels
 * @param {String|Object} message String or object to log
 * @param {String} resource_type Resource type for the log. Default is "global"
 */
function cloudLog(cloudLogLevel, message, resource_type = "global") {
  //Check cloudLogLevel against cloudLogLevels
  const cloglvl = Object.values(cloudLogLevels).includes(cloudLogLevel)
    ? cloudLogLevel
    : "DEFAULT";

  const metadata = {
    severity: cloglvl,
    // A default log resource is added for some GCP environments
    // This log resource can be overwritten per spec:
    // https://cloud.google.com/logging/docs/reference/v2/rest/v2/MonitoredResource
    resource: {
      type: resource_type,
    },
  };

  const logentry = gcloudLogger.entry(metadata, message);

  gcloudLogger.write(logentry).catch((err) => {
    localLog(appLogLevels.ERROR, "GCLOUD log error: " + err.message);
  });
}

/**
 * 
 * @param {String} level appLogLevels
 * @param {Strting|Object} message 
 * @param {*} meta 
 * @returns 
 * @throws Error if invalid log level
 */
function localLog(level, message, meta = null) {
  //Check if level is in appLogLevels, assign default if not
  const loglevel = Object.values(appLogLevels).includes(level)
    ? level
    : appLogLevels.DEFAULT;

  localLogger.log(loglevel, message, meta);
}

module.exports = {
  cloudLog,
  localLog,
  log,
  appLogLevels,
};
