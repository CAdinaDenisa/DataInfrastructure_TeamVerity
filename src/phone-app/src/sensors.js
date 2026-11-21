import { Platform } from 'react-native';
import { Accelerometer, Barometer, Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { GPS_DISTANCE_INTERVAL_M, GPS_TIME_INTERVAL_MS, SENSOR_INTERVAL_MS } from './config';

// Convenția backend-ului (src/backend/docs/01-format-json.md): convenția Android,
// telefon pe masă cu ecranul în sus → accelerometrul ≈ (0, 0, +1) g.
// Pe iPhone, expo-sensors dă semnul opus, așa că îl inversăm DOAR la accelerometru, DOAR pe iOS.
// Magnetometrul și barometrul rămân neschimbate.
export const ACC_SIGN = Platform.OS === 'ios' ? -1 : 1;

const SENSORS = {
  acceleration: Accelerometer,
  magneticField: Magnetometer,
  pressure: Barometer,
};

// Verifică pentru fiecare senzor dacă există pe telefon și dacă avem permisiune.
// Rezultat: { acceleration: 'live' | 'denied' | 'unavailable', ... }
export async function checkSensors() {
  const result = {};
  for (const [key, sensor] of Object.entries(SENSORS)) {
    try {
      const available = await sensor.isAvailableAsync();
      if (!available) {
        result[key] = 'unavailable';
        continue;
      }
      if (typeof sensor.requestPermissionsAsync === 'function') {
        const perm = await sensor.requestPermissionsAsync();
        if (perm && perm.granted === false) {
          result[key] = 'denied';
          continue;
        }
      }
      result[key] = 'live';
    } catch {
      result[key] = 'unavailable';
    }
  }
  result.location = await checkLocation();
  return result;
}

// GPS: fără el backend-ul nu are poziție orizontală (x/y), deci traseul de pe dashboard nu se mișcă.
async function checkLocation() {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return 'denied';
    const enabled = await Location.hasServicesEnabledAsync();
    return enabled ? 'live' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// Pornește ascultătorii doar pentru senzorii disponibili.
// onReading(channel, value) primește citirile cu unități explicite.
// Întoarce o funcție care oprește tot.
export function startSensors(status, onReading) {
  const subs = [];

  if (status.acceleration === 'live') {
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    subs.push(
      Accelerometer.addListener(({ x, y, z }) =>
        onReading('acceleration', { x: x * ACC_SIGN, y: y * ACC_SIGN, z: z * ACC_SIGN, unit: 'g' })
      )
    );
  }

  if (status.magneticField === 'live') {
    Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    subs.push(
      Magnetometer.addListener(({ x, y, z }) => onReading('magneticField', { x, y, z, unit: 'uT' }))
    );
  }

  if (status.pressure === 'live') {
    // Frecvența barometrului depinde de platformă; o setăm doar dacă API-ul există.
    if (typeof Barometer.setUpdateInterval === 'function') {
      try {
        Barometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      } catch {
        // unele platforme ignoră intervalul — e în regulă
      }
    }
    subs.push(Barometer.addListener(({ pressure }) => onReading('pressure', { value: pressure, unit: 'hPa' })));
  }

  if (status.location === 'live') {
    // Precizie maximă și fără prag de distanță: vrem și mișcările de câțiva metri.
    // watchPositionAsync e asincron; dacă oprim înainte să pornească, îl închidem imediat.
    let stopped = false;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_TIME_INTERVAL_MS, distanceInterval: GPS_DISTANCE_INTERVAL_M },
      ({ coords, timestamp }) =>
        onReading('location', {
          latitude: coords.latitude,
          longitude: coords.longitude,
          altitude: coords.altitude ?? null,
          accuracy: coords.accuracy ?? null,
          altitudeAccuracy: coords.altitudeAccuracy ?? null,
          speed: coords.speed ?? null,
          heading: coords.heading ?? null,
          timestamp,
        }),
      () => {} // eroare GPS: continuăm fără locație
    )
      .then((sub) => (stopped ? sub.remove() : subs.push(sub)))
      .catch(() => {});
    subs.push({ remove: () => { stopped = true; } });
  }

  return () => {
    subs.forEach((s) => s.remove());
    subs.length = 0;
  };
}
