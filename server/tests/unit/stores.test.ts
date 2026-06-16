import { beforeEach, describe, expect, it } from 'vitest';
import * as sessionStore from '../../src/stores/sessionStore.js';
import * as transactionStore from '../../src/stores/transactionStore.js';

beforeEach(() => {
  sessionStore._resetForTests();
  transactionStore._resetForTests();
});

describe('sessionStore', () => {
  it('creates and retrieves a session and tracks idempotency keys', () => {
    const s = sessionStore.getOrCreate('sess-1');
    expect(s.sessionId).toBe('sess-1');
    expect(sessionStore.hasIdempotencyKey('sess-1', 'k1')).toBe(false);
    sessionStore.markIdempotencyKey('sess-1', 'k1');
    expect(sessionStore.hasIdempotencyKey('sess-1', 'k1')).toBe(true);
  });

  it('stores and reads scratch state for multi-step flows', () => {
    sessionStore.setScratch('sess-2', 'preview', { amount: 500 });
    expect(sessionStore.getScratch<{ amount: number }>('sess-2', 'preview')).toEqual({ amount: 500 });
  });
});

describe('transactionStore', () => {
  it('creates a transaction in "started" state with a unique id', () => {
    const a = transactionStore.create({ consultantId: 'c1', clientEmail: 'A@x.com', clientName: 'A', type: 'subscription' });
    const b = transactionStore.create({ consultantId: 'c1', clientEmail: 'b@x.com', clientName: 'B', type: 'subscription' });
    expect(a.state).toBe('started');
    expect(a.clientEmail).toBe('a@x.com'); // normalized lower-case
    expect(a.txnId).not.toBe(b.txnId);
  });

  it('reuses the channel for the same consultant↔client pair (AC-05)', () => {
    transactionStore.linkChannel('c1', 'Client@X.com', 'C123', 'txn-alex-client-1');
    // Same pair, different email casing → same key → reuse.
    expect(transactionStore.findChannelForPair('c1', 'client@x.com')).toEqual({
      channelId: 'C123',
      channelName: 'txn-alex-client-1',
    });
    // Different consultant → no reuse.
    expect(transactionStore.findChannelForPair('c2', 'client@x.com')).toBeUndefined();
  });

  it('updates a transaction record', () => {
    const t = transactionStore.create({ consultantId: 'c1', clientEmail: 'a@x.com', clientName: 'A', type: 'subscription' });
    transactionStore.update(t.txnId, { state: 'completed', subscriptionId: 42 });
    expect(transactionStore.get(t.txnId)?.state).toBe('completed');
    expect(transactionStore.get(t.txnId)?.subscriptionId).toBe(42);
  });
});
