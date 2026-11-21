import { initCharts, pushChartPoint } from "./charts.js";

const config = window.APP_CONFIG || {
  apiBaseUrl: "http://localhost:7071/api",
  defaultDeviceId: "phone-stefana-01",
  pollIntervalMs: 1000
};

const statusEl = document.getElementById("connection-status");
const deviceLabelEl = document.getElementById("device-label");
const orientationEl = document.getElementById("orientation-val");
const altitudeEl = document.getElementById("altitude-val");

deviceLabelEl.textContent = config.defaultDeviceId;
const charts = initCharts();

function updateUIWithMockData() {
  const now = new Date().toLocaleTimeString();

  // Simulare date conform schemei JSON din planul de proiect
  const pitch = (Math.random() * 6 - 3).toFixed(1);
  const roll = (Math.random() * 10 - 5).toFixed(1);
  const yaw = (85 + Math.random() * 5).toFixed(1);

  orientationEl.textContent = `${pitch}° / ${roll}° / ${yaw}°`;
  altitudeEl.textContent = "2.4 m (simulat)";

  statusEl.textContent = "Mod Demo (Mock)";
  statusEl.className = "status online";

  pushChartPoint(charts.accelChart, now, [
    +(Math.random() * 0.1 - 0.05).toFixed(2),
    -0.98,
    +(0.1 + Math.random() * 0.05).toFixed(2)
  ]);

  pushChartPoint(charts.magChart, now, [21.4, -5.2, -40.8]);
  pushChartPoint(charts.baroChart, now, [+(1012.5 + Math.random() * 0.4).toFixed(2)]);
}

setInterval(updateUIWithMockData, config.pollIntervalMs);
updateUIWithMockData();