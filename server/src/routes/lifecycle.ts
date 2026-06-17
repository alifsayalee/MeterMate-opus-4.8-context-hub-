import { Router, type Request, type Response } from 'express';
import { getConsultant } from '../catalog.js';
import { createLogger } from '../logger.js';
import { lifecycleSchema } from '../schemas/lifecycle.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { lifecycleAction } from '../services/maxioService.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import { failureBlocks, lifecycleDoneBlocks, lifecycleProgressBlocks } from '../slack/blocks.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';
import type { CancelType, LifecycleAction } from '../types.js';

/**
 * UC4 — Lifecycle Control. One route, four actions (pause/resume/cancel/
 * reactivate). Resolves the transaction + channel, narrates progress and the
 * resulting state transition. Slack never blocks the HTTP response (plan §6).
 */
const log = createLogger('route:lifecycle');

export const lifecycleRouter = Router();

const ACTION_LABELS: Record<LifecycleAction, string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancellation',
  reactivate: 'Reactivation',
};

function effectiveLabel(effectiveDate: string | null): string {
  return effectiveDate ?? 'Immediately';
}

lifecycleRouter.post('/lifecycle', async (req: Request, res: Response) => {
  const parsed = lifecycleSchema.safeParse(req.body);
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

  const action = input.action as LifecycleAction;
  const cancelType = input.cancelType as CancelType | undefined;

  // Channel context + progress message (best-effort).
  let channelId = txn.channelId;
  let channelName = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn, consultant);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
    }
    if (channelId) {
      await postBlocks(channelId, lifecycleProgressBlocks(ACTION_LABELS[action]), `${ACTION_LABELS[action]} in progress`);
    }
  } catch (err) {
    log.warn('Slack channel setup failed; continuing', err);
  }

  try {
    transactionStore.update(txn.txnId, { state: 'in_progress' });
    const result = await lifecycleAction({
      subscriptionId: txn.subscriptionId,
      action,
      ...(cancelType ? { cancelType } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    });
    transactionStore.update(txn.txnId, { state: 'completed' });

    if (channelId) {
      await postBlocks(
        channelId,
        lifecycleDoneBlocks({
          fromState: result.fromState,
          toState: result.toState,
          scheduledCancellation: result.scheduledCancellation,
          effectiveLabel: effectiveLabel(result.effectiveDate),
          reasonCode: result.reasonCode,
          maxioUrl: result.maxioUrl,
        }),
        `${result.fromState} → ${result.toState}`,
      );
    }

    return res.status(200).json({ status: 'ok', txnId: txn.txnId, channelId, channelName, lifecycle: result });
  } catch (err) {
    transactionStore.update(txn.txnId, { state: 'failed' });
    const isMaxio = err instanceof MaxioServiceError;
    const summary = isMaxio ? err.message : `Unexpected error during ${ACTION_LABELS[action].toLowerCase()}`;
    log.error('Lifecycle action failed', err);

    if (channelId) {
      await postBlocks(channelId, failureBlocks(ACTION_LABELS[action], summary), `${ACTION_LABELS[action]} failed`);
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
