'use strict';
/**
 * Verificări de acces pentru endpoint-urile de citire (dashboard).
 * Aruncă HttpError(403/404) — prinse de http.js. Când AUTH_MODE=disabled, totul e permis.
 */
const { HttpError } = require('./http');
const { authorize } = require('./auth');

async function requireDevice(store, principal, deviceId) {
  if (principal.all) return;
  const device = await store.getDevice(deviceId);
  if (!device) throw new HttpError(404, 'Dispozitiv inexistent.');
  if (device.ownerId !== principal.ownerId) throw new HttpError(403, 'Tokenul nu are acces la acest dispozitiv.');
}

async function requireSession(store, principal, sessionId) {
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, 'Sesiune inexistentă.');
  if (principal.all || principal.allowAllVehicles) return session;
  await requireDevice(store, principal, session.deviceId);
  if (session.vehicleId && !principal.vehicleIds.has(session.vehicleId)) {
    throw new HttpError(403, 'Tokenul nu are acces la acest vehicul.');
  }
  return session;
}

function requireOwnerVehicle(principal, ownerId, vehicleId) {
  const denied = authorize(principal, ownerId, vehicleId);
  if (denied) throw new HttpError(denied.status, denied.jsonBody.error);
}

module.exports = { requireDevice, requireSession, requireOwnerVehicle };
