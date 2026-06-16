import { describe, expect, it } from 'vitest';
import {
  failureBlocks,
  subscriptionActiveBlocks,
  transactionStartedBlocks,
} from '../../src/slack/blocks.js';

function textDump(blocks: unknown[]): string {
  return JSON.stringify(blocks);
}

describe('block builders', () => {
  it('transactionStartedBlocks includes consultant + client', () => {
    const blocks = transactionStartedBlocks({ consultantName: 'Alex', clientName: 'Joe', type: 'subscription' });
    expect(blocks[0]).toMatchObject({ type: 'header' });
    expect(textDump(blocks)).toContain('Alex');
    expect(textDump(blocks)).toContain('Joe');
  });

  it('subscriptionActiveBlocks shows MRR and a View-in-Maxio button URL', () => {
    const blocks = subscriptionActiveBlocks({
      customerName: 'Joe Smith',
      planName: 'Pro plan',
      mrrInCents: 29900,
      state: 'active',
      nextAssessmentAt: '2026-07-16',
      maxioUrl: 'https://site.chargify.com/subscriptions/123',
    });
    const dump = textDump(blocks);
    expect(dump).toContain('$299.00');
    expect(dump).toContain('https://site.chargify.com/subscriptions/123');
    const action = blocks.find((b) => (b as { type: string }).type === 'actions') as
      | { elements: Array<{ url: string }> }
      | undefined;
    expect(action?.elements[0]?.url).toBe('https://site.chargify.com/subscriptions/123');
  });

  it('failureBlocks surfaces the error summary', () => {
    const blocks = failureBlocks('Booking', 'Product not found');
    expect(textDump(blocks)).toContain('Product not found');
    expect(textDump(blocks)).toContain('Booking failed');
  });
});
