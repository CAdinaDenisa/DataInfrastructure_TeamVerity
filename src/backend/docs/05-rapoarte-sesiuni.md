# Rapoarte de cursă (sesiuni)

O **sesiune** = o înregistrare Start -> Stop din aplicația de telefon (același `sessionId`). Backend-ul își actualizează statisticile **la fiecare lot primit**, deci lista de rapoarte e o interogare simplă, iar un raport „live” se actualizează în timp real.

Cod: [`api/src/lib/sessionStats.js`](../api/src/lib/sessionStats.js), endpoint-uri în [`api/src/functions/sessions.js`](../api/src/functions/sessions.js), coloane noi în [`database/migrations/002_session_stats.sql`](../database/migrations/002_session_stats.sql).

## Ce se calculează

| Câmp | Cum |
|---|---|
| `durationSec` | ultimul timestamp primit minus primul |
| `distanceM` | distanța orizontală din GPS. Se adună doar când telefonul s-a depărtat de ultimul punct numărat cu cel puțin max(5 m, precizia fix-ului), ca tremuratul GPS în repaus să nu fie numărat. Un salt care ar cere peste 70 m/s (~250 km/h) e ignorat (fix greșit) |
| `maxAltRelM` / `minAltRelM` | din altitudinea relativă (barometru, altfel GPS), față de începutul sesiunii |
| `maxSpeedMps` | viteza GPS (sau, dacă telefonul nu o dă, distanța / timp) |
| `avgSpeedMps` | `distanceM / durationSec` |
| `events.roughRoad` / `events.harshDriving` | câte loturi au avut sfatul „Rough road / pothole” sau „Harsh acceleration or sharp turn” |
| `status` | `live` dacă sesiunea a primit date în ultimul minut, altfel `done` |

Unități: metri, secunde, m/s (dashboard-ul le transformă în km, min, km/h).

## Endpoint-uri

Toate cer `Authorization: Bearer <token firmă>`: o firmă vede doar telefoanele și vehiculele ei (vezi 06-securitate-si-operare.md).

### `GET /api/devices/{deviceId}/sessions?limit=20`

Lista rapoartelor unui telefon, cele mai noi primele (lista de rapoarte din dashboard).

```json
[
  {
    "sessionId": "s-20261121100336-8b94",
    "deviceId": "phone-report-01",
    "vehicleId": "CAR-01",
    "status": "live",
    "startedAt": "2026-11-21T10:03:36.757Z",
    "endedAt": "2026-11-21T10:04:46.707Z",
    "durationSec": 70,
    "distanceM": 102.62,
    "maxAltRelM": 3.09,
    "minAltRelM": 0.1,
    "maxSpeedMps": 1.57,
    "avgSpeedMps": 1.47,
    "events": { "roughRoad": 0, "harshDriving": 3 },
    "batchCount": 70
  }
]
```

Corespondența cu câmpurile din dashboard (`src/web/app.js`, `reports`):

| Dashboard | Backend |
|---|---|
| `id` | `sessionId` |
| `date` | `startedAt` (convertit la ora locală) |
| `status` (`live` / `done`) | `status` |
| `duration` („24 min”) | `durationSec / 60` |
| `distance` („8.7 km”) | `distanceM / 1000` |
| `maxAlt` („+42.0 m”) | `maxAltRelM` |

### `GET /api/sessions/{sessionId}`

Același rezumat, pentru o singură sesiune. `404` dacă nu există.

### `GET /api/sessions/{sessionId}/track?points=300`

Rezumatul + traseul redus la cel mult `points` puncte (implicit 300, maxim 2000), pentru graficele și harta din pagina de raport. Se păstrează mereu primul și ultimul punct și vârful de altitudine.

```json
{
  "summary": { "...": "ca mai sus" },
  "totalPoints": 70,
  "points": [
    {
      "t": "2026-11-21T10:04:00.707Z",
      "x": 26.12, "y": 10.03, "altRelM": 2.4, "distanceM": 32.68,
      "pitch": -0.91, "roll": -11.28, "yaw": 141.41,
      "speedMps": 1.57, "latitude": 44.42689, "longitude": 26.10283,
      "pressureHpa": 1002.8,
      "advice": "Harsh acceleration or sharp turn detected."
    }
  ]
}
```

`x`/`y` sunt metri est/nord față de start (pentru desenul traseului), `latitude`/`longitude` pentru o hartă reală, `distanceM` = distanța parcursă până în acel punct (axa X la graficul de altitudine). `pressureHpa` e estimată din altitudine și apare doar când există barometru.

## Limite cunoscute

- `harshDriving` numără și **înclinarea** telefonului: logica actuală de sfaturi compară accelerația brută cu pragurile, iar gravitația pe un telefon înclinat arată ca o accelerare. Asta se repară la pasul „evenimente de condus” (scădem gravitația folosind orientarea).
- Fără GPS, `distanceM` rămâne 0. Altitudinea și evenimentele merg în continuare.
