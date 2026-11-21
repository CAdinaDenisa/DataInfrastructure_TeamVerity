import { createCarScene, bodyColorFor } from "./scene3d.js";

const rawContext = sessionStorage.getItem("selected_report_context");
const context = rawContext
  ? JSON.parse(rawContext)
  : {
      car: {
        id: "car-1",
        name: "Porsche 911 Turbo S",
        deviceId: "phone-daniela-01",
        color: "#38bdf8",
        imageBase: "./assets/porsche-silver",
        powertrain: "ice",
        odometerKm: 14280,
        oilIntervalKm: 15000,
        timingBeltKm: 90000,
        reports: [
          {
            id: "rep-demo",
            date: "2026-11-21",
            status: "done",
            duration: "24 min",
            distance: "8.7 km",
            maxAlt: "+42.0 m"
          }
        ]
      },
      reportId: "rep-demo",
      resolvedUrl: null
    };

const { car, reportId, resolvedUrl } = context;
const report = car.reports.find((r) => r.id === reportId) || car.reports[0];

document.getElementById("report-title").textContent = `${car.name} — Raport ${report.date}`;
document.getElementById("report-subtitle").textContent = `Dispozitiv: ${car.deviceId} • Durată: ${report.duration || "24 min"}`;
document.getElementById("car-model-name").textContent = car.name;
document.getElementById("car-device-tag").textContent = car.deviceId;

const badgeEl = document.getElementById("report-badge");
badgeEl.textContent = report.status === "live" ? "● Raport în desfășurare (LIVE)" : "Raport Finalizat";

let loadedCarImg = null;
const photoEl = document.getElementById("car-photo");

// Încarcă direct imaginea originală din assets/ fără nicio modificare asupra pixelilor
function initCarVisuals() {
  const base = car.imageBase || car.imageUrl || "./assets/porsche-silver";
  const candidates = resolvedUrl
    ? [resolvedUrl]
    : base.match(/\.(png|jpg|jpeg|webp)$/i)
      ? [base]
      : [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.webp`];

  let idx = 0;
  function tryLoad() {
    if (idx >= candidates.length) return;
    const url = candidates[idx++];
    const img = new Image();
    img.onload = () => {
      loadedCarImg = img;
      photoEl.src = url;
    };
    img.onerror = tryLoad;
    img.src = url;
  }

  tryLoad();
}

initCarVisuals();

// Generare 120 puncte de telemetrie (urcare și coborâre).
const TOTAL_POINTS = 120;
const telemetryPoints = [];

for (let i = 0; i < TOTAL_POINTS; i++) {
  const progress = i / (TOTAL_POINTS - 1);
  const angle = progress * Math.PI * 2.2;

  const x = Math.cos(angle) * 230 + Math.sin(angle * 2) * 60;
  const y = Math.sin(angle) * 120;
  const altitude = Math.max(0, Math.sin(progress * Math.PI) * 38 + Math.sin(progress * Math.PI * 4) * 4);
  const pressure = +(1013.2 - altitude / 8.3).toFixed(2);
  const pitch = +(Math.cos(progress * Math.PI) * 11.5).toFixed(1);
  const roll = +(Math.sin(angle * 2) * 8.2).toFixed(1);
  const yaw = +(((angle * 180) / Math.PI) % 360).toFixed(1);
  const rough = Math.max(0, Math.min(1, 1.6 - Math.abs(progress - 0.5) / 0.05));

  telemetryPoints.push({
    timeLabel: `10:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i * 10) % 60).padStart(2, "0")}`,
    x,
    y,
    altitude,
    pressure,
    pitch,
    roll,
    yaw,
    rough,
    accel: [+(Math.sin(angle) * 0.25).toFixed(2), -0.98, +(0.12 + pitch * 0.01 + rough * Math.sin(i * 5) * 0.35).toFixed(2)],
    mag: [+(22 + Math.cos(angle) * 15).toFixed(1), +(-6 + Math.sin(angle) * 15).toFixed(1), -40.5]
  });
}

const maxAlt = Math.max(...telemetryPoints.map((p) => p.altitude)).toFixed(1);
document.getElementById("val-dist").textContent = `${report.distance || "8.7 km"} • ${report.duration || "24 min"}`;

// Populare tabel citiri reprezentative
const tbody = document.getElementById("readings-table-body");
[0, 35, 60, 115].forEach((idx) => {
  const p = telemetryPoints[idx];
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${p.timeLabel}Z</td>
    <td>${p.accel.join(", ")}</td>
    <td>${p.mag.join(", ")}</td>
    <td>${p.pressure} hPa</td>
    <td><strong>+${p.altitude.toFixed(1)} m</strong></td>
    <td>${p.pitch}° / ${p.roll}°</td>
  `;
  tbody.appendChild(tr);
});

// ======================================================================
//  RECOMANDĂRI & MENTENANȚĂ PREDICTIVĂ — pentru ACEASTĂ zi
// ======================================================================
const REC_LABELS = {
  ice: { minor: "Schimb ulei", major: "Distribuție / revizie majoră" },
  ev: { minor: "Lichid frână / reductor", major: "Revizie transmisie / baterie" }
};

function fmtKm(n) {
  return Math.round(n).toLocaleString("ro-RO");
}

function buildSessionStats() {
  const dist = parseFloat(String(report.distance || "").replace(",", ".")) || 5;
  const n = telemetryPoints.length;
  const seed = String(report.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);

  const roughShare = telemetryPoints.filter((p) => p.rough > 0.3).length / n;
  const alts = telemetryPoints.map((p) => p.altitude);
  const azMean = telemetryPoints.reduce((a, p) => a + p.accel[2], 0) / n;
  const dynG = Math.max(...telemetryPoints.map((p) => Math.abs(p.accel[2] - azMean)));
  const mags = telemetryPoints.map((p) => Math.hypot(p.mag[0], p.mag[1], p.mag[2]));
  const magMean = mags.reduce((a, b) => a + b, 0) / n;
  const magStd = Math.sqrt(mags.reduce((a, b) => a + (b - magMean) ** 2, 0) / n);
  const magOut = (mags.filter((m) => m < 25 || m > 65).length / n) * 100;

  return {
    distanceKm: dist,
    roughPct: roughShare * 100,
    roughKm: dist * roughShare,
    elevGainM: Math.max(...alts),
    elevLossM: Math.max(...alts) * 0.9,
    minPressure: Math.min(...telemetryPoints.map((p) => p.pressure)),
    peakVertG: 0.5 + dynG,
    impacts: seed % 7 === 0 ? 1 : 0,
    magMeanUT: magMean,
    magStdUT: magStd,
    magOutOfRangePct: magOut,
    hasBaro: true,
    hardBrakes: Math.round(dist * (0.3 + (seed % 5) / 10)),
    hardAccels: 1,
    maxLateralG: car.id === "car-1" ? 0.62 : 0.35,
    rollBiasDeg: car.id === "car-2" ? 2.4 : 0.4,
    pitchOnBrakeDeg: 3,
    smoothVibPct: 1,
    idleMinutes: 1,
    idleVibRms: 0.02,
    stopGoPct: 12,
    pressureTrendHpaH: -0.5
  };
}

function buildCarRecommendations(carData, s) {
  const isEv = carData.powertrain ? carData.powertrain === "ev" : /taycan|electric/i.test(carData.name || "");
  const L = REC_LABELS[isEv ? "ev" : "ice"];
  const dist = Math.max(s.distanceKm || 0, 1);
  const per10 = (v) => ((v || 0) / dist) * 10;
  const odo = carData.odometerKm || 0;

  const wear = 1 - Math.min(0.12, (s.roughPct || 0) / 200) - Math.min(0.08, (s.stopGoPct || 0) / 500);

  const service = (step, w, lastKm) => {
    const eff = Math.round(step * w);
    const since = lastKm != null ? odo - lastKm : odo % step;
    return { left: Math.max(0, eff - since), pct: Math.min(100, Math.round((since / eff) * 100)) };
  };
  const minor = service(carData.oilIntervalKm || 15000, wear, carData.lastOilKm);
  const major = service(carData.timingBeltKm || 90000, 1, carData.lastMajorKm);

  const items = [];
  const add = (level, sensor, text, weight) => items.push({ level, sensor, text, weight });

  if (minor.left <= 1500) {
    add("danger", "Kilometraj", `${L.minor}: mai sunt aproximativ ${fmtKm(minor.left)} km până la termen.`, 90);
  } else if (minor.left <= 3000) {
    add("warn", "Kilometraj", `${L.minor} se apropie (peste ~${fmtKm(minor.left)} km). Poți programa din timp.`, 50);
  }
  if (major.left <= 5000) {
    add("warn", "Kilometraj", `${L.major} în ~${fmtKm(major.left)} km.`, 55);
  }
  if (wear < 0.95) {
    add("info", "Condiții", `Condiții solicitante recent: intervalul efectiv de service e scurtat cu ~${Math.round((1 - wear) * 100)}%.`, 20);
  }

  if ((s.roughPct || 0) >= 5 || (s.roughKm || 0) >= 1) {
    add("warn", "Accelerometru", `~${(s.roughKm || 0).toFixed(1)} km pe drum neasfaltat/denivelat. Merită o privire la suspensii, bucșe și presiunea din pneuri.`, 60);
  }
  if ((s.roughKmTotal || carData.roughKmTotal || 0) >= 300) {
    add("warn", "Accelerometru", "Rulaj cumulat mare pe drum prost: verifică amortizoarele și rotulele la următorul service.", 58);
  }
  if ((s.impacts || 0) >= 1 || (s.peakVertG || 0) >= 1.6) {
    add("warn", "Accelerometru", "Șoc puternic detectat (groapă sau bordură?). Verifică jantele, flancul anvelopelor și geometria.", 65);
  }
  if (per10(s.hardBrakes) >= 4) {
    add("warn", "Accelerometru", "Frânări apăsate frecvente: plăcuțele și discurile se uzează mai repede. Verifică-le la următoarea revizie.", 62);
  }
  if (per10(s.hardAccels) >= 4) {
    add("info", "Accelerometru", isEv
      ? "Accelerări bruște dese: consum mai mare și uzură mai rapidă a anvelopelor."
      : "Accelerări bruște dese: consum mai mare, uzură mai rapidă a anvelopelor și a uleiului.", 30);
  }
  if ((s.maxLateralG || 0) >= 0.6) {
    add("info", "Accelerometru", "Accelerații laterale mari în viraje: uzura anvelopelor pe margini; verifică presiunea și geometria.", 32);
  }
  if (Math.abs(s.rollBiasDeg || 0) >= 2) {
    add("warn", "Accelerometru", "Caroseria pare înclinată constant într-o parte pe drum drept: presiune inegală în pneuri, geometrie sau arc obosit.", 52);
  }
  if ((s.pitchOnBrakeDeg || 0) >= 4) {
    add("warn", "Accelerometru", "Boțul în frânare este accentuat: amortizoarele din față pot fi uzate.", 50);
  }
  if ((s.smoothVibPct || 0) >= 10) {
    add("warn", "Accelerometru", "Vibrații constante pe asfalt bun: posibil dezechilibru la roți sau jantă deformată.", 54);
  }
  if (!isEv && (s.idleVibRms || 0) >= 0.08) {
    add("warn", "Accelerometru", "Vibrații mai mari la ralanti: suporții motorului sau bujiile merită verificate.", 48);
  }
  if (!isEv && (s.idleMinutes || 0) >= 15) {
    add("info", "Accelerometru", "Mult timp mers în gol: uleiul se degradează mai repede decât arată kilometrajul.", 22);
  }
  if ((s.stopGoPct || 0) >= 40) {
    add("info", "Accelerometru", "Trafic aglomerat și curse scurte: solicitare mai mare pentru frâne și ulei/baterie.", 24);
  }

  if (s.hasBaro === false) {
    add("info", "Barometru", "Telefonul nu are barometru: recomandările legate de relief nu sunt disponibile.", 10);
  } else {
    if ((s.elevLossM || 0) >= 250 && per10(s.hardBrakes) >= 2) {
      add("warn", "Barometru", "Coborâri lungi cu frânări dese: plăcuțele și lichidul de frână se încălzesc. Folosește frâna de motor / regenerarea.", 56);
    } else if ((s.elevGainM || 0) >= 300) {
      add("info", "Barometru", isEv
        ? "Urcări mari în sesiune: consum și solicitare termică mai mari pentru baterie."
        : "Urcări mari în sesiune: solicitare mai mare pentru motor și sistemul de răcire.", 28);
    }
    if ((s.minPressure || 1013) <= 900) {
      add("info", "Barometru", isEv
        ? "Altitudine mare (~1000 m+): presiunea din pneuri se simte diferit; verific-o la coborâre."
        : "Altitudine mare (~1000 m+): aer mai rar, ușoară pierdere de putere la motoarele atmosferice; verifică filtrul de aer dacă e murdar.", 26);
    }
    if ((s.pressureTrendHpaH || 0) <= -3) {
      add("info", "Barometru", "Presiunea scade repede (front atmosferic): posibilă ploaie, aderență mai mică; verifică ștergătoarele și anvelopele.", 18);
    }
  }

  if ((s.magOutOfRangePct || 0) >= 10) {
    add("warn", "Magnetometru", `Câmp magnetic perturbat (medie ~${(s.magMeanUT || 0).toFixed(0)} µT, normal 25–65). Mută telefonul de magneți/cabluri și recalibrează busola; dacă persistă, verifică instalația electrică.`, 40);
  } else if ((s.magStdUT || 0) >= 12) {
    add("info", "Magnetometru", "Câmp magnetic instabil: direcția (yaw) poate fi imprecisă. Recalibrează busola în „opt”.", 16);
  }

  items.sort((a, b) => b.weight - a.weight);

  return {
    odo,
    bars: [
      { label: L.minor, left: minor.left, pct: minor.pct },
      { label: L.major, left: major.left, pct: major.pct }
    ],
    items
  };
}

function renderRecommendations(rec, visible = 3) {
  const barColor = (pct) => (pct >= 90 ? "#d9645a" : pct >= 75 ? "#d3a04a" : "rgba(148, 163, 184, 0.7)");
  const row = (i) => `
    <div class="rec-item ${i.level}">
      <span class="rec-sensor-tag">${i.sensor}</span>
      <span>${i.text}</span>
    </div>`;

  const top = rec.items.slice(0, visible).map(row).join("");
  const rest = rec.items.slice(visible);
  const more = rest.length
    ? `<details><summary>încă ${rest.length} ${rest.length === 1 ? "observație" : "observații"}</summary>
         <div class="rec-list">${rest.map(row).join("")}</div></details>`
    : "";
  const empty = rec.items.length ? "" : `<div class="rec-item"><span>Nimic de semnalat în această sesiune.</span></div>`;

  const bars = rec.bars
    .map(
      (b) => `
      <div class="service-item">
        <div class="service-item-top">
          <span>${b.label}</span>
          <strong>în ${fmtKm(b.left)} km</strong>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${b.pct}%; background: ${barColor(b.pct)};"></div>
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="recommendations-box">
      <div class="recommendations-header">
        <h4>Recomandări &amp; Mentenanță Predictivă</h4>
        <span class="km-badge">${fmtKm(rec.odo)} km total</span>
      </div>
      <div class="service-bars">${bars}</div>
      <div class="rec-list">${top}${empty}</div>
      ${more}
    </div>`;
}

const recsEl = document.getElementById("report-recs");
if (recsEl) {
  recsEl.innerHTML = renderRecommendations(buildCarRecommendations(car, buildSessionStats()), 3);
}

// Graficul din partea dreaptă-jos (Chart.js)
const chartCtx = document.getElementById("reportTelemetryChart");
if (chartCtx && window.Chart) {
  const sampled = telemetryPoints.filter((_, i) => i % 3 === 0);
  new window.Chart(chartCtx, {
    type: "line",
    data: {
      labels: sampled.map((p) => p.timeLabel),
      datasets: [
        {
          label: "Altitudine relativă (m)",
          data: sampled.map((p) => +p.altitude.toFixed(1)),
          borderColor: car.color,
          backgroundColor: "rgba(56, 189, 248, 0.14)",
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.3
        },
        {
          label: "Înclinație Pitch (°)",
          data: sampled.map((p) => p.pitch),
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
      plugins: {
        legend: { labels: { color: "#e2e8f0" } }
      },
      scales: {
        x: { ticks: { color: "#cbd5e1", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.07)" } }
      }
    }
  });
}

// ---- Traiectorie 3D (three.js) ----
const slider = document.getElementById("timeline-slider");
const playPauseBtn = document.getElementById("play-pause-btn");
const altReadout = document.getElementById("live-alt-readout");

const sceneHost = document.getElementById("trajectory3d") || document.querySelector(".canvas-3d-wrapper");
const scene3d = createCarScene(sceneHost, {
  trailColor: car.color,
  bodyColor: bodyColorFor(car)
});
scene3d.setPath(
  telemetryPoints.map((p) => ({ x: p.x, y: p.y, z: p.altitude, rough: p.rough }))
);

slider.max = TOTAL_POINTS - 1;
let currentIndex = 0;
let isPlaying = true;

function showIndex(idx, snap = false) {
  const p = telemetryPoints[idx];
  scene3d.setCarAt(idx, snap);

  altReadout.textContent = `+${p.altitude.toFixed(1)} m`;
  document.getElementById("val-alt").textContent = `+${maxAlt} m / +${p.altitude.toFixed(1)} m`;
  document.getElementById("val-orient").textContent = `${p.pitch}° / ${p.roll}° / ${p.yaw}°`;
  document.getElementById("val-accel").textContent = `${p.accel.join(", ")} g`;
  document.getElementById("val-mag").textContent = `${p.mag.join(", ")} µT`;
  document.getElementById("val-baro").textContent = `${p.pressure} hPa`;
}

playPauseBtn.addEventListener("click", () => {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? "⏸ Pauză" : "▶ Redă";
});

slider.addEventListener("input", (e) => {
  isPlaying = false;
  playPauseBtn.textContent = "▶ Redă";
  currentIndex = Number(e.target.value);
  showIndex(currentIndex);
});

setInterval(() => {
  if (!isPlaying) return;
  currentIndex = (currentIndex + 1) % TOTAL_POINTS;
  slider.value = currentIndex;
  showIndex(currentIndex, currentIndex === 0);
}, 90);

showIndex(0, true);