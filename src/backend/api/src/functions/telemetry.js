'use strict';
/**
 * /api/telemetry
 *  POST  telefonul trimite citiri (lot 1.0 sau evenimentul aplicației actuale)   -> 201 / 200 / 409 / 400 / 401 / 403
 *  GET   ?ownerId=&vehicleId=&sessionId=&from=&to=&limit=  (contractul din ghidul echipei, pentru dashboard)
 *        -> { ownerId, vehicleId, latest, countReturned, events }  evenimentele cele mai noi primele
 * Documentație: src/backend/docs/01-format-json.md și 06-securitate-si-operare.md
 */
const { app } = require('@azure/functions');
const { ingest } = require('../lib/ingest');
const { endpoint, HttpError, intParam, timeParam } = require('../lib/http');
const { requireOwnerVehicle } = require('../lib/access');

const MAX_BODY_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

async function post({ request, principal, store }) {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, 'Body prea mare (max 256 KB).');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body-ul nu este JSON valid.');
  }
  return ingest({ body, principal, store });
}

async function get({ request, principal, store }) {
  const ownerId = request.query.get('ownerId');
  const vehicleId = request.query.get('vehicleId');
  if (!ownerId || !vehicleId || !ID.test(ownerId) || !ID.test(vehicleId)) {
    throw new HttpError(400, 'ownerId și vehicleId sunt obligatorii (litere, cifre, _ . : -).');
  }
  requireOwnerVehicle(principal, ownerId, vehicleId); // 403 înainte de orice citire din bază
  const items = await store.listTelemetry({
    ownerId,
    vehicleId,
    sessionId: request.query.get('sessionId') || undefined,
    from: timeParam(request, 'from'),
    to: timeParam(request, 'to'),
    limit: intParam(request, 'limit', 100, 1, 200),
  });
  const events = items.map((it) => ({
    ...(it.payload || { eventId: it.batchId, deviceId: it.deviceId, sessionId: it.sessionId }),
    receivedAtUtc: it.receivedAt,
    derived: it.state && {
      capturedAtUtc: it.capturedAt,
      orientation: it.state.orientation,
      altitudeRel: it.state.altitudeRel,
      position: it.state.position,
      distanceM: it.state.distanceM,
      advice: it.state.advice,
    },
  }));
  return {
    jsonBody: { ownerId, vehicleId, latest: events[0] || null, countReturned: events.length, events },
    logFields: { ownerId, vehicleId, countReturned: events.length },
  };
}

app.http('telemetry', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // autorizarea o face aplicația, cu tokenul firmei, la fiecare cerere
  route: 'telemetry',
  handler: endpoint('telemetry', (ctx) => (ctx.request.method === 'POST' ? post(ctx) : get(ctx))),
});
