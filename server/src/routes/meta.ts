import { Router, type Request, type Response } from 'express';
import { config, configStatus } from '../config.js';
import { COMPONENTS, CONSULTANTS, PLANS } from '../catalog.js';
import { isMaxioConfigured } from '../maxioClient.js';
import { isSlackConfigured } from '../services/slackService.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';

/**
 * Cross-cutting meta endpoints: health plus the dropdown feeds the SPA needs.
 * Products/consultants are served from the seeded catalog (the app's source of
 * truth for handles/prices) so the UI loads without a live Maxio call.
 */
export const metaRouter = Router();

metaRouter.get('/health', (_req: Request, res: Response) => {
  const status = configStatus();
  res.json({
    status: 'ok',
    service: 'metermate-server',
    time: new Date().toISOString(),
    sessions: sessionStore.count(),
    transactions: transactionStore.count(),
    maxioSite: config.maxio.siteSubdomain || null,
    maxioConfigured: isMaxioConfigured(),
    slackConfigured: isSlackConfigured(),
    demoMode: status.demoMode,
  });
});

metaRouter.get('/products', (_req: Request, res: Response) => {
  res.json({
    plans: PLANS.map((p) => ({ handle: p.handle, name: p.name, priceInCents: p.priceInCents })),
    components: COMPONENTS.map((c) => ({
      handle: c.handle,
      name: c.name,
      kind: c.kind,
      unitPriceInCents: c.unitPriceInCents,
      unitName: c.unitName,
    })),
  });
});

metaRouter.get('/consultants', (_req: Request, res: Response) => {
  res.json({
    consultants: CONSULTANTS.map((c) => ({ id: c.id, name: c.name })),
  });
});
