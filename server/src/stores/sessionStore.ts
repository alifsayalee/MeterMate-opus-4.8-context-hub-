import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { SessionData } from '../types.js';

/**
 * In-memory session store with TTL sweeping (plan §4.3). Holds per-session
 * scratch state for multi-step flows and an idempotency-key set to guard
 * double-submits. DB-ready: the public surface (get/put/touch/delete/sweep) is
 * all any caller uses, so swapping the Map for Redis is a single-file change.
 */
const log = createLogger('sessionStore');

const ttlMs = config.sessionTtlMinutes * 60_000;

const sessions = new Map<string, SessionData>();

function now(): number {
  return Date.now();
}

/** Returns the session, creating it on first touch. Refreshes lastTouched. */
export function getOrCreate(sessionId: string): SessionData {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      lastTouched: now(),
      idempotencyKeys: new Set<string>(),
      scratch: {},
    };
    sessions.set(sessionId, s);
    log.debug(`Created session ${sessionId}`);
  } else {
    s.lastTouched = now();
  }
  return s;
}

/** Returns an existing, non-expired session or undefined. */
export function get(sessionId: string): SessionData | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  if (now() - s.lastTouched > ttlMs) {
    sessions.delete(sessionId);
    log.debug(`Session ${sessionId} expired on access`);
    return undefined;
  }
  s.lastTouched = now();
  return s;
}

/** True if this idempotency key was already seen for the session. */
export function hasIdempotencyKey(sessionId: string, key: string): boolean {
  const s = getOrCreate(sessionId);
  return s.idempotencyKeys.has(key);
}

export function markIdempotencyKey(sessionId: string, key: string): void {
  getOrCreate(sessionId).idempotencyKeys.add(key);
}

export function setScratch(sessionId: string, key: string, value: unknown): void {
  getOrCreate(sessionId).scratch[key] = value;
}

export function getScratch<T>(sessionId: string, key: string): T | undefined {
  return get(sessionId)?.scratch[key] as T | undefined;
}

export function remove(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Removes expired sessions. Returns the number swept. */
export function sweep(): number {
  const cutoff = now() - ttlMs;
  let removed = 0;
  for (const [id, s] of sessions) {
    if (s.lastTouched < cutoff) {
      sessions.delete(id);
      removed++;
    }
  }
  if (removed > 0) log.debug(`Swept ${removed} expired session(s)`);
  return removed;
}

export function count(): number {
  return sessions.size;
}

/** Test-only: clear all state. */
export function _resetForTests(): void {
  sessions.clear();
}

// Background sweep so idle sessions don't accumulate. Unref so it never keeps
// the process alive on its own.
const sweepTimer = setInterval(sweep, Math.max(60_000, ttlMs / 2));
sweepTimer.unref?.();
