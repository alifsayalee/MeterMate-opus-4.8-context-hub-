import { z } from 'zod';
import { CONSULTANT_IDS } from '../catalog.js';

/**
 * Zod schema for POST /api/digest (UC6, admin). consultantId is pinned to the
 * seeded list; windowDays defaults to 30. Validated before any external call.
 */
export const digestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  consultantId: z.enum(CONSULTANT_IDS as [string, ...string[]]),
  windowDays: z.number().int().min(1).max(365).optional(),
});

export type DigestRequest = z.infer<typeof digestSchema>;
