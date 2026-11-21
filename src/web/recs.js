// ======================================================================
//  Recomandări & mentenanță predictivă, calculate DOAR din date reale:
//   - rezumatele sesiunilor din bază (distanță, evenimente drum prost / condus agresiv, altitudine, viteză)
//   - opțional, citirile brute ale unei sesiuni (magnetometru, barometru, accelerometru) în pagina de raport
//   - kilometrajul de bord, dacă utilizatorul l-a introdus la vehicul
//  Dacă o informație lipsește, regula respectivă nu se aplică (nu inventăm valori).
// ======================================================================
import { fmtKm, fmtDistance, escapeHtml } from "./api.js";

const REC_LABELS = {
  ice: { minor: "Schimb ulei", major: "Distribuție / revizie majoră" },
  ev: { minor: "Lichid frână / reductor", major: "Revizie transmisie / baterie" }
};

/** Agregă rezumatele de sesiune venite din GET /devices/{id}/sessions sau /sessions/{id}/track. */
export function statsFromSessions(sessions) {
  const list = sessions || [];
  const sum = (f) => list.reduce((a, s) => a + (f(s) || 0), 0);
  const maxAlt = Math.max(...list.map((s) => s.maxAltRelM ?? -Infinity));
  const minAlt = Math.min(...list.map((s) => s.minAltRelM ?? Infinity));
  const maxSpeed = Math.max(...list.map((s) => s.maxSpeedMps ?? -Infinity));
  return {
    sessions: list.length,
    distanceKm: sum((s) => s.distanceM) / 1000,
    roughCount: sum((s) => s.events?.roughRoad),
    harshCount: sum((s) => s.events?.harshDriving),
    elevRangeM: Number.isFinite(maxAlt) && Number.isFinite(minAlt) ? maxAlt - minAlt : null,
    maxSpeedKmh: Number.isFinite(maxSpeed) ? maxSpeed * 3.6 : null
  };
}

/** Statistici din citirile brute ale unei sesiuni (pagina de raport). */
export function statsFromReadings({ accel = [], mag = [], baro = [] }) {
  const out = {};
  if (mag.length) {
    const m = mag.map((r) => Math.hypot(r.value.x, r.value.y, r.value.z));
    const mean = m.reduce((a, b) => a + b, 0) / m.length;
    out.magMeanUT = mean;
    out.magStdUT = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
    out.magOutOfRangePct = (m.filter((v) => v < 25 || v > 65).length / m.length) * 100;
  }
  if (baro.length) {
    const p = baro.map((r) => r.value.pressure).filter((v) => v != null);
    if (p.length) out.minPressure = Math.min(...p);
    out.hasBaro = p.length > 0;
  } else {
    out.hasBaro = false;
  }
  if (accel.length) {
    // modulul accelerației față de 1 g: vârfuri mari = șocuri (gropi, borduri), indiferent de poziția telefonului
    const dyn = accel.map((r) => Math.abs(Math.hypot(r.value.x, r.value.y, r.value.z) - 1));
    out.peakDynG = Math.max(...dyn);
    out.impacts = dyn.filter((v) => v > 0.8).length;
  }
  return out;
}

export function buildRecommendations(car, s) {
  const isEv = car.powertrain === "ev";
  const L = REC_LABELS[isEv ? "ev" : "ice"];
  const dist = Math.max(s.distanceKm || 0, 0.001);
  const per10 = (n) => ((n || 0) / dist) * 10;
  const items = [];
  const add = (level, sensor, text, weight) => items.push({ level, sensor, text, weight });

  // ---- service: doar dacă avem kilometrajul de bord introdus de utilizator
  let bars = [];
  let odo = null;
  if (car.odometerKm != null) {
    odo = car.odometerKm + (s.kmSinceOdometer || 0);
    const roughShare = Math.min(1, per10(s.roughCount) / 10);
    const wear = 1 - Math.min(0.12, roughShare * 0.12);
    const service = (step, w) => {
      const eff = Math.round(step * w);
      const since = odo % step;
      return { left: Math.max(0, eff - since), pct: Math.min(100, Math.round((since / eff) * 100)) };
    };
    const minor = service(car.oilIntervalKm || 15000, wear);
    const major = service(car.timingBeltKm || 90000, 1);
    bars = [
      { label: L.minor, left: minor.left, pct: minor.pct },
      { label: L.major, left: major.left, pct: major.pct }
    ];
    if (minor.left <= 1500) add("danger", "Kilometraj", `${L.minor}: mai sunt aproximativ ${fmtKm(minor.left)} km până la termen.`, 90);
    else if (minor.left <= 3000) add("warn", "Kilometraj", `${L.minor} se apropie (peste ~${fmtKm(minor.left)} km).`, 50);
    if (major.left <= 5000) add("warn", "Kilometraj", `${L.major} în ~${fmtKm(major.left)} km.`, 55);
    if (wear < 0.95) add("info", "Condiții", `Drum prost frecvent: intervalul efectiv de service e scurtat cu ~${Math.round((1 - wear) * 100)}%.`, 20);
  }

  // ---- din sesiunile salvate în bază
  if ((s.roughCount || 0) >= 3 || (s.distanceKm >= 1 && per10(s.roughCount) >= 2)) {
    add("warn", "Accelerometru", `${s.roughCount} momente de drum denivelat / gropi detectate. Merită o privire la suspensii, bucșe și presiunea din pneuri.`, 60);
  }
  if ((s.harshCount || 0) >= 3 && (s.distanceKm < 1 || per10(s.harshCount) >= 3)) {
    add("warn", "Accelerometru", `${s.harshCount} accelerări/frânări bruște sau viraje strânse: plăcuțele, discurile și anvelopele se uzează mai repede.`, 62);
  }
  if ((s.elevRangeM || 0) >= 300) {
    add("info", "Barometru", isEv
      ? `Diferență de nivel de ~${Math.round(s.elevRangeM)} m: consum și solicitare termică mai mari pentru baterie.`
      : `Diferență de nivel de ~${Math.round(s.elevRangeM)} m: solicitare mai mare pentru motor și răcire.`, 28);
  }
  if ((s.maxSpeedKmh || 0) >= 160) {
    add("info", "GPS", `Viteză maximă înregistrată ~${Math.round(s.maxSpeedKmh)} km/h: verifică presiunea și starea anvelopelor.`, 30);
  }

  // ---- din citirile brute (doar în raport)
  if ((s.impacts || 0) >= 1) {
    add("warn", "Accelerometru", `Șoc puternic detectat (vârf ~${(1 + s.peakDynG).toFixed(1)} g). Verifică jantele, flancul anvelopelor și geometria.`, 65);
  }
  if (s.hasBaro === false) {
    add("info", "Barometru", "Telefonul nu a trimis date de barometru: recomandările legate de relief folosesc doar altitudinea estimată.", 10);
  } else if (s.minPressure != null && s.minPressure <= 900) {
    add("info", "Barometru", "Altitudine mare (~1000 m+): presiunea din pneuri se schimbă; verific-o la coborâre.", 26);
  }
  if ((s.magOutOfRangePct || 0) >= 10) {
    add("warn", "Magnetometru", `Câmp magnetic perturbat (medie ~${(s.magMeanUT || 0).toFixed(0)} µT, normal 25–65). Mută telefonul de magneți/cabluri și recalibrează busola.`, 40);
  } else if ((s.magStdUT || 0) >= 12) {
    add("info", "Magnetometru", "Câmp magnetic instabil: direcția (yaw) poate fi imprecisă. Recalibrează busola în „opt”.", 16);
  }

  items.sort((a, b) => b.weight - a.weight);
  return { odo, bars, items, distanceKm: s.distanceKm || 0, sessions: s.sessions };
}

export function renderRecommendations(rec, visible = 2, emptyText = "Nimic de semnalat în datele înregistrate.", { serviceNote = true } = {}) {
  const barColor = (pct) => (pct >= 90 ? "#d9645a" : pct >= 75 ? "#d3a04a" : "rgba(148, 163, 184, 0.7)");
  const row = (i) => `
    <div class="rec-item ${i.level}">
      <span class="rec-sensor-tag">${escapeHtml(i.sensor)}</span>
      <span>${escapeHtml(i.text)}</span>
    </div>`;
  const top = rec.items.slice(0, visible).map(row).join("");
  const rest = rec.items.slice(visible);
  const more = rest.length
    ? `<details><summary>încă ${rest.length} ${rest.length === 1 ? "observație" : "observații"}</summary>
         <div class="rec-list">${rest.map(row).join("")}</div></details>`
    : "";
  const empty = rec.items.length ? "" : `<div class="rec-item"><span>${escapeHtml(emptyText)}</span></div>`;
  const bars = rec.bars.length
    ? rec.bars
        .map(
          (b) => `
      <div class="service-item">
        <div class="service-item-top"><span>${b.label}</span><strong>în ${fmtKm(b.left)} km</strong></div>
        <div class="progress-track"><div class="progress-fill" style="width: ${b.pct}%; background: ${barColor(b.pct)};"></div></div>
      </div>`
        )
        .join("")
    : !serviceNote
    ? ""
    : `<p class="muted small-note">Introdu kilometrajul de bord la vehicul (butonul ✎) ca să vezi termenele de service.</p>`;
  const badge = rec.odo != null ? `${fmtKm(rec.odo)} km bord` : `${fmtDistance(rec.distanceKm * 1000)} înregistrați`;

  return `
    <div class="recommendations-box">
      <div class="recommendations-header">
        <h4>Recomandări &amp; Mentenanță Predictivă</h4>
        <span class="km-badge">${badge}</span>
      </div>
      <div class="service-bars">${bars}</div>
      <div class="rec-list">${top}${empty}</div>
      ${more}
    </div>`;
}
