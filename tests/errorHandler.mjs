import { expect } from "chai";
import express from "express";
import request from "supertest";

import errorHandler from "../utils/errorHandler.js";
import RESTError from "../utils/RESTError.js";
import sqlErrorFactory from "../utils/SqlErrorFactory.js";
import logger from "../utils/logger/logger.js";

const originalLog = logger.log;

function createApp(handler) {
  const app = express();
  app.get("/boom", handler);
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  let logged;

  beforeEach(() => {
    logged = [];
    logger.log = (_level, message) => {
      logged.push(message);
    };
  });

  afterEach(() => {
    logger.log = originalLog;
  });

  it("sends RESTError status and payload unchanged", async () => {
    const response = await request(
      createApp((_req, _res, next) => {
        next(new RESTError(422, "Command missing"));
      })
    ).get("/boom");

    expect(response.status).to.equal(422);
    expect(response.body).to.equal("Command missing");
    expect(logged).to.be.empty;
  });

  it("hides unexpected Error messages behind a generic 500", async () => {
    const response = await request(
      createApp((_req, _res, next) => {
        next(new Error("ER_NO_SUCH_TABLE: person"));
      })
    ).get("/boom");

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({ errors: "Something went wrong" });
    expect(JSON.stringify(response.body)).to.not.include("ER_NO_SUCH_TABLE");
    expect(logged.join("\n")).to.include("ER_NO_SUCH_TABLE: person");
  });

  it("does not copy err.status from a plain Error onto the response", async () => {
    const response = await request(
      createApp((_req, _res, next) => {
        const err = new Error("sqlstate 45000 internals");
        err.status = 400;
        next(err);
      })
    ).get("/boom");

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({ errors: "Something went wrong" });
  });
});

describe("RESTError", () => {
  it("is an Error so logs can read message and stack", () => {
    const err = new RESTError(401, "Not authorized");

    expect(err).to.be.instanceOf(Error);
    expect(err).to.be.instanceOf(RESTError);
    expect(err.message).to.equal("Not authorized");
    expect(err.status).to.equal(401);
    expect(err.payload).to.equal("Not authorized");
    expect(err.stack).to.be.a("string");
  });
});

describe("SqlErrorFactory", () => {
  it("maps known errno values to a client-facing RESTError", () => {
    const err = sqlErrorFactory.getError("ADD_GUEST", { errno: 1062 });

    expect(err).to.be.instanceOf(RESTError);
    expect(err.status).to.equal(422);
    expect(err.payload).to.equal("Person already exists");
  });

  it("does not put the opcode in an unknown SQL 500", () => {
    const err = sqlErrorFactory.getError("ADD_BOOKING", { errno: 9999 });

    expect(err).to.be.instanceOf(RESTError);
    expect(err.status).to.equal(500);
    expect(err.payload).to.deep.equal({ errors: "Something went wrong" });
    expect(err.message).to.not.include("ADD_BOOKING");
  });

  it("passes SIGNAL sqlMessage as a 422", () => {
    const err = sqlErrorFactory.getError("ADD_GUEST", {
      errno: 1644,
      sqlMessage: "User roles cannot overlap",
    });

    expect(err.status).to.equal(422);
    expect(err.payload).to.equal("User roles cannot overlap");
  });
});
