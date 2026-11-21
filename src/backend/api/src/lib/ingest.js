'use strict';
const { validateTelemetry } = require('./validate');
const { processBatch } = require('./fusion');
const config = require('./config');

/**
 * Logica POST /api/telemetry, separată de Azure Functions ca să poată fi testată direct.
 * Coduri: 201 acceptat, 200 duplicat (retry), 400 invalid (nu reîncerca), 401 cheie greșită,
 * 503 baza de date indisponibilă (reîncearcă). Aplicația de telefon tratează 200 și 201 ca succes.
 * Acceptă ambele formate (lot 1.0 și evenimentul aplicației actuale), vezi validate.js.
 */
async function ingest({ body, deviceKey, store, log = console, now = new Date() }) {
  const expectedKey = config.getDeviceApiKey();
  if (expectedKey && deviceKey !== expectedKey) {
    return { status: 401, jsonBody: { error: 'Cheie lipsă sau greșită (header Authorization: Bearer <cheie> sau x-device-key).' } };
  }

  const result = validateTelemetry(body, now);
  if (!result.ok) {
    return { status: 400, jsonBody: { error: `Date invalide: ${result.errors[0]}`, details: result.errors } };
  }
  const batch = { ...result.batch, sourceFormat: result.sourceFormat };

  try {
    const session = (await store.getSession(batch.sessionId)) || {};
    if (session.deviceId && session.deviceId !== batch.deviceId) {
      return { status: 400, jsonBody: { error: `sessionId ${batch.sessionId} aparține altui deviceId` } };
    }
    const { state, sessionUpdate } = processBatch(batch, session);
    const { duplicate } = await store.saveBatch(batch, state, sessionUpdate);
    if (duplicate) return { status: 200, jsonBody: { status: 'duplicate', batchId: batch.batchId } };
    return { status: 201, jsonBody: { status: 'accepted', batchId: batch.batchId, events: batch.events.length, state } };
  } catch (err) {
    log.error?.(`Eroare la salvare: ${err.message}`);
    return { status: 503, jsonBody: { error: 'Stocare indisponibilă, reîncearcă.' } };
  }
}

module.exports = { ingest };
