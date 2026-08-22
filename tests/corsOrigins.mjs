import { expect } from "chai";

import {
  getAllowedOrigins,
  canonicalizeOrigin,
} from "../utils/corsOrigins.js";

function allows(allowed, origin) {
  return allowed.some((entry) =>
    entry instanceof RegExp ? entry.test(origin) : entry === origin
  );
}

describe("getAllowedOrigins", () => {
  it("uses exact origins from CORS_ORIGINS and strips paths", () => {
    const allowed = getAllowedOrigins({
      NODE_ENV: "production",
      CORS_ORIGINS:
        "https://knicktennis.net, https://www.knicktennis.net/app, https://knicktennis.net",
    });

    expect(allowed).to.deep.equal([
      "https://knicktennis.net",
      "https://www.knicktennis.net",
    ]);
  });

  it("drops invalid CORS_ORIGINS entries", () => {
    const allowed = getAllowedOrigins({
      NODE_ENV: "development",
      CORS_ORIGINS: "knicktennis.net,ftp://example.com,https://ok.example",
    });

    expect(allowed).to.deep.equal(["https://ok.example"]);
  });

  it("fails closed in production when CORS_ORIGINS is empty", () => {
    expect(getAllowedOrigins({ NODE_ENV: "production" })).to.deep.equal([]);
    expect(getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "  " })).to.deep.equal(
      []
    );
  });

  it("anchors local Vite and clubhouse.test fallbacks", () => {
    const allowed = getAllowedOrigins({ NODE_ENV: "development" });

    expect(allows(allowed, "http://localhost:5173")).to.equal(true);
    expect(allows(allowed, "https://localhost:5173")).to.equal(true);
    expect(allows(allowed, "http://127.0.0.1:5173")).to.equal(true);
    expect(allows(allowed, "http://[::1]:5173")).to.equal(true);
    expect(allows(allowed, "http://clubhouse.test:8081")).to.equal(true);
    expect(allows(allowed, "http://kiosk.clubhouse.test:8081")).to.equal(true);

    expect(allows(allowed, "https://evil-localhost:5173")).to.equal(false);
    expect(allows(allowed, "http://localhost:5173.attacker.com")).to.equal(false);
    expect(allows(allowed, "http://notclubhouse.test:8081")).to.equal(false);
    expect(allows(allowed, "http://clubhouse.test.evil.com:8081")).to.equal(false);
    expect(allows(allowed, "http://localhost:5173/extra")).to.equal(false);
  });
});

describe("canonicalizeOrigin", () => {
  it("keeps scheme host and port and drops a path", () => {
    expect(canonicalizeOrigin("https://www.knicktennis.net/api")).to.equal(
      "https://www.knicktennis.net"
    );
  });

  it("rejects non-http schemes and non-URLs", () => {
    expect(canonicalizeOrigin("ftp://example.com")).to.equal(null);
    expect(canonicalizeOrigin("localhost:5173")).to.equal(null);
  });
});
