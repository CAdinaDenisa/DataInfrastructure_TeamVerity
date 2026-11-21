'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ingest } = require('../src/lib/ingest');
const { createMemoryStore } = require('../src/storage/memoryStore');
const { createSqlStore } = require('../src/storage/sqlStore');
const full = require('../examples/batch-full.json');

const NOW = new Date('2026-11-21T10:16:00Z');
const silent = { error() {} };

/** Rulează aceleași scenarii pe orice store. */
function scenarios(name, makeStore, opts = {}) {
  test(`${name}: lot acceptat, retry = duplicat, citire înapoi`, opts, async () => {
    const store = await makeStore();
    const id = Date.now();
    const batch = { ...full, deviceId: `phone-test-${id}`, sessionId: `s-test-${id}`, batchId: `b-test-${id}` };

    const r1 = await ingest({ body: batch, store, now: NOW, log: silent });
    assert.equal(r1.status, 201, JSON.stringify(r1.jsonBody));
    assert.equal(r1.jsonBody.state.position.source, 'gps+barometer');

    const r2 = await ingest({ body: batch, store, now: NOW, log: silent });
    assert.equal(r2.status, 200);
    assert.equal(r2.jsonBody.status, 'duplicate');

    const latest = await store.getLatestState(batch.deviceId);
    assert.equal(latest.batchId, batch.batchId);
    const acc = await store.getReadings(batch.deviceId, { type: 'accelerometer', sessionId: batch.sessionId });
    assert.equal(acc.length, 2);
    assert.equal(acc[0].unit, 'g');
    const gps = await store.getReadings(batch.deviceId, { type: 'gps', sessionId: batch.sessionId });
    assert.equal(gps[0].value.accuracy, 6.5);

    // al doilea lot din aceeași sesiune folosește originea salvată
    const next = JSON.parse(JSON.stringify(batch));
    next.batchId += '-2';
    next.events = next.events.map((e) => ({ ...e, seq: e.seq + 100, timestamp: e.timestamp.replace(':30.', ':31.') }));
    next.events.find((e) => e.eventType === 'gps').value.latitude += 0.0001; // ~11 m spre nord
    const r3 = await ingest({ body: next, store, now: NOW, log: silent });
    assert.equal(r3.status, 201);
    assert.ok(Math.abs(r3.jsonBody.state.position.y - 11.1) < 0.2);
    const states = await store.getStates(batch.deviceId, { sessionId: batch.sessionId });
    assert.equal(states.length, 2);
  });

  test(`${name}: lot invalid -> 400`, opts, async () => {
    const r = await ingest({ body: { hello: 1 }, store: await makeStore(), now: NOW, log: silent });
    assert.equal(r.status, 400);
  });
}

scenarios('memorie', () => createMemoryStore());

const conn = process.env.SQL_CONNECTION_STRING;
scenarios('SQL Server', () => createSqlStore(conn), {
  skip: conn ? false : 'setează SQL_CONNECTION_STRING ca să rulezi și pe baza de date locală',
});

test('cheie de dispozitiv greșită -> 401', async () => {
  process.env.DEVICE_API_KEY = 'secret';
  try {
    const r = await ingest({ body: full, deviceKey: 'gresit', store: createMemoryStore(), now: NOW, log: silent });
    assert.equal(r.status, 401);
  } finally {
    delete process.env.DEVICE_API_KEY;
  }
});

test('baza de date picată -> 503 (telefonul reîncearcă)', async () => {
  const broken = { getSession: async () => { throw new Error('down'); } };
  const r = await ingest({ body: full, store: broken, now: NOW, log: silent });
  assert.equal(r.status, 503);
});

test('evenimentul aplicației de telefon + token Bearer -> 201, retry -> 200', async () => {
  const eventV1 = require('../examples/event-v1-phone-app.json');
  process.env.DEVICE_API_KEY = 'secret';
  try {
    const store = createMemoryStore();
    const r = await ingest({ body: eventV1, deviceKey: 'secret', store, now: NOW, log: silent });
    assert.equal(r.status, 201, JSON.stringify(r.jsonBody));
    assert.equal(r.jsonBody.state.altitudeRel.source, 'barometer');
    assert.ok(r.jsonBody.state.altitudeRel.value > 1.5); // 1012.62 -> 1012.4 hPa ≈ +1.8 m față de baseline
    assert.equal((await ingest({ body: eventV1, deviceKey: 'secret', store, now: NOW, log: silent })).status, 200);
  } finally {
    delete process.env.DEVICE_API_KEY;
  }
});
