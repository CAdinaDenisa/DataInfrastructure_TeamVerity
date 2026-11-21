'use strict';
/**
 * Fuziune simplă a senzorilor pentru un lot (≈1 s de date).
 *
 * Convenția axelor (aceeași ca la Android): telefonul pe masă cu ecranul în sus,
 * x spre dreapta, y spre marginea de sus, z ieșind din ecran.
 * În repaus accelerometrul arată ≈ (0, 0, +1) g. Pe iOS, aplicația trebuie să
 * trimită valorile în aceeași convenție (verificați o dată pe telefon real).
 *
 * Unghiuri: grade. yaw = 0 când marginea de sus a telefonului arată spre nordul magnetic,
 * crește în sensul acelor de ceasornic (ca la busolă).
 * Poziție: metri, sistem local ENU față de primul fix GPS bun din sesiune:
 * x = est, y = nord, z = sus (altitudine relativă).
 */

const EARTH_RADIUS_M = 6371000;
const GPS_MAX_ACCURACY_M = 50; // fix-uri mai proaste nu mișcă poziția
const RAD = 180 / Math.PI;

const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const scale = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const round = (v, d = 3) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

function meanVector(events) {
  return { x: mean(events.map((e) => e.value.x)), y: mean(events.map((e) => e.value.y)), z: mean(events.map((e) => e.value.z)) };
}

/** pitch/roll din gravitație, yaw din magnetometru compensat cu înclinarea. */
function computeOrientation(accel, mag) {
  const gN = norm(accel);
  if (!gN) return null;
  const a = scale(accel, 1 / gN);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -a.y))) * RAD;
  const roll = Math.atan2(-a.x, a.z) * RAD;

  let yaw = null;
  if (mag) {
    const h = cross(mag, a); // vectorul spre est
    const hN = norm(h);
    if (hN > 1e-6) {
      const east = scale(h, 1 / hN);
      const north = cross(a, east);
      yaw = Math.atan2(east.y, north.y) * RAD;
      if (yaw < 0) yaw += 360;
    }
  }
  return { pitch, roll, yaw };
}

/**
 * Inversul lui computeOrientation: ce ar măsura telefonul la o orientare dată.
 * Folosit de simulator și de teste. Câmpul magnetic implicit: 20 uT spre nord, 40 uT în jos.
 */
function orientationToSensors(pitchDeg, rollDeg, yawDeg, magWorld = { north: 20, down: 40 }) {
  const [p, r, y] = [pitchDeg / RAD, rollDeg / RAD, yawDeg / RAD];
  const rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
  const ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
  const rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  // telefon -> lume (ENU); transpusa duce vectorii din lume în cadrul telefonului
  const w = mul(mul(rz(-y), rx(-p)), ry(r));
  const toPhone = ([ex, ny, up]) => ({
    x: w[0][0] * ex + w[1][0] * ny + w[2][0] * up,
    y: w[0][1] * ex + w[1][1] * ny + w[2][1] * up,
    z: w[0][2] * ex + w[1][2] * ny + w[2][2] * up,
  });
  return { accel: toPhone([0, 0, 1]), mag: toPhone([0, magWorld.north, -magWorld.down]) };
}

/** Formula barometrică: altitudine relativă (m) față de presiunea de referință p0. */
function pressureToRelativeAltitude(p, p0) {
  return 44330 * (1 - Math.pow(p / p0, 0.1903));
}

/** Lat/lon -> metri est/nord față de origine (aproximare locală, bună pe câțiva km). */
function gpsToLocal(lat, lon, originLat, originLon) {
  const toRad = Math.PI / 180;
  const east = (lon - originLon) * toRad * EARTH_RADIUS_M * Math.cos(originLat * toRad);
  const north = (lat - originLat) * toRad * EARTH_RADIUS_M;
  return { east, north };
}

/** Logica de „sfaturi” din prima versiune a API-ului, adaptată la unități de g. */
function drivingAdvice(accelEvents) {
  let advice = 'Normal driving conditions.';
  for (const e of accelEvents) {
    const { x, y, z } = e.value;
    if (Math.abs(Math.hypot(x, y, z) - 1) > 0.3) return 'Rough road / pothole detected!';
    if (Math.hypot(x, y) > 0.25) advice = 'Harsh acceleration or sharp turn detected.';
  }
  return advice;
}

/**
 * @param batch   lot validat și normalizat (vezi validate.js)
 * @param session starea sesiunii din DB: { refPressureHpa, originLat, originLon, originAltM } (valori pot fi null)
 * @returns {{ state: object, sessionUpdate: object }}
 */
function processBatch(batch, session = {}) {
  const by = (type) => batch.events.filter((e) => e.eventType === type);
  const accel = by('accelerometer');
  const mag = by('magnetometer');
  const baro = by('barometer');
  const gps = by('gps');
  const sessionUpdate = {};
  const ts = batch.events[batch.events.length - 1].timestamp;

  // 1. Orientare
  const orientation = accel.length ? computeOrientation(meanVector(accel), mag.length ? meanVector(mag) : null) : null;

  // 2. Altitudine relativă din barometru
  let altBaro = null;
  if (baro.length) {
    const p = mean(baro.map((e) => e.value.pressure));
    let p0 = session.refPressureHpa;
    if (p0 == null) {
      p0 = batch.baselinePressureHpa ?? baro[0].value.pressure;
      sessionUpdate.refPressureHpa = p0;
    }
    altBaro = pressureToRelativeAltitude(p, p0);
  }

  // 3. GPS -> poziție orizontală (ultimul fix suficient de precis)
  const goodFix = [...gps].reverse().find((e) => e.value.accuracy <= GPS_MAX_ACCURACY_M);
  const lastFix = gps[gps.length - 1];
  let east = null;
  let north = null;
  let altGps = null;
  if (goodFix) {
    const v = goodFix.value;
    let { originLat, originLon, originAltM } = session;
    if (originLat == null) {
      originLat = v.latitude;
      originLon = v.longitude;
      originAltM = v.altitude ?? null;
      Object.assign(sessionUpdate, { originLat, originLon, originAltM });
    } else if (originAltM == null && v.altitude != null) {
      originAltM = v.altitude;
      sessionUpdate.originAltM = originAltM;
    }
    ({ east, north } = gpsToLocal(v.latitude, v.longitude, originLat, originLon));
    if (v.altitude != null && originAltM != null) altGps = v.altitude - originAltM;
  }

  // 4. Poziția 3D: x,y din GPS, z din barometru (mai stabil pe verticală), altfel din GPS
  const altRel = altBaro ?? altGps;
  const altSource = altBaro != null ? 'barometer' : altGps != null ? 'gps' : 'none';
  const posSource = goodFix ? (altBaro != null ? 'gps+barometer' : 'gps') : altBaro != null ? 'barometer' : 'none';

  const state = {
    deviceId: batch.deviceId,
    sessionId: batch.sessionId,
    batchId: batch.batchId,
    timestamp: ts,
    orientation: orientation && {
      pitch: round(orientation.pitch, 2),
      roll: round(orientation.roll, 2),
      yaw: round(orientation.yaw, 2),
      unit: 'deg',
    },
    altitudeRel: { value: round(altRel, 2), unit: 'm', source: altSource },
    position: { x: round(east, 2), y: round(north, 2), z: round(altRel, 2), unit: 'm', source: posSource, estimated: posSource !== 'gps+barometer' },
    gps: lastFix
      ? {
          latitude: lastFix.value.latitude,
          longitude: lastFix.value.longitude,
          accuracy: lastFix.value.accuracy,
          speed: lastFix.value.speed ?? null,
        }
      : null,
    advice: accel.length ? drivingAdvice(accel) : null,
  };
  return { state, sessionUpdate };
}

module.exports = { processBatch, computeOrientation, orientationToSensors, pressureToRelativeAltitude, gpsToLocal, drivingAdvice };
