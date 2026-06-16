/**
 * Client-side sessionId handling. A stable per-browser id ties multi-step
 * flows (e.g. UC3 preview -> confirm) to the same server-side session. Stored
 * in localStorage so it survives reloads within the demo.
 */
const KEY = 'metermate.sessionId';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function getSessionId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(KEY, id);
  }
  return id;
}
