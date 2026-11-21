// Altitudinea relativă față de începutul cursei, din presiune.
// Aceeași formulă barometrică pe care o folosește backend-ul:
//   h = 44330 · (1 − (p / p0)^0,1903)
export function relativeAltitude(pressureHpa, baselineHpa) {
  if (typeof pressureHpa !== 'number' || typeof baselineHpa !== 'number' || baselineHpa <= 0) return null;
  return 44330 * (1 - Math.pow(pressureHpa / baselineHpa, 0.1903));
}

// Durata cursei ca mm:ss sau h:mm:ss.
export function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
