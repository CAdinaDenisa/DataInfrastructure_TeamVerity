// Construiește evenimentul exact după contractul din ghid (contracts/telemetry-v1.json).
// Funcție pură: primește citirile curente și contextul, întoarce obiectul JSON.

const round = (v, digits) => (typeof v === 'number' ? Number(v.toFixed(digits)) : v);

const vector = (r, unit, digits) =>
  r ? { x: round(r.x, digits), y: round(r.y, digits), z: round(r.z, digits), unit } : null;

export function buildEvent({ eventId, deviceId, ownerId, vehicleId, sessionId, now, readings, status, baselineHpa }) {
  const hasPressure = status.pressure === 'live' && readings.pressure && baselineHpa != null;
  const hasMagnetic = status.magneticField === 'live' && !!readings.magneticField;

  return {
    schemaVersion: 1,
    eventId,
    deviceId,
    ownerId,
    vehicleId,
    sessionId,
    capturedAtUtc: now.toISOString(),
    acceleration: vector(readings.acceleration, 'g', 4),
    magneticField: hasMagnetic ? vector(readings.magneticField, 'uT', 2) : null,
    pressure: hasPressure
      ? { value: round(readings.pressure.value, 2), baselineHpa: round(baselineHpa, 2), unit: 'hPa' }
      : null,
    quality: {
      acceleration: 'live',
      magneticField: hasMagnetic ? 'live' : 'unavailable',
      pressure: hasPressure ? 'live' : 'unavailable',
    },
  };
}

// Media ultimelor citiri, doar dacă sunt stabile (variație mică) — pentru baseline-ul de presiune.
export function stableAverage(samples, maxSpreadHpa = 0.15) {
  if (samples.length === 0) return null;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (max - min > maxSpreadHpa) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
