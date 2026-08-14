import { expect } from "chai";

import { checkPermission } from "../../bookings/permissions/BookingPermissions.js";

function booking(overrides = {}) {
  return {
    active: 1,
    utc_start: 1_000,
    utc_end: 2_000,
    utc_created: 1_000,
    utc_req_time: 1_100,
    ...overrides,
  };
}

describe("cancel permission", () => {
  it("allows an ongoing start-now booking within 5 minutes even when start/end are DECIMAL strings", () => {
    const errors = checkPermission(
      "cancel",
      booking({
        utc_start: "1000.000000",
        utc_end: "1900.000000",
        utc_created: 999,
        utc_req_time: 1100,
      })
    );

    expect(errors).to.deep.equal([]);
  });

  it("denies cancel after the 5-minute start window for a booked-ahead session", () => {
    const errors = checkPermission(
      "cancel",
      booking({
        utc_start: "1000.000000",
        utc_end: "1900.000000",
        utc_created: 990,
        utc_req_time: 1301,
      })
    );

    expect(errors.length).to.be.greaterThan(0);
  });

  it("allows cancel of a retroactive booking within 5 minutes of creation", () => {
    const errors = checkPermission(
      "cancel",
      booking({
        utc_start: "900.000000",
        utc_end: "1900.000000",
        utc_created: 1000,
        utc_req_time: 1200,
      })
    );

    expect(errors).to.deep.equal([]);
  });
});

describe("create permission", () => {
  it("allows a follow-on whose end is already in the past", () => {
    const errors = checkPermission(
      "create",
      booking({
        schedule_id: 1,
        utc_start: 1000,
        utc_end: 1900,
        utc_req_time: 2500,
      })
    );

    expect(errors).to.deep.equal([]);
  });
});

describe("same-day-only booking", () => {
  it("treats numeric and string calendar dates as the same day", () => {
    const errors = checkPermission(
      "create",
      booking({
        loc_req_date: 20260814,
        numeric_date: "20260814",
        same_day_only: 1,
        schedule_id: 1,
        utc_start: 1000,
        utc_end: 1900,
      })
    );

    expect(errors).to.deep.equal([]);
  });
});

describe("end permission", () => {
  it("treats a booking as too fresh when start is a DECIMAL string within 5 minutes", () => {
    const errors = checkPermission(
      "end",
      booking({
        utc_start: "1000.000000",
        utc_end: "1900.000000",
        utc_req_time: 1100,
      })
    );

    expect(errors).to.deep.equal(["Booking too fresh"]);
  });
});
