import { expect } from "chai";

import settingsModule from "../../guest-pass-types/settings.js";

const {
  SETTINGS,
  resolvePassTypeSettings,
  resolveSettingsByPassType,
  settingsForPassType,
} = settingsModule;

describe("guest pass type settings", function () {
  it("declares play_after as a public time defaulting to unrestricted", function () {
    expect(SETTINGS.play_after).to.include({
      type: "time",
      default: null,
      public: true,
    });
  });

  it("resolves to no play_after when there are no overrides", function () {
    expect(resolvePassTypeSettings([])).to.deep.equal({ play_after: null });
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
});
