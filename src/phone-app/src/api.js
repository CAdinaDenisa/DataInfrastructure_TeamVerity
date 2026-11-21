import { API_URL, API_TOKEN, REQUEST_TIMEOUT_MS } from './config';

// Trimite UN eveniment. Nu aruncă erori: întoarce un rezultat clasificat.
// kind: 'ok' | 'transient' (se reîncearcă) | 'auth' (401/403) | 'invalid' (400) | 'conflict' (409) | 'config'
// Tokenul: cel introdus în aplicație, altfel EXPO_PUBLIC_API_TOKEN din .env.
export async function sendEvent(event, token = API_TOKEN) {
  token = (token || API_TOKEN || '').trim();
  if (!API_URL) return { kind: 'config', message: 'Lipsește EXPO_PUBLIC_API_URL în .env' };
  if (!token) return { kind: 'auth', status: 0, message: 'Lipsește tokenul: introdu-l în aplicație sau pune EXPO_PUBLIC_API_TOKEN în .env' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event), // același body la fiecare retry
      signal: controller.signal,
    });
    const status = response.status;
    let body = null;
    try {
      body = await response.json();
    } catch {
      // răspuns fără JSON — e în regulă
    }

    if (status === 200 || status === 201) return { kind: 'ok', status, body };
    if (status === 401) return { kind: 'auth', status, message: 'Token invalid sau expirat (401)' };
    if (status === 403) return { kind: 'auth', status, message: 'Token-ul nu are voie pentru acest owner/vehicul (403)' };
    if (status === 400) return { kind: 'invalid', status, message: body?.error || 'Date invalide (400) — verifică contractul cu Stefana' };
    if (status === 409) return { kind: 'conflict', status, message: 'Același eventId cu alt conținut (409)' };
    if (status === 429 || status >= 500) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      return { kind: 'transient', status, retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null, message: `Server ocupat sau eroare (${status})` };
    }
    return { kind: 'invalid', status, message: `Răspuns neașteptat (${status})` };
  } catch (e) {
    const timeout = e?.name === 'AbortError';
    return { kind: 'transient', status: 0, message: timeout ? 'Timeout — serverul nu a răspuns' : 'Fără conexiune la rețea' };
  } finally {
    clearTimeout(timer);
  }
}