'use strict';
/**
 * Aplică migrările din src/backend/database/migrations în ordine, fiecare o singură dată
 * (evidența e în tabela dbo.schema_migrations).
 *
 *   npm run db:migrate                                   # local (SQL_CONNECTION_STRING din local.settings.json)
 *   npm run db:migrate -- --grant-app <functionAppName>  # + acces pentru identitatea Function App (Azure)
 *
 * Azure SQL (Entra-only, ca în Bicep-ul Adinei): setezi SQL_SERVER și SQL_DATABASE, faci `az login`
 * cu contul de administrator SQL Entra, apoi rulezi comanda. Nu e nevoie de parolă.
 * Local creează și baza de date dacă nu există; în Azure baza o creează Bicep-ul.
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { getSqlConfig } = require('../src/lib/config');

const args = process.argv.slice(2);
const grantIdx = args.indexOf('--grant-app');
const grantApp = grantIdx >= 0 ? args[grantIdx + 1] : null;
const DB_DIR = path.join(__dirname, '..', '..', 'database');

const splitBatches = (text) => text.split(/^\s*GO\s*$/im).map((s) => s.trim()).filter(Boolean);

async function ensureLocalDatabase(cfg) {
  if (typeof cfg !== 'string') return; // Azure: baza există deja
  const parsed = sql.ConnectionPool.parseConnectionString(cfg);
  if (!parsed.database || !/^(localhost|127\.0\.0\.1|sql)$/i.test(parsed.server)) return;
  const pool = await new sql.ConnectionPool({ ...parsed, database: 'master' }).connect();
  await pool.request().input('n', sql.NVarChar, parsed.database)
    .query("IF DB_ID(@n) IS NULL EXEC('CREATE DATABASE [' + @n + ']')");
  await pool.close();
}

async function migrate(pool) {
  await pool.request().query(`IF OBJECT_ID('dbo.schema_migrations') IS NULL
    CREATE TABLE dbo.schema_migrations (name NVARCHAR(200) PRIMARY KEY, applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME())`);
  const done = new Set((await pool.request().query('SELECT name FROM dbo.schema_migrations')).recordset.map((r) => r.name));
  const dir = path.join(DB_DIR, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) { console.log(`= ${file} (deja aplicată)`); continue; }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const stmt of splitBatches(fs.readFileSync(path.join(dir, file), 'utf8'))) await new sql.Request(tx).batch(stmt);
      await new sql.Request(tx).input('n', sql.NVarChar, file).query('INSERT INTO dbo.schema_migrations (name) VALUES (@n)');
      await tx.commit();
      console.log(`+ ${file}`);
    } catch (err) {
      await tx.rollback();
      throw new Error(`${file}: ${err.message}`);
    }
  }
}

async function grant(pool, appName) {
  if (!/^[A-Za-z0-9-]{2,60}$/.test(appName)) throw new Error(`Nume Function App invalid: ${appName}`);
  const script = fs.readFileSync(path.join(DB_DIR, 'grants', 'grant_function_access.sql'), 'utf8')
    .replace("N'REPLACE_WITH_FUNCTION_APP_NAME';", `N'${appName}';`);
  const r = await pool.request().batch(script);
  console.log(`+ acces SELECT/INSERT/UPDATE pe schema dbo pentru ${appName}`, r.recordset || '');
}

async function main() {
  const cfg = getSqlConfig();
  if (!cfg) throw new Error('Lipsește SQL_CONNECTION_STRING (local) sau SQL_SERVER + SQL_DATABASE (Azure).');
  await ensureLocalDatabase(cfg);
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    await migrate(pool);
    if (grantApp) await grant(pool, grantApp);
  } finally {
    await pool.close();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
