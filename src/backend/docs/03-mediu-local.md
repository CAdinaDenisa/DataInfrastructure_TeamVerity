# Mediul local de test (fără Azure)

Totul rulează pe laptop și imită Azure:

| În Azure | Local | Ce se schimbă la trecere |
|---|---|---|
| Azure SQL Database | SQL Server 2022 în Docker (același T-SQL) | doar `SQL_CONNECTION_STRING` |
| Function App | Azure Functions Core Tools (`func start`) sau imaginea oficială în Docker | nimic în cod |
| Storage account (`AzureWebJobsStorage`) | Azurite (emulatorul oficial) | setat automat de Azure |
| App settings | `local.settings.json` -> `Values` (nu se urcă pe git) | le copiezi în portal |

## Ce instalezi o singură dată

1. **Node.js 20 sau 22** (LTS).
2. **Docker Desktop** (Windows/Mac) sau Docker Engine (Linux). Pe Mac cu M1/M2/M3: Settings -> General -> bifează „Use Rosetta for x86_64/amd64 emulation” (SQL Server nu are imagine ARM).
3. **Azure Functions Core Tools v4** (opțional, vezi varianta Docker mai jos):
   - Windows: `winget install Microsoft.Azure.FunctionsCoreTools`
   - Mac: `brew tap azure/functions && brew install azure-functions-core-tools@4`
   - oriunde: `npm i -g azure-functions-core-tools@4 --unsafe-perm true`
4. Recomandat în VS Code: extensiile „Azure Functions”, „SQL Server (mssql)”.

## Pornire

```bash
cd src/backend/api
npm install
npm run setup:local      # copiază local.settings.example.json -> local.settings.json (o singură dată)
npm run db:up            # pornește SQL Server + Azurite din ../database (prima dată descarcă ~1.5 GB)
npm run db:migrate       # creează baza porsche_hecaton și tabelele
npm start                # = func start -> http://localhost:7071/api/...
```

**Fără Core Tools**: `npm run api:docker` pornește și API-ul (runtime-ul oficial Azure Functions) pe același port 7071. După ce schimbi codul: `docker compose -f ../database/docker-compose.yml --profile api restart api`.

**Fără Docker deloc** (ex. un coleg care face doar dashboard-ul): în `local.settings.json` pune `"STORAGE_MODE": "memory"`. API-ul merge, dar datele dispar la repornire.

**Autorizarea local**: exemplul are `"AUTH_MODE": "disabled"`, deci nu e nevoie de token. Ca să testezi tokenurile ca în Azure: șterge `AUTH_MODE`, rulează `npm run token:new -- company_A CAR-01`, pune intrarea afișată într-o listă în `DEMO_TENANTS_JSON` (ex. `"[{...}]"`), repornește API-ul și trimite `Authorization: Bearer <token>` (simulator: `--token <token>`).

## Testare

```bash
npm run simulate                        # 30 s de date: mașina se înclină, merge în cerc, urcă 3 m
npm run simulate -- --seconds 120 --device phone-test-02
npm run simulate -- --no-barometer      # telefon fără barometru (z din GPS)
npm run simulate -- --no-gps            # fără GPS (doar orientare + altitudine)

curl -X POST http://localhost:7071/api/telemetry -H "Content-Type: application/json" -d @examples/batch-full.json
curl -X POST http://localhost:7071/api/telemetry -H "Content-Type: application/json" -H "Authorization: Bearer test" -d @examples/event-v1-phone-app.json
curl http://localhost:7071/api/devices
curl http://localhost:7071/api/devices/phone-sim-01/state
curl "http://localhost:7071/api/devices/phone-sim-01/readings?type=accelerometer&limit=50"

npm run ci                              # verificări + teste (fără bază de date), ca în pipeline
npm run test:sql                        # aceleași teste și pe SQL Server-ul local (după db:up + db:migrate)
```

Atenție: exemplele din `examples/` au timestamp-uri fixe din 21.11.2026; backend-ul respinge loturi mai vechi de 24 h, deci pentru curl după acea zi folosește simulatorul sau actualizează timestamp-urile.

## Telefonul real pe aceeași rețea Wi-Fi

`localhost` de pe telefon este telefonul, nu laptopul. În `src/phone-app/.env` pune IP-ul laptopului: `EXPO_PUBLIC_API_URL=http://192.168.x.y:7071` (fără `/api/telemetry`). Tokenul din aplicație poate fi orice text cât timp `AUTH_MODE=disabled` (afli IP-ul cu `ipconfig` / `ifconfig`). Dacă nu merge: permite portul 7071 în firewall sau folosește `npx expo start --tunnel` + un tunel pentru API (ex. VS Code „Ports” -> Forward port 7071, vizibilitate Public).

## Oprire / resetare

```bash
npm run db:down                                         # oprește containerele, păstrează datele
docker compose -f ../database/docker-compose.yml down -v  # oprește și ȘTERGE datele (bază nouă la următorul db:up + db:migrate)
```
