# Backend + bază de date (Porsche Hecaton)

Responsabil: Stefana. Tot ce ține de backend și baza de date stă în `src/backend/`, separat de `src/phone-app` și `src/web`:

```
src/backend/
  api/        Azure Functions (Node.js): validare, fuziune senzori, endpoint-uri, teste, simulator
  database/   migrări SQL + docker-compose pentru mediul local (SQL Server + Azurite)
  docs/       documentația de mai jos
```

| Document | Ce găsești |
|---|---|
| [01-format-json.md](01-format-json.md) | Formatul mesajelor JSON (lot 1.0 cu GPS + formatul actual al aplicației de telefon, acceptat și el), unități, validare, coduri de răspuns |
| [02-baza-de-date.md](02-baza-de-date.md) | Tabelele din Azure SQL, de ce arată așa, interogări utile |
| [03-mediu-local.md](03-mediu-local.md) | Cum rulezi totul pe laptop, fără Azure (SQL Server în Docker + Azurite + simulator de telefon) |
| [04-trecere-azure.md](04-trecere-azure.md) | Pașii exacți pentru Azure real: ce resurse creezi, ce tier gratuit alegi, unde pui connection string-ul |

## Pe scurt

```
Telefon (Expo)  --POST JSON-------->  Azure Functions (src/backend/api)  -->  Azure SQL Database
                                       validare + fuziune senzori         (local: SQL Server în Docker)
Dashboard React <--GET stare/citiri--  același API
```

- Accelerometru + magnetometru -> **orientare** (pitch, roll, yaw) pentru mașina 3D.
- GPS -> poziție **x/y** (metri est/nord față de punctul de start al sesiunii).
- Barometru -> poziție **z** (altitudine relativă, mai stabilă decât altitudinea GPS); fără barometru se folosește altitudinea GPS.

## Pornire rapidă (local)

```bash
cd src/backend/api
npm install
npm run setup:local      # creează local.settings.json din exemplu
npm run db:up            # SQL Server + Azurite în Docker
npm run db:migrate       # creează baza și tabelele
npm start                # API pe http://localhost:7071  (sau, fără Core Tools: npm run api:docker)
npm run simulate         # trimite date de la un telefon simulat
npm test
```

## Endpoint-uri

| Metodă + rută | Cine o folosește | Ce face |
|---|---|---|
| `POST /api/telemetry` | aplicația de telefon | primește citiri: lot 1.0 sau evenimentul aplicației actuale (vezi 01-format-json.md) |
| `GET /api/devices?ownerId=` | dashboard | lista telefoanelor/mașinilor |
| `GET /api/devices/{deviceId}/state` | dashboard, scena 3D (polling ~1 s) | ultima orientare + poziție |
| `GET /api/devices/{deviceId}/states?sessionId=&from=&to=&limit=` | dashboard, traseul 3D | istoricul stărilor procesate |
| `GET /api/devices/{deviceId}/readings?type=&sessionId=&from=&to=&limit=` | dashboard, grafice | citirile brute (`type` = accelerometer, magnetometer, barometer, gps) |

`from`/`to` sunt timestamp-uri ISO 8601 UTC. `limit` implicit 1000, maxim 5000 (întoarce cele mai recente, în ordine cronologică).
