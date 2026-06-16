import { z } from 'zod';
import { COMPONENT_HANDLES } from '../catalog.js';

/**
 * Zod schema for POST /api/usage (UC2). Validates before any external call
 * (AC-18). componentHandle is pinned to the seeded catalog; quantity is a
 * positive integer; timestamp, if present, must be an ISO-8601 datetime.
 */
export const usageSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  txnRef: z.string().min(1, 'txnRef is required'),
  componentHandle: z.enum(COMPONENT_HANDLES as [string, ...string[]]),
  quantity: z.number().int().positive().max(1_000_000),
  memo: z.string().trim().max(255).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export type UsageInput = z.infer<typeof usageSchema>;
