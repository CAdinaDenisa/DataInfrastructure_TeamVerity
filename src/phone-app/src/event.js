// Construiește evenimentul exact după contractul din ghid (contracts/telemetry-v1.json).
// Funcție pură: primește citirile curente și contextul, întoarce obiectul JSON.

import { GPS_MAX_AGE_MS } from './config';

const round = (v, digits) => (typeof v === 'number' ? Number(v.toFixed(digits)) : v);

const vector = (r, unit, digits) =>
  r ? { x: round(r.x, digits), y: round(r.y, digits), z: round(r.z, digits), unit } : null;

export function buildEvent({ eventId, deviceId, ownerId, vehicleId, sessionId, now, readings, status, baselineHpa }) {
  const hasPressure = status.pressure === 'live' && readings.pressure && baselineHpa != null;
  const hasMagnetic = status.magneticField === 'live' && !!readings.magneticField;
  const loc = readings.location;
  const hasLocation =
    status.location === 'live' && !!loc && typeof loc.accuracy === 'number' &&
    (loc.timestamp == null || now.getTime() - loc.timestamp <= GPS_MAX_AGE_MS);

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
    // GPS: 7 zecimale ≈ 1 cm, ca să nu pierdem mișcările mici
    location: hasLocation
      ? {
          latitude: round(loc.latitude, 7),
          longitude: round(loc.longitude, 7),
          altitude: loc.altitude == null ? null : round(loc.altitude, 2),
          accuracy: round(loc.accuracy, 1),
          altitudeAccuracy: loc.altitudeAccuracy == null ? null : round(loc.altitudeAccuracy, 1),
          speed: loc.speed == null ? null : round(loc.speed, 2),
          heading: loc.heading == null ? null : round(loc.heading, 1),
        }
      : null,
    quality: {
      acceleration: 'live',
      magneticField: hasMagnetic ? 'live' : 'unavailable',
      pressure: hasPressure ? 'live' : 'unavailable',
      location: hasLocation ? 'live' : status.location === 'denied' ? 'denied' : 'unavailable',
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
