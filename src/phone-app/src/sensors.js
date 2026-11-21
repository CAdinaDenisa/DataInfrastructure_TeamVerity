import { Accelerometer, Barometer, Magnetometer } from 'expo-sensors';
import { SENSOR_INTERVAL_MS } from './config';

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
  return result;
}

// Pornește ascultătorii doar pentru senzorii disponibili.
// onReading(channel, value) primește citirile cu unități explicite.
// Întoarce o funcție care oprește tot.
export function startSensors(status, onReading) {
  const subs = [];

  if (status.acceleration === 'live') {
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    subs.push(
      Accelerometer.addListener(({ x, y, z }) => onReading('acceleration', { x, y, z, unit: 'g' }))
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

  return () => {
    subs.forEach((s) => s.remove());
    subs.length = 0;
  };
}
