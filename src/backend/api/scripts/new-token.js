'use strict';
/**
 * Generează un token de firmă pentru demo + intrarea pentru DEMO_TENANTS_JSON.
 *   npm run token:new -- company_A CAR-01 [CAR-03 ...] [--hours 24]
 * Tokenul brut îl dai PRIVAT celor care testează firma (îl introduc în aplicație/dashboard).
 * În setările serverului (DEMO_TENANTS_JSON) intră DOAR hash-ul. Nu comite niciunul în git.
 */
const crypto = require('crypto');

const args = process.argv.slice(2);
const hIdx = args.indexOf('--hours');
const hours = hIdx >= 0 ? Number(args.splice(hIdx, 2)[1]) : 24;
const [ownerId, ...vehicleIds] = args;
if (!ownerId || !vehicleIds.length) {
  console.error('Folosire: npm run token:new -- <ownerId> <vehicleId> [vehicleId...] [--hours 24]');
  process.exit(1);
}
const token = crypto.randomBytes(32).toString('hex');
const entry = {
  ownerId,
  tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
  vehicleIds,
  expiresAtUtc: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
};
console.log('Token (secret, se dă doar testerilor firmei):');
console.log(`  ${token}`);
console.log('\nIntrare pentru DEMO_TENANTS_JSON (doar hash-ul):');
console.log(`  ${JSON.stringify(entry)}`);
