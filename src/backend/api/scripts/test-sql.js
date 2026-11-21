'use strict';
/**
 * Rulează testele și pe baza de date SQL locală (npm run test:sql).
 * Ia SQL_CONNECTION_STRING din mediu sau din local.settings.json. Necesită `npm run db:up` + `npm run db:migrate`.
 */
const { spawnSync } = require('child_process');
const { getConnectionString } = require('../src/lib/config');

const conn = getConnectionString();
if (!conn) {
  console.error('Lipsește SQL_CONNECTION_STRING (local.settings.json sau variabilă de mediu).');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', 'test/**/*.test.js'], { stdio: 'inherit', env: { ...process.env, SQL_CONNECTION_STRING: conn } });
process.exit(r.status ?? 1);
