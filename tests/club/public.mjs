import { expect } from "chai";
import express from "express";
import request from "supertest";

import clubRouter from "../../club/api.js";
import clubController from "../../club/controller.js";
import errorHandler from "../../utils/errorHandler.js";

const { toPublicClub } = clubController;
const originalGetClubInfo = clubController.getClubInfo;

function createApp() {
  const app = express();
  app.use("/club", clubRouter);
  app.use(errorHandler);
  return app;
}

function fullClub(overrides = {}) {
  return {
    id: 1,
    name: "Knickerbocker",
    time_zone: "America/New_York",
    guest_req_limit: 6,
    default_cal_start: "07:00:00",
    default_cal_start_min: 420,
    default_cal_end: "22:00:00",
    default_cal_end_min: 1320,
    images: [{ name: "CLUB_LOGO", src: "logo.webp", secret: "nope" }],
    about_sections: [
      {
        title: "History",
        image_url: "about.webp",
        text: "Founded in 1889",
        sort_order: 1,
      },
    ],
    settings: {
      rebooking_prompt_enabled: true,
      prevent_concurrent_member_bookings: true,
      require_guests_accompanied_by_member: true,
      internal_only: true,
    },
    roles: [
      {
        id: 4000,
        label: "Administrator",
        type_id: 200,
        type_label: "Staff",
        event_host: 1,
        guest_host: 1,
        requires_pass: 0,
        public_label: "Member",
      },
    ],
    extra: "leak",
    ...overrides,
  };
}

describe("toPublicClub", () => {
  it("keeps branding, hours, about copy, and public settings", () => {
    const dto = toPublicClub(fullClub());

    expect(dto).to.include({
      id: 1,
      name: "Knickerbocker",
      time_zone: "America/New_York",
      default_cal_start: "07:00:00",
      default_cal_start_min: 420,
      default_cal_end: "22:00:00",
      default_cal_end_min: 1320,
    });
    expect(dto.images).to.deep.equal([{ name: "CLUB_LOGO", src: "logo.webp" }]);
    expect(dto.about_sections).to.deep.equal([
      {
        title: "History",
        image_url: "about.webp",
        text: "Founded in 1889",
      },
    ]);
    expect(dto.settings).to.deep.equal({
      rebooking_prompt_enabled: true,
      prevent_concurrent_member_bookings: true,
      require_guests_accompanied_by_member: true,
    });
  });

  it("redacts role capabilities and internal labels", () => {
    const dto = toPublicClub(fullClub());

    expect(dto.roles).to.deep.equal([{ id: 4000, public_label: "Member" }]);
    expect(dto.roles[0]).to.not.have.property("label");
    expect(dto.roles[0]).to.not.have.property("event_host");
    expect(dto.roles[0]).to.not.have.property("guest_host");
    expect(dto.roles[0]).to.not.have.property("requires_pass");
    expect(dto.roles[0]).to.not.have.property("type_id");
    expect(dto.roles[0]).to.not.have.property("type_label");
  });

  it("drops guest-reg internals and unknown keys, including from a stale cache", () => {
    const dto = toPublicClub(fullClub());

    expect(dto).to.not.have.property("guest_req_limit");
    expect(dto).to.not.have.property("extra");
    expect(dto.settings).to.not.have.property("internal_only");
    expect(dto.images[0]).to.not.have.property("secret");
    expect(dto.about_sections[0]).to.not.have.property("sort_order");
  });

  it("fills missing public settings from registry defaults", () => {
    const dto = toPublicClub(fullClub({ settings: {} }));

    expect(dto.settings).to.deep.equal({
      rebooking_prompt_enabled: false,
      prevent_concurrent_member_bookings: true,
      require_guests_accompanied_by_member: true,
    });
  });

  it("treats missing arrays as empty", () => {
    const dto = toPublicClub({
      id: 1,
      name: "Knickerbocker",
      time_zone: "America/New_York",
    });

    expect(dto.images).to.deep.equal([]);
    expect(dto.about_sections).to.deep.equal([]);
    expect(dto.roles).to.deep.equal([]);
  });
});

describe("GET /club", () => {
  afterEach(() => {
    clubController.getClubInfo = originalGetClubInfo;
  });

  it("returns the public DTO without authentication", async () => {
    clubController.getClubInfo = async () => fullClub();

    const response = await request(createApp()).get("/club");

    expect(response.status).to.equal(200);
    expect(response.body.roles).to.deep.equal([
      { id: 4000, public_label: "Member" },
    ]);
    expect(response.body).to.not.have.property("guest_req_limit");
    expect(response.body).to.not.have.property("extra");
    expect(response.body.settings).to.not.have.property("internal_only");
    expect(response.body.name).to.equal("Knickerbocker");
    expect(response.body.time_zone).to.equal("America/New_York");
  });

  it("projects a stale cached payload on the way out", async () => {
    clubController.getClubInfo = async () =>
      fullClub({
        roles: [
          {
            id: 3000,
            label: "Manager",
            event_host: 1,
            guest_host: 1,
            public_label: "Member",
          },
        ],
      });

    const response = await request(createApp()).get("/club");

    expect(response.status).to.equal(200);
    expect(response.body.roles).to.deep.equal([
      { id: 3000, public_label: "Member" },
    ]);
  });
});
