import { getSessionId } from './session';

/**
 * Typed fetch wrappers. Every call automatically carries the sessionId and
 * normalizes errors so components can render a consistent failure state.
 */

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
  maxioConfigured: boolean;
  slackConfigured: boolean;
  demoMode: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed`, res.status, data);
  }
  return data as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

// ----- Catalog feeds (dropdowns) -----

export interface PlanOption {
  handle: string;
  name: string;
  priceInCents: number;
}

export interface ComponentOption {
  handle: string;
  name: string;
  kind: 'metered' | 'event-based';
  unitPriceInCents: number;
  unitName: string;
}

export interface ProductsResponse {
  plans: PlanOption[];
  components: ComponentOption[];
}

export interface ConsultantOption {
  id: string;
  name: string;
}

export function getProducts(): Promise<ProductsResponse> {
  return request<ProductsResponse>('/products');
}

export function getConsultants(): Promise<{ consultants: ConsultantOption[] }> {
  return request<{ consultants: ConsultantOption[] }>('/consultants');
}

// ----- UC1: Book & Subscribe -----

export type CollectionMethod = 'automatic' | 'remittance';

export interface BookRequest {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: CollectionMethod;
  couponCode?: string;
}

export interface SubscriptionResult {
  subscriptionId: number;
  customerId: number | null;
  state: string;
  planHandle: string;
  planName: string;
  mrrInCents: number;
  nextAssessmentAt: string | null;
  collectionMethod: CollectionMethod;
  maxioUrl: string;
}

export interface BookSuccess {
  status: 'ok';
  txnId: string;
  channelId?: string;
  channelName?: string;
  subscription: SubscriptionResult;
  idempotentReplay?: boolean;
}

export function book(body: BookRequest): Promise<BookSuccess> {
  return postWithSession<BookSuccess>('/book', body as unknown as Record<string, unknown>);
}

/** Formats integer cents as USD. */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

// ----- UC2: Report Session Usage -----

export interface UsageRequest {
  txnRef: string;
  componentHandle: string;
  quantity: number;
  memo?: string;
  timestamp?: string;
}

export interface UsageResult {
  componentHandle: string;
  componentName: string;
  kind: 'metered' | 'event-based';
  quantity: number;
  unitName: string;
  periodTotal: number | null;
  recordedEvents: number | null;
  accruesToNextInvoice: true;
}

export interface UsageSuccess {
  status: 'ok';
  txnId: string;
  channelId?: string;
  channelName?: string;
  usage: UsageResult;
}

export function recordUsage(body: UsageRequest): Promise<UsageSuccess> {
  return postWithSession<UsageSuccess>('/usage', body as unknown as Record<string, unknown>);
}

// ----- UC3: Plan Change -----

export type PlanChangeTiming = 'prorate' | 'at-renewal';

export interface PlanChangeRequest {
  txnRef: string;
  targetHandle: string;
  timing: PlanChangeTiming;
}

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
  effectiveDate: string | null;
}

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

export interface PreviewSuccess {
  status: 'ok';
  txnId: string;
  channelId?: string;
  channelName?: string;
  preview: PlanChangePreview;
}

export interface CommitSuccess {
  status: 'ok';
  txnId: string;
  channelId?: string;
  channelName?: string;
  planChange: PlanChangeResult;
}

export function previewPlanChange(body: PlanChangeRequest): Promise<PreviewSuccess> {
  return postWithSession<PreviewSuccess>('/plan-change/preview', body as unknown as Record<string, unknown>);
}

export function commitPlanChange(body: PlanChangeRequest): Promise<CommitSuccess> {
  return postWithSession<CommitSuccess>('/plan-change', body as unknown as Record<string, unknown>);
}

/** Signed money for proration deltas (credit shown negative). */
export function formatSignedMoney(cents: number): string {
  if (cents === 0) return formatMoney(0);
  const sign = cents > 0 ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(cents))}`;
}

// ----- UC4: Lifecycle Control -----

export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';

export interface LifecycleRequest {
  txnRef: string;
  action: LifecycleAction;
  cancelType?: CancelType;
  reasonCode?: string;
}

export interface LifecycleResult {
  action: LifecycleAction;
  cancelType: CancelType | null;
  fromState: string;
  toState: string;
  scheduledCancellation: boolean;
  effectiveDate: string | null;
  reasonCode: string | null;
  maxioUrl: string;
}

export interface LifecycleSuccess {
  status: 'ok';
  txnId: string;
  channelId?: string;
  channelName?: string;
  lifecycle: LifecycleResult;
}

export function lifecycle(body: LifecycleRequest): Promise<LifecycleSuccess> {
  return postWithSession<LifecycleSuccess>('/lifecycle', body as unknown as Record<string, unknown>);
}

// ----- shared client-side memory of the last transaction -----

const LAST_TXN_KEY = 'metermate.lastTxnId';

export function rememberLastTxn(txnId: string): void {
  try {
    localStorage.setItem(LAST_TXN_KEY, txnId);
  } catch {
    /* ignore storage errors */
  }
}

export function getLastTxn(): string {
  try {
    return localStorage.getItem(LAST_TXN_KEY) ?? '';
  } catch {
    return '';
  }
}

// Track the current plan per transaction so the UI can pre-check a no-op plan
// change before calling the API. Best-effort (browser-local); the backend is
// always the authority.
const CURRENT_PLAN_KEY = 'metermate.currentPlanByTxn';

function readPlanMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_PLAN_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberCurrentPlan(txnId: string, planHandle: string): void {
  if (!txnId || !planHandle) return;
  try {
    const map = readPlanMap();
    map[txnId] = planHandle;
    localStorage.setItem(CURRENT_PLAN_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage errors */
  }
}

export function getCurrentPlan(txnId: string): string | undefined {
  return readPlanMap()[txnId];
}

/** POST helper that injects the sessionId into the body. */
export function postWithSession<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify({ sessionId: getSessionId(), ...body }),
  });
}
