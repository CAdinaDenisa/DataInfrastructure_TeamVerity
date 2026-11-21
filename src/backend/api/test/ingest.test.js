'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ingest } = require('../src/lib/ingest');
const { createMemoryStore } = require('../src/storage/memoryStore');
const { createSqlStore } = require('../src/storage/sqlStore');
const full = require('../examples/batch-full.json');

const NOW = new Date('2026-11-21T10:16:00Z');

/** Rulează aceleași scenarii pe orice store. */
function scenarios(name, makeStore, opts = {}) {
  test(`${name}: lot acceptat, retry = duplicat, citire înapoi`, opts, async () => {
    const store = await makeStore();
    const id = Date.now();
    const batch = { ...full, deviceId: `phone-test-${id}`, sessionId: `s-test-${id}`, batchId: `b-test-${id}`, vehicleId: `CAR-${id}` };

    const r1 = await ingest({ body: batch, store, now: NOW });
    assert.equal(r1.status, 201, JSON.stringify(r1.jsonBody));
    assert.equal(r1.jsonBody.state.position.source, 'gps+barometer');

    const r2 = await ingest({ body: batch, store, now: NOW });
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
    const r3 = await ingest({ body: next, store, now: NOW });
    assert.equal(r3.status, 201);
    assert.ok(Math.abs(r3.jsonBody.state.position.y - 11.1) < 0.2);
    const states = await store.getStates(batch.deviceId, { sessionId: batch.sessionId });
    assert.equal(states.length, 2);

    // GET /api/telemetry: cele mai noi primele, cu payload-ul original + starea procesată
    const items = await store.listTelemetry({ ownerId: batch.ownerId, vehicleId: batch.vehicleId, limit: 10 });
    assert.deepEqual(items.map((i) => i.batchId), [next.batchId, batch.batchId]);
    assert.equal(items[0].payload.batchId, next.batchId);
    assert.ok(items[0].state.position.y > 11);
    assert.ok(items[0].receivedAt);

    // același id cu alt conținut -> 409
    const conflict = { ...batch, sentAt: '2026-11-21T10:15:59.000Z' };
    assert.equal((await ingest({ body: conflict, store, now: NOW })).status, 409);
  });

  test(`${name}: lot invalid -> 400`, opts, async () => {
    const r = await ingest({ body: { hello: 1 }, store: await makeStore(), now: NOW });
    assert.equal(r.status, 400);
  });
}

scenarios('memorie', () => createMemoryStore());

const conn = process.env.SQL_CONNECTION_STRING;
scenarios('SQL Server', () => createSqlStore(conn), {
  skip: conn ? false : 'setează SQL_CONNECTION_STRING ca să rulezi și pe baza de date locală',
});

test('baza de date picată -> eroarea urcă la http.js (care răspunde 503)', async () => {
  const broken = { getSession: async () => { throw new Error('down'); } };
  await assert.rejects(ingest({ body: full, store: broken, now: NOW }), /down/);
});

test('evenimentul aplicației de telefon -> 201, retry identic -> 200, alt conținut -> 409', async () => {
  const eventV1 = require('../examples/event-v1-phone-app.json');
  const store = createMemoryStore();
  const r = await ingest({ body: eventV1, store, now: NOW });
  assert.equal(r.status, 201, JSON.stringify(r.jsonBody));
  assert.equal(r.jsonBody.state.altitudeRel.source, 'barometer');
  assert.ok(r.jsonBody.state.altitudeRel.value > 1.5); // 1012.62 -> 1012.4 hPa ≈ +1.8 m față de baseline
  // aceleași date, chei în altă ordine -> tot retry identic
  const reordered = Object.fromEntries(Object.entries(eventV1).reverse());
  assert.equal((await ingest({ body: reordered, store, now: NOW })).status, 200);
  const changed = { ...eventV1, acceleration: { ...eventV1.acceleration, x: 0.5 } };
  assert.equal((await ingest({ body: changed, store, now: NOW })).status, 409);
});

test('autorizare la POST: altă firmă / alt vehicul -> 403, fără ownerId -> 400', async () => {
  const eventV1 = require('../examples/event-v1-phone-app.json');
  const store = createMemoryStore();
  const A = { all: false, ownerId: 'company_A', vehicleIds: new Set(['CAR-01']) };
  const B = { all: false, ownerId: 'company_B', vehicleIds: new Set(['CAR-02']) };
  assert.equal((await ingest({ body: eventV1, principal: B, store, now: NOW })).status, 403);
  assert.equal((await ingest({ body: { ...eventV1, vehicleId: 'CAR-09' }, principal: A, store, now: NOW })).status, 403);
  assert.equal((await ingest({ body: eventV1, principal: A, store, now: NOW })).status, 201);
  // același telefon, trimis apoi de firma B pentru vehiculul ei -> 403 (telefonul e al lui A)
  const hijack = { ...eventV1, eventId: 'e-hijack-0001', ownerId: 'company_B', vehicleId: 'CAR-02' };
  assert.equal((await ingest({ body: hijack, principal: B, store, now: NOW })).status, 403);
  const noOwner = require('../examples/batch-no-barometer-no-gps.json');
  assert.equal((await ingest({ body: noOwner, principal: A, store, now: new Date('2026-11-21T10:20:00Z') })).status, 400);
});

test('sesiunea acumulează distanța și apare în listSessions', async () => {
  const store = createMemoryStore();
  const base = require('../examples/batch-full.json');
  for (let i = 0; i < 5; i++) {
    const b = JSON.parse(JSON.stringify(base));
    b.batchId = `b-sess-${i}`;
    b.events = b.events.map((e) => ({ ...e, timestamp: e.timestamp.replace(':30.', `:3${i}.`) }));
    b.events.find((e) => e.eventType === 'gps').value.latitude += i * 0.0001; // ~11 m spre nord la fiecare lot
    const r = await ingest({ body: b, store, now: NOW });
    assert.equal(r.status, 201, JSON.stringify(r.jsonBody));
  }
  const [s] = await store.listSessions(base.deviceId);
  assert.ok(Math.abs(s.distanceM - 44.5) < 0.5, `distance ${s.distanceM}`);
  assert.equal(s.batchCount, 5);
  const states = await store.getSessionStates(base.sessionId);
  assert.equal(states.length, 5);
  assert.ok(states[4].distanceM > 44);
});
