// Calcule pentru accelerometru (funcții pure, fără UI).
//
// Aplicația primește accelerometrul deja în convenția backend-ului (Android):
// telefon pe masă, ecranul în sus → z = +1 (forța de reacție, în sus). Vezi ACC_SIGN în sensors.js.
// Pentru calculele de afișare folosim vectorul gravitației (în jos), adică semnul opus.

export function toGravity(a) {
  if (!a) return null;
  return { x: -a.x, y: -a.y, z: -a.z };
}

const deg = (rad) => (rad * 180) / Math.PI;

// Tangaj (pitch): + când partea de sus a telefonului coboară.
// Ruliu (roll):   + când marginea din dreapta coboară.
// Valorile sunt corecte cât timp telefonul e relativ nemișcat (gravitația domină).
export function tilt(a) {
  if (!a) return null;
  return {
    pitch: deg(Math.atan2(a.y, Math.hypot(a.x, a.z))),
    roll: deg(Math.atan2(a.x, Math.hypot(a.y, a.z))),
  };
}

// Accelerația totală în g. Nemișcat ≈ 1 g (doar gravitația).
export function totalG(a) {
  if (!a) return null;
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

// Mișcare = accelerația totală se abate vizibil de la 1 g.
export function isMoving(a, threshold = 0.12) {
  const g = totalG(a);
  return g != null && Math.abs(g - 1) > threshold;
}

// Poziția punctului în cerc: x spre dreapta, y în sus pe ecran, limitată la cercul de 1 g.
export function dotPosition(a, radius) {
  if (!a) return { x: 0, y: 0 };
  let x = a.x;
  let y = a.y;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x: x * radius, y: -y * radius };
}
