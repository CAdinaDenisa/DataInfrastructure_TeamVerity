'use strict';
/**
 * Stocare în memorie: pentru teste și pentru colegii care vor doar să pornească API-ul
 * fără Docker. Datele dispar la repornire. Aceeași interfață ca sqlStore.
 */
function createMemoryStore() {
  const devices = new Map();
  const sessions = new Map();
  const batches = new Set();
  const readings = [];
  const states = [];

  const inRange = (ts, { from, to }) => (!from || ts >= from) && (!to || ts <= to);

  return {
    mode: 'memory',

    async getSession(sessionId) {
      return sessions.get(sessionId) || null;
    },

    async saveBatch(batch, state, sessionUpdate) {
      if (batches.has(batch.batchId)) return { duplicate: true };
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
      sessions.set(batch.sessionId, { ...s, lastEventAt: last, ...sessionUpdate });
      batches.add(batch.batchId);
      for (const ev of batch.events) {
        readings.push({ deviceId: batch.deviceId, sessionId: batch.sessionId, batchId: batch.batchId, ...ev });
      }
      states.push(state);
      return { duplicate: false };
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
