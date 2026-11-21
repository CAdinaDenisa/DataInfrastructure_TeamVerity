'use strict';
/**
 * Aplică fișierele din src/backend/database/migrations în ordine (o singură dată fiecare).
 * Folosește SQL_CONNECTION_STRING din mediu sau din local.settings.json.
 *   npm run db:migrate
 * Local creează și baza de date dacă nu există (pe Azure o creezi din portal).
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { getConnectionString } = require('../src/lib/config');

function splitBatches(text) {
  return text.split(/^\s*GO\s*$/im).map((s) => s.trim()).filter(Boolean);
}

async function ensureDatabase(connStr) {
  const cfg = sql.ConnectionPool.parseConnectionString(connStr);
  const dbName = cfg.database;
  if (!dbName || !/^(localhost|127\.0\.0\.1|sql)$/i.test(cfg.server)) return; // doar local
  const pool = await new sql.ConnectionPool({ ...cfg, database: 'master' }).connect();
  await pool.request().input('n', sql.NVarChar, dbName)
    .query("IF DB_ID(@n) IS NULL EXEC('CREATE DATABASE [' + @n + ']')");
  await pool.close();
}

async function main() {
  const connStr = getConnectionString();
  if (!connStr) throw new Error('Lipsește SQL_CONNECTION_STRING (vezi local.settings.example.json)');
  await ensureDatabase(connStr);
  const pool = await sql.connect(connStr);
  await pool.request().query(`IF OBJECT_ID('dbo.schema_migrations') IS NULL
    CREATE TABLE dbo.schema_migrations (name NVARCHAR(200) PRIMARY KEY, applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME())`);
  const done = new Set((await pool.request().query('SELECT name FROM dbo.schema_migrations')).recordset.map((r) => r.name));
  const dir = path.join(__dirname, '..', '..', 'database', 'migrations');
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
  await pool.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
