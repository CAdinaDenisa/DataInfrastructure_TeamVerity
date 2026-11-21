'use strict';
/**
 * Statisticile unei sesiuni (o cursă), actualizate incremental la fiecare lot primit.
 * Le citește dashboard-ul în lista de rapoarte: durată, distanță, altitudine, viteză, evenimente.
 *
 * Distanța din GPS are două capcane:
 *  - jitter: în repaus, fix-urile „tremură” câțiva metri; adunate, ar da sute de metri parcurși stând pe loc.
 *    Soluția: adunăm doar când ne-am depărtat de ultimul punct numărat (ancora) cel puțin
 *    max(MIN_STEP_M, precizia fix-ului). Pe drum distanța nu se pierde: se măsoară de la ancoră.
 *  - salturi: un fix greșit (tunel, clădiri) poate sări sute de metri într-o secundă.
 *    Soluția: un pas care ar cere viteză > MAX_SPEED_MPS nu se adună; ancora se mută acolo
 *    (dacă saltul a fost real, de ex. după un tunel, următorii pași se numără normal).
 */

const MIN_STEP_M = 5;          // pas minim; crește până la precizia fix-ului GPS (max 25 m)
const MAX_STEP_THRESHOLD_M = 25;
const MAX_SPEED_MPS = 70; // ~250 km/h
const LIVE_WINDOW_MS = 60 * 1000; // sesiune „live” dacă a primit date în ultimul minut

const ADVICE_ROUGH = 'Rough road / pothole detected!';
const ADVICE_HARSH = 'Harsh acceleration or sharp turn detected.';

const emptyStats = () => ({
  distanceM: 0,
  anchorX: null,
  anchorY: null,
  anchorTs: null,
  maxAltRelM: null,
  minAltRelM: null,
  maxSpeedMps: null,
  roughCount: 0,
  harshCount: 0,
  batchCount: 0,
});

const pick = (session) => {
  const s = emptyStats();
  for (const k of Object.keys(s)) if (session && session[k] != null) s[k] = session[k];
  return s;
};

const maxOrNull = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
const minOrNull = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * @param session  sesiunea din DB (poate fi {} pentru o sesiune nouă)
 * @param state    starea procesată a lotului (din fusion.processBatch)
 * @returns {{ stats: object, distanceM: number }}  stats = câmpurile de salvat în sessions
 */
function updateSessionStats(session, state) {
  const s = pick(session);
  s.batchCount += 1;

  const alt = state.altitudeRel?.value;
  s.maxAltRelM = maxOrNull(s.maxAltRelM, alt);
  s.minAltRelM = minOrNull(s.minAltRelM, alt);

  if (state.advice === ADVICE_ROUGH) s.roughCount += 1;
  else if (state.advice === ADVICE_HARSH) s.harshCount += 1;

  const { x, y } = state.position || {};
  const t = Date.parse(state.timestamp);
  let measuredSpeed = state.gps?.speed ?? null;

  if (x != null && y != null) {
    if (s.anchorX == null) {
      Object.assign(s, { anchorX: x, anchorY: y, anchorTs: state.timestamp });
    } else if (t > Date.parse(s.anchorTs)) {
      const step = Math.hypot(x - s.anchorX, y - s.anchorY);
      const dt = (t - Date.parse(s.anchorTs)) / 1000;
      const impliedSpeed = step / dt;
      if (impliedSpeed > MAX_SPEED_MPS) {
        Object.assign(s, { anchorX: x, anchorY: y, anchorTs: state.timestamp }); // salt GPS: nu-l adunăm
      } else if (step >= Math.max(MIN_STEP_M, Math.min(state.gps?.accuracy ?? 0, MAX_STEP_THRESHOLD_M))) {
        s.distanceM += step;
        Object.assign(s, { anchorX: x, anchorY: y, anchorTs: state.timestamp });
        if (measuredSpeed == null) measuredSpeed = impliedSpeed;
      }
    }
  }
  if (measuredSpeed != null && measuredSpeed <= MAX_SPEED_MPS) s.maxSpeedMps = maxOrNull(s.maxSpeedMps, measuredSpeed);

  s.distanceM = r2(s.distanceM);
  s.maxAltRelM = r2(s.maxAltRelM);
  s.minAltRelM = r2(s.minAltRelM);
  s.maxSpeedMps = r2(s.maxSpeedMps);
  return { stats: s, distanceM: s.distanceM };
}

/** Rezumatul trimis dashboard-ului (numere brute; formatarea „8.7 km” o face dashboard-ul). */
function sessionSummary(session, now = new Date()) {
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.lastEventAt);
  const durationSec = Math.max(0, Math.round((end - start) / 1000));
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    vehicleId: session.vehicleId ?? null,
    status: now.getTime() - end <= LIVE_WINDOW_MS ? 'live' : 'done',
    startedAt: session.startedAt,
    endedAt: session.lastEventAt,
    durationSec,
    distanceM: session.distanceM ?? 0,
    maxAltRelM: session.maxAltRelM ?? null,
    minAltRelM: session.minAltRelM ?? null,
    maxSpeedMps: session.maxSpeedMps ?? null,
    avgSpeedMps: durationSec > 0 ? r2((session.distanceM ?? 0) / durationSec) : null,
    events: { roughRoad: session.roughCount ?? 0, harshDriving: session.harshCount ?? 0 },
    batchCount: session.batchCount ?? 0,
  };
}

/**
 * Reduce traseul la cel mult maxPoints puncte pentru grafice/hartă, păstrând
 * primul și ultimul punct și punctul cu altitudinea maximă (vârful din raport).
 */
function downsampleTrack(states, maxPoints = 300) {
  if (states.length <= maxPoints) return states;
  const keep = new Set([0, states.length - 1]);
  let maxIdx = -1;
  states.forEach((s, i) => {
    const a = s.altitudeRel?.value;
    if (a != null && (maxIdx < 0 || a > states[maxIdx].altitudeRel.value)) maxIdx = i;
  });
  if (maxIdx >= 0) keep.add(maxIdx);
  const step = (states.length - 1) / (maxPoints - keep.size + 1);
  for (let k = step; keep.size < maxPoints && k < states.length - 1; k += step) keep.add(Math.round(k));
  return [...keep].sort((a, b) => a - b).map((i) => states[i]);
}

/** Un punct de traseu compact pentru raport. */
function trackPoint(state, refPressureHpa) {
  const z = state.position?.z ?? state.altitudeRel?.value ?? null;
  return {
    t: state.timestamp,
    x: state.position?.x ?? null,
    y: state.position?.y ?? null,
    altRelM: state.altitudeRel?.value ?? z,
    distanceM: state.distanceM ?? null,
    pitch: state.orientation?.pitch ?? null,
    roll: state.orientation?.roll ?? null,
    yaw: state.orientation?.yaw ?? null,
    speedMps: state.gps?.speed ?? null,
    latitude: state.gps?.latitude ?? null,
    longitude: state.gps?.longitude ?? null,
    // presiunea estimată din altitudine (formula barometrică inversă), doar dacă avem barometru
    pressureHpa: state.altitudeRel?.source === 'barometer' && refPressureHpa != null && state.altitudeRel.value != null
      ? r2(refPressureHpa * Math.pow(1 - state.altitudeRel.value / 44330, 1 / 0.1903))
      : null,
    advice: state.advice ?? null,
  };
}

module.exports = { updateSessionStats, sessionSummary, downsampleTrack, trackPoint, MIN_STEP_M, MAX_SPEED_MPS };
