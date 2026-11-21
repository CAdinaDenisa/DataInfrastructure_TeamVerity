import { API_URL, API_TOKEN, REQUEST_TIMEOUT_MS } from './config';

export async function sendEvent(event, token = API_TOKEN) {
  const authToken = (token || API_TOKEN || '').trim();
  if (!API_URL) return { kind: 'config', message: 'Lipsește EXPO_PUBLIC_API_URL în .env' };
  if (!authToken) return { kind: 'config', message: 'Lipsește EXPO_PUBLIC_API_TOKEN în .env' };