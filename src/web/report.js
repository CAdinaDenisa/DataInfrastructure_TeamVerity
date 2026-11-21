import { createCarScene, bodyColorFor } from "./scene3d.js";
import {
  api,
  loadAuth,
  loadFleet,
  normalizeCar,
  fmtDistance,
  fmtDuration,
  fmtAlt,
  fmtDateTime,
  fmtTime,
  escapeHtml
} from "./api.js";
import { statsFromSessions, statsFromReadings, buildRecommendations, renderRecommendations } from "./recs.js";

// ======================================================================
//  Raportul unei curse, încărcat integral din API:
//    GET /sessions/{id}/track                          rezumat + traseu (altitudine, orientare, poziție)
//    GET /devices/{deviceId}/readings?sessionId=&type= citirile brute (accelerometru, magnetometru, barometru)
//  URL: report.html?vin=<VIN>&session=<sessionId>&device=<deviceId>
// ======================================================================
const params = new URLSearchParams(location.search);
const vin = (params.get("vin") || "").toUpperCase();
const sessionId = params.get("session");
let deviceId = params.get("device");

const auth = loadAuth();
const car = loadFleet().find((c) => c.vin === vin) || normalizeCar({ vin });

const $ = (id) => document.getElementById(id);
const errorEl = $("report-error");

function showError(msg) {
  errorEl.innerHTML = `<strong>Nu pot încărca raportul.</strong> ${escapeHtml(msg)} <a href="./index.html">← Înapoi la flotă</a>`;
  errorEl.classList.remove("hidden");
  $("report-subtitle").textContent = "Eroare la încărcare";
  $("report-badge").textContent = "Eroare";
  $("report-badge").className = "status";
}

$("car-model-name").textContent = car.name;
$("car-device-tag").textContent = vin || "—";

// imaginea vehiculului (din assets/)
(function initCarPhoto() {
  const base = car.imageBase || "./assets/porsche-silver";
  const candidates = /\.(png|jpe?g|webp)$/i.test(base) ? [base] : [`${base}.png`, `${base}.jpg`, `${base}.webp`];
  let i = 0;
  const photo = $("car-photo");
  photo.onerror = () => i < candidates.length && (photo.src = candidates[i++]);
  photo.src = candidates[i++];
})();

// ---------------------------------------------------------------- utilitare
function nearest(readings, iso) {
  if (!readings.length || !iso) return null;
  const t = Date.parse(iso);
  let lo = 0;
  let hi = readings.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(readings[mid].timestamp) < t) lo = mid + 1;
    else hi = mid;
  }
  const a = readings[lo];
  const b = readings[lo - 1];
  if (!b) return a;
  return Math.abs(Date.parse(a.timestamp) - t) < Math.abs(Date.parse(b.timestamp) - t) ? a : b;
}

const vec = (r, digits) => (r ? `${r.value.x.toFixed(digits)}, ${r.value.y.toFixed(digits)}, ${r.value.z.toFixed(digits)}` : "—");
const fmtDeg = (v) => (v == null ? "—" : `${v.toFixed(1)}°`);

// ---------------------------------------------------------------- încărcare
let scene3d = null;
let chart = null;
let points = [];
let readings = { accel: [], mag: [], baro: [] };
let summary = null;
let currentIndex = 0;
let isPlaying = false;

async function load() {
  if (!vin || !sessionId) {
    showError("Linkul nu conține VIN-ul și sesiunea. Deschide raportul din lista de rapoarte de pe pagina principală.");
    return false;
  }
  if (!auth.token) {
    showError("Nu ești conectat: introdu tokenul pe pagina principală.");
    return false;
  }

  let track;
  try {
    track = await api.sessionTrack(auth, sessionId, 400);
  } catch (err) {
    showError(err.message);
    return false;
  }
  summary = track.summary;
  deviceId = deviceId || summary.deviceId;

  const [acc, mag, baro] = await Promise.allSettled([
    api.readings(auth, deviceId, { type: "accelerometer", sessionId }),
    api.readings(auth, deviceId, { type: "magnetometer", sessionId }),
    api.readings(auth, deviceId, { type: "barometer", sessionId })
  ]);
  readings = {
    accel: acc.status === "fulfilled" ? acc.value || [] : [],
    mag: mag.status === "fulfilled" ? mag.value || [] : [],
    baro: baro.status === "fulfilled" ? baro.value || [] : []
  };

  // traseul: poziția calculată de backend; dacă lipsește, desfășurăm pe distanță (doar profilul de altitudine)
  let fallbackX = 0;
  points = (track.points || []).map((p, i) => {
    const hasPos = p.x != null && p.y != null;
    if (!hasPos) fallbackX = p.distanceM ?? i * 5;
    return {
      t: p.t,
      x: hasPos ? p.x : fallbackX,
      y: hasPos ? p.y : 0,
      altitude: p.altRelM ?? 0,
      pitch: p.pitch,
      roll: p.roll,
      yaw: p.yaw,
      speedKmh: p.speedMps != null ? p.speedMps * 3.6 : null,
      pressureHpa: p.pressureHpa,
      rough: p.advice && /rough|pothole/i.test(p.advice) ? 1 : 0,
      advice: p.advice
    };
  });

  renderHeader(track.totalPoints);
  renderTable();
  renderRecs();
  renderChart();
  render3d();
  return true;
}

function renderHeader(totalPoints) {
  const s = summary;
  $("report-title").textContent = `${car.name} — Raport ${fmtDateTime(s.startedAt)}`;
  $("report-subtitle").textContent =
    `VIN ${vin} • Telefon ${s.deviceId} • ${fmtDateTime(s.startedAt)} – ${fmtTime(s.endedAt)} • ${totalPoints} stări salvate`;
  const badge = $("report-badge");
  badge.textContent = s.status === "live" ? "● Cursă în desfășurare (LIVE)" : "Raport finalizat";
  badge.className = s.status === "live" ? "status online" : "status done";

  $("val-dist").textContent = `${fmtDistance(s.distanceM)} • ${fmtDuration(s.durationSec)}`;
  const speeds = [
    s.avgSpeedMps != null ? `medie ${Math.round(s.avgSpeedMps * 3.6)} km/h` : null,
    s.maxSpeedMps != null ? `max ${Math.round(s.maxSpeedMps * 3.6)} km/h` : null
  ].filter(Boolean);
  $("val-dist-note").textContent = speeds.length ? `Viteză ${speeds.join(" • ")}` : "Din sesiunea salvată";

  const pressures = readings.baro.map((r) => r.value.pressure).filter((v) => v != null);
  $("val-baro-range").textContent = pressures.length
    ? `Min: ${Math.min(...pressures).toFixed(1)} • Max: ${Math.max(...pressures).toFixed(1)}`
    : "Telefonul nu a trimis barometru";

  const sensors = [
    readings.accel.length && "Accelerometru",
    readings.mag.length && "Magnetometru",
    readings.baro.length && "Barometru"
  ].filter(Boolean);
  $("car-sensors").textContent = `Telemetrie: ${sensors.join(" • ") || "fără citiri brute în sesiune"}`;
  $("track-note").textContent = points.some((p) => p.rough)
    ? "Traseul din baza de date • porțiunile cu drum denivelat sunt marcate"
    : "Traseul înregistrat în baza de date";
}

function renderTable() {
  const tbody = $("readings-table-body");
  if (!points.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Sesiunea nu are încă stări procesate.</td></tr>`;
    return;
  }
  const n = points.length;
  let maxIdx = 0;
  points.forEach((p, i) => p.altitude > points[maxIdx].altitude && (maxIdx = i));
  const idxs = [...new Set([0, Math.round(n / 3), maxIdx, Math.round((2 * n) / 3), n - 1])].filter((i) => i < n).sort((a, b) => a - b);
  tbody.innerHTML = idxs
    .map((i) => {
      const p = points[i];
      const a = nearest(readings.accel, p.t);
      const m = nearest(readings.mag, p.t);
      const b = nearest(readings.baro, p.t);
      const pressure = b?.value.pressure ?? p.pressureHpa;
      return `<tr>
        <td>${fmtTime(p.t)}</td>
        <td>${vec(a, 2)}</td>
        <td>${vec(m, 1)}</td>
        <td>${pressure != null ? `${pressure.toFixed(1)} hPa` : "—"}</td>
        <td><strong>${fmtAlt(p.altitude)}</strong></td>
        <td>${fmtDeg(p.pitch)} / ${fmtDeg(p.roll)}</td>
      </tr>`;
    })
    .join("");
}

function renderRecs() {
  const stats = { ...statsFromSessions([summary]), ...statsFromReadings(readings) };
  // în raport arătăm doar observațiile cursei, fără termenele de service ale mașinii
  const rec = buildRecommendations({ ...car, odometerKm: null }, stats);
  $("report-recs").innerHTML = renderRecommendations(rec, 3, "Nimic de semnalat în această cursă.", { serviceNote: false });
}

function renderChart() {
  const ctx = $("reportTelemetryChart");
  if (!ctx || !window.Chart) return;
  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => fmtTime(p.t)),
      datasets: [
        {
          label: "Altitudine relativă (m)",
          data: points.map((p) => +p.altitude.toFixed(1)),
          borderColor: car.color,
          backgroundColor: "rgba(56, 189, 248, 0.14)",
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.3
        },
        {
          label: "Înclinație Pitch (°)",
          data: points.map((p) => (p.pitch == null ? null : +p.pitch.toFixed(1))),
          borderColor: "#f59e0b",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
      scales: {
        x: { ticks: { color: "#cbd5e1", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.07)" } }
      }
    }
  });
}

// ---------------------------------------------------------------- 3D + redare
const slider = $("timeline-slider");
const playPauseBtn = $("play-pause-btn");
const altReadout = $("live-alt-readout");

function render3d() {
  const host = $("trajectory3d");
  if (!scene3d) scene3d = createCarScene(host, { trailColor: car.color, bodyColor: bodyColorFor(car) });
  if (!points.length) return;
  scene3d.setPath(points.map((p) => ({ x: p.x, y: p.y, z: p.altitude, rough: p.rough })));
  slider.max = points.length - 1;
  currentIndex = Math.min(currentIndex, points.length - 1);
  if (summary.status === "live" && !isPlaying) currentIndex = points.length - 1;
  slider.value = currentIndex;
  showIndex(currentIndex, true);
}

function showIndex(idx, snap = false) {
  const p = points[idx];
  if (!p) return;
  scene3d.setCarAt(idx, snap);
  const maxAlt = summary.maxAltRelM ?? Math.max(...points.map((q) => q.altitude));
  altReadout.textContent = fmtAlt(p.altitude);
  $("val-alt").textContent = `${fmtAlt(maxAlt)} / ${fmtAlt(p.altitude)}`;
  $("val-orient").textContent = `${fmtDeg(p.pitch)} / ${fmtDeg(p.roll)} / ${fmtDeg(p.yaw)}`;
  const a = nearest(readings.accel, p.t);
  const m = nearest(readings.mag, p.t);
  const b = nearest(readings.baro, p.t);
  $("val-accel").textContent = a ? `${vec(a, 2)} g` : "—";
  $("val-mag").textContent = m ? `${vec(m, 1)} µT` : "—";
  const pressure = b?.value.pressure ?? p.pressureHpa;
  $("val-baro").textContent = pressure != null ? `${pressure.toFixed(1)} hPa` : "—";
}

playPauseBtn.addEventListener("click", () => {
  if (!points.length) return;
  isPlaying = !isPlaying;
  if (isPlaying && currentIndex >= points.length - 1) currentIndex = 0;
  playPauseBtn.textContent = isPlaying ? "⏸ Pauză" : "▶ Redă";
});

slider.addEventListener("input", (e) => {
  isPlaying = false;
  playPauseBtn.textContent = "▶ Redă";
  currentIndex = Number(e.target.value);
  showIndex(currentIndex);
});

setInterval(() => {
  if (!isPlaying || !points.length) return;
  currentIndex = (currentIndex + 1) % points.length;
  slider.value = currentIndex;
  showIndex(currentIndex, currentIndex === 0);
}, 90);

// cursa live se reîncarcă la 10 s
load().then((ok) => {
  if (ok && summary?.status === "live") {
    const timer = setInterval(async () => {
      await load();
      if (summary?.status !== "live") clearInterval(timer);
    }, 10000);
  }
});
