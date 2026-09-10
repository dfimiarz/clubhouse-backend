import { expect } from "chai";

import settingsModule from "../../guest-pass-types/settings.js";
import rules from "../../guest-pass-types/rules.js";

const {
  SETTINGS,
  resolvePassTypeSettings,
  resolveSettingsByPassType,
  settingsForPassType,
  constraintsFromSettings,
  passTypeRules,
  rulesForPassType,
} = settingsModule;

describe("guest pass type settings", function () {
  it("normalizes a stored full week to the unrestricted default, including with an unreadable date", function () {
    const settings = resolvePassTypeSettings([
      { setting_key: "allowed_days", setting_value: "[7,6,5,4,3,2,1]" },
    ]);
    expect(settings.allowed_days).to.equal(null);
    expect(constraintsFromSettings(settings)).to.deep.equal([]);
    expect(rules.evaluatePassRules(settings, { date: "invalid" })).to.deep.equal({ ok: true });
  });
  it("resolves JSON weekdays and labels selected days", function () {
    const settings = resolvePassTypeSettings([
      { setting_key: "allowed_days", setting_value: "[7,6]" },
    ]);
    expect(settings.allowed_days).to.deep.equal([6, 7]);
    expect(constraintsFromSettings(settings)).to.deep.equal([
      { key: "allowed_days", text: "Play on Saturday, Sunday only" },
    ]);
    expect(constraintsFromSettings({ allowed_days: [1, 2, 3, 4, 5, 6, 7] })).to.deep.equal([]);
  });

  it("uses the unrestricted default for invalid stored days", function () {
    for (const value of ['broken', '[]', '[0]', '[8]', '[1,1]', '["1"]', '{}']) {
      expect(resolvePassTypeSettings([
        { setting_key: "allowed_days", setting_value: value },
      ]).allowed_days).to.equal(null);
    }
  });
  it("declares play_after as a public time defaulting to unrestricted", function () {
    expect(SETTINGS.play_after).to.include({
      type: "time",
      default: null,
      public: true,
    });
  });

  it("resolves to no play_after when there are no overrides", function () {
    expect(resolvePassTypeSettings([])).to.deep.equal({ play_after: null, allowed_days: null });
  });

  it("coerces a play_after override", function () {
    expect(
      resolvePassTypeSettings([
        { setting_key: "play_after", setting_value: "12:00" },
      ]).play_after
    ).to.equal("12:00");
  });

  it("falls back to unrestricted for an unreadable play_after", function () {
    expect(
      resolvePassTypeSettings([
        { setting_key: "play_after", setting_value: "noon" },
      ]).play_after
    ).to.equal(null);
  });

  it("groups rows by pass type", function () {
    const byType = resolveSettingsByPassType([
      { pass_type: 2, setting_key: "play_after", setting_value: "12:00" },
      { pass_type: 3, setting_key: "play_after", setting_value: "14:00" },
    ]);

    expect(settingsForPassType(byType, 2).play_after).to.equal("12:00");
    expect(settingsForPassType(byType, 3).play_after).to.equal("14:00");
    expect(settingsForPassType(byType, 9).play_after).to.equal(null);
  });

  it("omits constraints when every rule is unrestricted", function () {
    expect(constraintsFromSettings(resolvePassTypeSettings([]))).to.deep.equal(
      []
    );
    expect(passTypeRules(resolvePassTypeSettings([])).constraints).to.deep.equal(
      []
    );
  });

  it("labels an active play_after for display", function () {
    expect(
      constraintsFromSettings({ play_after: "12:00" })
    ).to.deep.equal([
      { key: "play_after", text: "Play at or after 12:00" },
    ]);
  });

  it("does not label a null or missing play_after", function () {
    expect(constraintsFromSettings({ play_after: null })).to.deep.equal([]);
    expect(constraintsFromSettings({})).to.deep.equal([]);
    expect(constraintsFromSettings(undefined)).to.deep.equal([]);
  });

  it("attaches settings and constraints for a type", function () {
    const byType = resolveSettingsByPassType([
      { pass_type: 2, setting_key: "play_after", setting_value: "12:00" },
    ]);

    expect(rulesForPassType(byType, 2)).to.deep.equal({
      settings: { play_after: "12:00", allowed_days: null },
      constraints: [{ key: "play_after", text: "Play at or after 12:00" }],
    });
    expect(rulesForPassType(byType, 9)).to.deep.equal({
      settings: { play_after: null, allowed_days: null },
      constraints: [],
    });
  });
});
