import AsyncStorage from '@react-native-async-storage/async-storage';
import { QUEUE_LIMIT } from './config';

// Coadă persistentă: fiecare eveniment e salvat ÎNAINTE de trimitere,
// așa că supraviețuiește fără internet și după repornirea aplicației.
// Evenimentele respinse definitiv (400/409) se mută separat, vizibil — nu se aruncă.

const QUEUE_KEY = 'telemetry-queue-v1';
const REJECTED_KEY = 'telemetry-rejected-v1';

let queue = [];
let rejected = [];
let loaded = false;
let chain = Promise.resolve();
const listeners = new Set();

// Toate modificările trec pe rând, ca să nu se suprascrie între ele.
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function notify() {
  const snap = snapshot();
  listeners.forEach((l) => l(snap));
}

async function persist() {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify(rejected));
}

export function snapshot() {
  return { items: queue.slice(), size: queue.length, rejected: rejected.slice(), full: queue.length >= QUEUE_LIMIT };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function load() {
  return serial(async () => {
    if (loaded) return snapshot();
    try {
      queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]');
      rejected = JSON.parse((await AsyncStorage.getItem(REJECTED_KEY)) || '[]');
    } catch {
      queue = [];
      rejected = [];
    }
    loaded = true;
    notify();
    return snapshot();
  });
}

// Întoarce false dacă coada e plină (evenimentul NU se pierde în tăcere — apelantul oprește colectarea).
export function enqueue(event) {
  return serial(async () => {
    if (queue.length >= QUEUE_LIMIT) return false;
    queue.push(event);
    await persist();
    notify();
    return true;
  });
}

// Scoate DOAR evenimentul confirmat de server.
export function remove(eventId) {
  return serial(async () => {
    queue = queue.filter((e) => e.eventId !== eventId);
    await persist();
    notify();
  });
}

export function reject(eventId, reason) {
  return serial(async () => {
    const ev = queue.find((e) => e.eventId === eventId);
    queue = queue.filter((e) => e.eventId !== eventId);
    if (ev) rejected.push({ event: ev, reason, atUtc: new Date().toISOString() });
    await persist();
    notify();
  });
}

export function clearRejected() {
  return serial(async () => {
    rejected = [];
    await persist();
    notify();
  });
}
