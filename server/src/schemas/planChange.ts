import { z } from 'zod';
import { PLAN_HANDLES } from '../catalog.js';

/**
 * Zod schema for UC3 plan-change preview and commit. Same shape for both routes
 * (preview computes, commit applies). targetHandle is pinned to the catalog;
 * timing selects prorate-now vs at-renewal.
 */
export const planChangeSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  txnRef: z.string().min(1, 'txnRef is required'),
  targetHandle: z.enum(PLAN_HANDLES as [string, ...string[]]),
  timing: z.enum(['prorate', 'at-renewal']),
});

export type PlanChangeRequest = z.infer<typeof planChangeSchema>;
