import { describe, expect, it } from 'vitest';
import {
  COMPONENTS,
  CONSULTANTS,
  PLANS,
  getComponent,
  getConsultant,
  getPlan,
} from '../../src/catalog.js';

describe('catalog', () => {
  it('seeds the four §1.6 priced items with correct handles and prices', () => {
    expect(getPlan('chub-test-basic')?.priceInCents).toBe(9900);
    expect(getPlan('chub-test-pro')?.priceInCents).toBe(29900);
    expect(getComponent('chub-test-minutes')).toMatchObject({ kind: 'metered', unitPriceInCents: 200 });
    expect(getComponent('api-calls')).toMatchObject({ kind: 'metered', unitPriceInCents: 1 });
  });

  it('returns undefined for unknown handles/ids', () => {
    expect(getPlan('enterprise')).toBeUndefined();
    expect(getConsultant('nope')).toBeUndefined();
  });

  it('seeds consultants with slugs and slack emails', () => {
    expect(CONSULTANTS.length).toBeGreaterThanOrEqual(1);
    for (const c of CONSULTANTS) {
      expect(c.slug).toMatch(/^[a-z0-9-]+$/);
      expect(c.slackEmail).toContain('@');
    }
    expect(PLANS).toHaveLength(2);
    expect(COMPONENTS).toHaveLength(2);
  });
});
