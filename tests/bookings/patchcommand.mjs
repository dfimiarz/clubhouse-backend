import app from "../expressapp.mjs";
import request from "supertest";
import middleware from "../../bookings/middleware.js";
import errorHandler from "../../utils/errorHandler.js";

const { validatePatchRequest } = middleware;

app.patch("/bookings/:id", [validatePatchRequest], (req, res) => {
  res.status(200).json({ message: "ok" });
});

app.use(errorHandler);

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
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Validates a CHANGE_NOTE command with an empty note", function (done) {
    patchCommand("CHANGE_NOTE", { hash: VALID_HASH, note: "" })
      .expect(200)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation when note exceeds 256 characters", function (done) {
    patchCommand("CHANGE_NOTE", { hash: VALID_HASH, note: "x".repeat(257) })
      .expect(422)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation when hash is missing", function (done) {
    patchCommand("CHANGE_NOTE", { note: "Updated note" })
      .expect(422)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation for an unknown command", function (done) {
    patchCommand("CHANGE_COLOR", { hash: VALID_HASH })
      .expect(422)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });
});
