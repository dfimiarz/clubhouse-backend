import app from "../expressapp.mjs";
import request from "supertest";
import middleware from "../../bookings/middleware.js";

const { validatePatchRequest } = middleware;

app.patch("/bookings/:id", [validatePatchRequest], (req, res) => {
  res.status(200).json({ message: "ok" });
});

app.use((err, req, res, next) => {
  res.status(400).send(err.message);
});

function patchCommand(name, params) {
  return request(app)
    .patch("/bookings/1")
    .set("Content-Type", "application/json")
    .send({ cmd: { name, params } });
}

const VALID_HASH = "a".repeat(32);

describe("Patch Command Validation Test", () => {
  it("Validates a correct CHANGE_NOTE command", function (done) {
    patchCommand("CHANGE_NOTE", { hash: VALID_HASH, note: "Updated note" })
      .expect(200)
      .end(function (err, res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Validates a CHANGE_NOTE command with an empty note", function (done) {
    patchCommand("CHANGE_NOTE", { hash: VALID_HASH, note: "" })
      .expect(200)
      .end(function (err, res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation when note exceeds 256 characters", function (done) {
    patchCommand("CHANGE_NOTE", { hash: VALID_HASH, note: "x".repeat(257) })
      .expect(400)
      .end(function (err, res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation when hash is missing", function (done) {
    patchCommand("CHANGE_NOTE", { note: "Updated note" })
      .expect(400)
      .end(function (err, res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation for an unknown command", function (done) {
    patchCommand("CHANGE_COLOR", { hash: VALID_HASH })
      .expect(400)
      .end(function (err, res) {
        if (err) return done(err);
        return done();
      });
  });
});
