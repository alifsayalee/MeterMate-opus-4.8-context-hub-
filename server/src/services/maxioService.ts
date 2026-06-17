import {
  CollectionMethod,
  CreateInvoiceStatus,
  FailedPaymentAction,
  type CreateInvoiceRequest,
  type CreateSubscriptionRequest,
  type CreateUsageRequest,
  type EBBEvent,
  type CancellationRequest,
  type SendInvoiceRequest,
  type SubscriptionMigrationPreviewRequest,
  type SubscriptionProductMigrationRequest,
  type UpdateSubscriptionRequest,
} from '@maxio-com/advanced-billing-sdk';
import { COMPONENTS, getPlan } from '../catalog.js';
import { createLogger } from '../logger.js';
import {
  componentsController,
  invoicesController,
  subscriptionComponentsController,
  subscriptionProductsController,
  subscriptionsController,
  subscriptionStatusController,
  subscriptionUrl,
} from '../maxioClient.js';
import type {
  CancelType,
  CatalogComponent,
  CollectionMethodValue,
  InvoiceResultData,
  LifecycleAction,
  LifecycleResult,
  PlanChangePreview,
  PlanChangeResult,
  PlanChangeTiming,
  SubscriptionResult,
  UsageResult,
} from '../types.js';
import { MaxioServiceError, normalizeMaxioError } from './maxioErrors.js';

/** Safely coerces a Maxio bigint cents value to a JS number. */
function centsToNumber(v: bigint | number | null | undefined): number {
  return v != null ? Number(v) : 0;
}

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

interface SubscriptionSummary {
  state: string;
  productHandle: string | null;
  productName: string | null;
  currentPeriodEndsAt: string | null;
}

/** Reads the current plan + period for a subscription (UC3 context). */
async function readSubscriptionSummary(subscriptionId: number): Promise<SubscriptionSummary> {
  const { result } = await subscriptionsController().readSubscription(subscriptionId);
  const sub = result.subscription;
  return {
    state: String(sub?.state ?? 'unknown'),
    productHandle: sub?.product?.handle ?? null,
    productName: sub?.product?.name ?? null,
    currentPeriodEndsAt: sub?.currentPeriodEndsAt ?? null,
  };
}

function resolvePlanName(handle: string | null, fallback: string | null): string | null {
  if (!handle) return fallback;
  return getPlan(handle)?.name ?? fallback;
}

/** Case-insensitive handle comparison; tolerant of null current handle. */
function isSamePlan(currentHandle: string | null, targetHandle: string): boolean {
  return currentHandle != null && currentHandle.toLowerCase() === targetHandle.toLowerCase();
}

export interface PlanChangeInput {
  subscriptionId: number;
  targetHandle: string;
  timing: PlanChangeTiming;
}

/**
 * UC3 — preview the prorated cost of a plan change without committing.
 *  - prorate: uses previewSubscriptionProductMigration (the same prorated
 *    mechanism the commit applies), effective immediately.
 *  - at-renewal: no proration; effective at the current period end.
 */
export async function previewPlanChange(input: PlanChangeInput): Promise<PlanChangePreview> {
  const target = getPlan(input.targetHandle);
  if (!target) {
    throw new MaxioServiceError(`Unknown plan handle "${input.targetHandle}"`, 400, []);
  }

  try {
    const current = await readSubscriptionSummary(input.subscriptionId);
    const fromName = resolvePlanName(current.productHandle, current.productName);

    if (isSamePlan(current.productHandle, input.targetHandle)) {
      throw new MaxioServiceError(
        `Subscription is already on "${target.name}"`,
        400,
        [],
      );
    }

    if (input.timing === 'at-renewal') {
      // No proration; takes effect next period.
      return {
        fromHandle: current.productHandle,
        fromName,
        targetHandle: target.handle,
        targetName: target.name,
        timing: 'at-renewal',
        proratedAdjustmentInCents: 0,
        chargeInCents: 0,
        creditAppliedInCents: 0,
        paymentDueInCents: 0,
        effectiveDate: current.currentPeriodEndsAt,
      };
    }

    const body: SubscriptionMigrationPreviewRequest = {
      migration: {
        productHandle: target.handle,
        includeTrial: false,
        includeInitialCharge: false,
        includeCoupons: true,
        preservePeriod: true,
      },
    };

    const { result } = await subscriptionProductsController().previewSubscriptionProductMigration(
      input.subscriptionId,
      body,
    );
    const m = result.migration;

    return {
      fromHandle: current.productHandle,
      fromName,
      targetHandle: target.handle,
      targetName: target.name,
      timing: 'prorate',
      proratedAdjustmentInCents: centsToNumber(m.proratedAdjustmentInCents),
      chargeInCents: centsToNumber(m.chargeInCents),
      creditAppliedInCents: centsToNumber(m.creditAppliedInCents),
      paymentDueInCents: centsToNumber(m.paymentDueInCents),
      effectiveDate: null, // immediate
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, 'previewPlanChange');
    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
}

/**
 * UC3 — commit a plan change.
 *  - prorate: previews to capture the proration figure, then migrates now with
 *    preservePeriod (immediate prorated change).
 *  - at-renewal: schedules a non-prorated change via updateSubscription with
 *    productChangeDelayed, effective at the next renewal.
 */
export async function applyPlanChange(input: PlanChangeInput): Promise<PlanChangeResult> {
  const target = getPlan(input.targetHandle);
  if (!target) {
    throw new MaxioServiceError(`Unknown plan handle "${input.targetHandle}"`, 400, []);
  }

  try {
    const current = await readSubscriptionSummary(input.subscriptionId);
    const fromName = resolvePlanName(current.productHandle, current.productName);

    if (isSamePlan(current.productHandle, input.targetHandle)) {
      throw new MaxioServiceError(`Subscription is already on "${target.name}"`, 400, []);
    }

    if (input.timing === 'at-renewal') {
      const body: UpdateSubscriptionRequest = {
        subscription: {
          productHandle: target.handle,
          productChangeDelayed: true,
        },
      };
      await subscriptionsController().updateSubscription(input.subscriptionId, body);
      log.info(`Scheduled plan change to "${target.handle}" at renewal for sub ${input.subscriptionId}`);

      return {
        fromHandle: current.productHandle,
        fromName,
        toHandle: target.handle,
        toName: target.name,
        timing: 'at-renewal',
        proratedAdjustmentInCents: 0,
        effectiveDate: current.currentPeriodEndsAt,
        state: current.state,
        maxioUrl: subscriptionUrl(input.subscriptionId),
      };
    }

    // prorate now: capture the proration figure, then migrate.
    const previewBody: SubscriptionMigrationPreviewRequest = {
      migration: {
        productHandle: target.handle,
        includeTrial: false,
        includeInitialCharge: false,
        includeCoupons: true,
        preservePeriod: true,
      },
    };
    const products = subscriptionProductsController();
    const { result: preview } = await products.previewSubscriptionProductMigration(
      input.subscriptionId,
      previewBody,
    );

    const migrateBody: SubscriptionProductMigrationRequest = {
      migration: {
        productHandle: target.handle,
        includeTrial: false,
        includeInitialCharge: false,
        includeCoupons: true,
        preservePeriod: true,
      },
    };
    const { result: migrated } = await products.migrateSubscriptionProduct(
      input.subscriptionId,
      migrateBody,
    );
    log.info(`Migrated sub ${input.subscriptionId} to "${target.handle}" (prorated)`);

    return {
      fromHandle: current.productHandle,
      fromName,
      toHandle: migrated.subscription?.product?.handle ?? target.handle,
      toName: target.name,
      timing: 'prorate',
      proratedAdjustmentInCents: centsToNumber(preview.migration.proratedAdjustmentInCents),
      effectiveDate: null,
      state: String(migrated.subscription?.state ?? current.state),
      maxioUrl: subscriptionUrl(input.subscriptionId),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, 'applyPlanChange');
    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
}

export interface LifecycleInput {
  subscriptionId: number;
  action: LifecycleAction;
  /** Only meaningful for cancel; defaults to 'immediate'. */
  cancelType?: CancelType;
  reasonCode?: string;
}

/**
 * UC4 — lifecycle control. Maps each action to the matching status operation
 * (pause→hold, resume, cancel immediate vs delayed, reactivate), then reads the
 * subscription back so the reported state transition reflects Maxio's truth.
 */
export async function lifecycleAction(input: LifecycleInput): Promise<LifecycleResult> {
  const status = subscriptionStatusController();
  const cancelType: CancelType | null =
    input.action === 'cancel' ? (input.cancelType ?? 'immediate') : null;

  try {
    const before = await readSubscriptionSummary(input.subscriptionId);
    let scheduledCancellation = false;
    let effectiveDate: string | null = null;

    switch (input.action) {
      case 'pause':
        await status.pauseSubscription(input.subscriptionId);
        break;

      case 'resume':
        await status.resumeSubscription(input.subscriptionId);
        break;

      case 'reactivate':
        await status.reactivateSubscription(input.subscriptionId);
        break;

      case 'cancel': {
        const body: CancellationRequest | undefined = input.reasonCode
          ? { subscription: { reasonCode: input.reasonCode, cancellationMessage: 'Canceled via MeterMate' } }
          : undefined;
        if (cancelType === 'end-of-period') {
          // Delayed cancellation: keep access until the paid period ends.
          await status.initiateDelayedCancellation(input.subscriptionId, body);
          scheduledCancellation = true;
          effectiveDate = before.currentPeriodEndsAt;
        } else {
          await status.cancelSubscription(input.subscriptionId, body);
        }
        break;
      }

      default: {
        // Exhaustiveness guard.
        const never: never = input.action;
        throw new MaxioServiceError(`Unsupported lifecycle action "${String(never)}"`, 400, []);
      }
    }

    // Read the authoritative new state after the operation.
    const after = await readSubscriptionSummary(input.subscriptionId);
    log.info(
      `Lifecycle ${input.action}${cancelType ? `/${cancelType}` : ''} on sub ${input.subscriptionId}: ${before.state} -> ${after.state}${scheduledCancellation ? ' (pending cancellation)' : ''}`,
    );

    return {
      action: input.action,
      cancelType,
      fromState: before.state,
      toState: after.state,
      scheduledCancellation,
      effectiveDate,
      reasonCode: input.reasonCode ?? null,
      maxioUrl: subscriptionUrl(input.subscriptionId),
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, `lifecycle:${input.action}`);
    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
}

export interface InvoiceLineItemInput {
  title: string;
  quantity: number;
  /** Decimal amount as a string, e.g. "500.00". */
  unitPrice: string;
}

export interface IssueInvoiceInput {
  subscriptionId: number;
  lineItems: InvoiceLineItemInput[];
  memo?: string;
  sendEmail: boolean;
  /** Recipient for the emailed invoice (the client). */
  recipientEmail?: string;
}

/**
 * UC5 — create an ad-hoc invoice as a draft, issue it, optionally email it, and
 * read back amount due, due date, and the hosted public payment URL. Creating a
 * draft first makes the create→issue steps explicit (narrated separately).
 */
export async function issueInvoiceForSubscription(
  input: IssueInvoiceInput,
): Promise<InvoiceResultData> {
  if (input.lineItems.length === 0) {
    throw new MaxioServiceError('At least one line item is required', 400, []);
  }

  try {
    const controller = invoicesController();

    // 1. Create as a draft.
    const createBody: CreateInvoiceRequest = {
      invoice: {
        lineItems: input.lineItems.map((li) => ({
          title: li.title,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
        })),
        ...(input.memo ? { memo: input.memo } : {}),
        status: CreateInvoiceStatus.Draft,
      },
    };
    const { result: created } = await controller.createInvoice(input.subscriptionId, createBody);
    const uid = created.invoice?.uid;
    if (!uid) {
      throw new MaxioServiceError('Maxio returned no invoice uid', undefined, []);
    }
    log.info(`Created draft invoice ${uid} for sub ${input.subscriptionId}`);

    // 2. Issue it.
    const { result: issued } = await controller.issueInvoice(uid, {
      onFailedPayment: FailedPaymentAction.LeaveOpenInvoice,
    });
    log.info(`Issued invoice ${uid} (status ${issued.status})`);

    // 3. Optionally email it.
    let emailed = false;
    if (input.sendEmail) {
      const sendBody: SendInvoiceRequest | undefined = input.recipientEmail
        ? { recipientEmails: [input.recipientEmail] }
        : undefined;
      await controller.sendInvoice(uid, sendBody);
      emailed = true;
      log.info(`Emailed invoice ${uid}${input.recipientEmail ? ` to ${input.recipientEmail}` : ''}`);
    }

    return {
      invoiceUid: uid,
      status: String(issued.status ?? 'unknown'),
      totalAmount: issued.totalAmount ?? null,
      dueAmount: issued.dueAmount ?? null,
      dueDate: issued.dueDate ?? null,
      issueDate: issued.issueDate ?? null,
      publicUrl: issued.publicUrl ?? created.invoice?.publicUrl ?? null,
      emailed,
    };
  } catch (err) {
    if (err instanceof MaxioServiceError) throw err;
    const normalized = normalizeMaxioError(err, 'issueInvoice');
    log.error(normalized.message, { statusCode: normalized.statusCode });
    throw normalized;
  }
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
