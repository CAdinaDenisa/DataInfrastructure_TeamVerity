const STORAGE_KEY = "porsche_hecaton_fleet_v4";

const defaultFleet = [
  {
    id: "car-1",
    name: "Porsche 911 Turbo S",
    deviceId: "phone-daniela-01",
    color: "#38bdf8",
    imageBase: "./assets/porsche-silver",
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

// Flood Fill din marginile pozei: elimină DOAR fundalul exterior (alb, gri sau bej),
// fără să atingă reflexiile luminoase de pe interiorul mașinii!
function makeCleanCarSprite(img) {
  const c = document.createElement("canvas");
  const maxW = 360;
  const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
  c.width = Math.round((img.naturalWidth || 360) * scale);
  c.height = Math.round((img.naturalHeight || 220) * scale);

  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);

  try {
    const w = c.width;
    const h = c.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    // Verifică dacă un pixel seamănă cu fundalul deschis/neutru (nu e roșu aprins sau negru intens)
    function isBackgroundPixel(idx) {
      const p = idx * 4;
      const r = d[p], g = d[p + 1], b = d[p + 2], a = d[p + 3];
      if (a < 20) return true;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
      // Fundalul din ambele poze (alb la 911 sau gri-bej deschis la Taycan) are luminozitate > 125 și saturație mică (< 0.28)
      return maxC > 125 && saturation < 0.28;
    }

    // Pornim flood-fill-ul din toate marginile exterioare ale imaginii
    for (let x = 0; x < w; x++) {
      const top = x;
      const bottom = (h - 1) * w + x;
      if (!visited[top] && isBackgroundPixel(top)) { visited[top] = 1; queue[tail++] = top; }
      if (!visited[bottom] && isBackgroundPixel(bottom)) { visited[bottom] = 1; queue[tail++] = bottom; }
    }
    for (let y = 0; y < h; y++) {
      const left = y * w;
      const right = y * w + (w - 1);
      if (!visited[left] && isBackgroundPixel(left)) { visited[left] = 1; queue[tail++] = left; }
      if (!visited[right] && isBackgroundPixel(right)) { visited[right] = 1; queue[tail++] = right; }
    }

    while (head < tail) {
      const curr = queue[head++];
      d[curr * 4 + 3] = 0; // Facem pixelul exterior transparent

      const cx = curr % w;
      const cy = (curr - cx) / w;

      if (cx > 0) {
        const n = curr - 1;
        if (!visited[n] && isBackgroundPixel(n)) { visited[n] = 1; queue[tail++] = n; }
      }
      if (cx < w - 1) {
        const n = curr + 1;
        if (!visited[n] && isBackgroundPixel(n)) { visited[n] = 1; queue[tail++] = n; }
      }
      if (cy > 0) {
        const n = curr - w;
        if (!visited[n] && isBackgroundPixel(n)) { visited[n] = 1; queue[tail++] = n; }
      }
      if (cy < h - 1) {
        const n = curr + w;
        if (!visited[n] && isBackgroundPixel(n)) { visited[n] = 1; queue[tail++] = n; }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (_) {}

  return c;
}

const processedCarCache = {};

function loadCarAsset(imageBase, onReady) {
  if (processedCarCache[imageBase]) {
    if (onReady && processedCarCache[imageBase].resolvedUrl) {
      onReady(processedCarCache[imageBase]);
    }
    return processedCarCache[imageBase];
  }

  const entry = { spriteCanvas: null, spriteDataUrl: null, resolvedUrl: null };
  processedCarCache[imageBase] = entry;

  const extensions = imageBase.match(/\.(png|jpg|jpeg|webp)$/i)
    ? [""]
    : [".png", ".jpg", ".jpeg", ".webp"];

  let attempt = 0;
  function tryNext() {
    if (attempt >= extensions.length) return;
    const url = `${imageBase}${extensions[attempt++]}`;
    const img = new Image();
    img.onload = () => {
      const sprite = makeCleanCarSprite(img);
      entry.spriteCanvas = sprite;
      entry.spriteDataUrl = sprite.toDataURL("image/png");
      entry.resolvedUrl = url;
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

function drawPorscheOnMap(ctx, sx, sy, slopeAngleRad, goingLeft, imageBase, fallbackColor, altText) {
  const asset = processedCarCache[imageBase];

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 14, 28, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (asset && asset.spriteCanvas) {
    ctx.save();
    ctx.translate(sx, sy - 6);
    ctx.rotate(slopeAngleRad);
    if (goingLeft) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(asset.spriteCanvas, -44, -26, 88, 52);
    ctx.restore();
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 11px Segoe UI, sans-serif";
  ctx.fillText(altText, sx - 20, sy - 30);
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
    `;

    grid.appendChild(card);

    loadCarAsset(base, (asset) => {
      const thumb = document.getElementById(`thumb-${car.id}`);
      if (thumb && asset.spriteDataUrl) thumb.src = asset.spriteDataUrl;
    });
  });

  document.querySelectorAll(".reports-table tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      const carId = row.getAttribute("data-car-id");
      const reportId = row.getAttribute("data-report-id");
      const selectedCar = fleet.find((c) => c.id === carId);
      if (selectedCar) {
        const base = selectedCar.imageBase || selectedCar.imageUrl || "./assets/porsche-silver";
        const asset = processedCarCache[base];
        sessionStorage.setItem(
          "selected_report_context",
          JSON.stringify({
            car: selectedCar,
            reportId,
            resolvedUrl: asset ? asset.resolvedUrl : null,
            spriteDataUrl: asset ? asset.spriteDataUrl : null
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

    const x = Math.cos(state.t) * 210 + Math.sin(state.t * 2) * 45;
    const y = Math.sin(state.t) * 105;
    const z = Math.max(0, Math.sin(state.t * 1.4) * 24 + 12);
    const pitch = (Math.cos(state.t * 1.4) * 8.5).toFixed(1);

    state.trail.push({ x, y, z });
    if (state.trail.length > 2500) state.trail.shift();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
      ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      state.trail.forEach((pt, i) => {
        const g = projectIsoMini(pt.x, pt.y, 0, canvas.width, canvas.height);
        if (i === 0) ctx.moveTo(g.sx, g.sy);
        else ctx.lineTo(g.sx, g.sy);
      });
      ctx.stroke();

      state.trail.forEach((pt, i) => {
        if (i % 12 === 0) {
          const g = projectIsoMini(pt.x, pt.y, 0, canvas.width, canvas.height);
          const e = projectIsoMini(pt.x, pt.y, pt.z, canvas.width, canvas.height);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.24)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(g.sx, g.sy);
          ctx.lineTo(e.sx, e.sy);
          ctx.stroke();
        }
      });

      ctx.strokeStyle = car.color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      state.trail.forEach((pt, i) => {
        const e = projectIsoMini(pt.x, pt.y, pt.z, canvas.width, canvas.height);
        if (i === 0) ctx.moveTo(e.sx, e.sy);
        else ctx.lineTo(e.sx, e.sy);
      });
      ctx.stroke();

      const currPt = state.trail[state.trail.length - 1];
      const prevPt = state.trail[state.trail.length - 2];
      const currScreen = projectIsoMini(currPt.x, currPt.y, currPt.z, canvas.width, canvas.height);
      const prevScreen = projectIsoMini(prevPt.x, prevPt.y, prevPt.z, canvas.width, canvas.height);
      const groundScreen = projectIsoMini(currPt.x, currPt.y, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "#38bdf8";
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

      drawPorscheOnMap(ctx, currScreen.sx, currScreen.sy, slopeAngle, goingLeft, base, car.color, `+${z.toFixed(1)}m`);
    }

    const posEl = document.getElementById(`telemetry-pos-${car.id}`);
    const altEl = document.getElementById(`telemetry-alt-${car.id}`);
    if (posEl) posEl.textContent = `Poziție: X ${x.toFixed(1)}m, Y ${y.toFixed(1)}m`;
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