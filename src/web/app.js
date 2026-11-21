const STORAGE_KEY = "porsche_hecaton_fleet_v6";

const defaultFleet = [
  {
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
      { id: "rep-live-1", date: "2026-11-21 (Azi)", status: "live", duration: "În curs...", distance: "1.8 km", maxAlt: "+24.5 m" },
      { id: "rep-2026-11-20", date: "2026-11-20", status: "done", duration: "24 min", distance: "8.7 km", maxAlt: "+42.0 m" },
      { id: "rep-2026-11-19", date: "2026-11-19", status: "done", duration: "15 min", distance: "4.2 km", maxAlt: "+18.5 m" }
    ]
  },
  {
    id: "car-2",
    name: "Porsche Taycan GTS",
    deviceId: "phone-adina-02",
    color: "#e11d48",
    imageBase: "./assets/porsche-red",
    powertrain: "ev",
    odometerKm: 58400,
    oilIntervalKm: 30000, // Revizie lichid frână / reducător
    timingBeltKm: 90000, // Revizie majoră transmisie / baterie
    reports: [
      { id: "rep-live-2", date: "2026-11-21 (Azi)", status: "live", duration: "În curs...", distance: "1.2 km", maxAlt: "+19.2 m" },
      { id: "rep-2026-11-20", date: "2026-11-20", status: "done", duration: "31 min", distance: "12.3 km", maxAlt: "+65.4 m" },
      { id: "rep-2026-11-18", date: "2026-11-18", status: "done", duration: "19 min", distance: "5.9 km", maxAlt: "+21.0 m" }
    ]
  }
];

function loadFleet() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return defaultFleet;
}

function saveFleet(fleet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fleet));
}

let fleet = loadFleet();

const carImageCache = {};

function loadCarImage(imageBase, onReady) {
  if (carImageCache[imageBase]) {
    if (onReady && carImageCache[imageBase].loaded) {
      onReady(carImageCache[imageBase]);
    }
    return carImageCache[imageBase];
  }

  const entry = { img: null, resolvedUrl: null, loaded: false };
  carImageCache[imageBase] = entry;

  const extensions = imageBase.match(/\.(png|jpg|jpeg|webp)$/i)
    ? [""]
    : [".png", ".jpg", ".jpeg", ".webp"];

  let attempt = 0;
  function tryNext() {
    if (attempt >= extensions.length) return;
    const url = `${imageBase}${extensions[attempt++]}`;
    const img = new Image();
    img.onload = () => {
      entry.img = img;
      entry.resolvedUrl = url;
      entry.loaded = true;
      if (onReady) onReady(entry);
    };
    img.onerror = tryNext;
    img.src = url;
  }

  tryNext();
  return entry;
}

function projectIsoMini(x, y, z, width, height) {
  const cx = width / 2;
  const cy = height / 2 + 32;
  return {
    sx: cx + x * 0.95 + y * 0.25,
    sy: cy + y * 0.45 - z * 2.1
  };
}

// rough: 0..1 = intensitatea drumului neasfaltat (cu tranziție lină).
// Vibrația se aplică doar mașinii (≈1px / ≈0.8°), nu traiectoriei.
function drawPorscheOnMap(ctx, sx, sy, slopeAngleRad, goingLeft, imageBase, fallbackColor, altText, rough, t) {
  const asset = carImageCache[imageBase];
  const jitterY = rough * Math.sin(t * 38) * 0.9;
  const jitterA = rough * Math.sin(t * 31) * 0.014;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 14, 28, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (asset && asset.loaded && asset.img) {
    ctx.save();
    ctx.translate(sx, sy - 6 + jitterY);
    ctx.rotate(slopeAngleRad + jitterA);
    if (goingLeft) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(asset.img, -44, -26, 88, 52);
    ctx.restore();
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 11px Segoe UI, sans-serif";
  ctx.fillText(altText, sx - 24, sy - 30);

  if (rough > 0.5) {
    ctx.globalAlpha = Math.min(1, (rough - 0.5) * 2) * 0.85;
    ctx.fillStyle = "#d3a04a";
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillText("drum neasfaltat", sx - 24, sy - 18);
    ctx.globalAlpha = 1;
  }
}

// ======================================================================
//  RECOMANDĂRI & MENTENANȚĂ PREDICTIVĂ
//  Intrare: mașina (kilometraj, intervale) + statistici agregate din senzori.
//  (Aceeași logică există și în report.js, ca să nu avem fișier nou.)
// ======================================================================
const REC_LABELS = {
  ice: { minor: "Schimb ulei", major: "Distribuție / revizie majoră" },
  ev: { minor: "Lichid frână / reductor", major: "Revizie transmisie / baterie" }
};

function fmtKm(n) {
  return Math.round(n).toLocaleString("ro-RO");
}

// Valori de test până când backend-ul trimite statisticile reale ale sesiunii.
function mockSessionStats(car) {
  const base = {
    distanceKm: 6, roughKm: 0, roughPct: 0, peakVertG: 0.5, impacts: 0,
    hardBrakes: 1, hardAccels: 1, maxLateralG: 0.3, rollBiasDeg: 0.3, pitchOnBrakeDeg: 2,
    smoothVibPct: 1, idleMinutes: 1, idleVibRms: 0.02, stopGoPct: 10,
    elevGainM: 15, elevLossM: 12, hasBaro: true, minPressure: 1010, pressureTrendHpaH: -0.5,
    magMeanUT: 48, magStdUT: 4, magOutOfRangePct: 1
  };
  const perCar = {
    "car-1": { distanceKm: 8.7, roughKm: 1.3, roughPct: 15, hardBrakes: 6, maxLateralG: 0.62, pitchOnBrakeDeg: 3.1, elevGainM: 42, elevLossM: 38, minPressure: 1008.5, magMeanUT: 48.2 },
    "car-2": { distanceKm: 12.3, roughKm: 2.4, roughPct: 20, peakVertG: 1.8, impacts: 1, rollBiasDeg: 2.4, elevGainM: 65, elevLossM: 60, magMeanUT: 48.2 }
  };
  return Object.assign({}, base, perCar[car.id] || {});
}

function buildCarRecommendations(car, s) {
  const isEv = car.powertrain ? car.powertrain === "ev" : /taycan|electric/i.test(car.name || "");
  const L = REC_LABELS[isEv ? "ev" : "ice"];
  const dist = Math.max(s.distanceKm || 0, 1);
  const per10 = (n) => ((n || 0) / dist) * 10;
  const odo = car.odometerKm || 0;

  // Drum prost și trafic aglomerat scurtează intervalul efectiv de service (max ~20%)
  const wear = 1 - Math.min(0.12, (s.roughPct || 0) / 200) - Math.min(0.08, (s.stopGoPct || 0) / 500);

  const service = (step, w, lastKm) => {
    const eff = Math.round(step * w);
    const since = lastKm != null ? odo - lastKm : odo % step;
    return { left: Math.max(0, eff - since), pct: Math.min(100, Math.round((since / eff) * 100)) };
  };
  const minor = service(car.oilIntervalKm || 15000, wear, car.lastOilKm);
  const major = service(car.timingBeltKm || 90000, 1, car.lastMajorKm);

  const items = [];
  const add = (level, sensor, text, weight) => items.push({ level, sensor, text, weight });

  // --- Kilometraj ---
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

  // --- Accelerometru: drum, suspensii, roți, frâne ---
  if ((s.roughPct || 0) >= 5 || (s.roughKm || 0) >= 1) {
    add("warn", "Accelerometru", `~${(s.roughKm || 0).toFixed(1)} km pe drum neasfaltat/denivelat. Merită o privire la suspensii, bucșe și presiunea din pneuri.`, 60);
  }
  if ((s.roughKmTotal || car.roughKmTotal || 0) >= 300) {
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

  // --- Barometru: relief, altitudine, vreme ---
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

  // --- Magnetometru: câmp magnetic / interferențe ---
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

function renderRecommendations(rec, visible = 2) {
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

const liveSimState = {};

function renderFleet() {
  const grid = document.getElementById("fleet-grid");
  grid.innerHTML = "";

  fleet.forEach((car, index) => {
    const base = car.imageBase || car.imageUrl || "./assets/porsche-silver";
    if (!liveSimState[car.id]) {
      liveSimState[car.id] = {
        t: index * 1.4,
        rough: 0,
        trail: []
      };
    }

    const rec = buildCarRecommendations(car, mockSessionStats(car));

    const card = document.createElement("article");
    card.className = "car-card";
    card.innerHTML = `
      <div class="car-card-header">
        <div class="car-title-group">
          <img id="thumb-${car.id}" alt="${car.name}" class="car-thumb-mini" />
          <div>
            <h3>${car.name}</h3>
            <span class="muted">ID: ${car.deviceId}</span>
          </div>
        </div>
        <span class="live-pill">● TRAIECTORIE 3D LIVE</span>
      </div>

      <div class="mini-map-box">
        <canvas id="canvas-${car.id}" width="640" height="270"></canvas>
        <div class="mini-map-overlay">
          <span id="telemetry-pos-${car.id}">Poziție: X 0.0m, Y 0.0m</span>
          <span id="telemetry-alt-${car.id}">Altitudine: +0.0m • Pitch: 0.0°</span>
        </div>
      </div>

      <div class="reports-table-wrapper">
        <h4>Rapoarte pe zile (Click pe un raport pentru detalii complete)</h4>
        <table class="reports-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Status</th>
              <th>Durată</th>
              <th>Distanță</th>
              <th>Alt. Max</th>
            </tr>
          </thead>
          <tbody>
            ${car.reports
              .map(
                (rep) => `
              <tr data-car-id="${car.id}" data-report-id="${rep.id}">
                <td><strong>${rep.date}</strong></td>
                <td>
                  ${
                    rep.status === "live"
                      ? `<span class="badge-active">● În desfășurare</span>`
                      : `<span class="badge-done">Finalizat</span>`
                  }
                </td>
                <td>${rep.duration}</td>
                <td>${rep.distance}</td>
                <td>${rep.maxAlt}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>

      ${renderRecommendations(rec, 2)}
    `;

    grid.appendChild(card);

    loadCarImage(base, (asset) => {
      const thumb = document.getElementById(`thumb-${car.id}`);
      if (thumb && asset.resolvedUrl) thumb.src = asset.resolvedUrl;
    });
  });

  document.querySelectorAll(".reports-table tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      const carId = row.getAttribute("data-car-id");
      const reportId = row.getAttribute("data-report-id");
      const selectedCar = fleet.find((c) => c.id === carId);
      if (selectedCar) {
        const base = selectedCar.imageBase || selectedCar.imageUrl || "./assets/porsche-silver";
        const asset = carImageCache[base];
        sessionStorage.setItem(
          "selected_report_context",
          JSON.stringify({
            car: selectedCar,
            reportId,
            resolvedUrl: asset ? asset.resolvedUrl : null
          })
        );
        window.location.href = `./report.html?car=${encodeURIComponent(carId)}&report=${encodeURIComponent(reportId)}`;
      }
    });
  });
}

function animateMiniMaps() {
  fleet.forEach((car) => {
    const canvas = document.getElementById(`canvas-${car.id}`);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const state = liveSimState[car.id];
    const base = car.imageBase || car.imageUrl || "./assets/porsche-silver";
    state.t += 0.018;

    const phase = state.t % (Math.PI * 2);
    // Zona de "drum neasfaltat" este între unghiul 2.1 și 3.4 radiani
    const onRoughSegment = phase > 2.1 && phase < 3.4;
    // intrare / ieșire lină din zona de drum prost (nu mai apare brusc)
    state.rough += ((onRoughSegment ? 1 : 0) - state.rough) * 0.08;
    const rough = state.rough;

    // Traiectoria rămâne NETEDĂ: vibrația nu mai e adăugată la altitudine
    const x = Math.cos(state.t) * 210 + Math.sin(state.t * 2) * 45;
    const y = Math.sin(state.t) * 105;
    const z = Math.max(0, Math.sin(state.t * 1.4) * 24 + 12);
    const pitch = (Math.cos(state.t * 1.4) * 8.5 + rough * Math.sin(state.t * 30) * 0.6).toFixed(1);

    state.trail.push({ x, y, z, rough });
    if (state.trail.length > 2500) state.trail.shift();
    const trail = state.trail;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Grid 3D
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let gx = -260; gx <= 260; gx += 52) {
      const p1 = projectIsoMini(gx, -140, 0, canvas.width, canvas.height);
      const p2 = projectIsoMini(gx, 140, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }
    for (let gy = -140; gy <= 140; gy += 35) {
      const p1 = projectIsoMini(-260, gy, 0, canvas.width, canvas.height);
      const p2 = projectIsoMini(260, gy, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }

    if (trail.length > 1) {
      // Drumul de pe sol: gri pe asfalt, chihlimbar discret (mai gros, cu "pietriș") pe drum neasfaltat
      for (let i = 1; i < trail.length; i++) {
        const a = projectIsoMini(trail[i - 1].x, trail[i - 1].y, 0, canvas.width, canvas.height);
        const b = projectIsoMini(trail[i].x, trail[i].y, 0, canvas.width, canvas.height);
        const r = trail[i].rough;
        ctx.strokeStyle = r > 0.3 ? `rgba(211, 160, 74, ${0.25 + r * 0.3})` : "rgba(148, 163, 184, 0.2)";
        ctx.lineWidth = r > 0.3 ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();

        if (r > 0.5 && i % 5 === 0) {
          const off = ((i * 7) % 5) - 2;
          ctx.fillStyle = "rgba(211, 160, 74, 0.45)";
          ctx.fillRect(b.sx + off * 2, b.sy + off, 1.4, 1.4);
        }
      }

      // Stâlpi verticali (neutri)
      trail.forEach((pt, i) => {
        if (i % 12 === 0) {
          const g = projectIsoMini(pt.x, pt.y, 0, canvas.width, canvas.height);
          const e = projectIsoMini(pt.x, pt.y, pt.z, canvas.width, canvas.height);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(g.sx, g.sy);
          ctx.lineTo(e.sx, e.sy);
          ctx.stroke();
        }
      });

      // Traseul în aer: mereu culoarea mașinii, neted
      ctx.strokeStyle = car.color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      trail.forEach((pt, i) => {
        const e = projectIsoMini(pt.x, pt.y, pt.z, canvas.width, canvas.height);
        if (i === 0) ctx.moveTo(e.sx, e.sy);
        else ctx.lineTo(e.sx, e.sy);
      });
      ctx.stroke();

      const currPt = trail[trail.length - 1];
      // Înclinația se calculează pe o fereastră mai lungă => mașina nu mai "salută" la fiecare cadru
      const refPt = trail[Math.max(0, trail.length - 9)];
      const currScreen = projectIsoMini(currPt.x, currPt.y, currPt.z, canvas.width, canvas.height);
      const refScreen = projectIsoMini(refPt.x, refPt.y, refPt.z, canvas.width, canvas.height);
      const groundScreen = projectIsoMini(currPt.x, currPt.y, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(groundScreen.sx, groundScreen.sy);
      ctx.lineTo(currScreen.sx, currScreen.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      const dx = currScreen.sx - refScreen.sx;
      const dy = currScreen.sy - refScreen.sy;
      const goingLeft = dx < 0;
      const rawSlope = Math.atan2(dy, Math.abs(dx) || 0.01);
      const slopeAngle = Math.max(-0.48, Math.min(0.48, goingLeft ? -rawSlope : rawSlope));

      drawPorscheOnMap(ctx, currScreen.sx, currScreen.sy, slopeAngle, goingLeft, base, car.color, `+${z.toFixed(1)}m`, rough, state.t);
    }

    const posEl = document.getElementById(`telemetry-pos-${car.id}`);
    const altEl = document.getElementById(`telemetry-alt-${car.id}`);
    if (posEl) posEl.textContent = rough > 0.5 ? "Suprafață: drum neasfaltat (vibrații)" : `Poziție: X ${x.toFixed(1)}m, Y ${y.toFixed(1)}m`;
    if (altEl) altEl.textContent = `Altitudine: +${z.toFixed(1)}m • Pitch: ${pitch}°`;
  });

  requestAnimationFrame(animateMiniMaps);
}

const modal = document.getElementById("add-car-modal");
document.getElementById("add-car-btn").addEventListener("click", () => modal.classList.remove("hidden"));
document.getElementById("cancel-modal-btn").addEventListener("click", () => modal.classList.add("hidden"));

document.getElementById("add-car-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("car-name-input").value.trim();
  const deviceId = document.getElementById("car-device-input").value.trim();
  const imageBase = document.getElementById("car-image-input").value;
  const color = document.getElementById("car-color-input").value;

  const newCar = {
    id: `car-${Date.now()}`,
    name,
    deviceId,
    imageBase,
    color,
    powertrain: /taycan|electric/i.test(name) ? "ev" : "ice",
    odometerKm: 8500,
    oilIntervalKm: 15000,
    timingBeltKm: 90000,
    reports: [
      {
        id: `rep-live-${Date.now()}`,
        date: "2026-11-21 (Azi)",
        status: "live",
        duration: "În curs...",
        distance: "0.3 km",
        maxAlt: "+4.2 m"
      }
    ]
  };

  fleet.push(newCar);
  saveFleet(fleet);
  modal.classList.add("hidden");
  e.target.reset();
  renderFleet();
});

renderFleet();
animateMiniMaps();