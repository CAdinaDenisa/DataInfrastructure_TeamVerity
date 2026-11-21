'use strict';
const { app } = require('@azure/functions');
const { getStore } = require('../storage');

const SENSOR_TYPES = ['accelerometer', 'magnetometer', 'barometer', 'gps'];

function parseQuery(request) {
  const q = request.query;
  const limit = Math.min(Math.max(parseInt(q.get('limit') || '1000', 10) || 1000, 1), 5000);
  const from = q.get('from') || undefined;
  const to = q.get('to') || undefined;
  for (const t of [from, to]) if (t && Number.isNaN(Date.parse(t))) throw new Error(`timestamp invalid: ${t}`);
  return { sessionId: q.get('sessionId') || undefined, from, to, limit };
}

const wrap = (fn) => async (request, context) => {
  try {
    return await fn(request, context);
  } catch (err) {
    if (err.message.startsWith('timestamp invalid')) return { status: 400, jsonBody: { error: err.message } };
    context.error(err);
    return { status: 503, jsonBody: { error: 'Stocare indisponibilă.' } };
  }
};

// GET /api/devices?ownerId=...  - lista mașinilor (pentru dashboard)
app.http('listDevices', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices',
  handler: wrap(async (request) => ({ jsonBody: await getStore().listDevices(request.query.get('ownerId') || undefined) })),
});

// GET /api/devices/{deviceId}/state  - ultima orientare + poziție (scena 3D, polling 1 s)
app.http('latestState', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/state',
  handler: wrap(async (request) => {
    const state = await getStore().getLatestState(request.params.deviceId);
    return state ? { jsonBody: state } : { status: 404, jsonBody: { error: 'Nicio stare pentru acest device.' } };
  }),
});

// GET /api/devices/{deviceId}/states?sessionId=&from=&to=&limit=  - traseul 3D
app.http('stateHistory', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/states',
  handler: wrap(async (request) => ({ jsonBody: await getStore().getStates(request.params.deviceId, parseQuery(request)) })),
});

// GET /api/devices/{deviceId}/readings?type=accelerometer&from=&to=&limit=  - graficele
app.http('readings', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/readings',
  handler: wrap(async (request) => {
    const type = request.query.get('type') || undefined;
    if (type && !SENSOR_TYPES.includes(type)) {
      return { status: 400, jsonBody: { error: `type trebuie să fie unul din: ${SENSOR_TYPES.join(', ')}` } };
    }
    return { jsonBody: await getStore().getReadings(request.params.deviceId, { ...parseQuery(request), type }) };
  }),
});
