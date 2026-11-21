'use strict';
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('../schema/telemetry-batch.schema.json');
const eventV1Schema = require('../schema/telemetry-event-v1.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
const validateEventV1 = ajv.compile(eventV1Schema);

const STANDARD_GRAVITY = 9.80665; // m/s2 = 1 g
const MAX_FUTURE_MS = 5 * 60 * 1000; // ceas de telefon decalat: tolerăm 5 minute
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // loturi mai vechi de 24h (coadă offline) sunt respinse
const MAX_ACCEL_G = 16;

/**
 * Validează și normalizează un lot.
 * @returns {{ ok: true, batch: object } | { ok: false, errors: string[] }}
 */
function validateBatch(body, now = new Date()) {
  if (!validateSchema(body)) {
    return {
      ok: false,
      errors: validateSchema.errors.slice(0, 20).map((e) => `${e.instancePath || '/'} ${e.message}`),
    };
  }

  const errors = [];
  const seqs = new Set();
  const nowMs = now.getTime();

  body.events.forEach((ev, i) => {
    const where = `/events/${i}`;
    if (!body.capabilities[ev.eventType]) {
      errors.push(`${where} eventType "${ev.eventType}" trimis, dar capabilities.${ev.eventType} este false`);
    }
    if (seqs.has(ev.seq)) errors.push(`${where} seq ${ev.seq} duplicat în lot`);
    seqs.add(ev.seq);

    const t = Date.parse(ev.timestamp);
    if (t - nowMs > MAX_FUTURE_MS) errors.push(`${where} timestamp prea departe în viitor (ceasul telefonului?)`);
    if (nowMs - t > MAX_AGE_MS) errors.push(`${where} timestamp mai vechi de 24h`);

    if (ev.eventType === 'accelerometer' && ev.unit === 'g') {
      const { x, y, z } = ev.value;
      if ([x, y, z].some((v) => Math.abs(v) > MAX_ACCEL_G)) {
        errors.push(`${where} accelerație peste ${MAX_ACCEL_G} g`);
      }
    }
  });

  // Telefon în repaus/mașină în mers: media |a| ≈ 1 g. Dacă media e ≈ 9.8 "g", cineva a trimis m/s2.
  const accG = body.events.filter((e) => e.eventType === 'accelerometer' && e.unit === 'g');
  if (accG.length) {
    const meanMag = accG.reduce((s, e) => s + Math.hypot(e.value.x, e.value.y, e.value.z), 0) / accG.length;
    if (meanMag > 5) errors.push(`/events accelerația medie este ${meanMag.toFixed(1)} g: probabil ai trimis m/s2 cu unit "g"`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, batch: normalize(body) };
}

/**
 * Formatul aplicației de telefon actuale (schemaVersion: 1, un eveniment pe POST)
 * -> lot 1.0. Câmpurile necunoscute sunt ignorate, ca aplicația să poată evolua independent.
 */
function eventV1ToBatch(ev) {
  const ts = ev.capturedAtUtc;
  const events = [];
  const add = (eventType, value, unit) => events.push({ eventType, value, unit, timestamp: ts, seq: events.length });
  const a = ev.acceleration;
  add('accelerometer', { x: a.x, y: a.y, z: a.z }, a.unit);
  if (ev.magneticField) {
    const m = ev.magneticField;
    add('magnetometer', { x: m.x, y: m.y, z: m.z }, 'uT');
  }
  if (ev.pressure) add('barometer', { pressure: ev.pressure.value }, 'hPa');
  if (ev.location) {
    const l = ev.location;
    const value = { latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy };
    for (const k of ['altitude', 'altitudeAccuracy']) if (l[k] != null) value[k] = l[k];
    // iOS dă -1 când viteza/direcția nu se cunosc
    if (l.speed != null && l.speed >= 0) value.speed = l.speed;
    if (l.heading != null && l.heading >= 0) value.heading = l.heading;
    add('gps', value, 'wgs84');
  }
  const batch = {
    schemaVersion: '1.0',
    deviceId: ev.deviceId,
    sessionId: ev.sessionId,
    batchId: ev.eventId,
    sentAt: ts,
    capabilities: { accelerometer: true, magnetometer: !!ev.magneticField, barometer: !!ev.pressure, gps: !!ev.location },
    events,
  };
  if (ev.ownerId) batch.ownerId = ev.ownerId;
  if (ev.vehicleId) batch.vehicleId = ev.vehicleId;
  if (ev.pressure && ev.pressure.baselineHpa != null) batch.baselinePressureHpa = ev.pressure.baselineHpa;
  return batch;
}

/**
 * Punctul de intrare: acceptă ambele formate.
 *  - schemaVersion "1.0" -> lot (formatul recomandat, vezi docs/01-format-json.md)
 *  - schemaVersion 1     -> eveniment din aplicația actuală, convertit în lot
 * Rezultatul are în plus sourceFormat ("batch-1.0" sau "event-1").
 */
function validateTelemetry(body, now = new Date()) {
  if (body && body.schemaVersion === 1) {
    if (!validateEventV1(body)) {
      return { ok: false, errors: validateEventV1.errors.slice(0, 20).map((e) => `${e.instancePath || '/'} ${e.message}`) };
    }
    const r = validateBatch(eventV1ToBatch(body), now);
    return r.ok ? { ...r, sourceFormat: 'event-1' } : r;
  }
  const r = validateBatch(body, now);
  return r.ok ? { ...r, sourceFormat: 'batch-1.0' } : r;
}

/** Aduce totul la unitățile canonice din baza de date și sortează după timp. */
function normalize(body) {
  const events = body.events
    .map((ev) => {
      if (ev.eventType === 'accelerometer' && ev.unit === 'm/s2') {
        const { x, y, z } = ev.value;
        return {
          ...ev,
          unit: 'g',
          value: { x: x / STANDARD_GRAVITY, y: y / STANDARD_GRAVITY, z: z / STANDARD_GRAVITY },
        };
      }
      return ev;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.seq - b.seq);
  return { ...body, events };
}

module.exports = { validateTelemetry, validateBatch, eventV1ToBatch, STANDARD_GRAVITY };
