import { fetchJson } from './httpClient.js';

let statusPromise;

export function serverStatus() {
  if (!statusPromise) statusPromise = fetchJson('api/status', 'server').catch(() => ({ apiFootball: { configured: false }, footballDataOrg: { configured: false } }));
  return statusPromise;
}
