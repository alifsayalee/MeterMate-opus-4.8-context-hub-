import { describe, expect, it } from 'vitest';
import {
  failureBlocks,
  lifecycleDoneBlocks,
  planChangedBlocks,
  planChangePreviewBlocks,
  subscriptionActiveBlocks,
  transactionStartedBlocks,
  usageRecordedBlocks,
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

  it('usageRecordedBlocks shows the period total for metered usage', () => {
    const blocks = usageRecordedBlocks({
      componentName: 'Consulting time',
      quantity: 30,
      unitName: 'minute',
      periodTotal: 90,
      recordedEvents: undefined,
    });
    const dump = textDump(blocks);
    expect(dump).toContain('Usage recorded');
    expect(dump).toContain('90 minutes');
    expect(dump).toContain('30 minutes');
  });

  it('usageRecordedBlocks shows events recorded for event-based usage', () => {
    const blocks = usageRecordedBlocks({
      componentName: 'API calls',
      quantity: 5,
      unitName: 'event',
      periodTotal: undefined,
      recordedEvents: 5,
    });
    expect(textDump(blocks)).toContain('Events recorded');
  });

  it('planChangePreviewBlocks shows from→to and a signed proration', () => {
    const blocks = planChangePreviewBlocks({
      fromName: 'Basic plan',
      toName: 'Pro plan',
      timing: 'prorate',
      proratedAdjustmentInCents: 20000,
      paymentDueInCents: 20000,
      effectiveLabel: 'Immediately',
    });
    const dump = textDump(blocks);
    expect(dump).toContain('Plan change preview');
    expect(dump).toContain('Basic plan');
    expect(dump).toContain('Pro plan');
    expect(dump).toContain('+$200.00');
  });

  it('planChangedBlocks shows a credit (negative proration) and a Maxio button', () => {
    const blocks = planChangedBlocks({
      fromName: 'Pro plan',
      toName: 'Basic plan',
      timing: 'prorate',
      proratedAdjustmentInCents: -15000,
      effectiveLabel: 'Immediately',
      maxioUrl: 'https://site.chargify.com/subscriptions/9',
    });
    const dump = textDump(blocks);
    expect(dump).toContain('Plan changed');
    expect(dump).toContain('−$150.00');
    expect(dump).toContain('https://site.chargify.com/subscriptions/9');
  });

  it('lifecycleDoneBlocks shows the state transition and reason', () => {
    const blocks = lifecycleDoneBlocks({
      fromState: 'active',
      toState: 'canceled',
      scheduledCancellation: false,
      effectiveLabel: 'Immediately',
      reasonCode: 'too_expensive',
      maxioUrl: 'https://site.chargify.com/subscriptions/9',
    });
    const dump = textDump(blocks);
    expect(dump).toContain('active → canceled');
    expect(dump).toContain('too_expensive');
  });

  it('lifecycleDoneBlocks marks a scheduled end-of-period cancellation', () => {
    const blocks = lifecycleDoneBlocks({
      fromState: 'active',
      toState: 'active',
      scheduledCancellation: true,
      effectiveLabel: '2026-07-16',
      reasonCode: null,
      maxioUrl: 'https://site.chargify.com/subscriptions/9',
    });
    const dump = textDump(blocks);
    expect(dump).toContain('canceling at period end');
    expect(dump).toContain('pending cancellation');
  });

  it('failureBlocks surfaces the error summary', () => {
    const blocks = failureBlocks('Booking', 'Product not found');
    expect(textDump(blocks)).toContain('Product not found');
    expect(textDump(blocks)).toContain('Booking failed');
  });
});
