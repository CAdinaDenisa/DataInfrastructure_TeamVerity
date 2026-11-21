'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Toată configurarea vine din variabile de mediu (nimic secret în cod):
 *  - local: local.settings.json -> "Values" (le încarcă `func start`; scripturile node le citesc manual)
 *  - Azure: App settings ale Function App, setate de Bicep-ul Adinei (infrastructure/main.bicep)
 *
 * | Setare               | Local                          | Azure (Bicep)                          |
 * |----------------------|--------------------------------|----------------------------------------|
 * | STORAGE_MODE         | sql | memory                   | azure-sql                              |
 * | SQL_CONNECTION_STRING| SQL Server din Docker (parolă) | — (nu se folosește parolă)             |
 * | SQL_SERVER           | —                              | <server>.database.windows.net          |
 * | SQL_DATABASE         | —                              | telemetrydb                            |
 * | AUTH_MODE            | disabled (explicit, doar local)| — (autorizare activă)                  |
 * | DEMO_TENANTS_JSON    | opțional, pentru teste locale  | harta firmă -> hash token (secret)     |
 */
let localValues;
function localSettings() {
  if (localValues === undefined) {
    try {
      localValues = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'local.settings.json'), 'utf8')).Values || {};
    } catch {
      localValues = {};
    }
  }
  return localValues;
}

const get = (name) => {
  const v = process.env[name] ?? localSettings()[name];
  return v === '' ? undefined : v;
};

/** "sql" (SQL Server local sau Azure SQL) sau "memory" (fără bază de date, doar pentru teste/demo local). */
function getStorageMode() {
  const mode = (get('STORAGE_MODE') || '').toLowerCase();
  if (mode === 'memory' || mode === 'mock') return 'memory';
  if (mode === 'sql' || mode === 'azure-sql') return 'sql';
  return get('SQL_CONNECTION_STRING') || get('SQL_SERVER') ? 'sql' : 'memory';
}

/**
 * Configurația pentru pachetul mssql.
 *  - SQL_CONNECTION_STRING: local, cu user/parolă (SQL Server din Docker)
 *  - SQL_SERVER + SQL_DATABASE: Azure SQL cu Microsoft Entra, fără parolă. Folosește DefaultAzureCredential:
 *    în Azure = identitatea Function App (Managed Identity); pe laptop = contul din `az login`.
 */
// Serverul Azure SQL al echipei (din PR-ul Adinei), folosit dacă SQL_SERVER lipsește.
const DEFAULT_AZURE_SQL_SERVER = 'teamverity-sql-cqnazavdlt5aw.database.windows.net';

function getSqlConfig() {
  const conn = get('SQL_CONNECTION_STRING');
  // Un connection string cu "azure-active-directory-default" (varianta Adinei) înseamnă Managed Identity:
  // folosim configurația de mai jos (SQL_SERVER/SQL_DATABASE), ca să nu se piardă conectarea din Azure.
  const managedIdentityConn = Boolean(conn) && /azure-active-directory-default/i.test(conn);
  if (conn && !managedIdentityConn) return conn;
  const server = get('SQL_SERVER') || (managedIdentityConn ? DEFAULT_AZURE_SQL_SERVER : undefined);
  if (!server) return null;
  const clientId = get('AZURE_CLIENT_ID'); // doar pentru o identitate user-assigned
  return {
    server,
    database: get('SQL_DATABASE') || 'telemetrydb',
    port: 1433,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-default', options: clientId ? { clientId } : {} },
    connectionTimeout: 60000,
    requestTimeout: 30000,
  };
}

/** Autorizarea e oprită DOAR dacă AUTH_MODE=disabled (explicit, pentru dezvoltare locală). */
const isAuthDisabled = () => (get('AUTH_MODE') || '').toLowerCase() === 'disabled';

module.exports = {
  getStorageMode,
  getSqlConfig,
  isAuthDisabled,
  getTenantsJson: () => get('DEMO_TENANTS_JSON'),
  getBuildVersion: () => get('APP_BUILD_VERSION') || null,
  // compatibilitate cu scripturile vechi
  getConnectionString: () => get('SQL_CONNECTION_STRING'),
};
