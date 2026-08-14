import { expect } from "chai";

import settingsModule from "../../club/settings.js";

const { SETTINGS, coerce, resolveSettings } = settingsModule;

// A fixture registry keeps these assertions independent of the real settings,
// which will grow and change defaults over time.
const registry = {
  flag_on_by_default: { type: "boolean", default: true, public: true },
  flag_off_by_default: { type: "boolean", default: false, public: true },
  window_minutes: { type: "int", default: 20, public: true },
  greeting: { type: "string", default: "hello", public: true },
  internal_only: { type: "boolean", default: true, public: false },
};

function rows(pairs) {
  return Object.entries(pairs).map(([setting_key, setting_value]) => ({
    setting_key,
    setting_value,
  }));
}

describe("club settings registry", function () {
  describe("resolveSettings", function () {
    it("returns registry defaults when there are no overrides", function () {
      expect(resolveSettings([], { registry })).to.deep.equal({
        flag_on_by_default: true,
        flag_off_by_default: false,
        window_minutes: 20,
        greeting: "hello",
      });
    });

    it("treats a missing rows argument as no overrides", function () {
      expect(resolveSettings(undefined, { registry })).to.have.property(
        "flag_on_by_default",
        true,
      );
    });

    it("applies a '0' override over a true default", function () {
      const resolved = resolveSettings(rows({ flag_on_by_default: "0" }), { registry });
      expect(resolved.flag_on_by_default).to.equal(false);
    });

    it("applies a '1' override over a false default", function () {
      const resolved = resolveSettings(rows({ flag_off_by_default: "1" }), { registry });
      expect(resolved.flag_off_by_default).to.equal(true);
    });

    it("ignores rows for keys that are not in the registry", function () {
      const resolved = resolveSettings(rows({ retired_key: "1" }), { registry });
      expect(resolved).to.not.have.property("retired_key");
      expect(resolved.flag_on_by_default).to.equal(true);
    });

    it("falls back to the default for a value the type cannot read", function () {
      const resolved = resolveSettings(
        rows({ flag_on_by_default: "maybe", window_minutes: "soon" }),
        { registry },
      );
      expect(resolved.flag_on_by_default).to.equal(true);
      expect(resolved.window_minutes).to.equal(20);
    });

    it("omits non-public settings when publicOnly is set", function () {
      const resolved = resolveSettings([], { registry, publicOnly: true });
      expect(resolved).to.not.have.property("internal_only");
    });

    it("includes non-public settings when publicOnly is false", function () {
      const resolved = resolveSettings([], { registry, publicOnly: false });
      expect(resolved.internal_only).to.equal(true);
    });

    it("defaults to publicOnly", function () {
      expect(resolveSettings([], { registry })).to.not.have.property("internal_only");
    });
  });

  describe("coerce", function () {
    it("reads the accepted boolean spellings, case-insensitively", function () {
      const definition = { type: "boolean", default: false };
      ["1", "true", "TRUE", " True "].forEach((raw) => {
        expect(coerce(definition, raw), raw).to.equal(true);
      });
      ["0", "false", "FALSE"].forEach((raw) => {
        expect(coerce(definition, raw), raw).to.equal(false);
      });
    });

    it("returns the default for null and undefined", function () {
      const definition = { type: "boolean", default: true };
      expect(coerce(definition, null)).to.equal(true);
      expect(coerce(definition, undefined)).to.equal(true);
    });

    it("parses ints and trims strings", function () {
      expect(coerce({ type: "int", default: 1 }, " 42 ")).to.equal(42);
      expect(coerce({ type: "string", default: "x" }, " hi ")).to.equal("hi");
    });

    it("returns the default for an unknown type", function () {
      expect(coerce({ type: "json", default: null }, "{}")).to.equal(null);
    });
  });

  describe("the real registry", function () {
    it("declares rebooking_prompt_enabled as a public boolean defaulting to off", function () {
      expect(SETTINGS.rebooking_prompt_enabled).to.include({
        type: "boolean",
        default: false,
        public: true,
      });
    });

    it("resolves to the prompt being disabled with no overrides", function () {
      expect(resolveSettings([])).to.deep.equal({
        rebooking_prompt_enabled: false,
        prevent_concurrent_member_bookings: false,
      });
    });

    it("enables the prompt for a club that opted in", function () {
      const resolved = resolveSettings([
        { setting_key: "rebooking_prompt_enabled", setting_value: "1" },
      ]);
      expect(resolved.rebooking_prompt_enabled).to.equal(true);
    });

    it("declares prevent_concurrent_member_bookings as a public boolean defaulting to off", function () {
      expect(SETTINGS.prevent_concurrent_member_bookings).to.include({
        type: "boolean",
        default: false,
        public: true,
      });
    });

    it("enables concurrent-member blocking for a club that opted in", function () {
      const resolved = resolveSettings([
        { setting_key: "prevent_concurrent_member_bookings", setting_value: "1" },
      ]);
      expect(resolved.prevent_concurrent_member_bookings).to.equal(true);
    });
  });
});
