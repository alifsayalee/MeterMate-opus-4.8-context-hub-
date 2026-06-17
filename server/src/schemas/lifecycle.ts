import { z } from 'zod';

/**
 * Zod schema for POST /api/lifecycle (UC4). cancelType is only used when action
 * is `cancel`; reasonCode is optional. Validated before any external call.
 */
export const lifecycleSchema = z
  .object({
    sessionId: z.string().min(1, 'sessionId is required'),
    txnRef: z.string().min(1, 'txnRef is required'),
    action: z.enum(['pause', 'resume', 'cancel', 'reactivate']),
    cancelType: z.enum(['immediate', 'end-of-period']).optional(),
    reasonCode: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.action !== 'cancel' || v.cancelType !== undefined, {
    message: 'cancelType is required when action is "cancel"',
    path: ['cancelType'],
  });

export type LifecycleRequest = z.infer<typeof lifecycleSchema>;
