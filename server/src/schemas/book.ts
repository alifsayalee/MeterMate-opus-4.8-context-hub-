import { z } from 'zod';
import { CONSULTANT_IDS, PLAN_HANDLES } from '../catalog.js';

/**
 * Zod schema for POST /api/book (UC1). Invalid input is rejected with 400
 * before any Maxio/Slack call (plan AC-18). Enums are pinned to the seeded
 * catalog so an unknown plan/consultant fails validation, not a downstream API.
 */
export const bookSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  consultantId: z.enum(CONSULTANT_IDS as [string, ...string[]]),
  productHandle: z.enum(PLAN_HANDLES as [string, ...string[]]),
  collectionMethod: z.enum(['automatic', 'remittance']),
  couponCode: z.string().trim().min(1).max(60).optional(),
});

export type BookInput = z.infer<typeof bookSchema>;
