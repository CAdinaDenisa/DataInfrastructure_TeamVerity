'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateSessionStats, sessionSummary, downsampleTrack, trackPoint } = require('../src/lib/sessionStats');

const T0 = Date.parse('2026-11-21T10:00:00Z');
const st = (sec, x, y, extra = {}) => ({
  timestamp: new Date(T0 + sec * 1000).toISOString(),
  position: { x, y },
  altitudeRel: { value: extra.alt ?? 0, source: 'barometer' },
  gps: extra.speed != null ? { speed: extra.speed } : null,
  advice: extra.advice ?? 'Normal driving conditions.',
});

/** Rulează o serie de stări prin updateSessionStats, ca la primirea loturilor. */
function run(states) {
  let session = {};
  for (const s of states) session = { ...session, ...updateSessionStats(session, s).stats };
  return session;
}

test('mers în linie dreaptă: 10 m/s timp de 10 s = 100 m', () => {
  const s = run(Array.from({ length: 11 }, (_, i) => st(i, i * 10, 0)));
  assert.equal(s.distanceM, 100);
  assert.equal(s.maxSpeedMps, 10);
  assert.equal(s.batchCount, 11);
});

test('jitter GPS în repaus (±1.5 m) nu adună distanță', () => {
  const s = run(Array.from({ length: 60 }, (_, i) => st(i, Math.sin(i) * 1.5, Math.cos(i * 1.7) * 1.5)));
  assert.equal(s.distanceM, 0);
});

test('un salt GPS de 500 m într-o secundă e ignorat', () => {
  const s = run([st(0, 0, 0), st(1, 5, 0), st(2, 505, 0), st(3, 510, 0), st(4, 515, 0)]);
  assert.equal(s.distanceM, 15); // 5 + (saltul ignorat) + 5 + 5
});

test('altitudine min/max și evenimente', () => {
  const s = run([
    st(0, 0, 0, { alt: 0 }),
    st(1, 0, 0, { alt: 12.5, advice: 'Rough road / pothole detected!' }),
    st(2, 0, 0, { alt: -3, advice: 'Harsh acceleration or sharp turn detected.' }),
    st(3, 0, 0, { alt: 4, advice: 'Harsh acceleration or sharp turn detected.' }),
  ]);
  assert.equal(s.maxAltRelM, 12.5);
  assert.equal(s.minAltRelM, -3);
  assert.equal(s.roughCount, 1);
  assert.equal(s.harshCount, 2);
});

test('fără GPS: distanța rămâne 0, restul se calculează', () => {
  const s = run([st(0, null, null, { alt: 1 }), st(1, null, null, { alt: 2 })]);
  assert.equal(s.distanceM, 0);
  assert.equal(s.maxAltRelM, 2);
});

test('rezumat: durată, viteză medie, live/terminat', () => {
  const session = { sessionId: 's1', deviceId: 'd1', startedAt: '2026-11-21T10:00:00.000Z', lastEventAt: '2026-11-21T10:24:00.000Z', distanceM: 8700 };
  const done = sessionSummary(session, new Date('2026-11-21T12:00:00Z'));
  assert.equal(done.durationSec, 1440);
  assert.equal(done.status, 'done');
  assert.equal(done.avgSpeedMps, 6.04);
  assert.equal(sessionSummary(session, new Date('2026-11-21T10:24:30Z')).status, 'live');
});

test('traseul redus păstrează capetele și vârful de altitudine', () => {
  const states = Array.from({ length: 1000 }, (_, i) => st(i, i, 0, { alt: i === 777 ? 99 : 1 }));
  const out = downsampleTrack(states, 50);
  assert.ok(out.length <= 50);
  assert.equal(out[0], states[0]);
  assert.equal(out[out.length - 1], states[999]);
  assert.ok(out.includes(states[777]));
  assert.equal(downsampleTrack(states.slice(0, 10), 50).length, 10);
});

test('punctul de traseu estimează presiunea din altitudine', () => {
  const p = trackPoint({ ...st(0, 1, 2, { alt: 8.3 }), distanceM: 3 }, 1013.25);
  assert.ok(Math.abs(p.pressureHpa - 1012.26) < 0.05);
  assert.equal(p.distanceM, 3);
});
