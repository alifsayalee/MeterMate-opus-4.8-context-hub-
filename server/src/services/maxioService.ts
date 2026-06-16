import {
  CollectionMethod,
  type CreateSubscriptionRequest,
} from '@maxio-com/advanced-billing-sdk';
import { getPlan } from '../catalog.js';
import { createLogger } from '../logger.js';
import { subscriptionsController, subscriptionUrl } from '../maxioClient.js';
import type { CollectionMethodValue, SubscriptionResult } from '../types.js';
import { MaxioServiceError, normalizeMaxioError } from './maxioErrors.js';

/**
 * maxioService — one function per use case. Wraps the Maxio SDK, normalizes
 * results into MeterMate domain types, and throws typed MaxioServiceError on
 * failure. No Express/Slack imports here so it stays unit-testable in isolation.
 */
const log = createLogger('maxioService');

export interface CreateSubscriptionInput {
  firstName: string;
  lastName: string;
  email: string;
  productHandle: string;
  collectionMethod: CollectionMethodValue;
  couponCode?: string;
  /** Stable customer reference for idempotency (we use the client email). */
  customerReference: string;
}

/**
 * UC1 — create a subscription, creating the customer inline from the submitted
 * name/email. Reads back state, MRR (the seeded plan price), and next
 * assessment date. Throws MaxioServiceError on any failure.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionResult> {
  const plan = getPlan(input.productHandle);
  if (!plan) {
    // Guard before any network call: an unknown handle is a client error.
    throw new MaxioServiceError(
      `Unknown plan handle "${input.productHandle}"`,
      400,
      [`Valid handles: see /api/products`],
    );
  }

  const collectionMethod =
    input.collectionMethod === 'remittance'
      ? CollectionMethod.Remittance
      : CollectionMethod.Automatic;

  const body: CreateSubscriptionRequest = {
    subscription: {
      productHandle: input.productHandle,
      customerAttributes: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        reference: input.customerReference,
      },
      paymentCollectionMethod: collectionMethod,
      ...(input.couponCode ? { couponCodes: [input.couponCode] } : {}),
    },
  };

  log.info(`Creating subscription on "${input.productHandle}" for ${input.email}`);

  try {
    const controller = subscriptionsController();
    const { result } = await controller.createSubscription(body);
    const sub = result.subscription;
    if (!sub || sub.id == null) {
      throw new MaxioServiceError('Maxio returned no subscription', undefined, []);
    }

    const subscriptionId = Number(sub.id);
    log.info(`Subscription ${subscriptionId} created in state "${sub.state}"`);

    return {
      subscriptionId,
      customerId: sub.customer?.id != null ? Number(sub.customer.id) : undefined,
      state: String(sub.state ?? 'unknown'),
      planHandle: plan.handle,
      planName: plan.name,
      // MRR = the seeded recurring plan price (authoritative in our catalog).
      mrrInCents: plan.priceInCents,
      nextAssessmentAt: sub.nextAssessmentAt ?? undefined,
      collectionMethod: input.collectionMethod,
      maxioUrl: subscriptionUrl(subscriptionId),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, 'createSubscription');
    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
}
