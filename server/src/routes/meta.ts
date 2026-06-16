import { Router, type Request, type Response } from 'express';
import { configStatus } from '../config.js';

/**
 * Cross-cutting meta endpoints: health check plus the dropdown feeds the SPA
 * needs at boot. Product/consultant feeds are filled in during Phase 1 once the
 * Maxio client + seed exist; for the scaffold, /health is the contract that
 * proves the server is up.
 */
export const metaRouter = Router();

metaRouter.get('/health', (_req: Request, res: Response) => {
  const status = configStatus();
  res.json({
    status: 'ok',
    service: 'metermate-server',
    time: new Date().toISOString(),
    ...status,
  });
});
