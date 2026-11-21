import AsyncStorage from '@react-native-async-storage/async-storage';

// Telefonul ESTE mașina. Mașina se identifică prin seria de șasiu (VIN),
// introdusă de șofer o singură dată, la prima pornire.
// VIN-ul se trimite ca deviceId și vehicleId; dashboard-ul îl folosește ca ID al mașinii.
export const OWNER = { id: 'porsche', name: 'Porsche' };
export const MODEL = "911"; // modelul afisat langa PORSCHE

// VIN standard (ISO 3779): 17 caractere, litere și cifre, fără I, O, Q (se confundă cu 1 și 0).
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export const normalizeVin = (text) => (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function vinError(vin) {
  if (!vin) return 'Introdu seria de șasiu.';
  const bad = [...new Set(vin.match(/[IOQ]/g) || [])];
  if (bad.length) return `Litera ${bad.join(', ')} nu există în seriile de șasiu. Ai vrut cifra ${bad.map((c) => (c === 'I' ? '1' : '0')).join(' / ')}?`;
  if (vin.length !== 17) return `Seria de șasiu are exact 17 caractere (acum: ${vin.length}).`;
  if (!VIN_RE.test(vin)) return 'Doar litere și cifre.';
  return null;
}

const KEY = 'telemetry-vin-v1';

export async function loadVin() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v && !vinError(v) ? v : null;
  } catch {
    return null;
  }
}

export async function saveVin(vin) {
  try {
    await AsyncStorage.setItem(KEY, vin);
  } catch {
    // nu e grav dacă nu se salvează
  }
}
