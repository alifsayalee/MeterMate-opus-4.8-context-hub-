import { Router, type Request, type Response } from 'express';
import { getConsultant } from '../catalog.js';
import { createLogger } from '../logger.js';
import { bookSchema } from '../schemas/book.js';
import { MaxioServiceError } from '../services/maxioErrors.js';
import { createSubscription } from '../services/maxioService.js';
import {
  ensureTxnChannel,
  postBlocks,
} from '../services/slackService.js';
import {
  bookingProgressBlocks,
  failureBlocks,
  subscriptionActiveBlocks,
} from '../slack/blocks.js';
import * as sessionStore from '../stores/sessionStore.js';
import * as transactionStore from '../stores/transactionStore.js';

/**
 * UC1 — Book & Subscribe. Wires: validate → store → ensureTxnChannel →
 * maxioService.createSubscription → Slack completion/failure. Slack failures
 * never block the HTTP response (plan §6); billing is the source of truth.
 */
const log = createLogger('route:book');

export const bookRouter = Router();

bookRouter.post('/book', async (req: Request, res: Response) => {
  // 1. Validate before any external call.
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'invalid',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  const clientName = `${input.firstName} ${input.lastName}`.trim();

  const consultant = getConsultant(input.consultantId);
  if (!consultant) {
    // Schema enum makes this unreachable, but guard defensively.
    return res.status(400).json({ status: 'invalid', errors: [{ path: 'consultantId', message: 'Unknown consultant' }] });
  }

  // 2. Idempotency: a retried form for the same pair+plan reuses the result.
  const idemKey = `book:${input.consultantId}:${input.email.toLowerCase()}:${input.productHandle}`;
  if (sessionStore.hasIdempotencyKey(input.sessionId, idemKey)) {
    const prior = sessionStore.getScratch<Record<string, unknown>>(input.sessionId, idemKey);
    if (prior) {
      log.info(`Idempotent replay for ${idemKey}`);
      return res.status(200).json({ ...prior, idempotentReplay: true });
    }
  }

  // 3. Create the transaction record + session.
  sessionStore.getOrCreate(input.sessionId);
  const txn = transactionStore.create({
    consultantId: input.consultantId,
    clientEmail: input.email,
    clientName,
    type: 'subscription',
  });

  // 4. Ensure the private channel + announce "started" (best-effort).
  let channelId: string | undefined;
  let channelName: string | undefined;
  try {
    const channel = await ensureTxnChannel(txn, consultant);
    if (channel) {
      channelId = channel.channelId;
      channelName = channel.channelName;
      await postBlocks(channelId, bookingProgressBlocks(input.productHandle), 'Creating subscription…');
    }
  } catch (err) {
    // ensureTxnChannel/postBlocks are designed not to throw, but never let a
    // notification problem break billing.
    log.warn('Slack channel setup failed; continuing with billing', err);
  }

  // 5. Drive the billing operation.
  try {
    transactionStore.update(txn.txnId, { state: 'in_progress' });
    const result = await createSubscription({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      productHandle: input.productHandle,
      collectionMethod: input.collectionMethod,
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      customerReference: input.email.toLowerCase(),
    });

    transactionStore.update(txn.txnId, {
      state: 'completed',
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
    });

    // 6. Post completion to the channel (best-effort).
    if (channelId) {
      await postBlocks(
        channelId,
        subscriptionActiveBlocks({
          customerName: clientName,
          planName: result.planName,
          mrrInCents: result.mrrInCents,
          state: result.state,
          nextAssessmentAt: result.nextAssessmentAt,
          maxioUrl: result.maxioUrl,
        }),
        'Subscription active',
      );
    }

    const payload = {
      status: 'ok' as const,
      txnId: txn.txnId,
      channelId,
      channelName,
      subscription: result,
    };
    sessionStore.markIdempotencyKey(input.sessionId, idemKey);
    sessionStore.setScratch(input.sessionId, idemKey, payload);
    return res.status(200).json(payload);
  } catch (err) {
    const isMaxio = err instanceof MaxioServiceError;
    const summary = isMaxio ? err.message : 'Unexpected error creating subscription';
    log.error('Booking failed', err);

    transactionStore.update(txn.txnId, { state: 'failed' });

    if (channelId) {
      await postBlocks(channelId, failureBlocks('Booking', summary), 'Booking failed');
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
