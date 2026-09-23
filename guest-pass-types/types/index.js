/**
 * @typedef {object} PassType
 * @property {Number} id Pass Type ID
 * @property {String} label Pass Type Label
 * @property {Number} valid Pass Type Validity in days
 * @property {Number} limit Pass Type Season Limit
 * @property {Number} cost Pass Type Cost in cents
 * @property {{ play_after: string|null, allowed_days: number[]|null }} settings Resolved pass-type rules (ISO weekdays 1–7)
 * @property {Array<{ key: string, text: string }>} constraints Non-default rules, labeled for display
 * @property {boolean} [sellable] Catalog only: whether POST /guest_passes would accept this type now
 * @property {string|null} [unavailable_reason] Catalog only: why it cannot be sold now, or null
 */

module.exports = {};
