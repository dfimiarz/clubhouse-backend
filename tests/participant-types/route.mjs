import { expect } from "chai";
import express from "express";
import request from "supertest";

import participantTypesRouter from "../../participant-types/api.js";
import participantTypesController from "../../participant-types/controller.js";
import RESTError from "../../utils/RESTError.js";

const originalGetParticipantTypes = participantTypesController.getParticipantTypes;

function createApp({ userauth = true } = {}) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    next();
  });
  app.use("/participant-types", participantTypesRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

  return app;
}

describe("GET /participant-types", () => {
  afterEach(() => {
    participantTypesController.getParticipantTypes = originalGetParticipantTypes;
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(createApp({ userauth: false })).get(
      "/participant-types"
    );

    expect(response.status).to.equal(401);
  });

  it("returns match participant types", async () => {
    participantTypesController.getParticipantTypes = async () => [
      { id: 1000, label: "Non-repeater", lbl: "R0" },
    ];

    const response = await request(createApp()).get("/participant-types");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal([
      { id: 1000, label: "Non-repeater", lbl: "R0" },
    ]);
  });

  it("wraps unexpected controller errors", async () => {
    participantTypesController.getParticipantTypes = async () => {
      throw new Error("ER_NO_SUCH_TABLE: participant_type");
    };

    const response = await request(createApp()).get("/participant-types");

    expect(response.status).to.equal(500);
    expect(response.body).to.equal("Failed loading participant types");
  });
});
