import app from "../expressapp.mjs";
import request from "supertest";
import middleware from "../../bookings/middleware.js";

const { validateBatchInsertRequest } = middleware;

app.post("/bookings/batch", [validateBatchInsertRequest], (req, res) => {
  res.status(200).json({ message: "ok" });
});

describe("Batch Booking Test", () => {
  it("Validates correct booking data", function (done) {
    const data = [
      {
        date: "2024-01-01",
        start: "12:30:00",
        end: "13:30:00",
        court_id: 1,
        booking_type_id: 1,
        players: [
          { person_id: 1, player_type_id: 1 },
          { person_id: 2, player_type_id: 1 },
        ],
        notes: "Test booking 1",
      },
      {
        date: "2024-01-01",
        start: "12:30:00",
        end: "13:30:00",
        court_id: 1,
        booking_type_id: 1,
        players: [
          { person_id: 1, player_type_id: 1 },
          { person_id: 2, player_type_id: 1 },
        ],
        notes: "Test booking 1",
      },
    ];

    request(app)
      .post("/bookings/batch")
      .set("Content-Type", "application/json")
      .send(data)
      .expect(200)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });
  it("Fails validation with no data", function (done) {
    const data = [];

    request(app)
      .post("/bookings/batch")
      .set("Content-Type", "application/json")
      .send(data)
      .expect(400)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });

  it("Fails validation with misformatted data", function (done) {
    const data = [
      {
        date: "2024",
      },
    ];

    request(app)
      .post("/bookings/batch")
      .set("Content-Type", "application/json")
      .send(data)
      .expect(400)
      .end(function (err, _res) {
        if (err) return done(err);
        return done();
      });
  });
});
