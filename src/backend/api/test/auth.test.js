'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticate, authorize, authStatus, sha256, parseTenants } = require('../src/lib/auth');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const tenants = [
  { ownerId: 'company_A', tokenHash: sha256(TOKEN_A), vehicleIds: ['CAR-01'], expiresAtUtc: '2030-01-01T00:00:00Z' },
  { ownerId: 'company_B', tokenHash: sha256(TOKEN_B), vehicleIds: ['CAR-02'], expiresAtUtc: '2020-01-01T00:00:00Z' },
];
const headers = (h) => new Map(Object.entries(h));

function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
  }
}
const ON = { AUTH_MODE: 'enabled', DEMO_TENANTS_JSON: JSON.stringify(tenants) };

test('fără header / token necunoscut / token expirat -> 401', () => withEnv(ON, () => {
  assert.equal(authenticate(headers({})).status, 401);
  assert.equal(authenticate(headers({ authorization: 'Bearer nu-exista' })).status, 401);
  const expired = authenticate(headers({ authorization: `Bearer ${TOKEN_B}` }));
  assert.equal(expired.status, 401);
  assert.match(expired.jsonBody.error, /expirat/);
}));

test('token valid -> principal cu firma și vehiculele ei', () => withEnv(ON, () => {
  const r = authenticate(headers({ authorization: `Bearer ${TOKEN_A}` }));
  assert.equal(r.ok, true);
  assert.equal(r.principal.ownerId, 'company_A');
  assert.equal(authorize(r.principal, 'company_A', 'CAR-01'), null);
  assert.equal(authorize(r.principal, 'company_B', 'CAR-02').status, 403);
  assert.equal(authorize(r.principal, 'company_A', 'CAR-99').status, 403);
  assert.equal(authStatus(), 'enabled');
}));

test('fără DEMO_TENANTS_JSON autorizarea rămâne activă (nimic nu trece); doar AUTH_MODE=disabled o oprește', () => {
  withEnv({ AUTH_MODE: 'enabled', DEMO_TENANTS_JSON: '' }, () => {
    assert.equal(authenticate(headers({ authorization: `Bearer ${TOKEN_A}` })).status, 401);
    assert.equal(authStatus(), 'enabled-no-tenants');
  });
  withEnv({ AUTH_MODE: 'disabled' }, () => {
    assert.equal(authenticate(headers({})).principal.all, true);
    assert.equal(authStatus(), 'disabled');
  });
});

test('hartă de firme invalidă -> misconfigured, nimeni nu trece', () => withEnv({ AUTH_MODE: 'enabled', DEMO_TENANTS_JSON: '{nu e json' }, () => {
  assert.equal(authStatus(), 'misconfigured');
  assert.equal(authenticate(headers({ authorization: `Bearer ${TOKEN_A}` })).status, 401);
  assert.deepEqual(parseTenants('[{"ownerId":"x","tokenHash":"scurt"}]'), []);
}));
