import { describe, expect, it } from 'vitest';
import { planChangeSchema } from '../../src/schemas/planChange.js';

const valid = { sessionId: 's1', txnRef: 'txn_x', targetHandle: 'chub-test-pro', timing: 'prorate' };

describe('planChangeSchema', () => {
  it('accepts a valid prorate request', () => {
    expect(planChangeSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts at-renewal timing', () => {
    expect(planChangeSchema.safeParse({ ...valid, timing: 'at-renewal' }).success).toBe(true);
  });

  it('rejects an unknown target handle', () => {
    expect(planChangeSchema.safeParse({ ...valid, targetHandle: 'enterprise' }).success).toBe(false);
  });

  it('rejects an unknown timing', () => {
    expect(planChangeSchema.safeParse({ ...valid, timing: 'someday' }).success).toBe(false);
  });
});
