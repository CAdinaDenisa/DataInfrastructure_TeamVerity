'use strict';
/** Testează endpoint-urile prin învelișul http.js, cu cereri simulate (fără runtime Azure Functions). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('../src/lib/auth');
const { setStore } = require('../src/storage');
const { createMemoryStore } = require('../src/storage/memoryStore');

// capturăm handler-ele înregistrate cu app.http
const handlers = {};
const fn = require('@azure/functions');
fn.app.http = (name, opts) => { handlers[name] = opts.handler; };
for (const f of ['telemetry', 'devices', 'sessions', 'health']) require(`../src/functions/${f}.js`);

const TOKEN_A = 'c'.repeat(64);
const TOKEN_B = 'd'.repeat(64);
process.env.AUTH_MODE = 'enabled';
process.env.DEMO_TENANTS_JSON = JSON.stringify([
  { ownerId: 'company_A', tokenHash: sha256(TOKEN_A), vehicleIds: ['CAR-01'], expiresAtUtc: '2030-01-01T00:00:00Z' },
  { ownerId: 'company_B', tokenHash: sha256(TOKEN_B), vehicleIds: ['CAR-02'], expiresAtUtc: '2030-01-01T00:00:00Z' },
]);

const logs = [];
const ctx = () => ({ invocationId: `req-${logs.length}`, log: (m) => logs.push(m), error: (m) => logs.push(m) });
function req({ method = 'GET', token, query = {}, params = {}, body }) {
  const h = new Map(token ? [['authorization', `Bearer ${token}`]] : []);
  return {
    method, params, headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    query: new URLSearchParams(query), text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const event = () => {
  const e = JSON.parse(JSON.stringify(require('../examples/event-v1-phone-app.json')));
  e.capturedAtUtc = new Date().toISOString();
  return e;
};

test('flux complet cu tokenuri: POST A -> GET A ok, GET cu tokenul B -> 403, fără token -> 401', async () => {
  setStore(createMemoryStore());
  const e = event();
  assert.equal((await handlers.telemetry(req({ method: 'POST', body: e }), ctx())).status, 401);
  const posted = await handlers.telemetry(req({ method: 'POST', token: TOKEN_A, body: e }), ctx());
  assert.equal(posted.status, 201, JSON.stringify(posted.jsonBody));
  assert.ok(posted.headers['x-request-id']);

  const q = { ownerId: 'company_A', vehicleId: 'CAR-01' };
  const ok = await handlers.telemetry(req({ token: TOKEN_A, query: q }), ctx());
  assert.equal(ok.status, 200);
  assert.equal(ok.jsonBody.countReturned, 1);
  assert.equal(ok.jsonBody.latest.eventId, e.eventId);
  assert.ok(ok.jsonBody.latest.receivedAtUtc);
  assert.ok(ok.jsonBody.latest.derived.orientation);

  assert.equal((await handlers.telemetry(req({ token: TOKEN_B, query: q }), ctx())).status, 403);
  assert.equal((await handlers.telemetry(req({ query: q }), ctx())).status, 401);

  // endpoint-urile pe device/sesiune respectă aceeași regulă
  const dev = { deviceId: e.deviceId };
  assert.equal((await handlers.listSessions(req({ token: TOKEN_A, params: dev }), ctx())).status, 200);
  assert.equal((await handlers.listSessions(req({ token: TOKEN_B, params: dev }), ctx())).status, 403);
  assert.equal((await handlers.latestState(req({ token: TOKEN_B, params: dev }), ctx())).status, 403);
  assert.equal((await handlers.sessionTrack(req({ token: TOKEN_B, params: { sessionId: e.sessionId } }), ctx())).status, 403);
  assert.equal((await handlers.sessionTrack(req({ token: TOKEN_A, params: { sessionId: e.sessionId } }), ctx())).status, 200);
  const devs = await handlers.listDevices(req({ token: TOKEN_B }), ctx());
  assert.deepEqual(devs.jsonBody, []); // firma B nu vede telefonul firmei A
});

test('loguri structurate cu requestId și eventId', async () => {
  setStore(createMemoryStore());
  logs.length = 0;
  await handlers.telemetry(req({ method: 'POST', token: TOKEN_A, body: event() }), ctx());
  const line = JSON.parse(logs.at(-1));
  assert.equal(line.endpoint, 'telemetry');
  assert.equal(line.status, 201);
  assert.ok(line.requestId && line.eventId && line.durationMs >= 0);
  assert.ok(!JSON.stringify(logs).includes(TOKEN_A)); // tokenul nu ajunge niciodată în log
});

test('body invalid -> 400, body prea mare -> 413', async () => {
  setStore(createMemoryStore());
  const bad = req({ method: 'POST', token: TOKEN_A });
  bad.text = async () => '{nu e json';
  assert.equal((await handlers.telemetry(bad, ctx())).status, 400);
  const big = req({ method: 'POST', token: TOKEN_A });
  big.text = async () => 'x'.repeat(300 * 1024);
  assert.equal((await handlers.telemetry(big, ctx())).status, 413);
});

test('health: public, fără date private', async () => {
  setStore(createMemoryStore());
  const r = await handlers.health(req({}), ctx());
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.status, 'ok');
  assert.equal(r.jsonBody.auth, 'enabled');
  assert.equal(r.jsonBody.storageMode, 'memory');
  assert.ok(!JSON.stringify(r.jsonBody).includes('company_A'));
});

test('bază de date picată -> health 503 degraded, POST 503', async () => {
  const broken = { mode: 'sql', ping: async () => { throw new Error('down'); }, getDevice: async () => { throw new Error('down'); } };
  setStore(broken);
  assert.equal((await handlers.health(req({}), ctx())).status, 503);
  assert.equal((await handlers.telemetry(req({ method: 'POST', token: TOKEN_A, body: event() }), ctx())).status, 503);
});
