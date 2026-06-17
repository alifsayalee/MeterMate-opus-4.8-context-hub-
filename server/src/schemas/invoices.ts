import { z } from 'zod';

/**
 * Zod schema for POST /api/invoices (UC5, admin). Requires at least one line
 * item; unitPrice is a decimal string (e.g. "500.00"). Validated before any
 * external call.
 */
const lineItemSchema = z.object({
  title: z.string().trim().min(1).max(255),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'unitPrice must be a decimal amount like "500.00"'),
});

export const invoiceSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  txnRef: z.string().min(1, 'txnRef is required'),
  lineItems: z.array(lineItemSchema).min(1, 'at least one line item is required').max(50),
  memo: z.string().trim().max(255).optional(),
  sendEmail: z.boolean(),
});

export type InvoiceRequest = z.infer<typeof invoiceSchema>;
