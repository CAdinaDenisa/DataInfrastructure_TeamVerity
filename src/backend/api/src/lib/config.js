'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Setările vin din variabile de mediu:
 *  - local: din local.settings.json -> "Values" (le încarcă `func start`)
 *  - în Azure: din Function App -> Settings -> Environment variables
 * Pentru scripturile rulate cu node direct (migrate, simulate) citim local.settings.json manual.
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

const get = (name) => process.env[name] ?? localSettings()[name];

module.exports = {
  /** "sql" (implicit dacă există connection string) sau "memory" (fără bază de date). */
  getStorageMode: () => get('STORAGE_MODE') || (get('SQL_CONNECTION_STRING') ? 'sql' : 'memory'),
  getConnectionString: () => get('SQL_CONNECTION_STRING'),
  /** Dacă e setată, telefonul trebuie să trimită header-ul x-device-key cu această valoare. */
  getDeviceApiKey: () => get('DEVICE_API_KEY') || null,
};
