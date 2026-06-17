import {
  Client,
  ComponentsController,
  Environment,
  SubscriptionComponentsController,
  SubscriptionProductsController,
  SubscriptionsController,
  SubscriptionStatusController,
} from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';
import { createLogger } from './logger.js';

/**
 * Singleton Maxio Advanced Billing client (plan §4.4). HTTP Basic auth: API key
 * as username, literal "x" as password. Created lazily so the process can boot
 * (and serve /health) even when Maxio credentials are absent — services check
 * isMaxioConfigured() before calling and surface a clean typed error otherwise.
 */
const log = createLogger('maxioClient');

let client: Client | undefined;

export function isMaxioConfigured(): boolean {
  return Boolean(config.maxio.apiKey && config.maxio.siteSubdomain);
}

export function getClient(): Client {
  if (!isMaxioConfigured()) {
    throw new Error(
      'Maxio is not configured. Set MAXIO_API_KEY and MAXIO_SITE_SUBDOMAIN in .env.',
    );
  }
  if (!client) {
    client = new Client({
      basicAuthCredentials: {
        username: config.maxio.apiKey,
        password: 'x',
      },
      environment: config.maxio.environment === 'EU' ? Environment.EU : Environment.US,
      site: config.maxio.siteSubdomain,
      timeout: 120_000,
    });
    log.info(
      `Maxio client initialized for site "${config.maxio.siteSubdomain}" (${config.maxio.environment})`,
    );
  }
  return client;
}

// Controllers are cheap wrappers over the client; build per call site.
export function subscriptionsController(): SubscriptionsController {
  return new SubscriptionsController(getClient());
}

export function subscriptionComponentsController(): SubscriptionComponentsController {
  return new SubscriptionComponentsController(getClient());
}

export function componentsController(): ComponentsController {
  return new ComponentsController(getClient());
}

export function subscriptionProductsController(): SubscriptionProductsController {
  return new SubscriptionProductsController(getClient());
}

export function subscriptionStatusController(): SubscriptionStatusController {
  return new SubscriptionStatusController(getClient());
}

/** Deep link to a subscription in the Maxio dashboard for "View in Maxio". */
export function subscriptionUrl(subscriptionId: number): string {
  const sub = config.maxio.siteSubdomain;
  return `https://${sub}.chargify.com/subscriptions/${subscriptionId}`;
}

/** Test-only: drop the cached client so a new config takes effect. */
export function _resetForTests(): void {
  client = undefined;
}
