const express = require("express");
const { z } = require("zod");
const { validate } = require("../utils/validate");
const { authGuard } = require("../middleware/clientauth");
const { eventlimiter } = require("../rate-limiter/rate-limiter");
const { getEventDefinition } = require("./eventTypes");
// Held as a module object, not destructured: recordEvent / recordEvents are
// called through it so a test can replace them and observe the call.
// Destructuring would copy the reference and make it uninterceptable.
const controller = require("./controller");
const { log, appLogLevels } = require("../utils/logger/logger");

const router = express.Router();

/** Max events the client may send in one batch request. */
const MAX_BATCH_EVENTS = 50;

router.use(express.json());

/**
 * The envelope every event shares. `name` is checked against the registry
 * first, then that event's own schema is applied to `props` and its issues are
 * re-pathed under "props" so the client sees which field was wrong.
 */
/** Upper bound roughly year 2100 — rejects garbage without needing "now". */
const MAX_CLIENT_TS_MS = 4102444800000;

const eventBody = z
    .object({
        name: z
            .string("Invalid event name")
            .refine((value) => getEventDefinition(value) !== null, "Unknown event name"),
        flow_id: z.string("Invalid flow id").max(64).nullish(),
        // Client Date.now() at enqueue (ms). Optional so older clients still work.
        client_ts: z
            .number("Invalid client timestamp")
            .int("Invalid client timestamp")
            .positive("Invalid client timestamp")
            .max(MAX_CLIENT_TS_MS, "Invalid client timestamp")
            .nullish(),
        props: z.looseObject({}).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        const definition = getEventDefinition(value.name);

        // An unknown name already produced an issue; nothing to validate against.
        if (!definition) {
            return;
        }

        const result = definition.props.safeParse(value.props ?? {});

        if (!result.success) {
            result.error.issues.forEach((issue) => {
                ctx.addIssue({ ...issue, path: ["props", ...issue.path] });
            });
        }
    });

/**
 * Batch envelope. Only the array itself is checked here — the events inside it
 * are validated one at a time in the handler, so one malformed event costs that
 * event instead of the whole batch it travelled in. A client buffers unrelated
 * events together, so all-or-nothing would let a single broken call site delete
 * a whole booking funnel's worth of good data.
 *
 * Emptiness and size stay hard failures: those are a broken client contract
 * rather than bad data, and the client caps its own batches at the same limit.
 */
const batchEnvelope = z
    .object({
        events: z
            .array(z.unknown())
            .min(1, "At least one event is required")
            .max(MAX_BATCH_EVENTS, `At most ${MAX_BATCH_EVENTS} events per batch`),
    })
    .strict();

/**
 * Strips undeclared props via the registry schema and maps to the controller
 * shape. Safe after validate() has already accepted the body.
 *
 * @param {{ name: string, flow_id?: string|null, client_ts?: number|null, props?: Object }} body
 * @param {string|null} actor
 * @returns {{ name: string, props: Object, flowId: string|null, clientTs: number|null, actor: string|null }}
 */
function toStoredEvent(body, actor) {
    const definition = getEventDefinition(body.name);

    return {
        name: body.name,
        props: definition.props.parse(body.props ?? {}),
        flowId: body.flow_id ?? null,
        clientTs: body.client_ts ?? null,
        actor,
    };
}

/**
 * Records one analytics event.
 *
 * Responds as soon as the body is valid and stores afterwards: a client emits
 * these fire-and-forget in the middle of a booking, so a database problem must
 * be a log line here, never an error the user sees. Invalid input is still
 * rejected, so a mistake in a call site surfaces in development.
 */
router.post(
    "/",
    eventlimiter,
    authGuard,
    // 400 rather than the default 422: a rejected event means a broken call
    // site, not a user correcting a form.
    validate({ body: eventBody }, { status: 400 }),
    (req, res, _next) => {
        const stored = toStoredEvent(req.body, res.locals.username || null);

        res.status(202).json({ status: "ok" });

        controller.recordEvent(stored).catch((err) => {
            log(appLogLevels.ERROR, `Failed to record event '${stored.name}': ${err.message}`);
        });
    }
);

/**
 * Records many analytics events in one request.
 *
 * Same fire-and-forget contract as POST /: 202 after validation, store after
 * the response. One multi-row insert when possible. Counts as one rate-limit
 * unit regardless of how many events are in the body.
 *
 * Valid events are stored even when others in the same batch are not. The
 * response reports what was dropped and why, and the server logs it, because
 * the client sends these fire-and-forget and would otherwise never find out.
 * Still a 202 when every event was rejected: the client discards the batch
 * either way, so a status that varies with the payload buys nothing.
 */
router.post(
    "/batch",
    eventlimiter,
    authGuard,
    validate({ body: batchEnvelope }, { status: 400 }),
    (req, res, _next) => {
        const actor = res.locals.username || null;
        const accepted = [];
        const rejected = [];

        req.body.events.forEach((event, index) => {
            const result = eventBody.safeParse(event);

            if (result.success) {
                accepted.push(toStoredEvent(result.data, actor));
                return;
            }

            rejected.push({
                index,
                // Best effort: the name is what identifies the broken call site,
                // but an event can fail precisely by not having a usable one.
                name: typeof event?.name === "string" ? event.name : null,
                fielderrors: result.error.issues.map((issue) => ({
                    param: issue.path.join("."),
                    msg: issue.message,
                })),
            });
        });

        res.status(202).json({ status: "ok", accepted: accepted.length, rejected });

        if (rejected.length > 0) {
            log(
                appLogLevels.WARNING,
                `Discarded ${rejected.length} of ${req.body.events.length} analytics event(s): ${JSON.stringify(rejected)}`
            );
        }

        if (accepted.length === 0) {
            return;
        }

        controller.recordEvents(accepted).catch((err) => {
            log(
                appLogLevels.ERROR,
                `Failed to record event batch (${accepted.length}): ${err.message}`
            );
        });
    }
);

module.exports = router;
