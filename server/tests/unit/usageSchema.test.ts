import { describe, expect, it } from 'vitest';
import { usageSchema } from '../../src/schemas/usage.js';

const valid = {
  sessionId: 'sess-1',
  txnRef: 'txn_abc',
  componentHandle: 'chub-test-minutes',
  quantity: 30,
};

describe('usageSchema', () => {
  it('accepts valid metered usage', () => {
    expect(usageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an event-based handle with an ISO timestamp', () => {
    const r = usageSchema.safeParse({
      ...valid,
      componentHandle: 'api-calls',
      timestamp: '2026-06-16T17:45:50Z',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-positive / non-integer quantity', () => {
    expect(usageSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(usageSchema.safeParse({ ...valid, quantity: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown component handle', () => {
    expect(usageSchema.safeParse({ ...valid, componentHandle: 'seats' }).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(usageSchema.safeParse({ ...valid, timestamp: 'yesterday' }).success).toBe(false);
  });
});
