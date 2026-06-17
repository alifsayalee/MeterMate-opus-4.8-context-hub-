import { describe, expect, it } from 'vitest';
import { digestSchema } from '../../src/schemas/digest.js';

const valid = { sessionId: 's1', consultantId: 'c1' };

describe('digestSchema', () => {
  it('accepts a valid request without windowDays', () => {
    expect(digestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a windowDays within range', () => {
    expect(digestSchema.safeParse({ ...valid, windowDays: 7 }).success).toBe(true);
  });

  it('rejects an unknown consultant', () => {
    expect(digestSchema.safeParse({ ...valid, consultantId: 'cZ' }).success).toBe(false);
  });

  it('rejects an out-of-range windowDays', () => {
    expect(digestSchema.safeParse({ ...valid, windowDays: 0 }).success).toBe(false);
    expect(digestSchema.safeParse({ ...valid, windowDays: 999 }).success).toBe(false);
  });
});
