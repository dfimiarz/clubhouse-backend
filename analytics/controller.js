const sqlconnector = require("../db/SqlConnector");

const CLUB_ID = process.env.CLUB_ID;

const INSERT_EVENT_Q = `
    INSERT INTO app_event (club, name, actor, flow_id, client_ts, props)
    VALUES (?, ?, ?, ?, ?, ?)`;

/**
 * Builds the multi-row INSERT used by {@link recordEvents}.
 *
 * @param {number} count Number of value tuples
 * @returns {string}
 */
function buildInsertManyQuery(count) {
    const tuples = Array.from({ length: count }, () => "(?, ?, ?, ?, ?, ?)").join(", ");
    return `
    INSERT INTO app_event (club, name, actor, flow_id, client_ts, props)
    VALUES ${tuples}`;
}

/**
 * Flat parameter list for one event row
 * (club, name, actor, flow_id, client_ts, props).
 *
 * @param {{
 *   name: string,
 *   props?: Object,
 *   flowId?: string|null,
 *   clientTs?: number|null,
 *   actor?: string|null,
 * }} event
 * @returns {Array<*>}
 */
function eventRowParams({ name, props, flowId = null, clientTs = null, actor = null }) {
    return [CLUB_ID, name, actor, flowId, clientTs, JSON.stringify(props ?? {})];
}

/**
 * Stores one analytics event.
 *
 * The caller has already validated the name against the registry and the props
 * against that event's schema, so this only persists. `created` is left to the
 * column default (server clock, UTC; the pool runs timezone "Z"). Optional
 * `clientTs` is the client's Date.now() at enqueue and is stored as-is for
 * within-batch ordering — it is not used as the authoritative event time.
 *
 * @param {Object} event
 * @param {string} event.name Registry key
 * @param {Object} event.props Validated props
 * @param {string|null} [event.flowId] Correlates events within one user flow
 * @param {number|null} [event.clientTs] Client ms since epoch at enqueue
 * @param {string|null} [event.actor] Authenticated username, null for geoauth
 * @returns {Promise<number>} id of the stored event
 */
async function recordEvent({ name, props, flowId = null, clientTs = null, actor = null }) {
    const result = await sqlconnector.withConnection(async (connection) => {
        return sqlconnector.runExecute(connection, INSERT_EVENT_Q, eventRowParams({
            name,
            props,
            flowId,
            clientTs,
            actor,
        }));
    });

    return result.insertId;
}

/**
 * Stores many analytics events in one multi-row INSERT.
 *
 * Order of `events` is preserved in the insert list. All rows share the same
 * server `created` default (batch insert time). Prefer `client_ts` when you need
 * ordering or gaps between steps in the same batch; funnel joins still use
 * `flow_id`.
 *
 * @param {Array<{
 *   name: string,
 *   props?: Object,
 *   flowId?: string|null,
 *   clientTs?: number|null,
 *   actor?: string|null,
 * }>} events
 * @returns {Promise<void>}
 */
async function recordEvents(events) {
    if (!events.length) {
        return;
    }

    if (events.length === 1) {
        await recordEvent(events[0]);
        return;
    }

    const params = events.flatMap((event) => eventRowParams(event));

    await sqlconnector.withConnection(async (connection) => {
        return sqlconnector.runExecute(
            connection,
            buildInsertManyQuery(events.length),
            params
        );
    });
}

module.exports = { recordEvent, recordEvents };
