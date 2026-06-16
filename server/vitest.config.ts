import { defineConfig } from 'vitest/config';

// Deterministic env for tests: credentials present so isConfigured() gates are
// open, but all external SDK calls are mocked per-test (no live Maxio/Slack).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      MAXIO_API_KEY: 'test-key',
      MAXIO_SITE_SUBDOMAIN: 'test-site',
      MAXIO_ENVIRONMENT: 'US',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SESSION_TTL_MINUTES: '30',
    },
  },
});
