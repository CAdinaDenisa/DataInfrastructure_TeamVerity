# Trecerea la Azure real

Resursele Azure le creează **Adina** cu Bicep (`infrastructure/main.bicep`): Azure SQL (autentificare doar Microsoft Entra, fără parolă), Function App pe Flex Consumption (Node 24, cu Managed Identity), storage pentru host și Static Web App. Backend-ul **nu are nevoie de modificări de cod** pentru Azure: citește setările pe care le pune Bicep-ul.

## Setările pe care le citește backend-ul

Singurul loc din cod care citește configurarea: [`api/src/lib/config.js`](../api/src/lib/config.js).

| Setare | Local (`local.settings.json`) | Azure (setat de Bicep) |
|---|---|---|
| `STORAGE_MODE` | `sql` (sau `memory`) | `azure-sql` |
| `SQL_CONNECTION_STRING` | SQL Server din Docker, cu user/parolă | **nu se setează** |
| `SQL_SERVER` | — | `<server>.database.windows.net` (output `sqlServerFqdn`) |
| `SQL_DATABASE` | — | `telemetrydb` (output `sqlDatabaseName`) |
| `AUTH_MODE` | `disabled` (explicit, doar local) | **nu se setează** -> autorizarea e activă |
| `DEMO_TENANTS_JSON` | gol sau o hartă de test | harta firmă -> hash token (secretă) |
| `APP_BUILD_VERSION` | — | opțional: commit-ul deploy-at (apare în `/api/health`) |

Cu `SQL_SERVER` setat, backend-ul se conectează prin **DefaultAzureCredential**: în Azure folosește identitatea Function App (Managed Identity), pe laptop folosește contul din `az login`. Nicio parolă nu ajunge în setări sau în cod.

## Pași (o singură dată, după ce Adina rulează Bicep-ul)

### 1. Tabelele și accesul aplicației în Azure SQL

Îl rulează administratorul SQL Entra (contul din `sqlAdminLogin` din Bicep), de pe un calculator al cărui IP e permis (`sqlAdminIp`):

```bash
az login                                  # cu contul de administrator SQL Entra
cd src/backend/api
npm ci
# bash
SQL_SERVER=<sqlServerFqdn> SQL_DATABASE=telemetrydb npm run db:migrate -- --grant-app <functionAppName>
# PowerShell
$env:SQL_SERVER="<sqlServerFqdn>"; $env:SQL_DATABASE="telemetrydb"; npm run db:migrate -- --grant-app <functionAppName>
```

Așteptat: `+ 001_init.sql`, `+ 002_session_stats.sql`, `+ 003_auth_and_payloads.sql`, apoi `+ acces SELECT/INSERT/UPDATE ... pentru <functionAppName>`.

- Migrările creează tabelele **noastre** (`devices`, `sessions`, `batches`, `sensor_readings`, `device_states`). Ele înlocuiesc scripturile `dbo.Telemetry` din ghidul inițial.
- `--grant-app` creează utilizatorul pentru identitatea Function App și îi dă doar `SELECT, INSERT, UPDATE` pe schema `dbo`. Nu primește DELETE și nici drepturi de modificare a schemei. Varianta manuală e scriptul [`database/grants/grant_function_access.sql`](../database/grants/grant_function_access.sql), rulat în VS Code cu extensia MSSQL.
- La o migrare nouă (`004_...sql`) se rulează din nou doar `npm run db:migrate`. CD-ul nu rulează migrări, intenționat: aplicația nu are drept să modifice schema.

### 2. Tokenurile firmelor

```bash
npm run token:new -- company_A CAR-01 --hours 24
npm run token:new -- company_B CAR-02 --hours 24
```

Fiecare comandă afișează tokenul brut (îl dai privat testerilor firmei, care îl introduc în aplicație sau în dashboard) și intrarea JSON cu **hash-ul**. Intrările se pun într-o listă `[ ... , ... ]` în `demoTenantsJson` din `infrastructure/private.parameters.json` (fișierul Adinei, ignorat de git), iar Bicep-ul o pune în setarea `DEMO_TENANTS_JSON`. Alternativ, folosiți scriptul PowerShell din ghidul Adinei, care produce exact același format.

### 3. Deploy și verificare

Deploy-ul îl face workflow-ul Adinei din folderul `src/backend/api` (vezi [06-securitate-si-operare.md](06-securitate-si-operare.md#pentru-adina)). După deploy:

```bash
curl https://<functionBaseUrl>/api/health
# {"status":"ok","storageMode":"sql","database":"ok","auth":"enabled",...}

npm run simulate -- --url https://<functionBaseUrl> --token <token company_A> --owner company_A --vehicle CAR-01 --seconds 10
```

- `database: "unreachable"` -> verifică grant-ul (pasul 1), firewall-ul SQL (`allowAzureServices`) și că `SQL_SERVER` e FQDN-ul corect.
- `auth: "enabled-no-tenants"` -> `DEMO_TENANTS_JSON` e gol: niciun token nu trece.
- `auth: "misconfigured"` -> `DEMO_TENANTS_JSON` nu e JSON valid.

Aplicația de telefon: `src/phone-app/.env` -> `EXPO_PUBLIC_API_URL=https://<functionBaseUrl>`, iar tokenul firmei se introduce în câmpul „token”.

## Varianta fără Bicep (manual, din portal)

Dacă vreți vreodată o bază separată, de test, creată din portal (de ex. cu oferta gratuită Azure SQL): setați aceleași `SQL_SERVER` / `SQL_DATABASE` și rulați pasul 1. Cu autentificare SQL (user/parolă) se poate folosi și `SQL_CONNECTION_STRING`, cu formatul ADO.NET din portal (Connection strings), dar în mediul echipei rămâne varianta fără parolă.

## Costuri

Bicep-ul Adinei folosește Azure SQL **Basic (5 DTU, 2 GB)**: e mic, dar se plătește din creditul Azure for Students. Nu e oferta gratuită și nu intră în pauză singur. După demo, ștergeți resource group-ul (pasul de cleanup din ghidul Adinei).
