'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrientation, orientationToSensors, pressureToRelativeAltitude, gpsToLocal, processBatch } = require('../src/lib/fusion');
const { validateBatch } = require('../src/lib/validate');
const full = require('../examples/batch-full.json');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('telefon plat, cu marginea de sus spre nord: totul ≈ 0', () => {
  const o = computeOrientation({ x: 0, y: 0, z: 1 }, { x: 0, y: 20, z: -40 });
  close(o.pitch, 0, 1e-9, 'pitch'); close(o.roll, 0, 1e-9, 'roll'); close(o.yaw, 0, 1e-9, 'yaw');
});

test('marginea de sus spre est: yaw = 90°', () => {
  close(computeOrientation({ x: 0, y: 0, z: 1 }, { x: -20, y: 0, z: -40 }).yaw, 90, 1e-9, 'yaw');
});

test('orientarea se recuperează pentru unghiuri oarecare (round trip)', () => {
  for (const [p, r, y] of [[10, 15, 30], [-20, 5, 200], [5, -25, 300], [0, 0, 359]]) {
    const { accel, mag } = orientationToSensors(p, r, y);
    const o = computeOrientation(accel, mag);
    close(o.pitch, p, 1e-6, 'pitch'); close(o.roll, r, 1e-6, 'roll');
    close(((o.yaw - y + 540) % 360) - 180, 0, 1e-6, 'yaw');
  }
});

test('barometru: ~1.2 hPa mai puțin ≈ 10 m mai sus', () => {
  close(pressureToRelativeAltitude(1012.0, 1013.2), 10, 0.5, 'alt');
  assert.equal(pressureToRelativeAltitude(1000, 1000), 0);
});

test('GPS: 0.001° latitudine ≈ 111 m spre nord', () => {
  const { east, north } = gpsToLocal(44.001, 26, 44, 26);
  close(north, 111.2, 0.5, 'north'); close(east, 0, 1e-9, 'east');
});

test('processBatch fixează originea sesiunii și p0 la primul lot', () => {
  const { batch } = validateBatch(full, new Date('2026-11-21T10:16:00Z'));
  const { state, sessionUpdate } = processBatch(batch, {});
  assert.equal(sessionUpdate.refPressureHpa, 1012.62);
  assert.equal(sessionUpdate.originLat, 44.435123);
  assert.deepEqual([state.position.x, state.position.y, state.position.z], [0, 0, 0]);
  assert.equal(state.position.source, 'gps+barometer');
  assert.equal(state.altitudeRel.source, 'barometer');
  assert.ok(state.orientation.yaw >= 0 && state.orientation.yaw < 360);
});

test('processBatch fără barometru folosește altitudinea GPS', () => {
  const { batch } = validateBatch(full, new Date('2026-11-21T10:16:00Z'));
  const b = { ...batch, events: batch.events.filter((e) => e.eventType !== 'barometer') };
  const { state } = processBatch(b, { originLat: 44.435, originLon: 26.102, originAltM: 90.4 });
  assert.equal(state.altitudeRel.source, 'gps');
  close(state.position.z, 2, 1e-6, 'z');
  assert.ok(state.position.y > 10 && state.position.x > 30);
});

test('fix GPS imprecis (>50 m) nu mută poziția', () => {
  const { batch } = validateBatch(full, new Date('2026-11-21T10:16:00Z'));
  const b = JSON.parse(JSON.stringify(batch));
  b.events.find((e) => e.eventType === 'gps').value.accuracy = 120;
  const { state } = processBatch(b, {});
  assert.equal(state.position.x, null);
  assert.equal(state.position.source, 'barometer');
});
