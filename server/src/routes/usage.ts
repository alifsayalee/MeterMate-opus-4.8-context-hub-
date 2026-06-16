import { Router, type Request, type Response } from 'express';
import { getComponent, getConsultant } from '../catalog.js';
import { createLogger } from '../logger.js';
import { usageSchema } from '../schemas/usage.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { recordUsage } from '../services/maxioService.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  failureBlocks,
  usageRecordedBlocks,
  usageRecordingBlocks,
} from '../slack/blocks.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';

/**
 * UC2 — Report Session Usage. Resolves the existing transaction (and its
 * channel), records metered or event-based usage via maxioService, and narrates
 * it in the channel. Slack failures never block the HTTP response (plan §6).
 */
const log = createLogger('route:usage');

export const usageRouter = Router();

usageRouter.post('/usage', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = usageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  // 2. Resolve the existing transaction.
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

  const component = getComponent(input.componentHandle);
  const consultant = getConsultant(txn.consultantId);
  if (!component || !consultant) {
    return res.status(400).json({ status: 'invalid', error: 'Unknown component or consultant.' });
  }

  // 3. Ensure/reuse the transaction channel and post "recording…".
  let channelId = txn.channelId;
  let channelName = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn, consultant);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
    }
    if (channelId) {
      await postBlocks(channelId, usageRecordingBlocks(component.name), 'Recording usage…');
    }
  } catch (err) {
    log.warn('Slack channel setup failed; continuing with billing', err);
  }

  // 4. Record usage.
  try {
    const result = await recordUsage({
      subscriptionId: txn.subscriptionId,
      component,
      quantity: input.quantity,
      ...(input.memo ? { memo: input.memo } : {}),
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    });

    transactionStore.update(txn.txnId, { state: 'completed' });

    if (channelId) {
      await postBlocks(
        channelId,
        usageRecordedBlocks({
          componentName: result.componentName,
          quantity: result.quantity,
          unitName: result.unitName,
          periodTotal: result.periodTotal,
          recordedEvents: result.recordedEvents,
        }),
        'Usage recorded',
      );
    }

    return res.status(200).json({
      status: 'ok',
      txnId: txn.txnId,
      channelId,
      channelName,
      usage: result,
    });
  } catch (err) {
    const isMaxio = err instanceof MaxioServiceError;
    const summary = isMaxio ? err.message : 'Unexpected error recording usage';
    log.error('Usage recording failed', err);

    if (channelId) {
      await postBlocks(channelId, failureBlocks('Usage recording', summary), 'Usage recording failed');
    }

    const httpStatus = isMaxio && err.statusCode === 400 ? 400 : 502;
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
