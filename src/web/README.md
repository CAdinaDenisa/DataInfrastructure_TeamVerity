# Dashboard web (src/web)

Dashboard-ul citește **toate** datele din API-ul Azure Functions (`src/backend/api`), deci din baza de date.
Nu mai există date de simulare: flota, traseul 3D, rapoartele de cursă și recomandările vin din API.

## Pornire

```bash
cd src/web
npm install          # copiază chart.js și three.js în vendor/
cp config.example.js config.js   # (Windows: copy config.example.js config.js) doar prima dată
npm start            # http://localhost:5173
```

Deschide **http://localhost:5173** (exact această adresă: e cea permisă de CORS în Azure).
Nu deschide `index.html` cu dublu-click (file://) și nu folosi alt port decât dacă Adina l-a adăugat în CORS.

În pagină:
1. Owner ID: `porsche`
2. Token Secret: tokenul firmei primit de la Adina/Stefana (rămâne doar în browserul tău, nu se salvează în cod)
3. **Conectează API**

Vehiculele care au curse în bază apar automat. Poți adăuga manual un VIN cu „+ Adaugă Mașină”,
iar cu ✎ poți seta numele, culoarea și **kilometrajul de bord** (opțional, pentru termenele de service).

## Ce endpoint-uri folosește

| Unde | Endpoint |
|------|----------|
| verificare la conectare | `GET /api/health` |
| traseul 3D live pe fiecare card | `GET /api/telemetry?ownerId=porsche&vehicleId=<VIN>&limit=200` |
| lista de telefoane | `GET /api/devices?ownerId=porsche` |
| tabelul „Rapoarte de cursă” | `GET /api/devices/{deviceId}/sessions` (grupate pe VIN) |
| pagina de raport (traseu, grafic, valori) | `GET /api/sessions/{sessionId}/track` |
| citirile brute din raport (accel, mag, baro) | `GET /api/devices/{deviceId}/readings?type=&sessionId=` |

Toate cererile (în afară de `/health`) trimit `Authorization: Bearer <token>`.

## Configurare (config.js)

`config.js` e ignorat de git. Câmpuri: `apiBaseUrl` (URL-ul Function App + `/api`; local `http://localhost:7071/api`),
`ownerId`, `vehicles` (doar nume + VIN pentru prima pornire), `pollIntervalMs`, `sessionsRefreshMs`.
**Nu pune tokenul în config.js.**

## Mesaje de eroare

- **„Browserul nu a primit răspuns de la API (CORS sau server oprit)”**: originea paginii nu e în CORS-ul Function App
  sau aplicația din Azure e oprită. Vezi mai jos ce trebuie setat în Azure.
- **„autorizare greșit configurată”**: `/api/health` raportează `auth: misconfigured`, adică setarea
  `DEMO_TENANTS_JSON` din Azure nu e JSON valid; orice token primește 401.
- **„Token respins (401)”**: tokenul nu se potrivește cu niciun hash din `DEMO_TENANTS_JSON` sau a expirat.
- **„Tokenul nu are acces la acest VIN (403)”**: VIN-ul nu e în `vehicleIds` pentru tokenul firmei.

## Ce trebuie setat în Azure (Adina)

1. **CORS** – Function App → API → CORS → Allowed Origins: `http://localhost:5173` și `http://127.0.0.1:5173`
   (opțional `http://localhost:5500`, `http://127.0.0.1:5500` pentru Live Server). Fără „Enable Access-Control-Allow-Credentials”.
   Același lucru e acum în `infrastructure/main.bicep`, deci se aplică și la următorul deploy Bicep.
2. **DEMO_TENANTS_JSON** – Function App → Settings → Environment variables. Trebuie să fie o listă JSON validă, de forma:
   `[{"ownerId":"porsche","tokenHash":"<sha256 hex, 64 caractere>","vehicleIds":["WP0ZZZY1ZNSA54819","WP0ZZZ99ZTS392124"],"expiresAtUtc":"2026-12-31T23:59:59Z"}]`
   (generează intrarea cu `npm run token:new -- porsche WP0ZZZY1ZNSA54819 WP0ZZZ99ZTS392124 --hours 720` din `src/backend/api`). După salvare, `/api/health` trebuie să arate `"auth":"enabled"`.
   Fiecare VIN care trimite date trebuie să fie în `vehicleIds`.
