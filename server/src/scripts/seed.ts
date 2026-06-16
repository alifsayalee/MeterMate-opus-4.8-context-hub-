import { COMPONENTS, CONSULTANTS, PLANS } from '../catalog.js';
import { config } from '../config.js';
import { isMaxioConfigured } from '../maxioClient.js';

/**
 * Seed / catalog report. chub's Maxio docs cover *using* products and
 * components, not *creating* them, so the Product Family + four priced items
 * are provisioned in the Maxio UI (see docs/SETUP.md) and mirrored in
 * catalog.ts. This script prints the expected handles/prices so an operator can
 * confirm the Maxio test site matches, and reports the demo consultants.
 */
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function main(): void {
  console.log('MeterMate seed / catalog report');
  console.log('================================\n');

  console.log(`Maxio site:        ${config.maxio.siteSubdomain || '(not set)'}`);
  console.log(`Maxio environment: ${config.maxio.environment}`);
  console.log(`Maxio configured:  ${isMaxioConfigured()}\n`);

  console.log('Plans (Maxio Products — recurring monthly):');
  for (const p of PLANS) {
    console.log(`  - ${p.handle.padEnd(20)} ${p.name.padEnd(14)} ${money(p.priceInCents)} / month`);
  }

  console.log('\nComponents (usage):');
  for (const c of COMPONENTS) {
    console.log(
      `  - ${c.handle.padEnd(20)} ${c.name.padEnd(14)} ${money(c.unitPriceInCents)} / ${c.unitName} (${c.kind})`,
    );
  }

  console.log('\nConsultants (app-seeded; not Maxio entities):');
  for (const c of CONSULTANTS) {
    console.log(`  - ${c.id}  ${c.name.padEnd(16)} <${c.slackEmail}>`);
  }

  console.log(
    '\nNOTE: Create these exact Product/Component handles in the Maxio test site' +
      '\n(per docs/SETUP.md) so subscriptions resolve them by handle.',
  );
}

main();
