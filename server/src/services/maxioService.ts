import {
  CollectionMethod,
  type CreateSubscriptionRequest,
  type CreateUsageRequest,
  type EBBEvent,
} from '@maxio-com/advanced-billing-sdk';
import { COMPONENTS, getPlan } from '../catalog.js';
import { createLogger } from '../logger.js';
import {
  componentsController,
  subscriptionComponentsController,
  subscriptionsController,
  subscriptionUrl,
} from '../maxioClient.js';
import type {
  CatalogComponent,
  CollectionMethodValue,
  SubscriptionResult,
  UsageResult,
} from '../types.js';
import { MaxioServiceError, normalizeMaxioError } from './maxioErrors.js';

/** Max events ingestible in one bulk call (Maxio caps at 1000). */
const MAX_EVENTS_PER_CALL = 1000;

/**
 * Cache of component handle -> numeric Maxio component id. Component ids are
 * stable per site, so once resolved we reuse the id for every subsequent usage
 * call without another lookup.
 */
const componentIdCache = new Map<string, number>();

/**
 * Resolves a metered component's numeric id from its handle at runtime by
 * reading the subscription's components (chub: listSubscriptionComponents).
 * Avoids hardcoding ids in config. Results are cached by handle.
 */
async function resolveComponentId(subscriptionId: number, handle: string): Promise<number> {
  const cached = componentIdCache.get(handle);
  if (cached != null) return cached;

  const controller = subscriptionComponentsController();
  const { result } = await controller.listSubscriptionComponents({ subscriptionId });
  for (const entry of result) {
    const c = entry.component;
    const id = c?.componentId ?? c?.id;
    if (c?.componentHandle && id != null) {
      componentIdCache.set(c.componentHandle, id);
    }
  }

  const found = componentIdCache.get(handle);
  if (found == null) {
    throw new MaxioServiceError(
      `Component "${handle}" is not available on subscription ${subscriptionId}`,
      404,
      ['Ensure the component exists in the product family and is allocated to the subscription'],
    );
  }
  log.info(`Resolved component "${handle}" -> id ${found}`);
  return found;
}

/** Test-only: clear the resolved-component-id cache. */
export function _resetComponentCache(): void {
  componentIdCache.clear();
}

export interface SiteComponent {
  handle: string | null;
  id: number | undefined;
  name: string | undefined;
  kind: string | undefined;
}

export interface ComponentCheckResult {
  available: SiteComponent[];
  matched: string[];
  missing: string[];
}

/**
 * Startup check: lists the components that actually exist on the Maxio site
 * (chub: listComponents) and compares them against the seeded catalog handles.
 * Returns the available handles (so the operator can see what's there) and any
 * catalog handles missing from the site. Also pre-warms the handle->id cache
 * for matched components so UC2 metered usage needs no further lookup.
 */
export async function verifyCatalogComponents(): Promise<ComponentCheckResult> {
  const controller = componentsController();
  const { result } = await controller.listComponents({ perPage: 200 });

  const available: SiteComponent[] = result.map((r) => ({
    handle: r.component.handle ?? null,
    id: r.component.id,
    name: r.component.name,
    kind: r.component.kind,
  }));

  const siteHandles = new Set(
    available.map((a) => a.handle).filter((h): h is string => Boolean(h)),
  );

  // Pre-warm the cache for handles we can match.
  for (const c of available) {
    if (c.handle && c.id != null) componentIdCache.set(c.handle, c.id);
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const c of COMPONENTS) {
    if (siteHandles.has(c.handle)) matched.push(c.handle);
    else missing.push(c.handle);
  }

  return { available, matched, missing };
}

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

export interface RecordUsageInput {
  subscriptionId: number;
  component: CatalogComponent;
  quantity: number;
  memo?: string;
  /** ISO-8601 timestamp for event-based usage; defaults to now. */
  timestamp?: string;
}

/**
 * UC2 — record consumption against a component. Dispatches on the cached
 * component kind:
 *  - metered: createUsage(quantity + memo), then listUsages to read the running
 *    period total for reconciliation.
 *  - event-based: record `quantity` timestamped events into the apiHandle
 *    stream (bulk for >1). Maxio doesn't expose event usage via listUsages, so
 *    we report the number of events ingested instead of a period total.
 */
export async function recordUsage(input: RecordUsageInput): Promise<UsageResult> {
  const { component, quantity } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new MaxioServiceError('Quantity must be a positive integer', 400, []);
  }

  const base = {
    componentHandle: component.handle,
    componentName: component.name,
    kind: component.kind,
    quantity,
    unitName: component.unitName,
    accruesToNextInvoice: true as const,
  };

  try {
    const controller = subscriptionComponentsController();

    if (component.kind === 'metered') {
      // Prefer an explicit configured id; otherwise resolve it from the handle
      // at runtime (no hardcoded id required).
      const componentId =
        component.maxioComponentId ??
        (await resolveComponentId(input.subscriptionId, component.handle));

      const body: CreateUsageRequest = {
        usage: {
          quantity,
          ...(input.memo ? { memo: input.memo } : {}),
        },
      };

      log.info(`Recording ${quantity} metered unit(s) on component ${componentId} for sub ${input.subscriptionId}`);
      await controller.createUsage(input.subscriptionId, componentId, body);

      // Read back the running period total for reconciliation.
      let periodTotal: number | undefined;
      try {
        const { result } = await controller.listUsages({
          subscriptionIdOrReference: input.subscriptionId,
          componentId,
          perPage: 200,
        });
        periodTotal = result.reduce((sum, u) => sum + Number(u.usage?.quantity ?? 0), 0);
      } catch (readErr) {
        // Reading back is best-effort; the record itself succeeded.
        log.warn('listUsages read-back failed; reporting without period total', readErr);
      }

      return { ...base, periodTotal, recordedEvents: undefined };
    }

    // Event-based: record `quantity` events into the apiHandle stream.
    if (quantity > MAX_EVENTS_PER_CALL) {
      throw new MaxioServiceError(
        `Event-based usage is limited to ${MAX_EVENTS_PER_CALL} events per request`,
        400,
        [],
      );
    }

    const apiHandle = component.handle;
    const timestamp = input.timestamp ?? new Date().toISOString();
    const makeEvent = (): EBBEvent => ({
      chargify: { subscriptionId: input.subscriptionId, timestamp },
    });

    log.info(`Recording ${quantity} event(s) into stream "${apiHandle}" for sub ${input.subscriptionId}`);
    if (quantity === 1) {
      await controller.recordEvent(apiHandle, undefined, makeEvent());
    } else {
      const events: EBBEvent[] = Array.from({ length: quantity }, makeEvent);
      await controller.bulkRecordEvents(apiHandle, undefined, events);
    }

    return { ...base, periodTotal: undefined, recordedEvents: quantity };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, 'recordUsage');

    // A 404 here means the component isn't allocated to this subscription —
    // surface a clear, actionable message rather than a bare "Not Found".
    if (normalized.statusCode === 404) {
      const clear = new MaxioServiceError(
        `Component "${component.handle}" is not available on subscription ${input.subscriptionId}. ` +
          `Allocate the "${component.name}" component to this subscription's product in Maxio, then retry.`,
        404,
        normalized.details,
      );
      log.error(clear.message);
      throw clear;
    }

    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
}
