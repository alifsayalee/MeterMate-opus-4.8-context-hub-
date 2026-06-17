import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSubscriptionMock = vi.fn();
const listInvoicesMock = vi.fn();
const listEventsMock = vi.fn();

vi.mock('../../src/maxioClient.js', () => ({
  subscriptionsController: () => ({ readSubscription: readSubscriptionMock }),
  invoicesController: () => ({ listInvoices: listInvoicesMock }),
  eventsController: () => ({ listEvents: listEventsMock }),
  isMaxioConfigured: () => true,
}));

import { buildDigest } from '../../src/services/maxioService.js';

const NOW_ISO = new Date().toISOString();
const OLD_ISO = '2020-01-01T00:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();

  readSubscriptionMock.mockImplementation((id: number) => {
    if (id === 101) {
      return Promise.resolve({
        result: { subscription: { id: 101, state: 'active', product: { handle: 'chub-test-pro' }, createdAt: NOW_ISO, canceledAt: null } },
      });
    }
    // 102: churned this window
    return Promise.resolve({
      result: { subscription: { id: 102, state: 'canceled', product: { handle: 'chub-test-basic' }, createdAt: OLD_ISO, canceledAt: NOW_ISO } },
    });
  });

  listInvoicesMock.mockResolvedValue({
    result: {
      invoices: [
        { subscriptionId: 101, status: 'open', totalAmount: '99.00', dueDate: '2020-01-01' }, // overdue, in scope
        { subscriptionId: 999, status: 'open', totalAmount: '50.00', dueDate: '2099-01-01' }, // out of scope
      ],
    },
  });

  listEventsMock.mockResolvedValue({
    result: [
      { event: { subscriptionId: 101 } },
      { event: { subscriptionId: 102 } },
      { event: { subscriptionId: 999 } }, // out of scope
    ],
  });
});

describe('buildDigest', () => {
  it('aggregates subscriptions, invoices, and activity scoped to the consultant', async () => {
    const d = await buildDigest({
      consultantId: 'c1',
      consultantName: 'Alex Rivera',
      subscriptionIds: [101, 102],
      windowDays: 30,
    });

    expect(d.totalSubscriptions).toBe(2);
    expect(d.activeCount).toBe(1);
    expect(d.canceledCount).toBe(1);
    expect(d.mrrInCents).toBe(29900); // only the active pro sub
    expect(d.newSignups).toBe(1); // sub 101 created in-window
    expect(d.churned).toBe(1); // sub 102 canceled in-window
    expect(d.openInvoices).toBe(1); // only the in-scope open invoice
    expect(d.overdueInvoices).toBe(1);
    expect(d.openInvoiceAmountCents).toBe(9900);
    expect(d.recentActivity).toBe(2); // events for 101 + 102, not 999
  });

  it('returns zeros (and makes no Maxio calls) when the consultant has no subscriptions', async () => {
    const d = await buildDigest({ consultantId: 'c2', consultantName: 'Jordan Lee', subscriptionIds: [], windowDays: 30 });
    expect(d.totalSubscriptions).toBe(0);
    expect(d.activeCount).toBe(0);
    expect(d.mrrInCents).toBe(0);
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listEventsMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully when a subscription read fails', async () => {
    readSubscriptionMock.mockRejectedValueOnce(new Error('boom'));
    const d = await buildDigest({ consultantId: 'c1', consultantName: 'Alex', subscriptionIds: [101], windowDays: 30 });
    // The failed read contributes zero; the digest still returns.
    expect(d.totalSubscriptions).toBe(1);
    expect(d.activeCount).toBe(0);
  });
});
