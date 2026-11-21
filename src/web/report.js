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

// Generare 120 puncte de telemetrie (urcare și coborâre)
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

  telemetryPoints.push({
    timeLabel: `10:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i * 10) % 60).padStart(2, "0")}`,
    x,
    y,
    altitude,
    pressure,
    pitch,
    roll,
    yaw,
    accel: [+(Math.sin(angle) * 0.25).toFixed(2), -0.98, +(0.12 + pitch * 0.01).toFixed(2)],
    mag: [+(22 + Math.cos(angle) * 15).toFixed(1), +(-6 + Math.sin(angle) * 15).toFixed(1), -40.5]
  });
}

const maxAlt = Math.max(...telemetryPoints.map((p) => p.altitude)).toFixed(1);
document.getElementById("val-dist").textContent = `${report.distance || "8.7 km"} • ${report.duration || "24 min"}`;

// Populare tabel citiri reprezentative
const tbody = document.getElementById("readings-table-body");
[0, 35, 75, 115].forEach((idx) => {
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

// Harta 3D Isometrică din stânga-jos
const canvas = document.getElementById("trajectoryCanvas");
const ctx = canvas.getContext("2d");
const slider = document.getElementById("timeline-slider");
const playPauseBtn = document.getElementById("play-pause-btn");
const altReadout = document.getElementById("live-alt-readout");

slider.max = TOTAL_POINTS - 1;
let currentIndex = 0;
let isPlaying = true;

function projectIso(x, y, z) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + 52;
  return {
    sx: cx + x * 1.15 + y * 0.28,
    sy: cy + y * 0.55 - z * 2.8
  };
}

function drawPorsche3DMarker(sx, sy, slopeAngle, goingLeft, altitude) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 16, 34, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  if (loadedCarImg && loadedCarImg.complete && loadedCarImg.naturalWidth > 0) {
    ctx.save();
    ctx.translate(sx, sy - 6);
    ctx.rotate(slopeAngle);
    if (goingLeft) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(loadedCarImg, -46, -28, 92, 54);
    ctx.restore();
  } else {
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 12px Segoe UI, sans-serif";
  ctx.fillText(`+${altitude.toFixed(1)} m`, sx - 22, sy - 34);
}

function renderTrajectoryScene(activeIdx) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let gx = -320; gx <= 320; gx += 55) {
    const p1 = projectIso(gx, -170, 0);
    const p2 = projectIso(gx, 170, 0);
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
  }
  for (let gy = -170; gy <= 170; gy += 42) {
    const p1 = projectIso(-320, gy, 0);
    const p2 = projectIso(320, gy, 0);
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  telemetryPoints.forEach((pt, idx) => {
    const g = projectIso(pt.x, pt.y, 0);
    if (idx === 0) ctx.moveTo(g.sx, g.sy);
    else ctx.lineTo(g.sx, g.sy);
  });
  ctx.stroke();

  telemetryPoints.forEach((pt, idx) => {
    if (idx % 4 === 0) {
      const g = projectIso(pt.x, pt.y, 0);
      const e = projectIso(pt.x, pt.y, pt.altitude);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.sx, g.sy);
      ctx.lineTo(e.sx, e.sy);
      ctx.stroke();
    }
  });

  ctx.strokeStyle = car.color;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  telemetryPoints.forEach((pt, idx) => {
    const e = projectIso(pt.x, pt.y, pt.altitude);
    if (idx === 0) ctx.moveTo(e.sx, e.sy);
    else ctx.lineTo(e.sx, e.sy);
  });
  ctx.stroke();

  const currentPt = telemetryPoints[activeIdx];
  const prevPt = telemetryPoints[Math.max(0, activeIdx - 1)];
  const pCurr = projectIso(currentPt.x, currentPt.y, currentPt.altitude);
  const pPrev = projectIso(prevPt.x, prevPt.y, prevPt.altitude);
  const pGround = projectIso(currentPt.x, currentPt.y, 0);

  ctx.strokeStyle = "#38bdf8";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pGround.sx, pGround.sy);
  ctx.lineTo(pCurr.sx, pCurr.sy);
  ctx.stroke();
  ctx.setLineDash([]);

  const dx = pCurr.sx - pPrev.sx;
  const dy = pCurr.sy - pPrev.sy;
  const goingLeft = dx < 0;
  const rawSlope = Math.atan2(dy, Math.abs(dx) || 0.01);
  const slopeAngle = Math.max(-0.48, Math.min(0.48, goingLeft ? -rawSlope : rawSlope));

  drawPorsche3DMarker(pCurr.sx, pCurr.sy, slopeAngle, goingLeft, currentPt.altitude);

  altReadout.textContent = `+${currentPt.altitude.toFixed(1)} m`;
  document.getElementById("val-alt").textContent = `+${maxAlt} m / +${currentPt.altitude.toFixed(1)} m`;
  document.getElementById("val-orient").textContent = `${currentPt.pitch}° / ${currentPt.roll}° / ${currentPt.yaw}°`;
  document.getElementById("val-accel").textContent = `${currentPt.accel.join(", ")} g`;
  document.getElementById("val-mag").textContent = `${currentPt.mag.join(", ")} µT`;
  document.getElementById("val-baro").textContent = `${currentPt.pressure} hPa`;
}

playPauseBtn.addEventListener("click", () => {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? "⏸ Pauză" : "▶ Redă";
});

slider.addEventListener("input", (e) => {
  isPlaying = false;
  playPauseBtn.textContent = "▶ Redă";
  currentIndex = Number(e.target.value);
  renderTrajectoryScene(currentIndex);
});

setInterval(() => {
  if (!isPlaying) return;
  currentIndex = (currentIndex + 1) % TOTAL_POINTS;
  slider.value = currentIndex;
  renderTrajectoryScene(currentIndex);
}, 90);

renderTrajectoryScene(0);