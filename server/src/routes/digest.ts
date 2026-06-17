import { Router, type Request, type Response } from 'express';
import { adminGuard } from '../auth.js';
import { getConsultant } from '../catalog.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { digestSchema } from '../schemas/digest.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { buildDigest } from '../services/maxioService.js';
import { postBlocks } from '../services/slackService.js';
import { digestBlocks } from '../slack/blocks.js';
import * as transactionStore from '../stores/transactionStore.js';

/**
 * UC6 — Billing Activity Digest (admin only). Per-consultant, not per-
 * transaction: aggregates the consultant's subscriptions/invoices/activity from
 * Maxio's live data and posts a summary to the configured digest channel. The
 * report is read-only, so a missing session does not block it.
 */
const log = createLogger('route:digest');

const DEFAULT_WINDOW_DAYS = 30;

export const digestRouter = Router();

digestRouter.post('/digest', adminGuard, async (req: Request, res: Response) => {
  const parsed = digestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;

  const consultant = getConsultant(input.consultantId);
  if (!consultant) {
    return res.status(400).json({ status: 'invalid', error: 'Unknown consultant.' });
  }

  // Scope: the subscription ids created under this consultant's transactions.
  const subscriptionIds = transactionStore
    .listByConsultant(input.consultantId)
    .map((t) => t.subscriptionId)
    .filter((id): id is number => id != null);

  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

  try {
    const digest = await buildDigest({
      consultantId: input.consultantId,
      consultantName: consultant.name,
      subscriptionIds,
      windowDays,
    });

    // Post to the configured digest channel (best-effort).
    let posted = false;
    const digestChannel = config.slack.digestChannel || null;
    if (digestChannel) {
      const ts = await postBlocks(
        digestChannel,
        digestBlocks({
          consultantName: digest.consultantName,
          windowDays: digest.windowDays,
          activeCount: digest.activeCount,
          mrrInCents: digest.mrrInCents,
          newSignups: digest.newSignups,
          churned: digest.churned,
          openInvoices: digest.openInvoices,
          overdueInvoices: digest.overdueInvoices,
          generatedAtLabel: new Date(digest.generatedAt).toUTCString(),
        }),
        'Billing digest',
      );
      posted = Boolean(ts);
    }

    return res.status(200).json({ status: 'ok', digest, digestChannel, posted });
  } catch (err) {
    const isMaxio = err instanceof MaxioServiceError;
    const summary = isMaxio ? err.message : 'Unexpected error building digest';
    log.error('Digest build failed', err);
    return res.status(502).json({ status: 'maxio_failed', error: summary, details: isMaxio ? err.details : [] });
  }
});
