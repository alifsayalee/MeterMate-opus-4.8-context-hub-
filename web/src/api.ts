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

/** POST helper that injects the sessionId into the body. */
export function postWithSession<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify({ sessionId: getSessionId(), ...body }),
  });
}
