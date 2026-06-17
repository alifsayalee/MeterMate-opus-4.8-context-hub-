import { beforeEach, describe, expect, it, vi } from 'vitest';

const pauseMock = vi.fn();
const resumeMock = vi.fn();
const cancelMock = vi.fn();
const initiateDelayedMock = vi.fn();
const reactivateMock = vi.fn();
const readSubscriptionMock = vi.fn();

vi.mock('../../src/maxioClient.js', () => ({
  subscriptionStatusController: () => ({
    pauseSubscription: pauseMock,
    resumeSubscription: resumeMock,
    cancelSubscription: cancelMock,
    initiateDelayedCancellation: initiateDelayedMock,
    reactivateSubscription: reactivateMock,
  }),
  subscriptionsController: () => ({ readSubscription: readSubscriptionMock }),
  subscriptionUrl: (id: number) => `https://test-site.chargify.com/subscriptions/${id}`,
  isMaxioConfigured: () => true,
}));

import { lifecycleAction } from '../../src/services/maxioService.js';

function sub(state: string, currentPeriodEndsAt: string | null = '2026-07-16T00:00:00Z') {
  return { result: { subscription: { state, product: { handle: 'chub-test-basic' }, currentPeriodEndsAt } } };
}

/** readSubscriptionSummary is called before and after the action. */
function readSequence(before: string, after: string, periodEnd: string | null = '2026-07-16T00:00:00Z') {
  readSubscriptionMock.mockResolvedValueOnce(sub(before, periodEnd)).mockResolvedValueOnce(sub(after, periodEnd));
}

beforeEach(() => {
  vi.clearAllMocks();
  pauseMock.mockResolvedValue({ result: {} });
  resumeMock.mockResolvedValue({ result: {} });
  cancelMock.mockResolvedValue({ result: {} });
  initiateDelayedMock.mockResolvedValue({ result: {} });
  reactivateMock.mockResolvedValue({ result: {} });
});

describe('lifecycleAction', () => {
  it('pause → on_hold', async () => {
    readSequence('active', 'on_hold');
    const out = await lifecycleAction({ subscriptionId: 222, action: 'pause' });
    expect(pauseMock).toHaveBeenCalledWith(222);
    expect(out.fromState).toBe('active');
    expect(out.toState).toBe('on_hold');
    expect(out.scheduledCancellation).toBe(false);
    expect(out.effectiveDate).toBeNull();
  });

  it('resume → active', async () => {
    readSequence('on_hold', 'active');
    const out = await lifecycleAction({ subscriptionId: 222, action: 'resume' });
    expect(resumeMock).toHaveBeenCalledWith(222);
    expect(out.toState).toBe('active');
  });

  it('cancel immediate → canceled (no delayed call)', async () => {
    readSequence('active', 'canceled');
    const out = await lifecycleAction({ subscriptionId: 222, action: 'cancel', cancelType: 'immediate' });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(initiateDelayedMock).not.toHaveBeenCalled();
    expect(out.cancelType).toBe('immediate');
    expect(out.toState).toBe('canceled');
    expect(out.scheduledCancellation).toBe(false);
  });

  it('cancel end-of-period → delayed cancellation, effective at period end', async () => {
    readSequence('active', 'active');
    const out = await lifecycleAction({ subscriptionId: 222, action: 'cancel', cancelType: 'end-of-period' });
    expect(initiateDelayedMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(out.scheduledCancellation).toBe(true);
    expect(out.effectiveDate).toBe('2026-07-16T00:00:00Z');
  });

  it('cancel with reason code passes a CancellationRequest body', async () => {
    readSequence('active', 'canceled');
    await lifecycleAction({ subscriptionId: 222, action: 'cancel', cancelType: 'immediate', reasonCode: 'too_expensive' });
    expect(cancelMock).toHaveBeenCalledWith(222, {
      subscription: { reasonCode: 'too_expensive', cancellationMessage: 'Canceled via MeterMate' },
    });
  });

  it('reactivate → active', async () => {
    readSequence('canceled', 'active');
    const out = await lifecycleAction({ subscriptionId: 222, action: 'reactivate' });
    expect(reactivateMock).toHaveBeenCalledWith(222);
    expect(out.toState).toBe('active');
    expect(out.cancelType).toBeNull();
  });
});
