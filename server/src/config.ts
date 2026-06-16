import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env robustly regardless of cwd: first any .env in the current working
// directory, then the monorepo-root .env (this file lives at server/src/, so
// the root is two levels up). dotenv does not override already-set vars, so
// real environment variables always win.
dotenv.config();
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/**
 * Typed environment loader. Reads process.env once at startup, validates the
 * shape, and exposes a frozen, strongly-typed config object. Throwing here (at
 * boot) is intentional: a misconfigured service should fail fast and loud
 * rather than surface confusing runtime errors later.
 */

export type MaxioEnvironment = 'US' | 'EU';

export interface AppConfig {
  readonly port: number;
  readonly sessionTtlMinutes: number;
  readonly demoMode: boolean;
  readonly digestCron: string;

  readonly maxio: {
    readonly apiKey: string;
    readonly siteSubdomain: string;
    readonly environment: MaxioEnvironment;
    readonly defaultProductFamily: string;
  };

  readonly slack: {
    readonly botToken: string;
    readonly digestChannel: string;
  };

  readonly admin: {
    readonly user: string;
    readonly password: string;
  };
}

function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    return '';
  }
  return raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for env var ${name}: "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function maxioEnv(name: string): MaxioEnvironment {
  const raw = (process.env[name] ?? 'US').toUpperCase();
  if (raw !== 'US' && raw !== 'EU') {
    throw new Error(`${name} must be "US" or "EU", got "${raw}"`);
  }
  return raw;
}

export const config: AppConfig = Object.freeze({
  port: int('PORT', 4000),
  sessionTtlMinutes: int('SESSION_TTL_MINUTES', 30),
  demoMode: bool('DEMO_MODE', true),
  digestCron: str('DIGEST_CRON', '0 9 * * 1'),

  maxio: Object.freeze({
    apiKey: str('MAXIO_API_KEY'),
    siteSubdomain: str('MAXIO_SITE_SUBDOMAIN'),
    environment: maxioEnv('MAXIO_ENVIRONMENT'),
    defaultProductFamily: str('MAXIO_DEFAULT_PRODUCT_FAMILY', 'metermate'),
  }),

  slack: Object.freeze({
    botToken: str('SLACK_BOT_TOKEN'),
    digestChannel: str('SLACK_DIGEST_CHANNEL'),
  }),

  admin: Object.freeze({
    user: str('ADMIN_USER', 'admin'),
    password: str('ADMIN_PASSWORD', 'changeme'),
  }),
});

/**
 * Reports which integrations have credentials configured. Used by /api/health
 * and by services to decide whether to attempt a live call or run in a
 * degraded/offline state without crashing the process.
 */
export function configStatus() {
  return {
    maxioConfigured: Boolean(config.maxio.apiKey && config.maxio.siteSubdomain),
    slackConfigured: Boolean(config.slack.botToken),
    demoMode: config.demoMode,
  };
}
