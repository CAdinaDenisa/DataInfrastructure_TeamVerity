import * as SecureStore from 'expo-secure-store';

const DEVICE_KEY = 'telemetry-device';

// UUID v4 fără modul nativ (pe unele versiuni Expo Go de Android lipsește ExpoCrypto).
// Folosește generatorul criptografic dacă există, altfel Math.random (suficient pentru ID-uri de evenimente).
function uuidv4() {
  const b = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40; // versiunea 4
  b[8] = (b[8] & 0x3f) | 0x80; // varianta RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// deviceId se generează o singură dată și rămâne același după repornirea aplicației.
export async function getDeviceId() {
  let id = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!id) {
    id = uuidv4();
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  }
  return id;
}

// sessionId nou la fiecare Start; eventId nou pentru fiecare captură.
export const newId = () => uuidv4();
