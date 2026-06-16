import { Router, type Request, type Response } from 'express';
import { getConsultant } from '../catalog.js';
import { createLogger } from '../logger.js';
import { planChangeSchema } from '../schemas/planChange.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { applyPlanChange, previewPlanChange } from '../services/maxioService.js';
import { ensureTxnChannel, postBlocks } from '../services/slackService.js';
import {
  failureBlocks,
  planChangedBlocks,
  planChangePreviewBlocks,
} from '../slack/blocks.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';
import type { PlanChangeTiming, TransactionRecord } from '../types.js';

/**
 * UC3 — Plan Change with proration preview. Two routes: /plan-change/preview
 * (computes + narrates the prorated delta) and /plan-change (commits it). Slack
 * never blocks the HTTP response (plan §6).
 */
const log = createLogger('route:planChange');

export const planChangeRouter = Router();

/** Human label for when a change takes effect. */
function effectiveLabel(timing: PlanChangeTiming, effectiveDate: string | null): string {
  if (effectiveDate) return effectiveDate;
  return timing === 'prorate' ? 'Immediately' : 'next renewal';
}

interface Resolved {
  txn: TransactionRecord;
  consultant: ReturnType<typeof getConsultant>;
  subscriptionId: number;
}

/** Shared validation + transaction/subscription resolution for both routes. */
function resolve(req: Request, res: Response): Resolved | null {
  const parsed = planChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  const input = parsed.data;

  if (!sessionStore.get(input.sessionId)) {
    res.status(409).json({ status: 'session_expired', error: 'Session expired; restart the flow.' });
    return null;
  }
  const txn = transactionStore.get(input.txnRef);
  if (!txn) {
    res.status(409).json({ status: 'session_expired', error: 'Transaction not found or expired.' });
    return null;
  }
  if (txn.subscriptionId == null) {
    res.status(400).json({
      status: 'invalid',
      error: 'This transaction has no active subscription yet. Complete a booking (UC1) first.',
    });
    return null;
  }
  const consultant = getConsultant(txn.consultantId);
  if (!consultant) {
    res.status(400).json({ status: 'invalid', error: 'Unknown consultant on transaction.' });
    return null;
  }
  return { txn, consultant, subscriptionId: txn.subscriptionId };
}

planChangeRouter.post('/plan-change/preview', async (req: Request, res: Response) => {
  const resolved = resolve(req, res);
  if (!resolved) return;
  const { txn, consultant, subscriptionId } = resolved;
  const { targetHandle, timing } = req.body as { targetHandle: string; timing: PlanChangeTiming };

  // Channel context (best-effort).
  let channelId = txn.channelId;
  let channelName = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn, consultant!);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
    }
  } catch (err) {
    log.warn('Slack channel setup failed; continuing', err);
  }

  try {
    const preview = await previewPlanChange({ subscriptionId, targetHandle, timing });

    if (channelId) {
      await postBlocks(
        channelId,
        planChangePreviewBlocks({
          fromName: preview.fromName,
          toName: preview.targetName,
          timing: preview.timing,
          proratedAdjustmentInCents: preview.proratedAdjustmentInCents,
          paymentDueInCents: preview.paymentDueInCents,
          effectiveLabel: effectiveLabel(preview.timing, preview.effectiveDate),
        }),
        'Plan change preview',
      );
    }

    return res.status(200).json({ status: 'ok', txnId: txn.txnId, channelId, channelName, preview });
  } catch (err) {
    return handleFailure(err, res, txn.txnId, channelId, channelName, 'Plan change preview');
  }
});

planChangeRouter.post('/plan-change', async (req: Request, res: Response) => {
  const resolved = resolve(req, res);
  if (!resolved) return;
  const { txn, consultant, subscriptionId } = resolved;
  const { targetHandle, timing } = req.body as { targetHandle: string; timing: PlanChangeTiming };

  let channelId = txn.channelId;
  let channelName = txn.channelName;
  try {
    const channel = await ensureTxnChannel(txn, consultant!);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
    }
  } catch (err) {
    log.warn('Slack channel setup failed; continuing', err);
  }

  try {
    transactionStore.update(txn.txnId, { state: 'in_progress' });
    const result = await applyPlanChange({ subscriptionId, targetHandle, timing });
    transactionStore.update(txn.txnId, { state: 'completed' });

    if (channelId) {
      await postBlocks(
        channelId,
        planChangedBlocks({
          fromName: result.fromName,
          toName: result.toName,
          timing: result.timing,
          proratedAdjustmentInCents: result.proratedAdjustmentInCents,
          effectiveLabel: effectiveLabel(result.timing, result.effectiveDate),
          maxioUrl: result.maxioUrl,
        }),
        'Plan changed',
      );
    }

    return res.status(200).json({ status: 'ok', txnId: txn.txnId, channelId, channelName, planChange: result });
  } catch (err) {
    transactionStore.update(txn.txnId, { state: 'failed' });
    return handleFailure(err, res, txn.txnId, channelId, channelName, 'Plan change');
  }
});

/** Shared failure handler: posts a failure block and returns a typed error. */
async function handleFailure(
  err: unknown,
  res: Response,
  txnId: string,
  channelId: string | undefined,
  channelName: string | undefined,
  useCase: string,
): Promise<Response> {
  const isMaxio = err instanceof MaxioServiceError;
  const summary = isMaxio ? err.message : `Unexpected error during ${useCase.toLowerCase()}`;
  log.error(`${useCase} failed`, err);

  if (channelId) {
    await postBlocks(channelId, failureBlocks(useCase, summary), `${useCase} failed`);
  }

  const httpStatus = isMaxio && (err.statusCode === 400 || err.statusCode === 404) ? 400 : 502;
  return res.status(httpStatus).json({
    status: 'maxio_failed',
    txnId,
    channelId,
    channelName,
    error: summary,
    details: isMaxio ? err.details : [],
  });
}
