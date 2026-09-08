import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sql from '../../db/SqlConnector.js';
import clubRouter from '../../club/api.js';
import bookingsRouter from '../../bookings/api.js';
import errorHandler from '../../utils/errorHandler.js';
import { DEFAULT_SESSION_DURATION_POLICY as defaults, sessionDurationPolicySchema } from '../../club/sessionDurationPolicy.js';
import { resolveSettings } from '../../club/settings.js';
import { resolveSessionRules } from '../../bookings/sessionRules.js';
import logger from '../../utils/logger/logger.js';

function appFor(role = 4000, userauth = true, geoauth = false) {
  const app = express();
  app.use((_req, res, next) => {
    Object.assign(res.locals, { role, userauth, geoauth });
    next();
  });
  app.use('/club', clubRouter);
  app.use('/bookings', bookingsRouter);
  app.use(errorHandler);
  return app;
}

describe('session duration policy', () => {
  it('keeps the exact original minimum and maximum defaults', () => {
    expect(Object.values(defaults).map(row => row.full_allotment)).to.deep.equal([
      { min_non_repeaters: 0, max_second_repeaters: 1 },
      { min_non_repeaters: 2, max_second_repeaters: 2 },
      { min_non_repeaters: 2, max_second_repeaters: 0 },
      { min_non_repeaters: 4, max_second_repeaters: 4 },
    ]);
    expect(sessionDurationPolicySchema.safeParse(defaults).success).to.equal(true);
  });

  it('keeps all solo players eligible when full and reduced durations differ', () => {
    const policy = structuredClone(defaults);
    policy[1].reduced_duration_min = 20;
    for (const type of [1000, 2000, 3000]) {
      expect(resolveSessionRules([type], policy).max_duration_min).to.equal(45);
    }
    policy[1].full_allotment.min_non_repeaters = 1;
    expect(resolveSessionRules([1000], policy).max_duration_min).to.equal(45);
    expect(resolveSessionRules([2000], policy).max_duration_min).to.equal(20);
    expect(resolveSessionRules([3000], policy).max_duration_min).to.equal(20);
  });

  it('supports nobody and custom second-repeater limits without changing bumpability', () => {
    const policy = structuredClone(defaults);
    policy[4].full_allotment = { min_non_repeaters: 1, max_second_repeaters: 1 };
    expect(resolveSessionRules([1000, 2000, 2000, 3000], policy)).to.include({ max_duration_min: 90, bumpable: true });
    expect(resolveSessionRules([1000, 2000, 3000, 3000], policy).max_duration_min).to.equal(45);
    policy[4].full_allotment = null;
    expect(resolveSessionRules([1000, 1000, 1000, 1000], policy).max_duration_min).to.equal(45);
  });

  it('uses the complete default policy and logs malformed stored overrides', () => {
    const originalLog = logger.log;
    const warnings = [];
    logger.log = (...args) => warnings.push(args);
    try {
      for (const raw of ['{', '{}', 'null', JSON.stringify({ ...defaults, 2: { full_duration_min: 60 } })]) {
        expect(resolveSettings([{ setting_key: 'session_duration_policy', setting_value: raw }], { publicOnly: false }).session_duration_policy).to.deep.equal(defaults);
      }
      expect(warnings).to.have.length(4);
      expect(resolveSettings([])).not.to.have.property('session_duration_policy');
    } finally { logger.log = originalLog; }
  });
});

describe('session duration settings API and persistence', () => {
  const originalConnection = sql.withConnection;
  const originalExecute = sql.runExecute;
  let stored;
  let writes;
  let failWrite;

  beforeEach(() => {
    stored = null;
    writes = 0;
    failWrite = false;
    sql.withConnection = async work => work({});
    sql.runExecute = async (_connection, query, values) => {
      expect(values[0]).to.equal(process.env.CLUB_ID);
      if (values[1] === 'bumpability_policy' && query.startsWith('SELECT')) return [];
      expect(values[1]).to.equal('session_duration_policy');
      if (query.startsWith('SELECT')) return stored === null ? [] : [{ setting_key: values[1], setting_value: stored }];
      expect(query).to.include('ON DUPLICATE KEY UPDATE');
      if (failWrite) throw new Error('Write failed');
      stored = values[2];
      writes++;
      return { affectedRows: 1 };
    };
  });

  afterEach(() => {
    sql.withConnection = originalConnection;
    sql.runExecute = originalExecute;
  });

  it('returns defaults and persists an atomic policy used by subsequent recommendations', async () => {
    const app = appFor();
    const initial = await request(app).get('/club/session-duration-policy');
    expect(initial.status).to.equal(200);
    expect(initial.body).to.deep.equal({ policy: defaults, defaults });
    const policy = structuredClone(defaults);
    policy[3].full_duration_min = 75;
    policy[3].full_allotment.max_second_repeaters = 1;
    const saved = await request(app).put('/club/session-duration-policy').send(policy);
    expect(saved.status).to.equal(200);
    expect(saved.body.policy).to.deep.equal(policy);
    expect(writes).to.equal(1);
    expect((await request(app).get('/club/session-duration-policy')).body.policy).to.deep.equal(policy);
    const recommended = await request(app).get('/bookings/session-rules').query({ player_types: '1000,1000,3000' });
    expect(recommended.status).to.equal(200);
    expect(recommended.body).to.include({ max_duration_min: 75, bumpable: true });
    await request(app).put('/club/session-duration-policy').send(defaults).expect(200);
    expect((await request(app).get('/bookings/session-rules').query({ player_types: '1000,1000,3000' })).body.max_duration_min).to.equal(30);
  });

  it('requires administrator access, including for trusted-network clients', async () => {
    for (const app of [appFor(null, false), appFor(2000), appFor(3000), appFor(null, false, true)]) {
      await request(app).get('/club/session-duration-policy').expect(401);
      await request(app).put('/club/session-duration-policy').send(defaults).expect(401);
    }
    expect(writes).to.equal(0);
  });

  it('rejects incomplete, out-of-range, nonnumeric and unknown fields before writing', async () => {
    const mutations = [
      policy => { delete policy[4]; },
      policy => { policy[1].full_duration_min = 181; },
      policy => { policy[1].full_duration_min = 4; },
      policy => { policy[1].full_duration_min = 45.5; },
      policy => { policy[1].full_duration_min = '45'; },
      policy => { policy[2].reduced_duration_min = 90; },
      policy => { policy[2].full_allotment.min_non_repeaters = 3; },
      policy => { policy[2].full_allotment.max_second_repeaters = -1; },
      policy => { policy[2].full_allotment.max_second_repeaters = 3; },
      policy => { policy[2].full_allotment.min_non_repeaters = 0.5; },
      policy => { policy.club = 99; },
      policy => { policy[2].script = 'true'; },
    ];
    for (const mutate of mutations) {
      const policy = structuredClone(defaults);
      mutate(policy);
      await request(appFor()).put('/club/session-duration-policy').send(policy).expect(422);
    }
    expect(writes).to.equal(0);
  });

  it('reports persistence failures without claiming success', async () => {
    failWrite = true;
    await request(appFor()).put('/club/session-duration-policy').send(defaults).expect(500);
    expect(stored).to.equal(null);
  });
});
