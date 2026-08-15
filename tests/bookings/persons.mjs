import { expect } from "chai";

import bookingsController from "../../bookings/controller.js";

const { personsCoveringBookingDate } = bookingsController;

describe("personsCoveringBookingDate", () => {
  it("returns one person per requested id", () => {
    expect(
      personsCoveringBookingDate(
        [
          { id: 1, role: 2000 },
          { id: 2, role: 2001 },
        ],
        [1, 2]
      )
    ).to.deep.equal([
      { id: 1, role: 2000 },
      { id: 2, role: 2001 },
    ]);
  });

  it("collapses overlapping memberships and keeps the first role", () => {
    expect(
      personsCoveringBookingDate(
        [
          { id: 7, role: 2000 },
          { id: 7, role: 500 },
          { id: 8, role: 2001 },
        ],
        [7, 8]
      )
    ).to.deep.equal([
      { id: 7, role: 2000 },
      { id: 8, role: 2001 },
    ]);
  });

  it("treats string ids as the same person", () => {
    expect(
      personsCoveringBookingDate([{ id: "7", role: 2000 }], ["7"])
    ).to.deep.equal([{ id: 7, role: 2000 }]);
  });

  it("returns null when a requested person is missing", () => {
    expect(
      personsCoveringBookingDate([{ id: 1, role: 2000 }], [1, 2])
    ).to.equal(null);
  });

  it("returns null when the join result is empty", () => {
    expect(personsCoveringBookingDate([], [1])).to.equal(null);
    expect(personsCoveringBookingDate(null, [1])).to.equal(null);
  });

  it("returns null when requested ids are empty", () => {
    expect(personsCoveringBookingDate([{ id: 1, role: 2000 }], [])).to.equal(
      null
    );
  });

  it("ignores invalid person ids in the join result", () => {
    expect(
      personsCoveringBookingDate(
        [
          { id: 0, role: 2000 },
          { id: "nope", role: 2000 },
          { id: 1, role: 2001 },
        ],
        [1]
      )
    ).to.deep.equal([{ id: 1, role: 2001 }]);
  });
});
