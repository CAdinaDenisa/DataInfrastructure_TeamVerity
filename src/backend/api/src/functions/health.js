'use strict';
/**
 * GET /api/health  - public, fără token și fără date ale firmelor.
 * Pentru monitorizare și demo: rulează aplicația? ce stocare folosește? ajunge la bază? e activă autorizarea?
 */
const { app } = require('@azure/functions');
const { endpoint } = require('../lib/http');
const { authStatus } = require('../lib/auth');
const config = require('../lib/config');
const { version } = require('../../package.json');

app.http('health', {
  methods: ['GET'], authLevel: 'anonymous', route: 'health',
  handler: endpoint('health', async ({ store }) => {
    let database = 'ok';
    const t0 = Date.now();
    try {
      await Promise.race([store.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    } catch {
      database = 'unreachable';
    }
    return {
      status: database === 'ok' ? 200 : 503,
      jsonBody: {
        status: database === 'ok' ? 'ok' : 'degraded',
        storageMode: store.mode,
        database,
        databaseLatencyMs: Date.now() - t0,
        auth: authStatus(),
        version,
        build: config.getBuildVersion(),
        timeUtc: new Date().toISOString(),
      },
    };
  }, { auth: false }),
});
