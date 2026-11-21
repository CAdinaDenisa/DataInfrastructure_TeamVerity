'use strict';
/**
 * Simulator de telefon: trimite loturi realiste la API, fără telefon real.
 * Mașina se înclină sinusoidal, se rotește încet, merge pe un cerc de ~30 m (GPS)
 * și urcă ~3 m (un etaj, presiunea scade).
 *
 *   npm run simulate                                   # 30 s către http://localhost:7071
 *   npm run simulate -- --seconds 120 --device phone-test-02 --no-barometer
 *   npm run simulate -- --url https://<app>.azurewebsites.net --token <token firmă> --owner company_A --vehicle CAR-01
 */
const crypto = require('crypto');
const { orientationToSensors } = require('../src/lib/fusion');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);

const BASE_URL = opt('url', 'http://localhost:7071').replace(/\/$/, '');
const DEVICE_ID = opt('device', 'phone-sim-01');
const SECONDS = Number(opt('seconds', '30'));
const HZ = Number(opt('hz', '10'));
const TOKEN = opt('token', process.env.DEMO_TOKEN || '');
const OWNER = opt('owner', 'company_A');
const VEHICLE = opt('vehicle', 'CAR-01');
const caps = { accelerometer: true, magnetometer: true, barometer: !flag('no-barometer'), gps: !flag('no-gps') };

const sessionId = `s-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
const ORIGIN = { lat: 44.4268, lon: 26.1025, alt: 85 }; // București
const RAD = Math.PI / 180;
let seq = 0;

function sample(t) {
  const pitch = 10 * Math.sin(t * 0.8);  // ±10°
  const roll = 15 * Math.sin(t * 0.5);   // ±15°
  const yaw = (t * 6) % 360;             // 6°/s
  const { accel, mag } = orientationToSensors(pitch, roll, yaw);
  const n = (k) => (Math.random() - 0.5) * k;
  return {
    accel: { x: accel.x + n(0.02), y: accel.y + n(0.02), z: accel.z + n(0.02) },
    mag: { x: mag.x + n(1), y: mag.y + n(1), z: mag.z + n(1) },
  };
}

async function main() {
  console.log(`Sesiune ${sessionId}, device ${DEVICE_ID}, ${SECONDS}s @ ${HZ} Hz -> ${BASE_URL}/api/telemetry`);
  const start = Date.now();
  for (let s = 0; s < SECONDS; s++) {
    const events = [];
    for (let k = 0; k < HZ; k++) {
      const t = s + k / HZ;
      const ts = new Date(start + t * 1000).toISOString();
      const { accel, mag } = sample(t);
      events.push({ eventType: 'accelerometer', value: accel, unit: 'g', timestamp: ts, seq: seq++ });
      events.push({ eventType: 'magnetometer', value: mag, unit: 'uT', timestamp: ts, seq: seq++ });
      if (caps.barometer && k % 2 === 0) {
        const climb = Math.min(3, t * 0.1);  // urcă 3 m în 30 s
        const pressure = 1013.25 * Math.pow(1 - (ORIGIN.alt + climb) / 44330, 1 / 0.1903) + (Math.random() - 0.5) * 0.02;
        events.push({ eventType: 'barometer', value: { pressure }, unit: 'hPa', timestamp: ts, seq: seq++ });
      }
    }
    if (caps.gps) {
      const ang = (s / 60) * 2 * Math.PI; // un cerc pe minut
      const r = 15;
      const ts = new Date(start + (s + 0.95) * 1000).toISOString();
      events.push({
        eventType: 'gps', unit: 'wgs84', timestamp: ts, seq: seq++,
        value: {
          latitude: ORIGIN.lat + (r * Math.sin(ang)) / 111320,
          longitude: ORIGIN.lon + (r * (1 - Math.cos(ang))) / (111320 * Math.cos(ORIGIN.lat * RAD)),
          altitude: ORIGIN.alt + Math.min(3, s * 0.1) + (Math.random() - 0.5) * 4,
          accuracy: 4 + Math.random() * 4, altitudeAccuracy: 6, speed: (2 * Math.PI * r) / 60, heading: null,
        },
      });
    }
    const batch = {
      schemaVersion: '1.0', deviceId: DEVICE_ID, ownerId: OWNER, vehicleId: VEHICLE, sessionId,
      batchId: `b-${crypto.randomUUID()}`, sentAt: new Date(start + (s + 1) * 1000).toISOString(),
      device: { platform: 'simulator', model: 'scripts/simulate.js', appVersion: '0.0.0' },
      capabilities: caps, sampling: { sensorIntervalMs: Math.round(1000 / HZ), gpsIntervalMs: 1000 }, events,
    };
    const res = await fetch(`${BASE_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(batch),
    });
    const body = await res.json().catch(() => ({}));
    const st = body.state;
    console.log(res.status, st
      ? `pitch=${st.orientation?.pitch} roll=${st.orientation?.roll} yaw=${st.orientation?.yaw} pos=(${st.position.x}, ${st.position.y}, ${st.position.z}) [${st.position.source}]`
      : JSON.stringify(body));
    const wait = start + (s + 1) * 1000 - Date.now();
    if (wait > 0 && !flag('fast')) await new Promise((r) => setTimeout(r, wait));
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
