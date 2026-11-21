'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBatch } = require('../src/lib/validate');
const full = require('../examples/batch-full.json');
const minimal = require('../examples/batch-no-barometer-no-gps.json');
const invalid = require('../examples/batch-invalid.json');

const NOW = new Date('2026-11-21T10:20:00Z');
const clone = (o) => JSON.parse(JSON.stringify(o));

test('exemplele valide trec', () => {
  assert.equal(validateBatch(full, NOW).ok, true);
  assert.equal(validateBatch(minimal, NOW).ok, true);
});

test('exemplul invalid e respins cu mesaje utile', () => {
  const r = validateBatch(invalid, NOW);
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  assert.match(all, /timestamp/);
  assert.match(all, /accuracy/);
});

test('eveniment pentru un senzor marcat lipsă e respins', () => {
  const b = clone(minimal);
  b.events.push({ eventType: 'barometer', value: { pressure: 1000 }, unit: 'hPa', timestamp: '2026-11-21T10:17:00.200Z', seq: 9 });
  const r = validateBatch(b, NOW);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /capabilities\.barometer/);
});

test('accelerație în m/s2 trimisă ca "g" e prinsă', () => {
  const b = clone(minimal);
  b.events[0].value = { x: 0, y: 0, z: 9.81 };
  assert.match(validateBatch(b, NOW).errors.join(), /m\/s2/);
});

test('m/s2 e convertit în g', () => {
  const b = clone(minimal);
  Object.assign(b.events[0], { unit: 'm/s2', value: { x: 0, y: 0, z: 9.80665 } });
  const r = validateBatch(b, NOW);
  assert.equal(r.ok, true);
  const acc = r.batch.events.find((e) => e.eventType === 'accelerometer');
  assert.equal(acc.unit, 'g');
  assert.ok(Math.abs(acc.value.z - 1) < 1e-9);
});

test('seq duplicat și timestamp din viitor sunt respinse', () => {
  const b = clone(minimal);
  b.events[1].seq = b.events[0].seq;
  b.events[1].timestamp = '2026-11-21T11:00:00.000Z';
  const errs = validateBatch(b, NOW).errors.join('\n');
  assert.match(errs, /duplicat/);
  assert.match(errs, /viitor/);
});

test('câmpuri necunoscute sunt respinse (prinde greșelile de scriere)', () => {
  const b = clone(minimal);
  b.events[0].valeu = 1;
  assert.equal(validateBatch(b, NOW).ok, false);
});

const eventV1 = require('../examples/event-v1-phone-app.json');
const { validateTelemetry } = require('../src/lib/validate');

test('formatul aplicației de telefon (schemaVersion 1) e acceptat și convertit', () => {
  const r = validateTelemetry(eventV1, NOW);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.sourceFormat, 'event-1');
  assert.equal(r.batch.batchId, eventV1.eventId);
  assert.equal(r.batch.vehicleId, 'CAR-01');
  assert.equal(r.batch.baselinePressureHpa, 1012.62);
  assert.deepEqual(r.batch.events.map((e) => e.eventType), ['accelerometer', 'magnetometer', 'barometer']);
  assert.deepEqual(r.batch.capabilities, { accelerometer: true, magnetometer: true, barometer: true, gps: false });
});

test('aplicația fără magnetometru/barometru (null) și cu GPS opțional', () => {
  const e = clone(eventV1);
  e.magneticField = null;
  e.pressure = null;
  e.location = { latitude: 44.43, longitude: 26.1, altitude: null, accuracy: 8, speed: -1, heading: -1 };
  const r = validateTelemetry(e, NOW);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const gps = r.batch.events.find((x) => x.eventType === 'gps');
  assert.equal(gps.value.speed, undefined); // -1 de pe iOS = necunoscut
  assert.deepEqual(r.batch.capabilities, { accelerometer: true, magnetometer: false, barometer: false, gps: true });
});

test('formatul lot 1.0 trece tot prin validateTelemetry', () => {
  assert.equal(validateTelemetry(full, NOW).sourceFormat, 'batch-1.0');
  assert.equal(validateTelemetry({ schemaVersion: 1 }, NOW).ok, false);
});
