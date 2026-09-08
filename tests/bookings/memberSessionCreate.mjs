import { expect } from "chai";
import sql from "../../db/SqlConnector.js";
import { addBooking } from "../../bookings/controller.js";
import { DEFAULT_SESSION_DURATION_POLICY } from "../../club/sessionDurationPolicy.js";

const originalTransaction = sql.withTransaction;
const originalQuery = sql.runQuery;
const originalExecute = sql.runExecute;

describe("member rules in addBooking", () => {
  let inserted;
  let insertQuery;
  let overlapQuery;
  let overlapValues;
  let playerOverlapQuery;
  let playerOverlapValues;
  let body;
  let policy;
  let bumpabilityPolicy;

  beforeEach(() => {
    inserted = [];
    policy = structuredClone(DEFAULT_SESSION_DURATION_POLICY);
    bumpabilityPolicy = "second_repeater";
    insertQuery = null;
    overlapQuery = null;
    overlapValues = null;
    playerOverlapQuery = null;
    playerOverlapValues = null;
    body = {
      court: 1, date: "2026-09-05", start: "09:00", end: "09:30",
      bumpable: 1, note: null, type: 1000,
      players: [{ id: 7, type: 3000 }, { id: 8, type: 1000 }],
    };
    sql.withTransaction = async (work) => work({});
    sql.runExecute = async (_connection, query, values) => {
      if (query.includes('FROM club_setting')) {
        if (values?.[1] === "bumpability_policy") {
          return [{ setting_key: "bumpability_policy", setting_value: bumpabilityPolicy }];
        }
        return [{ setting_key: 'session_duration_policy', setting_value: JSON.stringify(policy) }];
      }
      throw new Error(`Unexpected execute: ${query}`);
    };
    sql.runQuery = async (_connection, query, values) => {
      if (query.includes("SELECT p.id,m.role")) return [{ id: 7, role: 2000 }, { id: 8, role: 2000 }];
      if (query.includes("FROM participant_type")) return body.players.map(player => ({ id: player.type }));
      if (query.includes("SELECT at.id,")) return [{ id: body.type, min_participant: 2 }];
      if (query.includes("FROM activity_supported")) return [{ supported: 1 }];
      if (query.includes("AS booking_type_desc")) return [{ group_id: body.type === 1000 ? 1 : 2, same_day_only: 1, min_participant: 2 }];
      if (query.includes("AS schedule_id")) {
        const [hour, minute] = body.end.split(":").map(Number);
        return [{ utc_start: 9 * 3600, utc_end: hour * 3600 + minute * 60, utc_req_time: 9 * 3600, numeric_date: 20260905, loc_req_date: 20260905, schedule_id: 1 }];
      }
      if (query.includes("FROM club_setting")) return [];
      if (query.includes("SELECT id FROM person")) return [{ id: 7 }, { id: 8 }];
      if (query.includes("FOR UPDATE")) {
        if (query.includes("court = ?") && query.includes("start_at")) {
          overlapQuery = query;
          overlapValues = values;
        }
        if (query.includes("p.person IN")) {
          playerOverlapQuery = query;
          playerOverlapValues = values;
        }
        return [];
      }
      if (query.includes("rt.requires_pass = 1")) return [];
      if (query.startsWith("INSERT INTO `activity`")) {
        insertQuery = query;
        inserted.push(values);
        return { insertId: 123 };
      }
      if (query.startsWith("UPDATE `activity`") || query.includes("INSERT INTO participant")) return { affectedRows: 1 };
      throw new Error(`Unexpected query: ${query}`);
    };
  });

  afterEach(() => {
    sql.withTransaction = originalTransaction;
    sql.runQuery = originalQuery;
    sql.runExecute = originalExecute;
  });

  async function rejectsBeforeInsert(message) {
    let failure;
    try { await addBooking({ body }); } catch (error) { failure = error; }
    expect(failure).to.have.property("message", message);
    expect(inserted).to.deep.equal([]);
  }

  it("rejects an unexplained bumpable override before writing", async () => {
    body.bumpable = 0;
    await rejectsBeforeInsert("Explain the session rule override in the note");
  });

  it("accepts the configured reduced duration without an override note", async () => {
    policy[2].reduced_duration_min = 60;
    body.end = '10:00';
    await addBooking({ body });
    expect(inserted).to.have.length(1);
  });

  it("uses the configured bumpability policy during creation", async () => {
    bumpabilityPolicy = "never";
    body.bumpable = 0;
    await addBooking({ body });
    expect(inserted).to.have.length(1);
  });

  it("requires a note when the club lowers its reduced duration", async () => {
    policy[2].reduced_duration_min = 20;
    await rejectsBeforeInsert('Explain the session rule override in the note');
  });

  it("uses custom full-allotment eligibility during creation", async () => {
    policy[2].full_allotment.min_non_repeaters = 1;
    body.end = '10:00';
    await addBooking({ body });
    expect(inserted).to.have.length(1);
  });

  it("rejects an unexplained duration override before writing", async () => {
    body.end = "10:00";
    await rejectsBeforeInsert("Explain the session rule override in the note");
  });

  it("rejects four hours even with an explanation", async () => {
    body.end = "13:00";
    body.note = "Approved";
    await rejectsBeforeInsert("Member sessions must be between 5 and 180 minutes long");
  });

  it("writes a normal session without requiring a note", async () => {
    await addBooking({ body });
    expect(inserted).to.have.length(1);
    expect(insertQuery).to.include("start_at");
    expect(insertQuery).to.include("FROM_UNIXTIME");
    expect(insertQuery).to.not.include("`start`");
    expect(insertQuery).to.not.include("`end`");
    expect(inserted[0][3]).to.equal(9 * 3600);
    expect(inserted[0][4]).to.equal(9 * 3600 + 30 * 60);
    expect(overlapQuery).to.include("INTERVAL 2 DAY");
    expect(overlapQuery).to.include("start_at >=");
    expect(overlapValues).to.deep.equal([
      9 * 3600,
      9 * 3600 + 30 * 60,
      9 * 3600,
      1,
    ]);
    expect(playerOverlapQuery).to.include("INTERVAL 2 DAY");
    expect(playerOverlapQuery).to.include("a.start_at <= UTC_TIMESTAMP()");
    expect(playerOverlapValues).to.deep.equal([
      1,
      [[7, 8]],
      9 * 3600,
      9 * 3600 + 30 * 60,
      9 * 3600,
      "2026-09-05",
    ]);
  });

  it("writes an explained override within the absolute maximum", async () => {
    body.end = "10:00";
    body.bumpable = 0;
    body.note = "Approved extra time";
    await addBooking({ body });
    expect(inserted).to.have.length(1);
  });

  it("preserves four-hour club events with host participant types", async () => {
    body.type = 2000;
    body.end = "13:00";
    body.players = body.players.map(player => ({ ...player, type: 4000 }));
    await addBooking({ body });
    expect(inserted).to.have.length(1);
  });
});
