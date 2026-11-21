// Calcule pentru busolă (funcții pure, fără UI).
//
// Axele telefonului (iOS și Android): x spre dreapta, y spre partea de sus a ecranului,
// z ieșind din ecran. Cu telefonul ținut orizontal, componenta orizontală a câmpului
// magnetic arată spre nordul magnetic. Direcția (heading) = unghiul, în sensul acelor
// de ceasornic, dintre nord și partea de sus a telefonului.

export function headingFromMagnetometer(m) {
  if (!m || typeof m.x !== 'number' || typeof m.y !== 'number') return null;
  const deg = (Math.atan2(-m.x, m.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SV', 'V', 'NV'];
const FULL = {
  N: 'Nord',
  NE: 'Nord-Est',
  E: 'Est',
  SE: 'Sud-Est',
  S: 'Sud',
  SV: 'Sud-Vest',
  V: 'Vest',
  NV: 'Nord-Vest',
};

export function cardinal(heading) {
  const short = SHORT[Math.round(heading / 45) % 8];
  return { short, full: FULL[short] };
}

// Intensitatea câmpului, în µT. Câmpul Pământului are ~25–65 µT;
// mult peste înseamnă metal sau un magnet în apropiere.
export function fieldStrength(m) {
  if (!m) return null;
  return Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z);
}

// Telefonul e „orizontal” când gravitația cade aproape doar pe axa z.
// Folosim valoarea absolută, ca să meargă la fel pe iOS și Android.
export function isFlat(acceleration) {
  if (!acceleration) return true;
  return Math.abs(acceleration.z) > 0.85;
}

// Cel mai scurt drum între două unghiuri (ca acul să nu facă o tură întreagă la 359° → 1°).
export function shortestTarget(current, target) {
  const diff = ((((target - current) % 360) + 540) % 360) - 180;
  return current + diff;
}
