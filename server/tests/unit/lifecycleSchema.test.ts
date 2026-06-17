import { describe, expect, it } from 'vitest';
import { lifecycleSchema } from '../../src/schemas/lifecycle.js';

const base = { sessionId: 's1', txnRef: 'txn_x' };

describe('lifecycleSchema', () => {
  it('accepts pause/resume/reactivate without cancelType', () => {
    expect(lifecycleSchema.safeParse({ ...base, action: 'pause' }).success).toBe(true);
    expect(lifecycleSchema.safeParse({ ...base, action: 'resume' }).success).toBe(true);
    expect(lifecycleSchema.safeParse({ ...base, action: 'reactivate' }).success).toBe(true);
  });

  it('requires cancelType when action is cancel', () => {
    expect(lifecycleSchema.safeParse({ ...base, action: 'cancel' }).success).toBe(false);
    expect(lifecycleSchema.safeParse({ ...base, action: 'cancel', cancelType: 'immediate' }).success).toBe(true);
    expect(lifecycleSchema.safeParse({ ...base, action: 'cancel', cancelType: 'end-of-period' }).success).toBe(true);
  });

  it('rejects an unknown action', () => {
    expect(lifecycleSchema.safeParse({ ...base, action: 'archive' }).success).toBe(false);
  });
});
