# Trecerea la Azure real

Codul **nu se schimbă**. Singurul loc din cod care citește configurarea este [`api/src/lib/config.js`](../api/src/lib/config.js), care ia valorile din variabile de mediu:

| Setare | Local (`local.settings.json`) | În Azure (Function App -> Settings -> Environment variables -> App settings) |
|---|---|---|
| `SQL_CONNECTION_STRING` | SQL Server din Docker | connection string-ul Azure SQL (pasul 2) |
| `STORAGE_MODE` | `sql` (sau `memory`) | `sql` |
| `DEVICE_API_KEY` | gol (fără verificare) | o cheie lungă aleatoare; în aplicația de telefon se introduce în câmpul „token” (trimisă ca `Authorization: Bearer`) |
| `AzureWebJobsStorage` | `UseDevelopmentStorage=true` (Azurite) | completat automat la crearea Function App |

> Interfața portalului se mai schimbă. Dacă un buton are alt nume, caută după ideea pasului.

## 0. Pregătire

- portal.azure.com, logat cu contul de Azure for Students. Verifică la **Subscriptions** că vezi „Azure for Students”.
- Creează un **Resource group**: `rg-porsche-hecaton`. Toate resursele de mai jos merg în el (la final ștergi grupul și dispare tot).
- **Regiunea**: abonamentele Student permit doar unele regiuni. Alege una permisă și apropiată (de ex. West Europe, North Europe, Sweden Central, Poland Central) și folosește aceeași pentru tot.

## 1. Azure SQL Database (oferta gratuită)

1. Caută **SQL databases** -> **+ Create**. Sus apare bannerul **„Want to try Azure SQL Database for free?” -> Apply offer**. Apasă-l: asta setează tier-ul gratuit.
2. **Basics**: resource group `rg-porsche-hecaton`, nume bază `porsche_hecaton`, **Server: Create new**:
   - nume server unic, ex. `porsche-hecaton-sql-<inițiale>` (devine `<nume>.database.windows.net`)
   - Authentication: **Use SQL authentication** (cel mai simplu pentru proiect); alegi un admin login + parolă puternică. Păstrează-le într-un manager de parole, nu pe git.
3. **Free offer**: Compute = General Purpose, **Serverless**. La „Behavior when free limit reached” alege **Auto-pause the database until next month** (așa nu plătești niciodată; alternativa „Continue using database for additional charges” costă).
4. **Networking**: Connectivity = **Public endpoint**; „Allow Azure services and resources to access this server” = **Yes** (ca să poată intra Function App); „Add current client IP address” = **Yes** (ca să rulezi migrarea de pe laptop). Colegii care vor să se conecteze direct se adaugă la SQL server -> Security -> Networking.
5. Review + create.

**Limitele ofertei gratuite** (lunar, per bază; verifică în portal, Microsoft le mai ajustează): ~100.000 vCore-secunde de calcul, 32 GB date. Baza se pune singură în pauză când nu e folosită și se trezește la prima conexiune (prima cerere poate dura ~1 minut, de aceea API-ul răspunde 503 și telefonul reîncearcă). Calculul se consumă doar cât timp baza e trează, deci **nu lăsa simulatorul sau aplicația să trimită date non-stop** zile întregi.

## 2. Connection string-ul

SQL database `porsche_hecaton` -> **Settings -> Connection strings -> ADO.NET (SQL authentication)**. Arată așa:

```
Server=tcp:porsche-hecaton-sql-xx.database.windows.net,1433;Initial Catalog=porsche_hecaton;Persist Security Info=False;User ID=<admin>;Password={your_password};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Înlocuiești `{your_password}` cu parola și pui `Connection Timeout=60` (timp pentru trezirea din pauză). Pachetul `mssql` folosit de noi înțelege direct acest format.

## 3. Creezi tabelele în Azure SQL (de pe laptop)

```bash
cd src/backend/api
# bash / Git Bash / Mac:
SQL_CONNECTION_STRING="Server=tcp:...;Password=...;Connection Timeout=60;" npm run db:migrate
# PowerShell:
$env:SQL_CONNECTION_STRING="Server=tcp:...;Password=...;Connection Timeout=60;"; npm run db:migrate
```

Trebuie să vezi `+ 001_init.sql`. Dacă primești „Client with IP address ... is not allowed”: SQL server -> Security -> Networking -> adaugă IP-ul tău. (Scriptul nu creează baza în Azure, doar tabelele: baza ai creat-o la pasul 1.)

Verificare: în portal, baza -> **Query editor (preview)** -> logare -> `SELECT name FROM sys.tables`.

## 4. Function App

1. Caută **Function App** -> **+ Create** -> plan de găzduire **Flex Consumption** (dacă nu e disponibil în regiunea ta: **Consumption**). Ambele au o cotă lunară gratuită de execuții, suficientă pentru proiect.
2. Runtime stack **Node.js**, versiune **20** (sau 22), OS Linux, același resource group și regiune.
3. Storage: lasă-l să creeze un storage account nou (costă cenți; acesta înlocuiește Azurite).
4. **Monitoring**: Application Insights = Yes (are cotă gratuită; util pentru loguri și pentru raportul DevOps).
5. Review + create.

## 5. Setările aplicației (aici intră Azure real)

Function App -> **Settings -> Environment variables -> App settings -> + Add**:

| Name | Value |
|---|---|
| `SQL_CONNECTION_STRING` | connection string-ul de la pasul 2 |
| `STORAGE_MODE` | `sql` |
| `DEVICE_API_KEY` | o cheie aleatoare (ex. `node -e "console.log(require('crypto').randomUUID())"`) |

**Apply** -> **Confirm** (aplicația repornește). Variantă mai sigură, pentru nota de DevOps: pui connection string-ul în **Key Vault** și în App setting scrii `@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/sql-conn/)`, cu Managed Identity activată pe Function App. Codul rămâne identic.

**CORS** (pentru dashboard): Function App -> **API -> CORS** -> adaugi URL-ul dashboard-ului (ex. `https://<nume>.azurestaticapps.net`) și, pentru dezvoltare, `http://localhost:5173`.

## 6. Deploy al codului

Oricare dintre:

- **VS Code**: extensia Azure Functions -> click dreapta pe folderul `src/backend/api` -> „Deploy to Function App...”.
- **Linie de comandă** (Azure CLI + Core Tools): `az login`, apoi din `src/backend/api`: `func azure functionapp publish <nume-function-app>`.
- **GitHub Actions** (pasul de CI/CD din plan): Function App -> **Deployment Center** -> Source: GitHub -> alegi repo-ul, branch `main`, apoi în workflow-ul generat setezi folderul aplicației la `src/backend/api`. Portalul generează workflow-ul. Secretele rămân în Azure/GitHub Secrets, niciodată în cod.

Fișierul `src/backend/api/.funcignore` exclude din deploy testele, exemplele, scripturile și `local.settings.json`.

## 7. Verificare și conectarea telefonului

- Function App -> **Overview -> Default domain**: ex. `https://porsche-hecaton-api.azurewebsites.net` (la Flex Consumption poate avea un sufix generat).
- Test din laptop: `npm run simulate -- --url https://<default-domain> --key <DEVICE_API_KEY> --seconds 10`.
- În aplicația de telefon: `src/phone-app/.env` -> `EXPO_PUBLIC_API_URL=https://<default-domain>` (fără `/api/telemetry`), iar în câmpul „token” din aplicație se introduce valoarea `DEVICE_API_KEY`.
- Loguri: Function App -> **Log stream**, sau Application Insights -> **Failures**.

## Costuri: ce să eviți

- Nu alege tier-uri „Provisioned”/„Business Critical” la SQL și nici plan „Premium”/„App Service” la Function App.
- Păstrează la SQL „Auto-pause the database until next month”.
- Setează un buget: **Cost Management -> Budgets** -> ex. 5 USD cu alertă pe email.
- La final de semestru: șterge resource group-ul `rg-porsche-hecaton`.
