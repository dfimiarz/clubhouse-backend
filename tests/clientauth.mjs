import { expect } from "chai";
import express from "express";
import request from "supertest";

import clientAuth from "../middleware/clientauth.js";
import authController from "../auth/controller.js";
import errorHandler from "../utils/errorHandler.js";

const {
  parseBearerToken,
  shouldGrantRemoteUserAuth,
  checkUserAuth,
  checkUserRole,
  authGuard,
  _setFirebaseAuth,
} = clientAuth;

const originalGetUserRole = authController.getUserRole;

function createApp() {
  const app = express();
  app.use(checkUserAuth, checkUserRole);
  app.get("/profile", (req, res) => {
    res.json({
      role: res.locals.role ?? null,
      geoauth: res.locals.geoauth ?? false,
      userauth: res.locals.userauth === true,
      username: res.locals.username ?? null,
      uid: res.locals.uid ?? null,
      emailVerified: res.locals.emailVerified === true,
    });
  });
  app.get("/protected", authGuard, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

function stubFirebase({
  email = "member@example.com",
  emailVerified = true,
  disabled = false,
  uid = "firebase-uid",
} = {}) {
  _setFirebaseAuth({
    verifyIdToken: async () => ({
      uid,
      email,
      email_verified: emailVerified,
    }),
    getUser: async () => ({
      uid,
      email,
      emailVerified,
      disabled,
    }),
  });
}

describe("parseBearerToken", () => {
  it("requires a Bearer scheme and a single token", () => {
    expect(parseBearerToken("Bearer abc.def")).to.equal("abc.def");
    expect(parseBearerToken("bearer abc.def")).to.equal("abc.def");
    expect(parseBearerToken("  Bearer   abc.def  ")).to.equal("abc.def");
  });

  it("rejects missing, non-Bearer, or malformed headers", () => {
    expect(parseBearerToken(undefined)).to.equal(null);
    expect(parseBearerToken("abc.def")).to.equal(null);
    expect(parseBearerToken("Basic abc.def")).to.equal(null);
    expect(parseBearerToken("Token abc.def")).to.equal(null);
    expect(parseBearerToken("Bearer")).to.equal(null);
    expect(parseBearerToken("Bearer abc def")).to.equal(null);
  });
});

describe("shouldGrantRemoteUserAuth", () => {
  it("requires a verified email and a live membership, including guest", () => {
    expect(shouldGrantRemoteUserAuth({ emailVerified: true, role: 2000 })).to.equal(
      true
    );
    expect(shouldGrantRemoteUserAuth({ emailVerified: true, role: 500 })).to.equal(
      true
    );
    expect(shouldGrantRemoteUserAuth({ emailVerified: true, role: null })).to.equal(
      false
    );
    expect(shouldGrantRemoteUserAuth({ emailVerified: false, role: 2000 })).to.equal(
      false
    );
    expect(shouldGrantRemoteUserAuth({ role: 2000 })).to.equal(false);
  });
});

describe("checkUserAuth and checkUserRole", () => {
  afterEach(() => {
    _setFirebaseAuth(null);
    authController.getUserRole = originalGetUserRole;
  });

  it("leaves public requests without an Authorization header anonymous", async () => {
    const response = await request(createApp()).get("/profile");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      role: null,
      geoauth: false,
      userauth: false,
      username: null,
      uid: null,
      emailVerified: false,
    });
  });

  it("ignores a non-Bearer Authorization header instead of treating it as a token", async () => {
    stubFirebase();
    authController.getUserRole = async () => 2000;

    const response = await request(createApp())
      .get("/profile")
      .set("Authorization", "Token abc.def");

    expect(response.status).to.equal(200);
    expect(response.body.userauth).to.equal(false);
    expect(response.body.username).to.equal(null);
  });

  it("returns 401 when the Bearer token cannot be verified", async () => {
    _setFirebaseAuth({
      verifyIdToken: async () => {
        throw new Error("bad token");
      },
      getUser: async () => {
        throw new Error("should not fetch user");
      },
    });

    const response = await request(createApp())
      .get("/profile")
      .set("Authorization", "Bearer not-a-token");

    expect(response.status).to.equal(401);
    expect(response.body).to.equal("Unable to verify auth token");
  });

  it("returns 401 when the Firebase user is disabled", async () => {
    stubFirebase({ disabled: true });

    const response = await request(createApp())
      .get("/profile")
      .set("Authorization", "Bearer good-token");

    expect(response.status).to.equal(401);
    expect(response.body).to.equal("Unable to verify auth token");
  });

  it("does not grant userauth for an unverified email even with a membership", async () => {
    stubFirebase({ emailVerified: false });
    let roleLookups = 0;
    authController.getUserRole = async () => {
      roleLookups += 1;
      return 2000;
    };

    const profile = await request(createApp())
      .get("/profile")
      .set("Authorization", "Bearer good-token");
    const protectedResponse = await request(createApp())
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(profile.status).to.equal(200);
    expect(profile.body.username).to.equal("member@example.com");
    expect(profile.body.emailVerified).to.equal(false);
    expect(profile.body.role).to.equal(null);
    expect(profile.body.userauth).to.equal(false);
    expect(roleLookups).to.equal(0);
    expect(protectedResponse.status).to.equal(401);
  });

  it("does not grant userauth when the verified email has no live membership", async () => {
    stubFirebase();
    authController.getUserRole = async () => null;

    const profile = await request(createApp())
      .get("/profile")
      .set("Authorization", "Bearer good-token");
    const protectedResponse = await request(createApp())
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(profile.status).to.equal(200);
    expect(profile.body.emailVerified).to.equal(true);
    expect(profile.body.role).to.equal(null);
    expect(profile.body.userauth).to.equal(false);
    expect(protectedResponse.status).to.equal(401);
  });

  it("grants userauth for a verified email with a live membership", async () => {
    stubFirebase({ uid: "uid-1" });
    authController.getUserRole = async (username, clubId) => {
      expect(username).to.equal("member@example.com");
      expect(clubId).to.equal(process.env.CLUB_ID);
      return 2000;
    };

    const profile = await request(createApp())
      .get("/profile")
      .set("Authorization", "Bearer good-token");
    const protectedResponse = await request(createApp())
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(profile.status).to.equal(200);
    expect(profile.body).to.include({
      role: 2000,
      userauth: true,
      username: "member@example.com",
      uid: "uid-1",
      emailVerified: true,
    });
    expect(protectedResponse.status).to.equal(200);
    expect(protectedResponse.body).to.deep.equal({ ok: true });
  });

  it("grants userauth for a verified guest membership", async () => {
    stubFirebase({ email: "guest@example.com" });
    authController.getUserRole = async () => 500;

    const response = await request(createApp())
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(response.status).to.equal(200);
  });
});
