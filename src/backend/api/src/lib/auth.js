'use strict';
/**
 * Autorizare demo cu token per firmă (cum cere ghidul echipei).
 *
 * DEMO_TENANTS_JSON (setare server, secretă) conține DOAR hash-uri SHA-256 ale tokenurilor:
 *   [{ "ownerId": "company_A", "tokenHash": "<sha256 hex>", "vehicleIds": ["CAR-01"], "expiresAtUtc": "2026-11-22T10:00:00Z" }]
 * Telefonul/dashboard-ul trimit tokenul brut în header: Authorization: Bearer <token>.
 *
 * 401 = token lipsă, necunoscut sau expirat.  403 = token valid, dar pentru altă firmă / alt vehicul.
 * Verificarea se face înainte de orice citire de date ale firmei.
 */
const crypto = require('crypto');
const config = require('./config');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function parseTenants(json) {
  if (!json) return [];
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    return { error: 'DEMO_TENANTS_JSON nu este JSON valid' };
  }
  if (!Array.isArray(list)) return { error: 'DEMO_TENANTS_JSON trebuie să fie o listă' };
  return list
    .filter((t) => t && typeof t.ownerId === 'string' && /^[0-9a-fA-F]{64}$/.test(t.tokenHash || ''))
    .map((t) => ({
      ownerId: t.ownerId,
      tokenHash: t.tokenHash.toLowerCase(),
      vehicleIds: Array.isArray(t.vehicleIds) ? t.vehicleIds.map(String) : [],
      expiresAtUtc: t.expiresAtUtc || null,
    }));
}

let cache = { json: undefined, tenants: [] };
function tenants() {
  const json = config.getTenantsJson();
  if (json !== cache.json) {
    const parsed = parseTenants(json);
    cache = { json, tenants: Array.isArray(parsed) ? parsed : [], error: parsed.error };
  }
  return cache;
}

const deny = (status, error) => ({ ok: false, status, jsonBody: { error } });

/**
 * @returns {{ ok: true, principal } | { ok: false, status, jsonBody }}
 * principal = { ownerId, vehicleIds: Set, all: false }  sau  { all: true } când AUTH_MODE=disabled
 */
function authenticate(headers, now = new Date()) {
  if (config.isAuthDisabled()) return { ok: true, principal: { all: true, ownerId: null, vehicleIds: null } };
  const header = headers.get ? headers.get('authorization') : headers.authorization;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header || '');
  if (!match) return deny(401, 'Lipsește header-ul Authorization: Bearer <token>.');

 const hash = Buffer.from(sha256(match[1]), 'hex');
  const tenant = tenants().tenants.find((t) => {
    const candidate = Buffer.from(t.tokenHash, 'hex');
    return candidate.length === hash.length && crypto.timingSafeEqual(candidate, hash);
  });
  if (!tenant) return deny(401, 'Token necunoscut.');
  if (tenant.expiresAtUtc && Date.parse(tenant.expiresAtUtc) <= now.getTime()) return deny(401, 'Token expirat.');
  const vehicleIds = new Set(tenant.vehicleIds);
  return {
    ok: true,
    principal: {
      all: false,
      allowAllVehicles: vehicleIds.has('*'),
      ownerId: tenant.ownerId,
      vehicleIds,
    },
  };
}

/** Verifică firma (și vehiculul, dacă e dat). Întoarce null dacă e permis, altfel răspunsul 403. */
function authorize(principal, ownerId, vehicleId) {
  if (principal.all) return null;
  if (ownerId == null || ownerId !== principal.ownerId) {
    return { status: 403, jsonBody: { error: 'Tokenul nu are acces la această firmă (ownerId).' } };
  }
  if (vehicleId != null && !principal.allowAllVehicles && !principal.vehicleIds.has(vehicleId)) {
    return { status: 403, jsonBody: { error: 'Tokenul nu are acces la acest vehicul (vehicleId).' } };
  }
  return null;
}

/** Pentru /api/health: starea autorizării, fără detalii secrete. */
function authStatus() {
  if (config.isAuthDisabled()) return 'disabled';
  const t = tenants();
  if (t.error) return 'misconfigured';
  return t.tenants.length ? 'enabled' : 'enabled-no-tenants';
}

module.exports = { authenticate, authorize, authStatus, parseTenants, sha256 };
