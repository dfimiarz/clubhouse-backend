const { z } = require("zod");
const sql = require("../db/SqlConnector");
const RESTError = require("../utils/RESTError");
const { ROLE_TYPES } = require("../utils/dbconstants");
const { hhmm } = require("../utils/validate");
const { resolveSettings } = require("./settings");
const { SETTINGS: passSettings, constraintsFromSettings } = require("../guest-pass-types/settings");
const { allowedDaysSchema } = require("../guest-pass-types/weekdays");

const CLUB_ID = process.env.CLUB_ID;
// Share the guest-pass definitions, while limiting this feature to these two rules.
const SETTINGS = {
  play_after: passSettings.play_after,
  allowed_days: passSettings.allowed_days,
};
const restrictedMemberSchema = z.strictObject({
  settings: z.strictObject({
    play_after: hhmm("Enter a time in HH:MM format").nullable(),
    allowed_days: allowedDaysSchema.nullable(),
  }),
});
const roleParams = z.object({
  id: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .pipe(z.number().int().min(1).max(2147483647)),
});

function resolveRoleSettings(rows) {
  return resolveSettings(rows, { registry: SETTINGS, publicOnly: false });
}

async function loadRoleSettings(connection, roleIds, { lock = false } = {}) {
  const ids = [...new Set(roleIds.map(Number))].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  const rows = await sql.runQuery(connection,
    `SELECT role, setting_key, setting_value FROM club_role_setting
     WHERE club = ? AND role IN ?${lock ? " LOCK IN SHARE MODE" : ""}`,
    [CLUB_ID, [ids]]);
  if (!Array.isArray(rows)) throw new Error("Unable to read restricted member settings");
  return new Map(ids.map(id => [id, resolveRoleSettings(rows.filter(row => Number(row.role) === id))]));
}

function roleWithSettings(role, settings) {
  return { ...role, settings, constraints: constraintsFromSettings(settings) };
}

async function getRestrictedMemberRoles() {
  return sql.withConnection(async connection => {
    const roles = await sql.runExecute(connection,
      "SELECT id, lbl AS label FROM role WHERE type = ? ORDER BY lbl, id",
      [ROLE_TYPES.RESTRICTED_MEMBER_TYPE]);
    const settings = await loadRoleSettings(connection, roles.map(role => role.id));
    return roles.map(role => roleWithSettings(role, settings.get(Number(role.id))));
  });
}

async function saveRestrictedMemberRole(id, input) {
  const { settings } = restrictedMemberSchema.parse(input);
  return sql.withTransaction(async connection => {
    const roles = await sql.runExecute(connection,
      "SELECT id, lbl AS label FROM role WHERE id = ? AND type = ? FOR UPDATE",
      [id, ROLE_TYPES.RESTRICTED_MEMBER_TYPE]);
    if (roles.length !== 1) throw new RESTError(404, "Restricted member role not found");
    for (const [key, value] of Object.entries(settings)) {
      if (value === null) {
        await sql.runExecute(connection,
          "DELETE FROM club_role_setting WHERE club = ? AND role = ? AND setting_key = ?",
          [CLUB_ID, id, key]);
      } else {
        await sql.runExecute(connection,
          `INSERT INTO club_role_setting (club, role, setting_key, setting_value)
           VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [CLUB_ID, id, key, SETTINGS[key].type === "json" ? JSON.stringify(value) : value]);
      }
    }
    return roleWithSettings(roles[0], settings);
  });
}

module.exports = {
  restrictedMemberSchema, roleParams, resolveRoleSettings, loadRoleSettings,
  getRestrictedMemberRoles, saveRestrictedMemberRole,
};
