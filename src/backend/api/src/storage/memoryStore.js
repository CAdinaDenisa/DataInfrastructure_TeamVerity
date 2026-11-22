'use strict';
/**
 * Stocare în memorie: pentru teste și pentru colegii care vor doar să pornească API-ul
 * fără Docker. Datele dispar la repornire. Aceeași interfață ca sqlStore.
 */
function createMemoryStore() {
  const devices = new Map();
  const sessions = new Map();
  const batches = new Map(); // batchId -> { hash, ownerId, vehicleId, capturedAt, receivedAt, payload }
  const readings = [];
  const states = [];

  const inRange = (ts, { from, to }) => (!from || ts >= from) && (!to || ts <= to);

  return {
    mode: 'memory',

    async ping() {
      return true;
    },

    async getDevice(deviceId) {
      return devices.get(deviceId) || null;
    },

    async listTelemetry({ ownerId, vehicleId, sessionId, from, to, limit = 100 }) {
      const byBatch = new Map(states.map((s) => [s.batchId, s]));
      return [...batches.values()]
        .filter((b) => b.ownerId === ownerId && b.vehicleId === vehicleId && (!sessionId || b.sessionId === sessionId)
          && inRange(b.capturedAt, { from, to }))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.batchId.localeCompare(a.batchId))
        .slice(0, limit)
        .map((b) => ({ ...b, state: byBatch.get(b.batchId) || null }));
    },

    async getSession(sessionId) {
      return sessions.get(sessionId) || null;
    },

    async getActiveVehicleSession(vehicleId, activeWindowSec = 30) {
      const cutoff = new Date(Date.now() - activeWindowSec * 1000).toISOString();
      const active = [...sessions.values()]
        .filter((s) => s.vehicleId === vehicleId && s.lastEventAt && s.lastEventAt >= cutoff)
        .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
      return active[0] || null;
    },

    async saveBatch(batch, state, sessionUpdate) {
      if (batches.has(batch.batchId)) return { duplicate: true, existingHash: batches.get(batch.batchId).hash };
      const first = batch.events[0].timestamp;
      const last = batch.events[batch.events.length - 1].timestamp;
      const prevDev = devices.get(batch.deviceId) || {};
      devices.set(batch.deviceId, {
        ...prevDev,
        deviceId: batch.deviceId,
        ownerId: batch.ownerId ?? prevDev.ownerId ?? null,
        ...(batch.device || {}),
        capabilities: batch.capabilities,
        lastSeenAt: new Date().toISOString(),
      });
      const s = sessions.get(batch.sessionId) || { sessionId: batch.sessionId, deviceId: batch.deviceId, vehicleId: batch.vehicleId ?? null, startedAt: first };
      if (first < s.startedAt) s.startedAt = first;
      sessions.set(batch.sessionId, { ...s, ...sessionUpdate, lastEventAt: !s.lastEventAt || last > s.lastEventAt ? last : s.lastEventAt });
      batches.set(batch.batchId, {
        batchId: batch.batchId, deviceId: batch.deviceId, sessionId: batch.sessionId,
        hash: batch.payloadHash ?? null, ownerId: batch.ownerId ?? null, vehicleId: batch.vehicleId ?? null,
        capturedAt: last, receivedAt: new Date().toISOString(),
        payload: batch.payloadJson ? JSON.parse(batch.payloadJson) : null,
      });
      for (const ev of batch.events) {
        readings.push({ deviceId: batch.deviceId, sessionId: batch.sessionId, batchId: batch.batchId, ...ev });
      }
      states.push(state);
      return { duplicate: false };
    },

    async listSessions(deviceId, limit = 20) {
      return [...sessions.values()]
        .filter((x) => x.deviceId === deviceId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    },

    async getSessionStates(sessionId, maxRows = 20000) {
      return states
        .filter((x) => x.sessionId === sessionId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(0, maxRows);
    },

    async listDevices(ownerId) {
      return [...devices.values()].filter((d) => !ownerId || d.ownerId === ownerId);
    },

    async getLatestState(deviceId) {
      const s = states.filter((x) => x.deviceId === deviceId);
      return s.length ? s.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a)) : null;
    },

    async getStates(deviceId, q = {}) {
      return states
        .filter((s) => s.deviceId === deviceId && (!q.sessionId || s.sessionId === q.sessionId) && inRange(s.timestamp, q))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-(q.limit || 1000));
    },

    async getReadings(deviceId, q = {}) {
      return readings
        .filter((r) => r.deviceId === deviceId && (!q.type || r.eventType === q.type)
          && (!q.sessionId || r.sessionId === q.sessionId) && inRange(r.timestamp, q))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-(q.limit || 1000))
        .map(({ eventType, value, unit, timestamp, seq, sessionId }) => ({ eventType, value, unit, timestamp, seq, sessionId }));
    },
  };
}

module.exports = { createMemoryStore };
