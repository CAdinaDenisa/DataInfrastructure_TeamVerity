'use strict';
const { app } = require('@azure/functions');
const { ingest } = require('../lib/ingest');
const { getStore } = require('../storage');

// POST /api/telemetry  - telefonul trimite citiri (lot 1.0 sau evenimentul aplicației actuale), vezi src/backend/docs/01-format-json.md
app.http('telemetry', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Body-ul nu este JSON valid.' } };
    }
    const auth = request.headers.get('authorization') || '';
    const deviceKey = request.headers.get('x-device-key') || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
    return ingest({ body, deviceKey, store: getStore(), log: context });
  },
});
