'use strict';
const config = require('../lib/config');
const { createMemoryStore } = require('./memoryStore');
const { createSqlStore } = require('./sqlStore');

let store;
/** Un singur store per proces (pool-ul SQL e refolosit între cereri). */
function getStore() {
  if (!store) {
    store = config.getStorageMode() === 'sql'
      ? createSqlStore(config.getSqlConfig())
      : createMemoryStore();
  }
  return store;
}

/** Doar pentru teste. */
function setStore(s) { store = s; }

module.exports = { getStore, setStore };
