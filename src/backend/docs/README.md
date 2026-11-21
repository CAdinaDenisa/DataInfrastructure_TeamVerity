# Backend + bază de date (Porsche Hecaton)

Responsabil: Stefana. Tot ce ține de backend și baza de date stă în `src/backend/`, separat de `src/phone-app` și `src/web`:

```
src/backend/
  api/        Azure Functions (Node.js)
    src/functions/   endpoint-urile HTTP (telemetry, devices, sessions, health)
    src/lib/         logica: validare, fuziune senzori, rapoarte, autorizare, http
    src/storage/     acces la date: SQL (local + Azure) și memorie (teste)
    src/schema/      schemele JSON ale mesajelor
    scripts/         migrare, simulator, tokenuri, verificări pentru CI
    test/            teste automate
    examples/        mesaje JSON de exemplu
  database/
    migrations/      schema SQL, versionată (001, 002, 003 ...)
    grants/          accesul identității Function App în Azure SQL
    docker-compose.yml  mediul local (SQL Server + Azurite)
  docs/       documentația de mai jos
```

| Document | Ce găsești |
|---|---|
| [01-format-json.md](01-format-json.md) | Formatul mesajelor JSON (lot 1.0 cu GPS + formatul actual al aplicației de telefon, acceptat și el), unități, validare, coduri de răspuns |
| [02-baza-de-date.md](02-baza-de-date.md) | Tabelele din Azure SQL, de ce arată așa, interogări utile |
| [03-mediu-local.md](03-mediu-local.md) | Cum rulezi totul pe laptop, fără Azure (SQL Server în Docker + Azurite + simulator de telefon) |
| [05-rapoarte-sesiuni.md](05-rapoarte-sesiuni.md) | Rapoartele de cursă: durată, distanță, altitudine, viteză, traseu, plus endpoint-urile pentru dashboard |
| [04-trecere-azure.md](04-trecere-azure.md) | Azure real: setările din Bicep-ul Adinei, migrare + grant pentru Managed Identity, tokenuri, verificare |
| [06-securitate-si-operare.md](06-securitate-si-operare.md) | Autorizare per firmă (401/403), 409, `/api/health`, loguri, scripturi pentru CI, ce trebuie să știe Adina |

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
npm test                 # sau: npm run ci  (check + test, ce rulează pipeline-ul)
```

Toate endpoint-urile în afară de `/api/health` cer `Authorization: Bearer <token firmă>`. Local se poate opri explicit cu `AUTH_MODE=disabled` (vezi 06-securitate-si-operare.md).

## Endpoint-uri

| Metodă + rută | Cine o folosește | Ce face |
|---|---|---|
| `GET /api/health` | monitorizare, verificare după deploy | stare publică: bază de date, autorizare, versiune (fără token) |
| `GET /api/telemetry?ownerId=&vehicleId=&limit=` | dashboard (contractul din ghid) | `{ latest, countReturned, events }`, cele mai noi primele |
| `POST /api/telemetry` | aplicația de telefon | primește citiri: lot 1.0 sau evenimentul aplicației actuale (vezi 01-format-json.md) |
| `GET /api/devices?ownerId=` | dashboard | lista telefoanelor/mașinilor |
| `GET /api/devices/{deviceId}/state` | dashboard, scena 3D (polling ~1 s) | ultima orientare + poziție |
| `GET /api/devices/{deviceId}/states?sessionId=&from=&to=&limit=` | dashboard, traseul 3D | istoricul stărilor procesate |
| `GET /api/devices/{deviceId}/readings?type=&sessionId=&from=&to=&limit=` | dashboard, grafice | citirile brute (`type` = accelerometer, magnetometer, barometer, gps) |
| `GET /api/devices/{deviceId}/sessions?limit=` | dashboard, lista de rapoarte | rapoartele de cursă (durată, distanță, altitudine, viteză, live/terminat) |
| `GET /api/sessions/{sessionId}` | dashboard | rezumatul unei curse |
| `GET /api/sessions/{sessionId}/track?points=` | dashboard, pagina de raport | rezumat + traseu redus pentru grafice și hartă |

`from`/`to` sunt timestamp-uri ISO 8601 UTC. `limit` implicit 1000, maxim 5000 (întoarce cele mai recente, în ordine cronologică).
