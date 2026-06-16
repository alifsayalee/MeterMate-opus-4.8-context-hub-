import { WebClient, type KnownBlock } from '@slack/web-api';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import * as transactionStore from '../stores/transactionStore.js';
import {
  clientByEmailNoticeBlocks,
  transactionStartedBlocks,
} from '../slack/blocks.js';
import type { Consultant, TransactionRecord } from '../types.js';

/**
 * slackService — owns the Slack WebClient and the channel-per-transaction
 * mechanism (plan §3). Every Slack failure is isolated: posting never throws,
 * and ensureTxnChannel degrades gracefully (tier-2 email fallback) rather than
 * breaking the billing flow. Nothing outside this module imports @slack/web-api.
 */
const log = createLogger('slackService');

let web: WebClient | undefined;

export function isSlackConfigured(): boolean {
  return Boolean(config.slack.botToken);
}

function client(): WebClient {
  if (!isSlackConfigured()) {
    throw new Error('Slack is not configured. Set SLACK_BOT_TOKEN in .env.');
  }
  if (!web) {
    web = new WebClient(config.slack.botToken);
    log.info('Slack WebClient initialized');
  }
  return web;
}

/** Reads the Slack error code from a thrown SDK error, if present. */
function slackErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === 'string') return data.error;
  }
  return undefined;
}

/** Boot-time auth check (plan §3.1 health check). Never throws. */
export async function checkAuth(): Promise<{ ok: boolean; detail?: string }> {
  if (!isSlackConfigured()) return { ok: false, detail: 'not configured' };
  try {
    const res = await client().auth.test();
    return { ok: Boolean(res.ok), detail: res.team ? `team ${res.team}` : undefined };
  } catch (err) {
    const code = slackErrorCode(err);
    log.warn('Slack auth.test failed', code ?? err);
    return { ok: false, detail: code ?? 'auth_failed' };
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function buildChannelName(consultantSlug: string, clientEmail: string, seq: number): string {
  const clientSlug = slugify(clientEmail.split('@')[0] ?? 'client');
  return `txn-${slugify(consultantSlug)}-${clientSlug}-${seq}`.slice(0, 80);
}

/** Looks up a workspace user id by email. Returns undefined if not a member. */
async function lookupUserId(email: string): Promise<string | undefined> {
  try {
    const res = await client().users.lookupByEmail({ email });
    return res.user?.id;
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'users_not_found') {
      log.info(`Slack user not found for ${email} — will fall back to email`);
      return undefined;
    }
    // Missing scope or other errors: log and treat as "can't invite".
    log.warn(`users.lookupByEmail failed for ${email}`, code ?? err);
    return undefined;
  }
}

/** Finds an existing private channel by name (used to reuse on name_taken). */
async function findChannelByName(name: string): Promise<{ id: string; name: string } | undefined> {
  try {
    let cursor: string | undefined;
    do {
      const res = await client().conversations.list({
        types: 'private_channel',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const match = res.channels?.find((c) => c.name === name);
      if (match?.id) return { id: match.id, name: match.name ?? name };
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (err) {
    log.warn(`conversations.list failed while resolving "${name}"`, slackErrorCode(err) ?? err);
  }
  return undefined;
}

async function inviteUser(channelId: string, userId: string): Promise<boolean> {
  try {
    await client().conversations.invite({ channel: channelId, users: userId });
    return true;
  } catch (err) {
    const code = slackErrorCode(err);
    // already_in_channel is success for our purposes.
    if (code === 'already_in_channel') return true;
    log.warn(`conversations.invite failed for ${userId} -> ${channelId}`, code ?? err);
    return false;
  }
}

/**
 * Posts blocks to a channel. Never throws — Slack is notification, not the
 * source of truth (plan §6). Returns the message ts on success.
 */
export async function postBlocks(
  channelId: string,
  blocks: KnownBlock[],
  fallbackText: string,
): Promise<string | undefined> {
  if (!isSlackConfigured()) return undefined;
  try {
    const res = await client().chat.postMessage({
      channel: channelId,
      text: fallbackText,
      blocks,
    });
    return res.ts;
  } catch (err) {
    log.warn(`chat.postMessage failed for ${channelId}`, slackErrorCode(err) ?? err);
    return undefined;
  }
}

export interface EnsureChannelResult {
  channelId: string;
  channelName: string;
  created: boolean;
  consultantInvited: boolean;
  clientInvited: boolean;
}

/**
 * Ensures a private transaction channel exists for the consultant↔client pair,
 * inviting both parties when they are workspace members (tier 1) and noting an
 * email fallback when the client cannot be added (tier 2). Reuses an existing
 * channel for the pair (plan §3.2–3.3). Updates the transaction record with the
 * channel id/name. Never throws — returns undefined if Slack isn't configured.
 */
export async function ensureTxnChannel(
  txn: TransactionRecord,
  consultant: Consultant,
): Promise<EnsureChannelResult | undefined> {
  if (!isSlackConfigured()) {
    log.info('Slack not configured — skipping channel creation');
    return undefined;
  }

  // Reuse: already linked for this pair?
  const existing = transactionStore.findChannelForPair(txn.consultantId, txn.clientEmail);
  if (existing) {
    transactionStore.update(txn.txnId, {
      channelId: existing.channelId,
      channelName: existing.channelName,
    });
    log.info(`Reusing channel ${existing.channelName} for ${txn.consultantId}/${txn.clientEmail}`);
    return {
      channelId: existing.channelId,
      channelName: existing.channelName,
      created: false,
      consultantInvited: true,
      clientInvited: !txn.clientByEmail,
    };
  }

  // Create a new private channel.
  const seq = transactionStore.nextSeq();
  const desiredName = buildChannelName(consultant.slug, txn.clientEmail, seq);

  let channelId: string | undefined;
  let channelName = desiredName;
  let created = false;

  try {
    const res = await client().conversations.create({ name: desiredName, is_private: true });
    channelId = res.channel?.id;
    channelName = res.channel?.name ?? desiredName;
    created = true;
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'name_taken') {
      const found = await findChannelByName(desiredName);
      if (found) {
        channelId = found.id;
        channelName = found.name;
        log.info(`Channel name taken — reusing existing ${channelName}`);
      }
    } else {
      log.warn(`conversations.create failed for ${desiredName}`, code ?? err);
    }
  }

  if (!channelId) {
    // Could not get a channel; flow continues without Slack (billing is truth).
    log.warn(`Unable to create/resolve channel ${desiredName}; continuing without it`);
    return undefined;
  }

  // Tier-1 invites: only workspace members can be added.
  const consultantUserId = await lookupUserId(consultant.slackEmail);
  const clientUserId = await lookupUserId(txn.clientEmail);

  const consultantInvited = consultantUserId ? await inviteUser(channelId, consultantUserId) : false;
  const clientInvited = clientUserId ? await inviteUser(channelId, clientUserId) : false;

  // Persist linkage + record.
  transactionStore.linkChannel(txn.consultantId, txn.clientEmail, channelId, channelName);
  transactionStore.update(txn.txnId, {
    channelId,
    channelName,
    clientByEmail: !clientInvited,
  });

  // Announce the channel.
  await postBlocks(
    channelId,
    transactionStartedBlocks({
      consultantName: consultant.name,
      clientName: txn.clientName,
      type: txn.type,
    }),
    'Transaction started',
  );

  if (!clientInvited) {
    await postBlocks(
      channelId,
      clientByEmailNoticeBlocks(txn.clientEmail),
      'Client will be notified by email',
    );
  }

  log.info(
    `Channel ${channelName} ready (created=${created}, consultantInvited=${consultantInvited}, clientInvited=${clientInvited})`,
  );

  return { channelId, channelName, created, consultantInvited, clientInvited };
}

export function _resetForTests(): void {
  web = undefined;
}
