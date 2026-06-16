import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewMigrationMock = vi.fn();
const migrateMock = vi.fn();
const readSubscriptionMock = vi.fn();
const updateSubscriptionMock = vi.fn();

vi.mock('../../src/maxioClient.js', () => ({
  subscriptionProductsController: () => ({
    previewSubscriptionProductMigration: previewMigrationMock,
    migrateSubscriptionProduct: migrateMock,
  }),
  subscriptionsController: () => ({
    readSubscription: readSubscriptionMock,
    updateSubscription: updateSubscriptionMock,
  }),
  subscriptionUrl: (id: number) => `https://test-site.chargify.com/subscriptions/${id}`,
  isMaxioConfigured: () => true,
}));

import { applyPlanChange, previewPlanChange } from '../../src/services/maxioService.js';
import { MaxioServiceError } from '../../src/services/maxioErrors.js';

function subOnBasic() {
  readSubscriptionMock.mockResolvedValue({
    result: {
      subscription: {
        state: 'active',
        product: { handle: 'chub-test-basic', name: 'Basic plan' },
        currentPeriodEndsAt: '2026-07-16T00:00:00Z',
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('previewPlanChange', () => {
  it('prorate: returns the prorated numbers from the migration preview, effective immediately', async () => {
    subOnBasic();
    previewMigrationMock.mockResolvedValue({
      result: {
        migration: {
          proratedAdjustmentInCents: 20000n,
          chargeInCents: 29900n,
          creditAppliedInCents: 9900n,
          paymentDueInCents: 20000n,
        },
      },
    });

    const out = await previewPlanChange({ subscriptionId: 222, targetHandle: 'chub-test-pro', timing: 'prorate' });
    expect(out.timing).toBe('prorate');
    expect(out.fromName).toBe('Basic plan');
    expect(out.targetName).toBe('Pro plan');
    expect(out.proratedAdjustmentInCents).toBe(20000);
    expect(out.paymentDueInCents).toBe(20000);
    expect(out.effectiveDate).toBeNull();
  });

  it('at-renewal: no proration, effective at the period end, no migration preview call', async () => {
    subOnBasic();
    const out = await previewPlanChange({ subscriptionId: 222, targetHandle: 'chub-test-pro', timing: 'at-renewal' });
    expect(out.proratedAdjustmentInCents).toBe(0);
    expect(out.effectiveDate).toBe('2026-07-16T00:00:00Z');
    expect(previewMigrationMock).not.toHaveBeenCalled();
  });

  it('rejects changing to the plan the subscription is already on', async () => {
    readSubscriptionMock.mockResolvedValue({
      result: { subscription: { state: 'active', product: { handle: 'chub-test-pro', name: 'Pro plan' }, currentPeriodEndsAt: null } },
    });
    await expect(
      previewPlanChange({ subscriptionId: 222, targetHandle: 'chub-test-pro', timing: 'prorate' }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
  });

  it('rejects an unknown target handle before any API call', async () => {
    await expect(
      previewPlanChange({ subscriptionId: 222, targetHandle: 'enterprise', timing: 'prorate' }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
    expect(readSubscriptionMock).not.toHaveBeenCalled();
  });
});

describe('applyPlanChange', () => {
  it('prorate: previews then migrates, reporting the proration and new state', async () => {
    subOnBasic();
    previewMigrationMock.mockResolvedValue({ result: { migration: { proratedAdjustmentInCents: 20000n } } });
    migrateMock.mockResolvedValue({ result: { subscription: { state: 'active', product: { handle: 'chub-test-pro' } } } });

    const out = await applyPlanChange({ subscriptionId: 222, targetHandle: 'chub-test-pro', timing: 'prorate' });
    expect(migrateMock).toHaveBeenCalled();
    expect(out.toHandle).toBe('chub-test-pro');
    expect(out.proratedAdjustmentInCents).toBe(20000);
    expect(out.effectiveDate).toBeNull();
    expect(out.state).toBe('active');
    // migrate body prorates across the period.
    expect(migrateMock.mock.calls[0][1].migration.preservePeriod).toBe(true);
  });

  it('at-renewal: schedules a delayed change, no proration, effective next period', async () => {
    subOnBasic();
    updateSubscriptionMock.mockResolvedValue({ result: {} });

    const out = await applyPlanChange({ subscriptionId: 222, targetHandle: 'chub-test-pro', timing: 'at-renewal' });
    expect(updateSubscriptionMock).toHaveBeenCalledWith(222, {
      subscription: { productHandle: 'chub-test-pro', productChangeDelayed: true },
    });
    expect(migrateMock).not.toHaveBeenCalled();
    expect(out.proratedAdjustmentInCents).toBe(0);
    expect(out.effectiveDate).toBe('2026-07-16T00:00:00Z');
  });
});
