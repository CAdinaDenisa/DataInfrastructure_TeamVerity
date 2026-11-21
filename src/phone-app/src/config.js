// Setări comune ale aplicației.
// URL-ul API vine din src/phone-app/.env:  EXPO_PUBLIC_API_URL=https://NUMELE-FUNCTION-APP.azurewebsites.net
// (fără /api/telemetry la final). Variabilele EXPO_PUBLIC_ ajung în aplicație, deci NU pune secrete acolo.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

export const SENSOR_INTERVAL_MS = 500; // cât de des citim accelerometrul și magnetometrul
export const CAPTURE_INTERVAL_MS = 2000; // un eveniment la 2 secunde
export const QUEUE_LIMIT = 100; // peste atât, oprim colectarea vizibil (nu aruncăm date)
export const REQUEST_TIMEOUT_MS = 10000;
export const MAX_RETRIES = 3;
export const RETRY_COOLDOWN_MS = 30000; // după 3 eșecuri, mai încercăm singuri peste 30 s
export const BASELINE_SAMPLES = 5; // câte citiri stabile de presiune la începutul sesiunii
