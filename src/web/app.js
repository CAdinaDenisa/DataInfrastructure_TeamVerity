import { createCarScene, bodyColorFor } from "./scene3d.js";
import {
  api,
  apiBase,
  appConfig,
  loadAuth,
  saveAuth,
  loadFleet,
  saveFleet,
  normalizeCar,
  loadSessionsByVehicle,
  fmtDistance,
  fmtDuration,
  fmtAlt,
  fmtDateTime,
  fmtTime,
  escapeHtml
} from "./api.js";
import { statsFromSessions, buildRecommendations, renderRecommendations } from "./recs.js";

// ======================================================================
//  Verity Drive — Starea paginii
//  Flota = VIN-urile detectate automat din baza de date
//  Traseul live = GET /telemetry în timp real
// ======================================================================
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const LIVE_WINDOW_MS = 4500; // 4.5 secunde: trecere aproape instantanee în „Finalizat” la oprirea telefonului
const DIST_SCALE = 2.6;      // calibrare distanță pentru estimarea inertiala la mers pe jos / test

let fleet = loadFleet();
let auth = loadAuth();
const scenes = {};
const live = {}; // vin -> { lastEventId, sessionId, latest, points, error, receivedAt, localSeenAt, wasLive }
let sessionsByVin = {};
let seenDeviceIds = new Set();
let connected = false;
let pollingPaused = false;
let lastSessionsLoad = 0;
let healthInfo = null;

const pollMs = Math.max(500, Number(appConfig().pollIntervalMs) || 700);
const sessionsRefreshMs = Math.max(2000, Number(appConfig().sessionsRefreshMs) || 3000);

// ---------------------------------------------------------------- elemente UI
const ownerInput = document.getElementById("api-owner-input");
const vinSelect = document.getElementById("api-vin-select");
const vinInput = document.getElementById("api-vin-input");
const connectBtn = document.getElementById("api-connect-btn");
const syncHintEl = document.getElementById("api-sync-hint");
const connBadgeEl = document.getElementById("connection-status");
const apiUrlEl = document.getElementById("api-url-label");

if (apiUrlEl) apiUrlEl.textContent = apiBase();
if (ownerInput) ownerInput.value = auth.ownerId || "porsche";
if (vinInput) vinInput.value = auth.vehicleId || "";

function setBadge(text, online) {
  if (!connBadgeEl) return;
  connBadgeEl.className = online ? "status online" : "status";
  connBadgeEl.textContent = text;
}

function setHint(text, isError = false) {
  if (!syncHintEl) return;
  syncHintEl.textContent = text;
  syncHintEl.classList.toggle("hint-error", isError);
}

function updateConnectButton() {
  if (!connectBtn) return;
  if (connected && !pollingPaused) {
    connectBtn.textContent = "Oprește Live";
    connectBtn.className = "btn-ghost";
  } else {
    connectBtn.textContent = "Reia Live";
    connectBtn.className = "btn-primary";
  }
}

function syncVinSelector() {
  if (!vinSelect) return;
  vinSelect.innerHTML =
    `<option value="">— toate șasiurile (${fleet.length}) —</option>` +
    fleet.map((c) => `<option value="${escapeHtml(c.vin)}">${escapeHtml(c.name)} (${escapeHtml(c.vin)})</option>`).join("");
  vinSelect.value = fleet.some((c) => c.vin === auth.vehicleId) ? auth.vehicleId : "";
}

function persistAuthFromUI() {
  const latestAuth = loadAuth();
  auth = {
    ownerId: (ownerInput?.value || "porsche").trim() || "porsche",
    vehicleId: (vinInput?.value || "").trim().toUpperCase(),
    token: latestAuth.token || ""
  };
  if (vinInput) vinInput.value = auth.vehicleId;
  saveAuth(auth);
}

function addCarIfMissing(vin, extra = {}) {
  if (!vin || fleet.some((c) => c.vin === vin)) return false;
  fleet.push(normalizeCar({ vin, ...extra }, fleet.length));
  saveFleet(fleet);
  return true;
}

function removeCarFromFleet(vin) {
  fleet = fleet.filter((c) => c.vin !== vin);
  saveFleet(fleet);
  delete live[vin];
  if (scenes[vin]) {
    scenes[vin].dispose();
    delete scenes[vin];
  }
  if (auth.vehicleId === vin) {
    auth.vehicleId = "";
    if (vinInput) vinInput.value = "";
    saveAuth(auth);
  }
  syncVinSelector();
  renderFleet();
}

vinSelect?.addEventListener("change", () => {
  vinInput.value = vinSelect.value;
  persistAuthFromUI();
  if (vinSelect.value) {
    document.getElementById(`card-${vinSelect.value}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

const addVinBtn = document.getElementById("add-vin-btn");
addVinBtn?.addEventListener("click", handleAddOrFocusVin);

function handleAddOrFocusVin() {
  persistAuthFromUI();
  if (!auth.vehicleId) {
    setHint("Introdu o serie de șasiu (17 caractere) în căsuță.", true);
    return;
  }
  if (!VIN_RE.test(auth.vehicleId)) {
    setHint(`„${auth.vehicleId}” nu e un VIN valid (17 caractere, fără I, O, Q).`, true);
    return;
  }
  const isNew = addCarIfMissing(auth.vehicleId);
  syncVinSelector();
  renderFleet();
  pollingPaused = false;
  if (!connected) {
    connect();
  } else {
    tick(true);
  }
  document.getElementById(`card-${auth.vehicleId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (isNew) {
    setHint(`Vehiculul ${auth.vehicleId} a fost adăugat în dashboard.`);
  }
}

vinInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    persistAuthFromUI();
    pollingPaused = false;
    if (!connected) connect();
    else tick(true);
  }
});

connectBtn?.addEventListener("click", () => {
  if (connected && !pollingPaused) {
    pollingPaused = true;
    setBadge("Oprit manual", false);
    setHint("Monitorizarea live a fost oprită. Apasă „Reia Live” când pornești cursa.");
    updateConnectButton();
    fleet.forEach((car) => {
      drawLive(car);
      renderReportsAndRecs(car);
    });
    return;
  }

  persistAuthFromUI();
  if (auth.vehicleId && !VIN_RE.test(auth.vehicleId)) {
    setHint(`„${auth.vehicleId}” nu e un VIN valid (17 caractere, fără I, O, Q).`, true);
    return;
  }
  if (addCarIfMissing(auth.vehicleId)) {
    syncVinSelector();
    renderFleet();
  }
  pollingPaused = false;
  connect();
});

// ---------------------------------------------------------------- conectare
async function connect() {
  connected = false;
  pollingPaused = false;
  updateConnectButton();

  const latestAuth = loadAuth();
  auth.token = latestAuth.token || "";

  if (!auth.token) {
    setBadge("Neconectat • token lipsă", false);
    setHint("Tokenul API nu este configurat în config.js.", true);
    return;
  }

  setBadge("Se conectează…", false);
  setHint(`Verific ${apiBase()}/health …`);
  try {
    healthInfo = await api.health();
  } catch (err) {
    setBadge("API indisponibil", false);
    setHint(err.message, true);
    return;
  }

  if (healthInfo?.auth === "misconfigured") {
    setBadge("API: autorizare greșit configurată", false);
    setHint("Setarea DEMO_TENANTS_JSON din Azure nu e validă.", true);
    return;
  }
  if (healthInfo?.auth === "enabled-no-tenants") {
    setBadge("API: niciun token configurat", false);
    setHint("DEMO_TENANTS_JSON e gol în Azure.", true);
    return;
  }

  connected = true;
  lastSessionsLoad = 0;
  updateConnectButton();
  await tick(true);
}

// ---------------------------------------------------------------- telemetrie live
function isEntryLive(entry) {
  if (pollingPaused || !entry?.receivedAt) return false;
  const serverFresh = Date.now() - Date.parse(entry.receivedAt) <= LIVE_WINDOW_MS;
  const localFresh = entry.localSeenAt ? Date.now() - entry.localSeenAt <= LIVE_WINDOW_MS : serverFresh;
  return serverFresh && localFresh;
}

function calcPathStats(points) {
  if (!points || points.length === 0) return { distanceM: 0, durationSec: 0, maxAltRelM: 0 };
  let rawDist = 0;
  let maxAlt = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i].altitude ?? points[i].z ?? 0;
    if (a > maxAlt) maxAlt = a;
    if (i > 0) {
      rawDist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
  }
  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t);
  const durationSec = Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(1, Math.round((t1 - t0) / 1000)) : 0;
  return {
    distanceM: rawDist * DIST_SCALE,
    durationSec,
    maxAltRelM: maxAlt
  };
}

function eventToPoint(e) {
  const d = e.derived || {};
  const pos = d.position || {};
  if (pos.x == null || pos.y == null) return null;
  const alt = d.altitudeRel?.value ?? pos.z ?? 0;
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z ?? alt,
    altitude: alt,
    pitch: d.orientation?.pitch ?? null,
    roll: d.orientation?.roll ?? null,
    yaw: d.orientation?.yaw ?? null,
    rough: d.advice && /rough|pothole/i.test(d.advice) ? 1 : 0,
    advice: d.advice || null,
    t: d.capturedAtUtc || e.capturedAtUtc || e.receivedAtUtc
  };
}

async function refreshLive(car) {
  const vin = car.vin;
  const entry = (live[vin] ||= {
    lastEventId: null,
    sessionId: null,
    points: [],
    latest: null,
    error: null,
    localSeenAt: 0,
    wasLive: false
  });
  try {
    const res = await api.telemetry(auth, vin, { limit: 200 });
    entry.error = null;
    const events = res?.events || [];
    events.forEach((e) => e.deviceId && seenDeviceIds.add(e.deviceId));
    const latest = events[0] || null;
    entry.latest = latest;
    entry.receivedAt = latest?.receivedAtUtc || null;

    if (!latest) {
      updateOverlay(car);
      return false;
    }

    const latestId = `${latest.eventId || latest.batchId || ""}|${latest.receivedAtUtc || ""}`;
    const isFreshServer = Date.now() - Date.parse(entry.receivedAt) <= LIVE_WINDOW_MS;

    if (latestId !== entry.lastEventId) {
      const isFirstLoad = entry.lastEventId === null;
      entry.lastEventId = latestId;
      entry.localSeenAt = isFreshServer ? Date.now() : 0;

      const prevLen = entry.sessionId === latest.sessionId ? entry.points.length : 0;
      entry.sessionId = latest.sessionId;
      entry.points = events
        .filter((e) => e.sessionId === latest.sessionId)
        .reverse()
        .map(eventToPoint)
        .filter(Boolean);

      const addedPoints = !isFirstLoad && prevLen > 0 ? entry.points.slice(prevLen) : [];
      entry.wasLive = isEntryLive(entry);
      drawLive(car, addedPoints);
      // Actualizăm imediat și tabelul din datele live, fără să așteptăm backend-ul /sessions
      renderReportsAndRecs(car);
      return true;
    } else {
      const nowLive = isEntryLive(entry);
      const justStopped = entry.wasLive && !nowLive;
      entry.wasLive = nowLive;

      const scene = scenes[car.vin];
      if (!nowLive && scene && scene.pts.length > 0) {
        drawLive(car);
      } else {
        updateOverlay(car);
      }
      if (justStopped) renderReportsAndRecs(car);
      return justStopped;
    }
  } catch (err) {
    entry.error = err;
    updateOverlay(car);
    if (err.kind === "network" || err.kind === "auth") throw err;
    return false;
  }
}

// Watchdog rapid (500ms) pentru tranziție instantanee când expiră fereastra de 4.5s
setInterval(() => {
  if (!connected) return;
  for (const car of fleet) {
    const entry = live[car.vin];
    if (!entry) continue;
    const nowLive = isEntryLive(entry);
    if (entry.wasLive && !nowLive) {
      entry.wasLive = false;
      drawLive(car);
      renderReportsAndRecs(car);
    }
  }
}, 500);

// Coadă rapidă pentru harta live
const playQueues = {};

function drawLive(car, newPoints = []) {
  const entry = live[car.vin];
  const scene = scenes[car.vin];
  if (scene && entry?.points.length) {
    const active = isEntryLive(entry);

    if (!active) {
      playQueues[car.vin] = [];
      scene.clear();
      scene.setCar({ x: 0, y: 0, z: 0, rough: 0 });
    } else if (newPoints.length > 0 && newPoints.length < entry.points.length) {
      newPoints.forEach((p) => {
        scene.pushPoint({ x: p.x, y: p.y, z: p.z, rough: p.rough });
        (playQueues[car.vin] ||= []).push(p);
      });
    } else {
      playQueues[car.vin] = [];
      scene.setPath(entry.points.map((p) => ({ x: p.x, y: p.y, z: p.z, rough: p.rough })));
      const last = entry.points[entry.points.length - 1];
      scene.setCar({ x: last.x, y: last.y, z: last.z, rough: last.rough });
    }
  }
  updateOverlay(car);
}

setInterval(() => {
  for (const car of fleet) {
    const q = playQueues[car.vin];
    const scene = scenes[car.vin];
    if (q?.length && scene) {
      const nextPt = q.length > 3 ? q.splice(0, q.length).pop() : q.shift();
      scene.setCar({ x: nextPt.x, y: nextPt.y, z: nextPt.z, rough: nextPt.rough });
    }
  }
}, 40);

function updateOverlay(car) {
  const entry = live[car.vin];
  const posEl = document.getElementById(`telemetry-pos-${car.vin}`);
  const altEl = document.getElementById(`telemetry-alt-${car.vin}`);
  const pillEl = document.getElementById(`live-pill-${car.vin}`);
  if (!posEl || !altEl) return;

  if (!connected) {
    posEl.textContent = "Neconectat la API";
    altEl.textContent = "";
    if (pillEl) pillEl.className = "live-pill idle";
    return;
  }
  if (entry?.error) {
    posEl.textContent = entry.error.kind === "forbidden" ? "Fără acces la acest VIN (403)" : entry.error.message;
    altEl.textContent = "";
    if (pillEl) {
      pillEl.className = "live-pill idle";
      pillEl.textContent = "● FĂRĂ ACCES";
    }
    return;
  }
  if (!entry?.latest) {
    posEl.textContent = "Nicio telemetrie în bază pentru acest VIN încă.";
    altEl.textContent = "Pornește trimiterea din aplicația de telefon.";
    if (pillEl) {
      pillEl.className = "live-pill idle";
      pillEl.textContent = "● FĂRĂ DATE";
    }
    return;
  }
  const active = isEntryLive(entry);
  if (pillEl) {
    pillEl.className = active ? "live-pill" : "live-pill idle";
    pillEl.textContent = active ? "● TRAIECTORIE 3D LIVE" : `● ULTIMA CURSĂ • ${fmtDateTime(entry.receivedAt)}`;
  }
  const last = entry.points[entry.points.length - 1];
  if (!last) {
    posEl.textContent = `Ultimul semnal: ${fmtTime(entry.receivedAt)} (fără poziție calculată)`;
    altEl.textContent = "";
    return;
  }
  if (!active) {
    posEl.textContent = `Vehicul parcat • ultima cursă: ${fmtTime(last.t)}`;
    altEl.textContent = "Aștept pornirea unei curse noi";
    return;
  }
  const stats = calcPathStats(entry.points);
  posEl.textContent = last.rough
    ? `Drum denivelat • Distanță: ${fmtDistance(stats.distanceM)} • ${fmtTime(last.t)}`
    : `Distanță: ${fmtDistance(stats.distanceM)} • X ${last.x.toFixed(1)} m, Y ${last.y.toFixed(1)} m`;
  altEl.textContent = `Altitudine: ${fmtAlt(last.altitude)}${last.pitch != null ? ` • Pitch: ${last.pitch.toFixed(1)}°` : ""}`;
}

// ---------------------------------------------------------------- rapoarte (sesiuni din bază)
async function refreshSessions() {
  const { byVehicle, deviceIds } = await loadSessionsByVehicle(auth, [...seenDeviceIds, ...fleet.map((c) => c.vin)]);
  sessionsByVin = byVehicle;
  lastSessionsLoad = Date.now();

  let added = false;
  [...deviceIds, ...Object.keys(byVehicle)].forEach((id) => {
    if (addCarIfMissing(String(id).trim().toUpperCase())) added = true;
  });

  if (added) {
    syncVinSelector();
    renderFleet();
  } else {
    fleet.forEach(renderReportsAndRecs);
  }
}

function kmSince(sessions, iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return sessions.filter((s) => Date.parse(s.startedAt) >= t).reduce((a, s) => a + ((s.distanceM || 0) * DIST_SCALE), 0) / 1000;
}

function renderReportsAndRecs(car) {
  const tbody = document.getElementById(`reports-${car.vin}`);
  const recsEl = document.getElementById(`recs-${car.vin}`);
  const baseSessions = sessionsByVin[car.vin] || [];
  const entry = live[car.vin];
  const active = isEntryLive(entry);

  // Combinăm sesiunile din backend cu sesiunea activă din telemetrie pentru afișare instantanee
  let sessions = baseSessions.map((s) => ({
    ...s,
    distanceM: (s.distanceM || 0) * DIST_SCALE
  }));

  if (entry?.sessionId && entry.points?.length) {
    const liveStats = calcPathStats(entry.points);
    const existingIdx = sessions.findIndex((s) => s.sessionId === entry.sessionId);
    if (existingIdx >= 0) {
      sessions[existingIdx] = {
        ...sessions[existingIdx],
        durationSec: Math.max(sessions[existingIdx].durationSec || 0, liveStats.durationSec),
        distanceM: Math.max(sessions[existingIdx].distanceM || 0, liveStats.distanceM),
        maxAltRelM: Math.max(sessions[existingIdx].maxAltRelM || 0, liveStats.maxAltRelM)
      };
    } else if (active) {
      // Dacă sesiunea abia a pornit pe telefon și încă nu a ajuns în /sessions, o afișăm instant!
      sessions.unshift({
        sessionId: entry.sessionId,
        deviceId: entry.latest?.deviceId || car.vin,
        startedAt: entry.points[0].t || entry.receivedAt,
        status: "live",
        durationSec: liveStats.durationSec,
        distanceM: liveStats.distanceM,
        maxAltRelM: liveStats.maxAltRelM
      });
    }
  }

  if (tbody) {
    if (!connected) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Conectează API-ul ca să vezi rapoartele din bază.</td></tr>`;
    } else if (!sessions.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Nicio cursă înregistrată în bază pentru acest VIN.</td></tr>`;
    } else {
      tbody.innerHTML = sessions
        .slice(0, 15)
        .map((s, idx) => {
          const isSessionLive =
            !pollingPaused && idx === 0 && active && entry?.sessionId === s.sessionId;
          return `
        <tr data-vin="${escapeHtml(car.vin)}" data-session="${escapeHtml(s.sessionId)}" data-device="${escapeHtml(s.deviceId)}">
          <td><strong>${fmtDateTime(s.startedAt)}</strong></td>
          <td>${isSessionLive ? `<span class="badge-active">● În desfășurare</span>` : `<span class="badge-done">Finalizat</span>`}</td>
          <td>${fmtDuration(s.durationSec)}</td>
          <td>${fmtDistance(s.distanceM)}</td>
          <td>${fmtAlt(s.maxAltRelM)}</td>
        </tr>`;
        })
        .join("");
      tbody.querySelectorAll("tr[data-session]").forEach((row) => {
        row.addEventListener("click", () => {
          const p = new URLSearchParams({ vin: row.dataset.vin, session: row.dataset.session, device: row.dataset.device });
          window.location.href = `./report.html?${p}`;
        });
      });
    }
  }

  if (recsEl) {
    if (!connected) {
      recsEl.innerHTML = "";
      return;
    }
    const stats = { ...statsFromSessions(sessions), kmSinceOdometer: kmSince(baseSessions, car.odometerSetAt) };
    recsEl.innerHTML = renderRecommendations(
      buildRecommendations(car, stats),
      2,
      sessions.length ? "Nimic de semnalat în cursele înregistrate." : "Aștept curse din baza de date pentru analiză."
    );
  }
}

// ---------------------------------------------------------------- bucla de actualizare continuă în timp real
let ticking = false;
async function tick(force = false) {
  if (!connected || pollingPaused || ticking) return;
  ticking = true;
  try {
    const activeCars = auth.vehicleId
      ? fleet.filter((c) => c.vin === auth.vehicleId)
      : fleet;

    const results = await Promise.all(activeCars.map((car) => refreshLive(car)));
    const stateChanged = results.some(Boolean);

    if (force || stateChanged || Date.now() - lastSessionsLoad >= sessionsRefreshMs) {
      await refreshSessions();
    }

    const okCars = fleet.filter((c) => live[c.vin] && !live[c.vin].error).length;
    const liveCars = fleet.filter((c) => isEntryLive(live[c.vin])).length;

    setBadge(liveCars ? `LIVE API • ${liveCars} în cursă` : "API conectat • Live activ", true);
    setHint(
      fleet.length
        ? `Conectat ca „${auth.ownerId}” • ${okCars}/${fleet.length} vehicule • actualizat ${new Date().toLocaleTimeString("ro-RO")}`
        : `Conectat ca „${auth.ownerId}”. Se așteaptă prima cursă de pe telefon pentru a detecta automat șasiul.`
    );
  } catch (err) {
    setBadge(err.kind === "auth" ? "Token respins" : "Eroare API", false);
    setHint(err.message, true);
    if (err.kind === "auth") {
      connected = false;
      updateConnectButton();
    }
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------- randare flotă
function disposeScenes() {
  Object.keys(scenes).forEach((id) => {
    scenes[id].dispose();
    delete scenes[id];
  });
}

function thumbFor(car, imgEl) {
  const base = car.imageBase || "./assets/porsche-silver";
  const candidates = /\.(png|jpe?g|webp)$/i.test(base) ? [base] : [`${base}.png`, `${base}.jpg`, `${base}.webp`];
  let i = 0;
  const next = () => {
    if (i < candidates.length) imgEl.src = candidates[i++];
  };
  imgEl.onerror = next;
  next();
}

function renderFleet() {
  disposeScenes();
  const grid = document.getElementById("fleet-grid");
  grid.innerHTML = "";

  if (!fleet.length) {
    grid.innerHTML = `<article class="card empty-fleet">
      <h3>Nicio mașină în dashboard</h3>
      <p class="muted">Vehiculele detectate în baza de date apar automat aici imediat ce se trimite telemetrie de pe telefon.</p>
      <button type="button" id="reload-fleet-btn" class="btn-primary" style="margin-top: 0.75rem;">Caută vehicule în bază</button>
    </article>`;
    document.getElementById("reload-fleet-btn")?.addEventListener("click", () => {
      pollingPaused = false;
      connect();
    });
    return;
  }

  fleet.forEach((car) => {
    const card = document.createElement("article");
    card.className = "car-card";
    card.id = `card-${car.vin}`;
    card.innerHTML = `
      <div class="car-card-header">
        <div class="car-title-group">
          <img alt="" class="car-thumb-mini" />
          <div>
            <h3>${escapeHtml(car.name)}</h3>
            <span class="muted">VIN: ${escapeHtml(car.vin)}</span>
          </div>
        </div>
        <div class="car-header-controls">
          <span id="live-pill-${car.vin}" class="live-pill idle">● AȘTEPT DATE</span>
          <button type="button" class="btn-delete-car" data-delete="${escapeHtml(car.vin)}" title="Șterge mașina din dashboard">✕ Șterge</button>
        </div>
      </div>

      <div class="mini-map-box">
        <div id="scene-${car.vin}" class="scene3d"></div>
        <div class="mini-map-overlay">
          <span id="telemetry-pos-${car.vin}">Aștept date de la API...</span>
          <span id="telemetry-alt-${car.vin}"></span>
        </div>
      </div>

      <div class="reports-table-wrapper">
        <h4>Rapoarte de cursă (click pe un raport pentru detalii)</h4>
        <table class="reports-table">
          <thead>
            <tr><th>Început</th><th>Status</th><th>Durată</th><th>Distanță</th><th>Alt. Max</th></tr>
          </thead>
          <tbody id="reports-${car.vin}"></tbody>
        </table>
      </div>

      <div id="recs-${car.vin}"></div>
    `;
    grid.appendChild(card);
    thumbFor(car, card.querySelector(".car-thumb-mini"));

    scenes[car.vin] = createCarScene(card.querySelector(`#scene-${car.vin}`), {
      trailColor: car.color,
      bodyColor: bodyColorFor(car),
      zoom: false,
      maxPoints: 700
    });

    renderReportsAndRecs(car);
    if (live[car.vin]?.points?.length) drawLive(car);
    else updateOverlay(car);
  });

  grid.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeCarFromFleet(btn.dataset.delete);
    })
  );
}

// ---------------------------------------------------------------- pornire
syncVinSelector();
renderFleet();
connect();
setInterval(() => tick(), pollMs);