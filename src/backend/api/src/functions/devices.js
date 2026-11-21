'use strict';
const { app } = require('@azure/functions');
const { endpoint, HttpError, intParam, timeParam } = require('../lib/http');
const { requireDevice } = require('../lib/access');

const SENSOR_TYPES = ['accelerometer', 'magnetometer', 'barometer', 'gps'];

const rangeQuery = (request) => ({
  sessionId: request.query.get('sessionId') || undefined,
  from: timeParam(request, 'from'),
  to: timeParam(request, 'to'),
  limit: intParam(request, 'limit', 1000, 1, 5000),
});

// GET /api/devices?ownerId=...  - telefoanele firmei (cu token: doar ale firmei tale)
app.http('listDevices', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices',
  handler: endpoint('listDevices', async ({ request, principal, store }) => {
    let ownerId = request.query.get('ownerId') || undefined;
    if (!principal.all) {
      if (ownerId && ownerId !== principal.ownerId) throw new HttpError(403, 'Tokenul nu are acces la această firmă.');
      ownerId = principal.ownerId;
    }
    return { jsonBody: await store.listDevices(ownerId) };
  }),
});

// GET /api/devices/{deviceId}/state  - ultima orientare + poziție (scena 3D)
app.http('latestState', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/state',
  handler: endpoint('latestState', async ({ request, principal, store }) => {
    await requireDevice(store, principal, request.params.deviceId);
    const state = await store.getLatestState(request.params.deviceId);
    return state ? { jsonBody: state } : { status: 404, jsonBody: { error: 'Nicio stare pentru acest device.' } };
  }),
});

// GET /api/devices/{deviceId}/states?sessionId=&from=&to=&limit=  - istoricul stărilor procesate
app.http('stateHistory', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/states',
  handler: endpoint('stateHistory', async ({ request, principal, store }) => {
    await requireDevice(store, principal, request.params.deviceId);
    return { jsonBody: await store.getStates(request.params.deviceId, rangeQuery(request)) };
  }),
});

// GET /api/devices/{deviceId}/readings?type=accelerometer&from=&to=&limit=  - citirile brute (grafice)
app.http('readings', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/readings',
  handler: endpoint('readings', async ({ request, principal, store }) => {
    const type = request.query.get('type') || undefined;
    if (type && !SENSOR_TYPES.includes(type)) throw new HttpError(400, `type trebuie să fie unul din: ${SENSOR_TYPES.join(', ')}`);
    await requireDevice(store, principal, request.params.deviceId);
    return { jsonBody: await store.getReadings(request.params.deviceId, { ...rangeQuery(request), type }) };
  }),
});
