# Formatul JSON al datelor de la senzori (v1.0)

Scheme (JSON Schema 2020-12): [`api/src/schema/`](../api/src/schema). Exemple: [`api/examples/`](../api/examples).

## Două formate acceptate

`POST /api/telemetry` primește oricare dintre ele; backend-ul le recunoaște după `schemaVersion`:

| `schemaVersion` | Format | Cine îl trimite |
|---|---|---|
| `1` (număr) | **eveniment** cu ultimele citiri (formatul din `src/phone-app/src/event.js`) | aplicația de telefon de acum, **funcționează fără nicio modificare** |
| `"1.0"` (text) | **lot** cu mai multe citiri pe secundă + GPS (descris mai jos) | formatul recomandat pentru 3D fluid și GPS |

Ambele ajung în aceleași tabele și dau aceeași stare procesată.

### Formatul aplicației actuale (`schemaVersion: 1`)

Exemplu: [`api/examples/event-v1-phone-app.json`](../api/examples/event-v1-phone-app.json). Schema: `telemetry-event-v1.schema.json`.

```json
{
  "schemaVersion": 1,
  "eventId": "6f1c2a9e-...",
  "deviceId": "0b8f6c3e-...",
  "ownerId": "company_A",
  "vehicleId": "CAR-01",
  "sessionId": "c4e2a1f0-...",
  "capturedAtUtc": "2026-11-21T10:15:30.000Z",
  "acceleration": { "x": 0.0123, "y": 0.1702, "z": 0.9811, "unit": "g" },
  "magneticField": { "x": 1.42, "y": 21.5, "z": -40.83, "unit": "uT" },
  "pressure": { "value": 1012.4, "baselineHpa": 1012.62, "unit": "hPa" },
  "quality": { "acceleration": "live", "magneticField": "live", "pressure": "live" }
}
```

- `eventId` are rolul lui `batchId` (retry cu același `eventId` -> `200`, nu se salvează de două ori).
- `magneticField` / `pressure` pot fi `null` (senzor lipsă). `baselineHpa` devine altitudinea relativă 0 a sesiunii.
- **Pentru GPS** aplicația poate adăuga oricând un câmp opțional `location`, cu aceleași câmpuri ca evenimentul `gps` de mai jos (`latitude`, `longitude`, `altitude`, `accuracy`, `altitudeAccuracy`, `speed`, `heading`). `speed`/`heading` = `-1` (iOS, necunoscut) sunt ignorate.
- Câmpurile necunoscute sunt ignorate, ca aplicația să poată evolua independent.

## Formatul lot 1.0 (recomandat)

Telefonul citește senzorii (~10 Hz pentru accelerometru/magnetometru, ~1 Hz pentru GPS) și trimite **un lot pe secundă** la `POST /api/telemetry`. Fiecare eveniment are tip, valoare, unitate, timestamp UTC și număr de ordine; `deviceId` e o singură dată, la nivel de lot (cerința cursului: ID dispozitiv, tip, valoare, unitate, timestamp).

## Lotul

```json
{
  "schemaVersion": "1.0",
  "deviceId": "phone-stefana-01",
  "ownerId": "team-verity",
  "sessionId": "s-20261121-101530-7f3a",
  "batchId": "b-7f3a-000042",
  "sentAt": "2026-11-21T10:15:31.020Z",
  "device": { "platform": "android", "model": "Pixel 7", "appVersion": "0.1.0" },
  "capabilities": { "accelerometer": true, "magnetometer": true, "barometer": true, "gps": true },
  "sampling": { "sensorIntervalMs": 100, "gpsIntervalMs": 1000 },
  "events": [
    { "eventType": "accelerometer", "value": { "x": 0.02, "y": 0.17, "z": 0.98 }, "unit": "g",
      "timestamp": "2026-11-21T10:15:30.100Z", "seq": 1532 },
    { "eventType": "magnetometer", "value": { "x": 1.4, "y": 21.5, "z": -40.8 }, "unit": "uT",
      "timestamp": "2026-11-21T10:15:30.102Z", "seq": 1533 },
    { "eventType": "barometer", "value": { "pressure": 1012.62 }, "unit": "hPa",
      "timestamp": "2026-11-21T10:15:30.105Z", "seq": 1534 },
    { "eventType": "gps", "value": { "latitude": 44.435123, "longitude": 26.102456, "altitude": 92.4,
        "accuracy": 6.5, "altitudeAccuracy": 4.0, "speed": 1.2, "heading": 87.0 },
      "unit": "wgs84", "timestamp": "2026-11-21T10:15:30.950Z", "seq": 1537 }
  ]
}
```

| Câmp | Obligatoriu | Descriere |
|---|---|---|
| `schemaVersion` | da | mereu `"1.0"` acum; la o schimbare incompatibilă creștem versiunea |
| `deviceId` | da | ID stabil al telefonului (generat la prima pornire, salvat cu AsyncStorage). 3–64 caractere: litere, cifre, `_ . : -` |
| `ownerId` | nu | temporar din aplicație; mai târziu vine din login, nu din telefon |
| `vehicleId` | nu | mașina aleasă în aplicație (ex. `CAR-01`) |
| `baselinePressureHpa` | nu | presiunea de referință de la începutul sesiunii; dacă lipsește, se ia prima citire |
| `sessionId` | da | o înregistrare Start -> Stop. Originea poziției 3D și presiunea de referință sunt per sesiune |
| `batchId` | da | unic per lot (ex. UUID). **La retry se retrimite același `batchId`**, iar backend-ul nu salvează de două ori |
| `sentAt` | da | când a plecat lotul (UTC) |
| `device` | nu | platformă, model, versiune aplicație |
| `capabilities` | da | ce senzori are telefonul. Lipsa barometrului/GPS-ului **nu e eroare** |
| `sampling` | nu | intervalele setate în aplicație (depanare) |
| `events` | da | 1–500 evenimente |

## Evenimentele

| `eventType` | `value` | `unit` | Note |
|---|---|---|---|
| `accelerometer` | `{ x, y, z }` | `"g"` (sau `"m/s2"`, convertit automat în g) | expo-sensors `Accelerometer` dă deja g. Include gravitația |
| `magnetometer` | `{ x, y, z }` | `"uT"` | expo-sensors `Magnetometer` (sau `MagnetometerUncalibrated`) |
| `barometer` | `{ pressure, relativeAltitude? }` | `"hPa"` | `relativeAltitude` (m) există doar pe iOS |
| `gps` | `{ latitude, longitude, altitude?, accuracy, altitudeAccuracy?, speed?, heading? }` | `"wgs84"` | din `expo-location` (`coords`). Grade, metri, m/s. Câmpurile opționale pot fi `null` |

Toate evenimentele au și `timestamp` (UTC, ISO 8601 cu `Z`, max. 3 zecimale, ex. `2026-11-21T10:15:30.123Z`) și `seq` (întreg crescător per sesiune).

### Convenția axelor (important pentru mașina 3D)

Telefonul pe masă, ecranul în sus: **x spre dreapta, y spre marginea de sus, z ieșind din ecran**. În repaus accelerometrul trebuie să arate ≈ `(0, 0, +1)` g. Aceasta e convenția Android, și backend-ul o presupune pentru toate telefoanele.

**Android și iPhone trimit la fel doar dacă aplicația corectează iOS.** Pe iPhone, `Accelerometer` din expo-sensors raportează gravitația cu semn opus (telefon plat: `z ≈ -1`). Aplicația înmulțește cu -1 **doar accelerometrul, doar pe iOS**, înainte de trimitere (vezi `ACC_SIGN` în codul de mai jos). Magnetometrul, barometrul și GPS-ul se trimit neschimbate pe ambele platforme.

Test de 10 secunde pe fiecare telefon nou: îl pui plat pe masă, cu ecranul în sus, și verifici în aplicație sau în `GET /api/devices/{id}/readings?type=accelerometer&limit=5` că `z ≈ +1`. Apoi ridici marginea de sus și verifici că `pitch` din `GET /api/devices/{id}/state` devine negativ. Dacă vreun model nu respectă asta, se corectează în același loc din aplicație, nu în backend.

## Validare (ce face backend-ul)

1. Structura după JSON Schema (câmpuri necunoscute = eroare, ca să prindem greșelile de scriere).
2. Intervale: |accelerație| ≤ 16 g, câmp magnetic ±5000 uT, presiune 300–1100 hPa, lat ±90, lon ±180, `accuracy` ≥ 0.
3. Un eveniment pentru un senzor marcat `false` în `capabilities` = eroare.
4. `seq` duplicat în același lot = eroare.
5. Timestamp cu mai mult de 5 minute în viitor (ceas greșit) sau mai vechi de 24 h = eroare.
6. Dacă media accelerației e ≈ 9.8 „g”, cineva a trimis m/s² cu `unit: "g"` = eroare.

## Răspunsuri

| Cod | Când | Ce face telefonul |
|---|---|---|
| `201` | salvat. Body: `{ status: "accepted", batchId, events, state }` (`state` = orientarea + poziția calculate) | trece mai departe |
| `200` | `{ status: "duplicate" }`: lotul era deja salvat (retry) | îl consideră trimis |
| `400` | `{ error, details: [...] }`: date invalide (`error` conține prima problemă) | **nu** reîncearcă; afișează `error` |
| `401` | cheie lipsă/greșită, doar dacă `DEVICE_API_KEY` e setat în backend. Se acceptă `Authorization: Bearer <cheie>` (cum trimite aplicația) sau `x-device-key: <cheie>` | verifică token-ul |
| `503` | baza de date indisponibilă (ex. Azure SQL se trezește din pauză) | reîncearcă: 1 s, 2 s, 4 s ... max 30 s |

## Starea procesată (ce primește dashboard-ul)

`GET /api/devices/{deviceId}/state`:

```json
{
  "deviceId": "phone-sim-01",
  "sessionId": "s-20261121073317-d81b",
  "batchId": "b-7dffef22-...",
  "timestamp": "2026-11-21T07:33:22.196Z",
  "orientation": { "pitch": -4.14, "roll": 11.69, "yaw": 26.33, "unit": "deg" },
  "altitudeRel": { "value": 0.41, "unit": "m", "source": "barometer" },
  "position": { "x": 1.3, "y": 6.09, "z": 0.41, "unit": "m", "source": "gps+barometer", "estimated": false },
  "gps": { "latitude": 44.42685, "longitude": 26.10252, "accuracy": 7.6, "speed": 1.57 },
  "advice": "Normal driving conditions."
}
```

- `yaw` = 0 când marginea de sus a telefonului arată spre nordul magnetic, crește în sensul acelor de ceasornic. `pitch` negativ când ridici marginea de sus (convenția Android).
- `position`: metri, x = est, y = nord, z = sus, față de primul fix GPS bun al sesiunii (`accuracy` ≤ 50 m). `source` poate fi `gps+barometer`, `gps`, `barometer` sau `none`.
- `advice`: logica de „sfaturi” din prima versiune a API-ului, adaptată la g.

## Cod de exemplu pentru aplicația de telefon

```js
import { Accelerometer, Magnetometer, Barometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

// iOS raportează gravitația cu semn opus față de Android -> aducem totul la convenția Android
const ACC_SIGN = Platform.OS === 'ios' ? -1 : 1;

let seq = 0;
const buffer = [];
const push = (eventType, value, unit) =>
  buffer.push({ eventType, value, unit, timestamp: new Date().toISOString(), seq: seq++ });

Accelerometer.setUpdateInterval(100);
Accelerometer.addListener(({ x, y, z }) =>
  push('accelerometer', { x: x * ACC_SIGN, y: y * ACC_SIGN, z: z * ACC_SIGN }, 'g'));
Magnetometer.setUpdateInterval(100);
Magnetometer.addListener(({ x, y, z }) => push('magnetometer', { x, y, z }, 'uT'));
if (await Barometer.isAvailableAsync()) {
  Barometer.addListener(({ pressure, relativeAltitude }) =>
    push('barometer', relativeAltitude == null ? { pressure } : { pressure, relativeAltitude }, 'hPa'));
}
const { status } = await Location.requestForegroundPermissionsAsync();
if (status === 'granted') {
  await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    ({ coords: c }) => push('gps', {
      latitude: c.latitude, longitude: c.longitude, altitude: c.altitude, accuracy: c.accuracy ?? 9999,
      altitudeAccuracy: c.altitudeAccuracy, speed: c.speed != null && c.speed >= 0 ? c.speed : null,
      heading: c.heading != null && c.heading >= 0 ? c.heading : null,
    }, 'wgs84'));
}

// o dată pe secundă: events = buffer.splice(0), construiești lotul de mai sus și îl trimiți (cu retry pe 5xx)
```

Atenție: pe iOS `speed`/`heading` pot fi `-1` când nu se știu; trimiteți `null` (schema nu acceptă valori negative).
