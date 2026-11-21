const STORAGE_KEY = "porsche_hecaton_fleet_v6";

const defaultFleet = [
  {
    id: "car-1",
    name: "Porsche 911 Turbo S",
    deviceId: "phone-daniela-01",
    color: "#38bdf8",
    imageBase: "./assets/porsche-silver",
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
    odometerKm: 58400,
    oilIntervalKm: 30000, // Revizie lichid frână / reducător
    timingBeltKm: 90000,  // Revizie majoră transmisie / baterie
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

function drawPorscheOnMap(ctx, sx, sy, slopeAngleRad, goingLeft, imageBase, fallbackColor, altText, isRoughRoad) {
  const asset = carImageCache[imageBase];

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 14, 28, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (asset && asset.loaded && asset.img) {
    ctx.save();
    ctx.translate(sx, sy - 6);
    ctx.rotate(slopeAngleRad);
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

  ctx.fillStyle = isRoughRoad ? "#fbbf24" : "#f8fafc";
  ctx.font = "bold 11px Segoe UI, sans-serif";
  ctx.fillText(isRoughRoad ? `${altText} ⚠ Drum forestier` : altText, sx - 24, sy - 30);
}

// Generează recomandările automate pe baza senzorilor și kilometrajului
function buildCarRecommendations(car) {
  const odo = car.odometerKm || 12000;
  const oilStep = car.oilIntervalKm || 15000;
  const distSinceOil = odo % oilStep;
  const kmToOil = oilStep - distSinceOil;
  const oilPct = Math.min(100, Math.round((distSinceOil / oilStep) * 100));

  const beltStep = car.timingBeltKm || 90000;
  const distSinceBelt = odo % beltStep;
  const kmToBelt = beltStep - distSinceBelt;
  const beltPct = Math.min(100, Math.round((distSinceBelt / beltStep) * 100));

  const items = [];

  if (kmToOil <= 1500) {
    items.push({
      level: "danger",
      sensor: "Kilometraj",
      text: `Schimb ulei & filtru necesar în ${kmToOil} km (rulaj: ${odo.toLocaleString("ro-RO")} km).`
    });
  } else {
    items.push({
      level: "ok",
      sensor: "Kilometraj",
      text: `Ulei motor în parametri — următorul schimb peste ${kmToOil.toLocaleString("ro-RO")} km.`
    });
  }

  // Scenariu detectat din Accelerometru (drum forestier / vibrații)
  items.push({
    level: "warn",
    sensor: "Accelerometru",
    text: "Segment drum forestier detectat (vibrații > 0.42g) — recomandată verificarea suspensiilor și bucșelor."
  });

  // Scenariu detectat din Barometru (urcare/coborâre)
  if (car.id === "car-1") {
    items.push({
      level: "warn",
      sensor: "Barometru",
      text: "Diferență de nivel +42m cu frânări repetate — verifică uzura plăcuțelor de frână."
    });
  } else {
    items.push({
      level: "ok",
      sensor: "Magnetometru",
      text: "Câmp magnetic stabil (48.2 µT) — fără anomalii electrice sau interferențe pe sistem."
    });
  }

  return { odo, kmToOil, oilPct, kmToBelt, beltPct, items };
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
        trail: []
      };
    }

    const rec = buildCarRecommendations(car);
    const oilBarColor = rec.oilPct > 85 ? "#ef4444" : rec.oilPct > 65 ? "#f59e0b" : "#10b981";
    const beltBarColor = rec.beltPct > 85 ? "#ef4444" : "#38bdf8";

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

      <!-- SECȚIUNEA RECOMANDĂRI DEDUSE DIN SENZORI -->
      <div class="recommendations-box">
        <div class="recommendations-header">
          <h4>Recomandări &amp; Mentenanță Predictivă</h4>
          <span class="km-badge">${rec.odo.toLocaleString("ro-RO")} km total</span>
        </div>

        <div class="service-bars">
          <div class="service-item">
            <div class="service-item-top">
              <span>Schimb ulei</span>
              <strong>în ${rec.kmToOil.toLocaleString("ro-RO")} km</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${rec.oilPct}%; background: ${oilBarColor};"></div>
            </div>
          </div>

          <div class="service-item">
            <div class="service-item-top">
              <span>Distribuție / Revizie majoră</span>
              <strong>în ${rec.kmToBelt.toLocaleString("ro-RO")} km</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${rec.beltPct}%; background: ${beltBarColor};"></div>
            </div>
          </div>
        </div>

        <div class="rec-list">
          ${rec.items
            .map(
              (item) => `
            <div class="rec-item ${item.level}">
              <span class="rec-sensor-tag">${item.sensor}</span>
              <span>${item.text}</span>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
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
    // Zona de "drum forestier" este între unghiul 2.1 și 3.4 radiani
    const isRoughRoad = phase > 2.1 && phase < 3.4;
    const vibrationZ = isRoughRoad ? Math.sin(state.t * 38) * 1.8 : 0;

    const x = Math.cos(state.t) * 210 + Math.sin(state.t * 2) * 45;
    const y = Math.sin(state.t) * 105;
    const z = Math.max(0, Math.sin(state.t * 1.4) * 24 + 12 + vibrationZ);
    const pitch = (Math.cos(state.t * 1.4) * 8.5 + (isRoughRoad ? Math.sin(state.t * 30) * 2.4 : 0)).toFixed(1);

    state.trail.push({ x, y, z, isRoughRoad });
    if (state.trail.length > 2500) state.trail.shift();

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

    if (state.trail.length > 1) {
      // Umbra la sol
      ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      state.trail.forEach((pt, i) => {
        const g = projectIsoMini(pt.x, pt.y, 0, canvas.width, canvas.height);
        if (i === 0) ctx.moveTo(g.sx, g.sy);
        else ctx.lineTo(g.sx, g.sy);
      });
      ctx.stroke();

      // Stâlpi verticali
      state.trail.forEach((pt, i) => {
        if (i % 12 === 0) {
          const g = projectIsoMini(pt.x, pt.y, 0, canvas.width, canvas.height);
          const e = projectIsoMini(pt.x, pt.y, pt.z, canvas.width, canvas.height);
          ctx.strokeStyle = pt.isRoughRoad ? "rgba(245, 158, 11, 0.38)" : "rgba(56, 189, 248, 0.24)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(g.sx, g.sy);
          ctx.lineTo(e.sx, e.sy);
          ctx.stroke();
        }
      });

      // Desenăm traseul pe segmente: normal (culoarea mașinii) vs drum forestier (portocaliu)
      for (let i = 1; i < state.trail.length; i++) {
        const pPrev = state.trail[i - 1];
        const pCurr = state.trail[i];
        const e1 = projectIsoMini(pPrev.x, pPrev.y, pPrev.z, canvas.width, canvas.height);
        const e2 = projectIsoMini(pCurr.x, pCurr.y, pCurr.z, canvas.width, canvas.height);

        ctx.strokeStyle = pCurr.isRoughRoad ? "#f59e0b" : car.color;
        ctx.lineWidth = pCurr.isRoughRoad ? 4 : 3.2;
        ctx.beginPath();
        ctx.moveTo(e1.sx, e1.sy);
        ctx.lineTo(e2.sx, e2.sy);
        ctx.stroke();
      }

      const currPt = state.trail[state.trail.length - 1];
      const prevPt = state.trail[state.trail.length - 2];
      const currScreen = projectIsoMini(currPt.x, currPt.y, currPt.z, canvas.width, canvas.height);
      const prevScreen = projectIsoMini(prevPt.x, prevPt.y, prevPt.z, canvas.width, canvas.height);
      const groundScreen = projectIsoMini(currPt.x, currPt.y, 0, canvas.width, canvas.height);

      ctx.strokeStyle = currPt.isRoughRoad ? "#f59e0b" : "#38bdf8";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(groundScreen.sx, groundScreen.sy);
      ctx.lineTo(currScreen.sx, currScreen.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      const dx = currScreen.sx - prevScreen.sx;
      const dy = currScreen.sy - prevScreen.sy;
      const goingLeft = dx < 0;
      const rawSlope = Math.atan2(dy, Math.abs(dx) || 0.01);
      const slopeAngle = Math.max(-0.48, Math.min(0.48, goingLeft ? -rawSlope : rawSlope));

      drawPorscheOnMap(ctx, currScreen.sx, currScreen.sy, slopeAngle, goingLeft, base, car.color, `+${z.toFixed(1)}m`, currPt.isRoughRoad);
    }

    const posEl = document.getElementById(`telemetry-pos-${car.id}`);
    const altEl = document.getElementById(`telemetry-alt-${car.id}`);
    if (posEl) posEl.textContent = isRoughRoad ? "⚠ Suprafață: Drum forestier (vibrații)" : `Poziție: X ${x.toFixed(1)}m, Y ${y.toFixed(1)}m`;
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