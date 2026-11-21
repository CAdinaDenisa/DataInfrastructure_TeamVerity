import { sendEvent } from './api';
import { MAX_RETRIES, RETRY_COOLDOWN_MS } from './config';
import * as Queue from './queue';

// Un singur expeditor, serial: trimite evenimentele pe rând, din capul cozii.
// Trimite doar evenimentele contextului curent (owner + vehicul), cu token-ul curent;
// evenimentele altui owner rămân în coadă până revii la el.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;
let pausedUntil = 0; // după eșecuri repetate sau erori de autentificare
let authBlocked = false;

export function createSender({ getContext, onStatus }) {
  async function drain({ manual = false } = {}) {
    if (running) return;
    if (manual) {
      pausedUntil = 0;
      authBlocked = false;
    }
    if (authBlocked || Date.now() < pausedUntil) return;

    running = true;
    try {
      while (true) {
        const { ownerId, vehicleId, token } = getContext();
        const next = Queue.snapshot().items.find((e) => e.ownerId === ownerId && e.vehicleId === vehicleId);
        if (!next) {
          onStatus({ state: 'idle' });
          break;
        }

        let result;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          onStatus({ state: 'sending', eventId: next.eventId, attempt });
          result = await sendEvent(next, token);
          if (result.kind !== 'transient') break;
          if (attempt < MAX_RETRIES) {
            const delay = result.retryAfterMs ?? 1000 * 2 ** attempt; // 1 s, 2 s, 4 s
            onStatus({ state: 'retrying', eventId: next.eventId, attempt: attempt + 1, message: result.message, delayMs: delay });
            await sleep(delay);
          }
        }

        if (result.kind === 'ok') {
          await Queue.remove(next.eventId);
          onStatus({ state: 'acked', eventId: next.eventId, status: result.status, atUtc: new Date().toISOString() });
          continue;
        }
        if (result.kind === 'invalid' || result.kind === 'conflict') {
          // eroare permanentă pentru ACEST eveniment: îl mutăm vizibil la „respinse” și continuăm
          await Queue.reject(next.eventId, result.message);
          onStatus({ state: 'error', message: result.message, eventId: next.eventId });
          continue;
        }
        if (result.kind === 'auth' || result.kind === 'config') {
          authBlocked = true; // nu mai încercăm până nu se corectează token-ul / URL-ul și apeși Retry
          onStatus({ state: 'error', message: result.message });
          break;
        }
        // transient după toate încercările: păstrăm evenimentul și facem pauză
        pausedUntil = Date.now() + RETRY_COOLDOWN_MS;
        onStatus({ state: 'error', message: `${result.message}. Evenimentele rămân în coadă — apasă Retry.` });
        break;
      }
    } finally {
      running = false;
    }
  }

  return { drain };
}
