/**
 * Shared domain types. Kept free of any SDK imports so they can describe the
 * MeterMate contract independently of Maxio/Slack wire shapes.
 */

/** Discriminated status returned by every mutating route. */
export type ApiStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';

export type CollectionMethodValue = 'automatic' | 'remittance';

/** A billable plan in the seeded catalog (Maxio Product, recurring monthly). */
export interface Plan {
  readonly handle: string;
  readonly name: string;
  /** Recurring monthly price in cents — the MRR shown in Slack. */
  readonly priceInCents: number;
}

export type ComponentKind = 'metered' | 'event-based';

/** A usage component in the seeded catalog. */
export interface CatalogComponent {
  readonly handle: string;
  readonly name: string;
  readonly kind: ComponentKind;
  readonly unitPriceInCents: number;
  readonly unitName: string;
  /**
   * Numeric Maxio component id — required for metered usage (createUsage takes
   * a numeric component id). Provisioned on the Maxio site and supplied via
   * MAXIO_CONSULTING_COMPONENT_ID. Event-based components are addressed by
   * their string `handle` (apiHandle) instead and don't need this.
   */
  readonly maxioComponentId?: number;
}

/** A consultant the client can book. Seeded; not a Maxio entity. */
export interface Consultant {
  readonly id: string;
  readonly name: string;
  /** Slack email used to invite the consultant to transaction channels. */
  readonly slackEmail: string;
  /** URL-safe slug used in channel names. */
  readonly slug: string;
}

/** Transaction lifecycle state, narrated into the Slack channel. */
export type TransactionState = 'started' | 'in_progress' | 'completed' | 'failed';

export type TransactionType =
  | 'subscription'
  | 'usage'
  | 'plan_change'
  | 'lifecycle'
  | 'invoice';

/** One consultant↔client transaction. Holds the channel-reuse linkage. */
export interface TransactionRecord {
  txnId: string;
  consultantId: string;
  clientEmail: string;
  clientName: string;
  type: TransactionType;
  state: TransactionState;
  /** Maxio subscription id once created. */
  subscriptionId?: number;
  /** Maxio customer id once created. */
  customerId?: number;
  /** Slack channel created/reused for this consultant↔client pair. */
  channelId?: string;
  channelName?: string;
  /** True when the client could not be invited and is notified by email. */
  clientByEmail?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Per-session live state: last submission + last result for multi-step flows. */
export interface SessionData {
  sessionId: string;
  lastTouched: number;
  /** Idempotency keys already processed in this session. */
  idempotencyKeys: Set<string>;
  /** Free-form bag for multi-step flows (e.g. UC3 preview → confirm). */
  scratch: Record<string, unknown>;
}

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

/** UC4 — result of a lifecycle operation. */
export interface LifecycleResult {
  action: LifecycleAction;
  cancelType: CancelType | null;
  fromState: string;
  toState: string;
  /** True when cancellation is scheduled for end of period (not immediate). */
  scheduledCancellation: boolean;
  /** Effective date for a deferred action (e.g. end-of-period); null = now. */
  effectiveDate: string | null;
  reasonCode: string | null;
  maxioUrl: string;
}

export type PlanChangeTiming = 'prorate' | 'at-renewal';

/** UC3 — prorated cost preview of a plan change (no commit). */
export interface PlanChangePreview {
  fromHandle: string | null;
  fromName: string | null;
  targetHandle: string;
  targetName: string;
  timing: PlanChangeTiming;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  creditAppliedInCents: number;
  paymentDueInCents: number;
  /** null = takes effect immediately; otherwise the effective date (ISO). */
  effectiveDate: string | null;
}

/** UC3 — committed plan change result. */
export interface PlanChangeResult {
  fromHandle: string | null;
  fromName: string | null;
  toHandle: string;
  toName: string;
  timing: PlanChangeTiming;
  proratedAdjustmentInCents: number;
  effectiveDate: string | null;
  state: string;
  maxioUrl: string;
}

/** Normalized result of UC2 recordUsage, ready for the HTTP response. */
export interface UsageResult {
  componentHandle: string;
  componentName: string;
  kind: ComponentKind;
  quantity: number;
  unitName: string;
  /** Metered: running total for the period read back from Maxio. */
  periodTotal: number | undefined;
  /** Event-based: number of events ingested. */
  recordedEvents: number | undefined;
  accruesToNextInvoice: true;
}

/** Normalized result of UC1 createSubscription, ready for the HTTP response. */
export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number | undefined;
  state: string;
  planHandle: string;
  planName: string;
  mrrInCents: number;
  nextAssessmentAt: string | undefined;
  collectionMethod: CollectionMethodValue;
  /** Deep link to the subscription in the Maxio dashboard. */
  maxioUrl: string;
}
