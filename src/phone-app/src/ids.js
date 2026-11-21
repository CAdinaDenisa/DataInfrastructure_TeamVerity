import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_KEY = 'telemetry-device';

// deviceId se generează o singură dată și rămâne același după repornirea aplicației.
export async function getDeviceId() {
  let id = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  }
  return id;
}

// sessionId nou la fiecare Start sau Calibrare; eventId nou pentru fiecare captură.
export const newId = () => Crypto.randomUUID();
