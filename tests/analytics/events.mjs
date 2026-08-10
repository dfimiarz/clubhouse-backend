import { expect } from "chai";
import express from "express";
import request from "supertest";

import analyticsRouter from "../../analytics/api.js";
import analyticsController from "../../analytics/controller.js";
import eventTypes from "../../analytics/eventTypes.js";
import RESTError from "../../utils/RESTError.js";

const { getEventNames, getEventDefinition } = eventTypes;
const originalRecordEvent = analyticsController.recordEvent;
const originalRecordEvents = analyticsController.recordEvents;

/**
 * The route under its real guards, with an authenticated caller. Controllers
 * are stubbed so these assertions cover validation and the response contract
 * without needing a database.
 */
function createApp({ authenticated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = authenticated;
    res.locals.geoauth = false;
    res.locals.username = authenticated ? "staff@example.com" : undefined;
    next();
  });
  app.use("/events", analyticsRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

  return app;
}

function validBody(overrides = {}) {
  return {
    name: "rebooking_offered",
    flow_id: "abc123",
    client_ts: 1_710_000_000_123,
    props: { person_ids: [12, 44], minutes_ago: 7, start_min: 615 },
    ...overrides,
  };
}

describe("analytics events", function () {
  let recorded;

  beforeEach(function () {
    recorded = [];
    analyticsController.recordEvent = async (event) => {
      recorded.push(event);
      return 1;
    };
    analyticsController.recordEvents = async (events) => {
      recorded.push(...events);
    };
  });

  afterEach(function () {
    analyticsController.recordEvent = originalRecordEvent;
    analyticsController.recordEvents = originalRecordEvents;
  });

  describe("registry", function () {
    it("declares a props schema for every event name", function () {
      const names = getEventNames();

      expect(names).to.not.be.empty;
      names.forEach((name) => {
        expect(getEventDefinition(name), name).to.have.property("props");
      });
    });

    it("returns null for a name it does not know", function () {
      expect(getEventDefinition("not_an_event")).to.equal(null);
    });
  });

  describe("POST /events", function () {
    it("accepts a valid event and records it", async function () {
      const response = await request(createApp()).post("/events").send(validBody());

      expect(response.status).to.equal(202);
      expect(response.body).to.deep.equal({ status: "ok" });
      expect(recorded).to.have.lengthOf(1);
      expect(recorded[0].name).to.equal("rebooking_offered");
      expect(recorded[0].flowId).to.equal("abc123");
      expect(recorded[0].clientTs).to.equal(1_710_000_000_123);
      expect(recorded[0].actor).to.equal("staff@example.com");
      expect(recorded[0].props).to.deep.equal({
        person_ids: [12, 44],
        minutes_ago: 7,
        start_min: 615,
      });
    });

    it("rejects an unknown event name", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({ name: "not_an_event" }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects a prop the event does not declare", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          props: { person_ids: [12], minutes_ago: 7, start_min: 615, note: "hi" },
        }));

      expect(response.status).to.equal(400);
      expect(response.body.fielderrors[0].param).to.contain("props");
      expect(recorded).to.be.empty;
    });

    it("rejects an event missing a prop the schema requires", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({ props: { person_ids: [12] } }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects person ids that are not positive integers", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          props: { person_ids: [0], minutes_ago: 7, start_min: 615 },
        }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("stores no flow id when the client omits one", async function () {
      const body = validBody();
      delete body.flow_id;

      const response = await request(createApp()).post("/events").send(body);

      expect(response.status).to.equal(202);
      expect(recorded[0].flowId).to.equal(null);
    });

    it("stores no client_ts when the client omits one", async function () {
      const body = validBody();
      delete body.client_ts;

      const response = await request(createApp()).post("/events").send(body);

      expect(response.status).to.equal(202);
      expect(recorded[0].clientTs).to.equal(null);
    });

    it("rejects a non-integer client_ts", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({ client_ts: 1_710_000_000.5 }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects a non-positive client_ts", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({ client_ts: 0 }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("accepts a booking that kept the suggested time", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          name: "rebooking_booked",
          props: {
            person_ids: [12],
            start_min: 615,
            offered_start_min: 615,
            kept_offer: true,
          },
        }));

      expect(response.status).to.equal(202);
      expect(recorded[0].props.kept_offer).to.equal(true);
    });

    it("accepts a booking whose start time was edited after accepting", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          name: "rebooking_booked",
          props: {
            person_ids: [12],
            start_min: 630,
            offered_start_min: 615,
            kept_offer: false,
          },
        }));

      expect(response.status).to.equal(202);
      expect(recorded[0].props).to.deep.equal({
        person_ids: [12],
        start_min: 630,
        offered_start_min: 615,
        kept_offer: false,
      });
    });

    it("rejects a booking that does not say whether the offer was kept", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          name: "rebooking_booked",
          props: { person_ids: [12], start_min: 615, offered_start_min: 615 },
        }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects a non-boolean kept_offer", async function () {
      const response = await request(createApp())
        .post("/events")
        .send(validBody({
          name: "rebooking_booked",
          props: {
            person_ids: [12],
            start_min: 615,
            offered_start_min: 615,
            kept_offer: "yes",
          },
        }));

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects an unauthenticated caller", async function () {
      const response = await request(createApp({ authenticated: false }))
        .post("/events")
        .send(validBody());

      expect(response.status).to.be.oneOf([401, 403]);
      expect(recorded).to.be.empty;
    });

    it("still answers 202 when storing the event fails", async function () {
      analyticsController.recordEvent = async () => {
        throw new Error("database is down");
      };

      const response = await request(createApp()).post("/events").send(validBody());

      // Analytics must never surface in a booking flow.
      expect(response.status).to.equal(202);
    });
  });

  describe("POST /events/batch", function () {
    it("accepts a valid batch and records every event", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({
          events: [
            validBody(),
            validBody({
              name: "booking_started",
              props: { prefilled_player_count: 1 },
            }),
          ],
        });

      expect(response.status).to.equal(202);
      expect(response.body).to.deep.equal({ status: "ok", accepted: 2, rejected: [] });
      expect(recorded).to.have.lengthOf(2);
      expect(recorded[0].name).to.equal("rebooking_offered");
      expect(recorded[0].actor).to.equal("staff@example.com");
      expect(recorded[0].clientTs).to.equal(1_710_000_000_123);
      expect(recorded[1].name).to.equal("booking_started");
      expect(recorded[1].props).to.deep.equal({ prefilled_player_count: 1 });
    });

    it("rejects an empty events array", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({ events: [] });

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("keeps the valid events when one event in the batch is invalid", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({
          events: [
            validBody(),
            validBody({ name: "not_an_event" }),
            validBody({
              name: "booking_started",
              props: { prefilled_player_count: 2 },
            }),
          ],
        });

      expect(response.status).to.equal(202);
      expect(response.body.accepted).to.equal(2);
      expect(recorded.map((event) => event.name)).to.deep.equal([
        "rebooking_offered",
        "booking_started",
      ]);
    });

    it("reports which event was dropped and why", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({
          events: [
            validBody(),
            validBody({
              name: "start_time_option_selected",
              props: { option: "other", start_min: null },
            }),
          ],
        });

      expect(response.status).to.equal(202);
      expect(response.body.rejected).to.have.lengthOf(1);
      expect(response.body.rejected[0].index).to.equal(1);
      expect(response.body.rejected[0].name).to.equal("start_time_option_selected");
      expect(response.body.rejected[0].fielderrors[0].param).to.equal("props.start_min");
    });

    it("stores nothing but still answers 202 when every event is invalid", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({ events: [validBody({ name: "not_an_event" })] });

      expect(response.status).to.equal(202);
      expect(response.body.accepted).to.equal(0);
      expect(response.body.rejected).to.have.lengthOf(1);
      expect(recorded).to.be.empty;
    });

    it("drops an event whose props carry a key the registry does not declare", async function () {
      const response = await request(createApp())
        .post("/events/batch")
        .send({
          events: [
            validBody(),
            validBody({
              name: "booking_started",
              props: { prefilled_player_count: 1, sneaky: "value" },
            }),
          ],
        });

      expect(response.status).to.equal(202);
      expect(response.body.accepted).to.equal(1);
      expect(recorded).to.have.lengthOf(1);
      expect(recorded[0].name).to.equal("rebooking_offered");
    });

    it("rejects a batch larger than 50 events", async function () {
      const events = Array.from({ length: 51 }, () => validBody());

      const response = await request(createApp())
        .post("/events/batch")
        .send({ events });

      expect(response.status).to.equal(400);
      expect(recorded).to.be.empty;
    });

    it("rejects an unauthenticated caller", async function () {
      const response = await request(createApp({ authenticated: false }))
        .post("/events/batch")
        .send({ events: [validBody()] });

      expect(response.status).to.be.oneOf([401, 403]);
      expect(recorded).to.be.empty;
    });

    it("still answers 202 when storing the batch fails", async function () {
      analyticsController.recordEvents = async () => {
        throw new Error("database is down");
      };

      const response = await request(createApp())
        .post("/events/batch")
        .send({ events: [validBody()] });

      expect(response.status).to.equal(202);
    });
  });
});
