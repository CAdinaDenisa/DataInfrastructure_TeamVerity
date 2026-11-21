const MAX_POINTS = 30;

function createSensorChart(canvasId, datasetsConfig) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !window.Chart) return null;

  return new window.Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: datasetsConfig.map((ds) => ({
        label: ds.label,
        data: [],
        borderColor: ds.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2
      }))
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { display: false },
        y: { grid: { color: "#2a303c" } }
      }
    }
  });
}

export function initCharts() {
  const accelChart = createSensorChart("accelChart", [
    { label: "X", color: "#ef4444" },
    { label: "Y", color: "#22c55e" },
    { label: "Z", color: "#3b82f6" }
  ]);

  const magChart = createSensorChart("magChart", [
    { label: "X", color: "#f59e0b" },
    { label: "Y", color: "#10b981" },
    { label: "Z", color: "#6366f1" }
  ]);

  const baroChart = createSensorChart("baroChart", [
    { label: "Presiune (hPa)", color: "#ec4899" }
  ]);

  return { accelChart, magChart, baroChart };
}

export function pushChartPoint(chart, label, values) {
  if (!chart) return;

  chart.data.labels.push(label);
  if (chart.data.labels.length > MAX_POINTS) {
    chart.data.labels.shift();
  }

  values.forEach((val, idx) => {
    const dataset = chart.data.datasets[idx];
    if (!dataset) return;
    dataset.data.push(val);
    if (dataset.data.length > MAX_POINTS) {
      dataset.data.shift();
    }
  });

  chart.update();
}