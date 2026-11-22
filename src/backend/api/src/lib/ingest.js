'use strict';
/**
 * Logica POST /api/telemetry, separată de Azure Functions ca să poată fi testată direct.
 *
 * Ordinea (cum cere ghidul echipei): token verificat înainte (în http.js) -> validare -> autorizare
 * firmă/vehicul -> procesare -> salvare -> 201 DOAR după ce salvarea a reușit.
 *
 * Coduri: 201 salvat | 200 retry identic (nu se salvează din nou) | 409 același id cu alt conținut
 *         400 date invalide | 403 altă firmă/vehicul | 503 stocare indisponibilă (telefonul reîncearcă)
 * Acceptă ambele formate (lot 1.0 și evenimentul aplicației actuale), vezi validate.js.
 */
const crypto = require('crypto');
const { validateTelemetry } = require('./validate');
const { processBatch } = require('./fusion');
const { updateSessionStats } = require('./sessionStats');
const { authorize } = require('./auth');

const OPEN = { all: true };

/** JSON cu cheile sortate: același conținut => același hash, indiferent de ordinea câmpurilor. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const payloadHash = (body) => crypto.createHash('sha256').update(canonicalJson(body)).digest('hex');

async function ingest({ body, principal = OPEN, store, now = new Date() }) {
  const result = validateTelemetry(body, now);
  if (!result.ok) {
    return { status: 400, jsonBody: { error: `Date invalide: ${result.errors[0]}`, details: result.errors } };
  }
  const batch = {
    ...result.batch,
    sourceFormat: result.sourceFormat,
    payloadHash: payloadHash(body),
    payloadJson: JSON.stringify(body),
  };
  const logFields = { eventId: batch.batchId, deviceId: batch.deviceId, sessionId: batch.sessionId };

  if (!principal.all) {
    if (!batch.ownerId || !batch.vehicleId) {
      return { status: 400, jsonBody: { error: 'ownerId și vehicleId sunt obligatorii când autorizarea e activă.' }, logFields };
    }
    const denied = authorize(principal, batch.ownerId, batch.vehicleId);
    if (denied) return { ...denied, logFields };
    // un telefon înregistrat la altă firmă nu poate fi „preluat” cu tokenul tău
    const device = await store.getDevice(batch.deviceId);
    if (device && device.ownerId && device.ownerId !== principal.ownerId) {
      return { status: 403, jsonBody: { error: 'Acest deviceId aparține altei firme.' }, logFields };
    }
  }

  
  const session = (await store.getSession(batch.sessionId)) || {};
  if (session.deviceId && session.deviceId !== batch.deviceId) {
    return { status: 400, jsonBody: { error: `sessionId ${batch.sessionId} aparține altui deviceId` }, logFields };
  }

  if (batch.vehicleId && store.getActiveVehicleSession) {
    const active = await store.getActiveVehicleSession(batch.vehicleId, 30);
    if (active && active.deviceId && active.deviceId !== batch.deviceId) {
      return {
        status: 409,
        jsonBody: {
         error: `Vehiculul ${batch.vehicleId} transmite deja de pe un alt telefon activ.`,
          vehicleId: batch.vehicleId,
        },
        logFields: { ...logFields, outcome: 'vehicle_locked' },
      };
    }
  }
  const { state, sessionUpdate } = processBatch(batch, session);
  const { stats, distanceM } = updateSessionStats(session, state);
  state.distanceM = distanceM;
  Object.assign(sessionUpdate, stats);

  const saved = await store.saveBatch(batch, state, sessionUpdate);
  if (saved.duplicate) {
    if (saved.existingHash && saved.existingHash !== batch.payloadHash) {
      return {
        status: 409,
        jsonBody: { error: 'Același eventId/batchId a fost deja primit cu alt conținut.', batchId: batch.batchId },
        logFields: { ...logFields, outcome: 'conflict' },
      };
    }
    return { status: 200, jsonBody: { status: 'duplicate', batchId: batch.batchId }, logFields: { ...logFields, outcome: 'duplicate' } };
  }
  return {
    status: 201,
    jsonBody: { status: 'accepted', batchId: batch.batchId, events: batch.events.length, state },
    logFields: { ...logFields, outcome: 'stored', events: batch.events.length },
  };
}

module.exports = { ingest, payloadHash, canonicalJson };
