import { expect } from "chai";
import express from "express";
import request from "supertest";

import personsRouter from "../../persons/api.js";
import personsController from "../../persons/controller.js";
import authController from "../../auth/controller.js";
import clientAuth from "../../middleware/clientauth.js";
import errorHandler from "../../utils/errorHandler.js";
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
  app.use(errorHandler);

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

  it("allows authenticated registration when the client posts a null captcha", async () => {
    const app = createApp({ userauth: true });

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.12")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        phone: null,
        hcaptcha: null,
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

  it("reports an unavailable verifier instead of a hostname failure", async () => {
    authController.verifyhCaptcha = async () => ({
      success: false,
      replayed: false,
      unavailable: true,
      hostname: null,
      hostnameValid: false,
    });

    const app = createApp();

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.18")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
        hcaptcha: "token-redis-down",
      });

    expect(response.status).to.equal(422);
    expect(response.body.fielderrors).to.deep.include({
      param: "hcaptcha",
      msg: "Captcha verification unavailable. Please try again.",
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

  it("tells authenticated callers to disclose duplicate guests", async () => {
    let addGuestOptions;

    personsController.addGuest = async (_req, options) => {
      addGuestOptions = options;
    };

    const app = createApp({ userauth: true });

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.14")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
      });

    expect(response.status).to.equal(201);
    expect(addGuestOptions).to.deep.equal({ discloseDuplicates: true });
  });

  it("tells kiosk geoauth callers to disclose duplicate guests", async () => {
    let addGuestOptions;

    personsController.addGuest = async (_req, options) => {
      addGuestOptions = options;
    };

    const app = createApp({ geoauth: true });

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.17")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
      });

    expect(response.status).to.equal(201);
    expect(addGuestOptions).to.deep.equal({ discloseDuplicates: true });
  });

  it("hides duplicate reasons from anonymous callers", async () => {
    let addGuestOptions;

    personsController.addGuest = async (_req, options) => {
      addGuestOptions = options;
    };

    const app = createApp();

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.15")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
        hcaptcha: "token-anon",
      });

    expect(response.status).to.equal(201);
    expect(addGuestOptions).to.deep.equal({ discloseDuplicates: false });
  });

  it("returns field errors when an authenticated duplicate is disclosed", async () => {
    personsController.addGuest = async () => {
      throw new RESTError(409, {
        fielderrors: [{ param: "email", msg: "Guest already exists" }],
      });
    };

    const app = createApp({ userauth: true });

    const response = await request(app)
      .post("/persons/guests")
      .set("X-Forwarded-For", "198.51.100.16")
      .send({
        firstname: "John",
        lastname: "Doe",
        email: "john@example.com",
        agreement: true,
      });

    expect(response.status).to.equal(409);
    expect(response.body.fielderrors).to.deep.include({
      param: "email",
      msg: "Guest already exists",
    });
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
