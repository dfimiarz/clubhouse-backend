/**
 * @typedef {object} PassInfo
 * @property {Number} host Host ID
 * @property {Number} guest Guest ID
 * @property {Number} pass_type Pass Type
 * @property {String} [valid_from] Pass start date as YYYY-MM-DD in club time zone. Defaults to today.
 */

/**
 * @typedef {object} GuestPass
 * @property {Number} id Guest Pass ID
 * @property {String} [created_utc] Created At Date
 * @property {String} [updated_utc] Updated At Date
 * @property {Number} guest Guest ID
 * @property {Number} host Host ID
 * @property {Boolean} valid Is the pass valid
 * @property {Number} type Guest Pass Type
 * @property {String} valid_from Valid From Date
 * @property {String} valid_to Valid To Date
 * @property {String} label Guest Pass Label
 * @property {Number} active Guest Pass Label
 */

module.exports = {};
