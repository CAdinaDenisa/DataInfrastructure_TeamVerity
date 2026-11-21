'use strict';
const { app } = require('@azure/functions');
const { endpoint, intParam } = require('../lib/http');
const { requireDevice, requireSession } = require('../lib/access');
const { sessionSummary, downsampleTrack, trackPoint } = require('../lib/sessionStats');

// GET /api/devices/{deviceId}/sessions?limit=20  - lista rapoartelor de cursă (cele mai noi primele)
app.http('listSessions', {
  methods: ['GET'], authLevel: 'anonymous', route: 'devices/{deviceId}/sessions',
  handler: endpoint('listSessions', async ({ request, principal, store }) => {
    await requireDevice(store, principal, request.params.deviceId);
    let sessions = await store.listSessions(request.params.deviceId, intParam(request, 'limit', 20, 1, 200));
    if (!principal.all && !principal.allowAllVehicles) sessions = sessions.filter((s) => !s.vehicleId || principal.vehicleIds.has(s.vehicleId));
    const now = new Date();
    return { jsonBody: sessions.map((s) => sessionSummary(s, now)) };
  }),
});

// GET /api/sessions/{sessionId}  - rezumatul unei curse
app.http('sessionSummary', {
  methods: ['GET'], authLevel: 'anonymous', route: 'sessions/{sessionId}',
  handler: endpoint('sessionSummary', async ({ request, principal, store }) => {
    const s = await requireSession(store, principal, request.params.sessionId);
    return { jsonBody: sessionSummary(s) };
  }),
});

// GET /api/sessions/{sessionId}/track?points=300  - traseul redus, pentru graficele și harta din raport
app.http('sessionTrack', {
  methods: ['GET'], authLevel: 'anonymous', route: 'sessions/{sessionId}/track',
  handler: endpoint('sessionTrack', async ({ request, principal, store }) => {
    const s = await requireSession(store, principal, request.params.sessionId);
    const states = await store.getSessionStates(s.sessionId);
    const points = downsampleTrack(states, intParam(request, 'points', 300, 2, 2000));
    return {
      jsonBody: {
        summary: sessionSummary(s),
        totalPoints: states.length,
        points: points.map((st) => trackPoint(st, s.refPressureHpa)),
      },
    };
  }),
});
