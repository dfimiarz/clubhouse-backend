import { expect } from "chai";
import express from "express";
import request from "supertest";

import personsRouter from "../../persons/api.js";
import personsController from "../../persons/controller.js";
import authController from "../../auth/controller.js";
import clientAuth from "../../middleware/clientauth.js";
import RESTError from "../../utils/RESTError.js";

const { getGeoAuthState } = clientAuth;

const originalAddGuest = personsController.addGuest;
const originalVerifyHCaptcha = authController.verifyhCaptcha;

function createApp({ userauth = false, geoauth = false } = {}) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.userauth = userauth;
    res.locals.geoauth = geoauth;
    next();
  });
  app.use("/persons", personsRouter);
  app.use((err, _req, res, _next) => {
    if (err instanceof RESTError) {
      res.status(err.status).json(err.payload);
      return;
    }

    res.status(err.status || 500).json(err.message || "Something went wrong");
  });

  return app;
}

describe("Guest registration security", () => {
  beforeEach(() => {
    personsController.addGuest = async () => {};
    authController.verifyhCaptcha = async () => ({
      success: true,
      replayed: false,
      hostnameValid: true,
    });
  });

  afterEach(() => {
    personsController.addGuest = originalAddGuest;
    authController.verifyhCaptcha = originalVerifyHCaptcha;
  });

  it("rejects anonymous registration without captcha", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.10")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
      });

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "hcaptcha",
      msg: "hCaptcha must be set",
    });
  });

  it("allows authenticated registration without captcha", async () => {
    const app = createApp({ userauth: true });

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.11")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
      });

    expect(response.status).to.equal(201);
  });

  it("rejects replayed hcaptcha tokens", async () => {
    authController.verifyhCaptcha = async () => ({
      success: false,
      replayed: true,
      hostnameValid: true,
    });

    const app = createApp();

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.12")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
        hcaptcha: "token-1",
      });

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "hcaptcha",
      msg: "Captcha token already used",
    });
  });

  it("rate limits repeated anonymous guest registrations", async () => {
    const app = createApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post("/persons/guests")
        .set("X-Forwarded-For", "198.51.100.13")
        .send({
          firstname: "John",
          lastname: "Doe",
          email: `john${attempt}@example.com`,
          agreement: true,
          hcaptcha: `token-${attempt}`,
        });

      expect(response.status).to.equal(201);
    }

    const blockedResponse = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.13")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john-final@example.com",
        agreement: true,
        hcaptcha: "token-final",
      });

    expect(blockedResponse.status).to.equal(429);
  });

  it("marks public remote addresses with trusted header as spoofed", () => {
    const state = getGeoAuthState({
      header(name) {
        return name === "X-AUTH-CLIENT" ? "1" : undefined;
      },
      socket: {
        remoteAddress: "203.0.113.20",
      },
    });

    expect(state.spoofed).to.equal(true);
    expect(state.geoauth).to.equal(false);
  });
});
