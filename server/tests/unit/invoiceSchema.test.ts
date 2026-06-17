import { describe, expect, it } from 'vitest';
import { invoiceSchema } from '../../src/schemas/invoices.js';

const valid = {
  sessionId: 's1',
  txnRef: 'txn_x',
  lineItems: [{ title: 'Onboarding', quantity: 1, unitPrice: '500.00' }],
  sendEmail: true,
};

describe('invoiceSchema', () => {
  it('accepts a valid invoice request', () => {
    expect(invoiceSchema.safeParse(valid).success).toBe(true);
  });

  it('requires at least one line item', () => {
    expect(invoiceSchema.safeParse({ ...valid, lineItems: [] }).success).toBe(false);
  });

  it('rejects a non-decimal unitPrice', () => {
    expect(invoiceSchema.safeParse({ ...valid, lineItems: [{ title: 'x', quantity: 1, unitPrice: 'free' }] }).success).toBe(false);
  });

  it('requires sendEmail to be a boolean', () => {
    expect(invoiceSchema.safeParse({ ...valid, sendEmail: 'yes' }).success).toBe(false);
  });
});
