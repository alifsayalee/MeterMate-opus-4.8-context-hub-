import { ApiError } from '@maxio-com/advanced-billing-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Maxio client module so no live SDK call is made.
const createSubscriptionMock = vi.fn();
vi.mock('../../src/maxioClient.js', () => ({
  subscriptionsController: () => ({ createSubscription: createSubscriptionMock }),
  subscriptionUrl: (id: number) => `https://test-site.chargify.com/subscriptions/${id}`,
  isMaxioConfigured: () => true,
}));

import { createSubscription } from '../../src/services/maxioService.js';
import { MaxioServiceError } from '../../src/services/maxioErrors.js';

const baseInput = {
  firstName: 'Joe',
  lastName: 'Smith',
  email: 'joe@example.com',
  productHandle: 'chub-test-pro',
  collectionMethod: 'automatic' as const,
  customerReference: 'joe@example.com',
};

beforeEach(() => {
  createSubscriptionMock.mockReset();
});

describe('maxioService.createSubscription', () => {
  it('returns a normalized result on success (MRR from catalog, Maxio URL)', async () => {
    createSubscriptionMock.mockResolvedValue({
      result: {
        subscription: {
          id: 555,
          state: 'active',
          nextAssessmentAt: '2026-07-16T00:00:00Z',
          customer: { id: 88 },
        },
      },
    });

    const out = await createSubscription(baseInput);
    expect(out.subscriptionId).toBe(555);
    expect(out.state).toBe('active');
    expect(out.mrrInCents).toBe(29900); // pro price from catalog
    expect(out.customerId).toBe(88);
    expect(out.maxioUrl).toContain('/subscriptions/555');

    // Verify the request shape passed to the SDK.
    const body = createSubscriptionMock.mock.calls[0][0];
    expect(body.subscription.productHandle).toBe('chub-test-pro');
    expect(body.subscription.customerAttributes.reference).toBe('joe@example.com');
    expect(body.subscription.paymentCollectionMethod).toBe('automatic');
  });

  it('passes coupon codes through when provided', async () => {
    createSubscriptionMock.mockResolvedValue({ result: { subscription: { id: 1, state: 'active' } } });
    await createSubscription({ ...baseInput, couponCode: 'WELCOME10' });
    const body = createSubscriptionMock.mock.calls[0][0];
    expect(body.subscription.couponCodes).toEqual(['WELCOME10']);
  });

  it('throws a typed MaxioServiceError with parsed details on API error', async () => {
    const apiErr = new ApiError(
      {
        request: {},
        response: { statusCode: 422, headers: {}, body: JSON.stringify({ errors: ['Product not found'] }) },
      } as never,
      'Unprocessable Entity',
    );
    createSubscriptionMock.mockRejectedValue(apiErr);

    await expect(createSubscription(baseInput)).rejects.toBeInstanceOf(MaxioServiceError);
    await createSubscription(baseInput).catch((e: MaxioServiceError) => {
      expect(e.statusCode).toBe(422);
      expect(e.details).toContain('Product not found');
    });
  });

  it('rejects an unknown plan handle before calling the SDK', async () => {
    await expect(createSubscription({ ...baseInput, productHandle: 'enterprise' })).rejects.toBeInstanceOf(
      MaxioServiceError,
    );
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });
});
