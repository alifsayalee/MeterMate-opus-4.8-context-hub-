import type { CatalogComponent, Consultant, Plan } from './types.js';

/**
 * Seeded catalog — the app's source of truth for plan/component handles and
 * prices (plan §1.6). These handles MUST exist in the Maxio test site; the
 * chub Maxio docs cover using products/components, not creating them, so the
 * Product Family + four items are provisioned in the Maxio UI per SETUP.md and
 * mirrored here. Consultants are pure app data (not a Maxio entity).
 *
 * Centralizing this here keeps every UC (booking, usage, plan-change) reading
 * the same handles and lets /api/products and /api/consultants serve the SPA
 * dropdowns without a live Maxio call.
 */

export const PLANS: readonly Plan[] = Object.freeze([
  { handle: 'chub-test-basic', name: 'Basic plan', priceInCents: 9900 },
  { handle: 'chub-test-pro', name: 'Pro plan', priceInCents: 29900 },
]);

export const COMPONENTS: readonly CatalogComponent[] = Object.freeze([
  {
    handle: 'consulting-minutes',
    name: 'Consulting time',
    kind: 'metered',
    unitPriceInCents: 200,
    unitName: 'minute',
  },
  {
    handle: 'api-calls',
    name: 'API calls',
    kind: 'event-based',
    unitPriceInCents: 1,
    unitName: 'event',
  },
]);

export const CONSULTANTS: readonly Consultant[] = Object.freeze([
  { id: 'c1', name: 'Alex Rivera', slackEmail: 'ali.usman@apimatic.io', slug: 'alex' },
  { id: 'c2', name: 'Jordan Lee', slackEmail: 'jordan.lee@example.com', slug: 'jordan' },
  { id: 'c3', name: 'Sam Patel', slackEmail: 'sam.patel@example.com', slug: 'sam' },
]);

export function getPlan(handle: string): Plan | undefined {
  return PLANS.find((p) => p.handle === handle);
}

export function getComponent(handle: string): CatalogComponent | undefined {
  return COMPONENTS.find((c) => c.handle === handle);
}

export function getConsultant(id: string): Consultant | undefined {
  return CONSULTANTS.find((c) => c.id === id);
}

export const PLAN_HANDLES = PLANS.map((p) => p.handle);
export const COMPONENT_HANDLES = COMPONENTS.map((c) => c.handle);
export const CONSULTANT_IDS = CONSULTANTS.map((c) => c.id);
