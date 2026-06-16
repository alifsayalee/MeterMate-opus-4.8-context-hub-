import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUsageMock = vi.fn();
const listUsagesMock = vi.fn();
const recordEventMock = vi.fn();
const bulkRecordEventsMock = vi.fn();
const listSubscriptionComponentsMock = vi.fn();
const listComponentsMock = vi.fn();

vi.mock('../../src/maxioClient.js', () => ({
  subscriptionComponentsController: () => ({
    createUsage: createUsageMock,
    listUsages: listUsagesMock,
    recordEvent: recordEventMock,
    bulkRecordEvents: bulkRecordEventsMock,
    listSubscriptionComponents: listSubscriptionComponentsMock,
  }),
  componentsController: () => ({ listComponents: listComponentsMock }),
  subscriptionsController: () => ({}),
  subscriptionUrl: (id: number) => `https://test-site.chargify.com/subscriptions/${id}`,
  isMaxioConfigured: () => true,
}));

import { ApiError } from '@maxio-com/advanced-billing-sdk';
import { recordUsage, verifyCatalogComponents, _resetComponentCache } from '../../src/services/maxioService.js';
import { MaxioServiceError } from '../../src/services/maxioErrors.js';
import type { CatalogComponent } from '../../src/types.js';

const metered: CatalogComponent = {
  handle: 'consulting-minutes',
  name: 'Consulting time',
  kind: 'metered',
  unitPriceInCents: 200,
  unitName: 'minute',
  maxioComponentId: 144,
};

const eventBased: CatalogComponent = {
  handle: 'api-calls',
  name: 'API calls',
  kind: 'event-based',
  unitPriceInCents: 1,
  unitName: 'event',
};

const meteredNoId: CatalogComponent = { ...metered, maxioComponentId: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  _resetComponentCache();
});

describe('maxioService.recordUsage — metered', () => {
  it('creates usage and reads back the running period total', async () => {
    createUsageMock.mockResolvedValue({ result: { usage: { id: 1, quantity: 30 } } });
    listUsagesMock.mockResolvedValue({ result: [{ usage: { quantity: 30 } }, { usage: { quantity: 60 } }] });

    const out = await recordUsage({ subscriptionId: 234, component: metered, quantity: 30, memo: 'call' });

    expect(out.kind).toBe('metered');
    expect(out.quantity).toBe(30);
    expect(out.periodTotal).toBe(90);
    expect(out.recordedEvents).toBeUndefined();
    expect(createUsageMock).toHaveBeenCalledWith(234, 144, { usage: { quantity: 30, memo: 'call' } });
  });

  it('still succeeds when the read-back fails (record is the source of truth)', async () => {
    createUsageMock.mockResolvedValue({ result: { usage: { id: 1 } } });
    listUsagesMock.mockRejectedValue(new Error('rate limited'));
    const out = await recordUsage({ subscriptionId: 234, component: metered, quantity: 10 });
    expect(out.periodTotal).toBeUndefined();
    expect(out.quantity).toBe(10);
  });

  it('resolves the component id from its handle at runtime when no id is configured', async () => {
    listSubscriptionComponentsMock.mockResolvedValue({
      result: [
        { component: { componentId: 999, componentHandle: 'consulting-minutes', kind: 'metered' } },
        { component: { componentId: 1000, componentHandle: 'something-else' } },
      ],
    });
    createUsageMock.mockResolvedValue({ result: { usage: { id: 1 } } });
    listUsagesMock.mockResolvedValue({ result: [{ usage: { quantity: 15 } }] });

    const out = await recordUsage({ subscriptionId: 234, component: meteredNoId, quantity: 15 });

    expect(listSubscriptionComponentsMock).toHaveBeenCalledWith({ subscriptionId: 234 });
    // createUsage used the resolved id (999), not a hardcoded one.
    expect(createUsageMock).toHaveBeenCalledWith(234, 999, { usage: { quantity: 15 } });
    expect(out.periodTotal).toBe(15);
  });

  it('caches the resolved id so a second call does not re-list components', async () => {
    listSubscriptionComponentsMock.mockResolvedValue({
      result: [{ component: { componentId: 999, componentHandle: 'consulting-minutes' } }],
    });
    createUsageMock.mockResolvedValue({ result: { usage: { id: 1 } } });
    listUsagesMock.mockResolvedValue({ result: [] });

    await recordUsage({ subscriptionId: 234, component: meteredNoId, quantity: 5 });
    await recordUsage({ subscriptionId: 234, component: meteredNoId, quantity: 5 });
    expect(listSubscriptionComponentsMock).toHaveBeenCalledTimes(1);
  });

  it('turns a 404 from createUsage into a clear "not available on subscription" message', async () => {
    const apiErr = new ApiError(
      { request: {}, response: { statusCode: 404, headers: {}, body: '' } } as never,
      '',
    );
    createUsageMock.mockRejectedValue(apiErr);

    await recordUsage({ subscriptionId: 321, component: metered, quantity: 10 }).catch(
      (e: MaxioServiceError) => {
        expect(e.statusCode).toBe(404);
        expect(e.message).toContain('not available on subscription 321');
        expect(e.message).toContain('consulting-minutes');
        expect(e.message.length).toBeGreaterThan(20); // never empty
      },
    );
  });

  it('throws a clear error when the handle is not present on the subscription', async () => {
    listSubscriptionComponentsMock.mockResolvedValue({
      result: [{ component: { componentId: 1000, componentHandle: 'other' } }],
    });
    await expect(
      recordUsage({ subscriptionId: 234, component: meteredNoId, quantity: 5 }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
    expect(createUsageMock).not.toHaveBeenCalled();
  });
});

describe('maxioService.recordUsage — event-based', () => {
  it('records a single event via recordEvent', async () => {
    recordEventMock.mockResolvedValue(undefined);
    const out = await recordUsage({
      subscriptionId: 7,
      component: eventBased,
      quantity: 1,
      timestamp: '2026-06-16T17:45:50Z',
    });
    expect(out.recordedEvents).toBe(1);
    expect(out.periodTotal).toBeUndefined();
    expect(recordEventMock).toHaveBeenCalledWith('api-calls', undefined, {
      chargify: { subscriptionId: 7, timestamp: '2026-06-16T17:45:50Z' },
    });
    expect(bulkRecordEventsMock).not.toHaveBeenCalled();
  });

  it('records many events via bulkRecordEvents', async () => {
    bulkRecordEventsMock.mockResolvedValue(undefined);
    const out = await recordUsage({ subscriptionId: 7, component: eventBased, quantity: 3 });
    expect(out.recordedEvents).toBe(3);
    const [handle, store, events] = bulkRecordEventsMock.mock.calls[0];
    expect(handle).toBe('api-calls');
    expect(store).toBeUndefined();
    expect(events).toHaveLength(3);
  });

  it('rejects more than 1000 events in one request', async () => {
    await expect(
      recordUsage({ subscriptionId: 7, component: eventBased, quantity: 1001 }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
  });

  it('rejects a non-positive quantity before any call', async () => {
    await expect(
      recordUsage({ subscriptionId: 7, component: eventBased, quantity: 0 }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
  });
});

describe('verifyCatalogComponents', () => {
  it('reports available handles and flags catalog handles missing from the site', async () => {
    listComponentsMock.mockResolvedValue({
      result: [
        { component: { id: 10, handle: 'consulting-time', name: 'Consulting', kind: 'metered' } },
        { component: { id: 11, handle: 'api-calls', name: 'API calls', kind: 'on_off' } },
      ],
    });

    const out = await verifyCatalogComponents();
    expect(out.available.map((a) => a.handle)).toEqual(['consulting-time', 'api-calls']);
    // catalog has 'chub-test-minutes' (not in this mocked site list) and 'api-calls' (on site)
    expect(out.matched).toContain('api-calls');
    expect(out.missing).toContain('chub-test-minutes');
  });

  it('pre-warms the id cache so a matched metered component skips re-listing', async () => {
    listComponentsMock.mockResolvedValue({
      result: [{ component: { id: 555, handle: 'consulting-minutes', name: 'Consulting time', kind: 'metered' } }],
    });
    await verifyCatalogComponents();

    createUsageMock.mockResolvedValue({ result: { usage: { id: 1 } } });
    listUsagesMock.mockResolvedValue({ result: [] });
    await recordUsage({ subscriptionId: 9, component: meteredNoId, quantity: 5 });

    // Resolved from the pre-warmed cache; no subscription-component listing.
    expect(listSubscriptionComponentsMock).not.toHaveBeenCalled();
    expect(createUsageMock).toHaveBeenCalledWith(9, 555, { usage: { quantity: 5 } });
  });
});
