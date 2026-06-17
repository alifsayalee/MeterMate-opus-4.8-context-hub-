import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { getConsultant } from '../catalog.js';
import { createLogger } from '../logger.js';
import { invoiceSchema } from '../schemas/invoices.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { issueInvoiceForSubscription } from '../services/maxioService.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import { failureBlocks, invoiceIssuedBlocks, invoiceProgressBlocks } from '../slack/blocks.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';

/**
 * UC5 — Invoice Issue + Send (admin only). adminGuard runs before the handler,
 * so non-admin callers are rejected before any work (AC-14). Creates → issues →
 * optionally emails an ad-hoc invoice and posts the hosted Pay link to Slack.
 */
const log = createLogger('route:invoices');

export const invoicesRouter = Router();

invoicesRouter.post('/invoices', adminGuard, async (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  if (!sessionStore.get(input.sessionId)) {
    return res.status(409).json({ status: 'session_expired', error: 'Session expired; restart the flow.' });
  }
  const txn = transactionStore.get(input.txnRef);
  if (!txn) {
    return res.status(409).json({ status: 'session_expired', error: 'Transaction not found or expired.' });
  }
  if (txn.subscriptionId == null) {
    return res.status(400).json({
      status: 'invalid',
      error: 'This transaction has no active subscription yet. Complete a booking (UC1) first.',
    });
  }
  const consultant = getConsultant(txn.consultantId);
  if (!consultant) {
    return res.status(400).json({ status: 'invalid', error: 'Unknown consultant on transaction.' });
  }

  // Channel context + progress (best-effort).
  let channelId = txn.channelId;
  let channelName = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn, consultant);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
    }
    if (channelId) {
      await postBlocks(channelId, invoiceProgressBlocks(), 'Issuing invoice…');
    }
  } catch (err) {
    log.warn('Slack channel setup failed; continuing', err);
  }

  try {
    transactionStore.update(txn.txnId, { state: 'in_progress' });
    const result = await issueInvoiceForSubscription({
      subscriptionId: txn.subscriptionId,
      lineItems: input.lineItems,
      ...(input.memo ? { memo: input.memo } : {}),
      sendEmail: input.sendEmail,
      recipientEmail: txn.clientEmail,
    });
    transactionStore.update(txn.txnId, { state: 'completed' });

    if (channelId) {
      await postBlocks(
        channelId,
        invoiceIssuedBlocks({
          totalAmount: result.totalAmount,
          dueAmount: result.dueAmount,
          dueDate: result.dueDate,
          emailed: result.emailed,
          publicUrl: result.publicUrl,
        }),
        'Invoice issued',
      );
    }

    return res.status(200).json({ status: 'ok', txnId: txn.txnId, channelId, channelName, invoice: result });
  } catch (err) {
    transactionStore.update(txn.txnId, { state: 'failed' });
    const isMaxio = err instanceof MaxioServiceError;
    const summary = isMaxio ? err.message : 'Unexpected error issuing invoice';
    log.error('Invoice issuance failed', err);

    if (channelId) {
      await postBlocks(channelId, failureBlocks('Invoice', summary), 'Invoice failed');
    }

    const httpStatus = isMaxio && (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 422) ? 400 : 502;
    return res.status(httpStatus).json({
      status: 'maxio_failed',
      txnId: txn.txnId,
      channelId,
      channelName,
      error: summary,
      details: isMaxio ? err.details : [],
    });
  }
});
