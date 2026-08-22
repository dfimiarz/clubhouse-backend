import { expect } from "chai";

import {
  skipGlobalRateLimit,
  isRateLimitedWrite,
  apilimiter,
  writelimiter,
} from "../rate-limiter/rate-limiter.js";

describe("skipGlobalRateLimit", () => {
  it("skips health checks and CORS preflight", () => {
    expect(skipGlobalRateLimit({ method: "GET", path: "/" })).to.equal(true);
    expect(skipGlobalRateLimit({ method: "GET", path: "/alive" })).to.equal(true);
    expect(skipGlobalRateLimit({ method: "OPTIONS", path: "/bookings" })).to.equal(
      true
    );
  });

  it("does not skip ordinary API traffic", () => {
    expect(skipGlobalRateLimit({ method: "GET", path: "/bookings" })).to.equal(
      false
    );
    expect(skipGlobalRateLimit({ method: "POST", path: "/bookings" })).to.equal(
      false
    );
  });
});

describe("isRateLimitedWrite", () => {
  it("covers booking and guest-pass writes", () => {
    expect(isRateLimitedWrite({ method: "POST", path: "/bookings" })).to.equal(
      true
    );
    expect(isRateLimitedWrite({ method: "POST", path: "/bookings/" })).to.equal(
      true
    );
    expect(isRateLimitedWrite({ method: "PATCH", path: "/bookings/42" })).to.equal(
      true
    );
    expect(isRateLimitedWrite({ method: "PATCH", path: "/bookings/42/" })).to.equal(
      true
    );
    expect(isRateLimitedWrite({ method: "POST", path: "/guest_passes" })).to.equal(
      true
    );
  });

  it("does not cover reads or other posts", () => {
    expect(isRateLimitedWrite({ method: "GET", path: "/bookings" })).to.equal(
      false
    );
    expect(isRateLimitedWrite({ method: "POST", path: "/bookings/batch" })).to.equal(
      false
    );
    expect(isRateLimitedWrite({ method: "POST", path: "/persons/guests" })).to.equal(
      false
    );
    expect(isRateLimitedWrite({ method: "PATCH", path: "/bookings/42/extra" })).to.equal(
      false
    );
  });
});

describe("exported limiters", () => {
  it("exposes the global and write limiters as middleware", () => {
    expect(apilimiter).to.be.a("function");
    expect(writelimiter).to.be.a("function");
  });
});
