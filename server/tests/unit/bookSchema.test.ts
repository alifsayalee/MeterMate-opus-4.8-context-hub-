import { describe, expect, it } from 'vitest';
import { bookSchema } from '../../src/schemas/book.js';

const valid = {
  sessionId: 'sess-1',
  firstName: 'Joe',
  lastName: 'Smith',
  email: 'joe@example.com',
  consultantId: 'c1',
  productHandle: 'chub-test-pro',
  collectionMethod: 'automatic',
};

describe('bookSchema', () => {
  it('accepts a valid booking', () => {
    expect(bookSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an invalid email before any external call (AC-18)', () => {
    const r = bookSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown plan handle', () => {
    expect(bookSchema.safeParse({ ...valid, productHandle: 'enterprise' }).success).toBe(false);
  });

  it('rejects an unknown consultant', () => {
    expect(bookSchema.safeParse({ ...valid, consultantId: 'cZ' }).success).toBe(false);
  });
});
