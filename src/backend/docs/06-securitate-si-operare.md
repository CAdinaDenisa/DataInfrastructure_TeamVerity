# Securitate, monitorizare și automatizare

## Autorizare cu token per firmă

Aliniat cu ghidul echipei (secțiunea „token model”):

- Fiecare firmă (ex. `company_A`, `company_B`) are un **token aleator** (`npm run token:new`). Serverul păstrează doar **hash-ul SHA-256**, în setarea secretă `DEMO_TENANTS_JSON`:
  ```json
  [{ "ownerId": "company_A", "tokenHash": "<sha256>", "vehicleIds": ["CAR-01"], "expiresAtUtc": "2026-11-22T10:00:00Z" }]
  ```
- Telefonul și dashboard-ul trimit `Authorization: Bearer <token>` la **fiecare** cerere (aplicația Anei face deja asta).
- `401` = token lipsă, necunoscut sau expirat. `403` = token valid, dar cere date ale altei firme sau ale unui vehicul nealocat. Verificarea se face **înainte** de citirea datelor firmei.
- POST: `ownerId`/`vehicleId` din eveniment trebuie să fie ale tokenului. Un `deviceId` deja înregistrat la firma A nu poate fi trimis cu tokenul firmei B.
- GET pe device/sesiune: device-ul trebuie să aparțină firmei tokenului. `GET /api/devices` arată doar telefoanele firmei tale.
- Tokenul nu apare niciodată în loguri sau în răspunsuri.
- Local, autorizarea se oprește **doar explicit**: `AUTH_MODE=disabled` în `local.settings.json`. Fără această setare, autorizarea e activă; dacă lipsește și `DEMO_TENANTS_JSON`, nu trece nimeni (sigur implicit).

Cod: [`api/src/lib/auth.js`](../api/src/lib/auth.js) (tokenuri), [`api/src/lib/access.js`](../api/src/lib/access.js) (reguli pe device/sesiune), [`api/src/lib/http.js`](../api/src/lib/http.js) (aplicat la toate endpoint-urile).

**Demo pentru juriu**: cu tokenul firmei A, `GET /api/telemetry?ownerId=company_B&vehicleId=CAR-02` -> `403`; fără token -> `401`; cu tokenul B pentru B -> `200`.

## Coduri de răspuns la `POST /api/telemetry`

| Cod | Când |
|---|---|
| `201` | salvat (doar după ce scrierea în bază a reușit) |
| `200` | retry identic (același id, același conținut): nu se salvează din nou |
| `409` | același `eventId`/`batchId`, dar cu **alt conținut**. Se compară hash-ul SHA-256 al JSON-ului, cu cheile sortate |
| `400` | JSON invalid sau date invalide (`details` arată problemele) |
| `401` / `403` | vezi mai sus |
| `413` | body peste 256 KB |
| `503` | baza de date indisponibilă: telefonul reîncearcă |

## `GET /api/telemetry` (contractul din ghid, pentru dashboard)

`GET /api/telemetry?ownerId=company_A&vehicleId=CAR-01&sessionId=&from=&to=&limit=100`, cu `limit` implicit 100 și maxim 200.

```json
{
  "ownerId": "company_A",
  "vehicleId": "CAR-01",
  "latest": { "...evenimentul original...": "", "receivedAtUtc": "...", "derived": { "capturedAtUtc": "...", "orientation": {}, "altitudeRel": {}, "position": {}, "distanceM": 0, "advice": "..." } },
  "countReturned": 2,
  "events": [ "...cele mai noi primele..." ]
}
```

- `events` conțin **evenimentul exact cum l-a trimis telefonul**, plus `receivedAtUtc` și `derived` (ce a calculat backend-ul).
- `latest` = cel cu cel mai mare timp de captură. `countReturned` = câte sunt în pagină, nu totalul.
- Pentru grafice în ordine cronologică, inversați o copie a listei.

## `GET /api/health`

Public, fără token și fără date ale firmelor:

```json
{ "status": "ok", "storageMode": "sql", "database": "ok", "databaseLatencyMs": 12, "auth": "enabled", "version": "1.0.0", "build": null, "timeUtc": "..." }
```

Răspunde `503` cu `status: "degraded"` dacă baza de date nu răspunde în 5 s. Util pentru verificarea după deploy și pentru un availability test în Application Insights.

## Loguri

Fiecare cerere scrie o linie JSON (o vezi în Function App -> Log stream sau în Application Insights -> Logs, tabela `traces`):

```json
{"endpoint":"telemetry","requestId":"<invocationId>","status":201,"durationMs":42,"eventId":"...","deviceId":"...","sessionId":"...","outcome":"stored","events":6}
```

Același `requestId` e întors clientului în header-ul `x-request-id`: dacă telefonul raportează o eroare, o găsești imediat în loguri. Interogare KQL utilă:

```kusto
traces | where message startswith "{\"endpoint\"" | extend d = parse_json(message)
| summarize count() by tostring(d.endpoint), toint(d.status), bin(timestamp, 5m)
```

## Scripturi npm (pentru dezvoltare și pentru CI)

Din `src/backend/api`:

| Script | Ce face | Are nevoie de bază de date? |
|---|---|---|
| `npm ci` | instalează exact versiunile din `package-lock.json` | nu |
| `npm run check` | sintaxa tuturor fișierelor JS, schemele JSON + exemplele, numerotarea migrărilor | nu |
| `npm test` | testele unitare și de API (autorizare, 401/403/409, health, procesare, rapoarte) | nu |
| `npm run ci` | `check` + `test`: tot ce trebuie să ruleze pipeline-ul | nu |
| `npm run test:sql` | aceleași teste și pe SQL Server-ul local | da (Docker) |
| `npm run db:migrate [-- --grant-app <nume>]` | aplică migrările (+ acces pentru Function App) | da |
| `npm run token:new -- <owner> <vehicul...>` | token nou + hash pentru `DEMO_TENANTS_JSON` | nu |
| `npm run simulate -- [--url] [--token] [--owner] [--vehicle]` | telefon simulat | nu (are nevoie de API) |

## Pentru Adina

Nu am modificat nimic în `infrastructure/`, `.github/workflows/` sau `.gitignore`. Ca workflow-ul și Bicep-ul tău să se potrivească cu backend-ul:

1. **Folderul aplicației Functions este `src/backend/api`**, nu `src/api`. În `ci-cd.yml`: `working-directory: src/backend/api` la pașii backend și `package: src/backend/api` la `Azure/functions-action`.
2. **Pasul de verificare**: `npm ci` + `npm run ci` (în loc de `npm test` + `node --check ...`; `ci` include ambele). Nu are nevoie de bază de date sau de secrete.
3. **Setările din Bicep sunt deja cele corecte**: `SQL_SERVER`, `SQL_DATABASE`, `STORAGE_MODE=azure-sql`, `DEMO_TENANTS_JSON`. Nu adăuga `SQL_CONNECTION_STRING`. Nu seta `AUTH_MODE` în Azure. Opțional: `APP_BUILD_VERSION` = SHA-ul commit-ului, ca să apară în `/api/health`.
4. **Schema și grant-ul**: în locul scripturilor `dbo.Telemetry` din ghid, rulezi o dată, ca administrator SQL Entra: `npm run db:migrate -- --grant-app <functionAppName>` (detalii în 04-trecere-azure.md). Aplicația are nevoie de `SELECT, INSERT, UPDATE` pe schema `dbo` (sunt 6 tabele și actualizări de statistici), nu doar `SELECT, INSERT` pe un singur tabel.
5. **Runtime**: codul merge pe Node 20–24. Dependențele de producție sunt doar `@azure/functions`, `mssql`, `ajv`, `ajv-formats`, deci `npm ci --omit=dev` e suficient.
6. **Health**: `GET /api/health` răspunde `503` dacă SQL nu e accesibil. E un semnal bun pentru verificarea de după deploy.
