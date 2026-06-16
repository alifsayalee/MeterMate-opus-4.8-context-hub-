import { createLogger } from '../logger.js';
import type { TransactionRecord, TransactionType } from '../types.js';

/**
 * In-memory transaction store (plan §4.3). Two indexes:
 *  - byId: txnId -> record
 *  - channelByPair: "(consultantId|clientEmail)" -> channelId/name
 *
 * The pair index is what powers channel reuse: the first action for a
 * consultant↔client pair creates the private channel; later actions look it up
 * here and reuse it. DB-ready: callers only use the exported functions.
 */
const log = createLogger('transactionStore');

const byId = new Map<string, TransactionRecord>();
const channelByPair = new Map<string, { channelId: string; channelName: string }>();

let seq = 0;

function pairKey(consultantId: string, clientEmail: string): string {
  return `${consultantId}|${clientEmail.trim().toLowerCase()}`;
}

/** Monotonic sequence used in channel names (txn-<c>-<client>-<seq>). */
export function nextSeq(): number {
  seq += 1;
  return seq;
}

export function create(input: {
  consultantId: string;
  clientEmail: string;
  clientName: string;
  type: TransactionType;
}): TransactionRecord {
  const ts = Date.now();
  const txnId = `txn_${ts.toString(36)}_${nextSeq().toString(36)}`;
  const record: TransactionRecord = {
    txnId,
    consultantId: input.consultantId,
    clientEmail: input.clientEmail.trim().toLowerCase(),
    clientName: input.clientName,
    type: input.type,
    state: 'started',
    createdAt: ts,
    updatedAt: ts,
  };
  byId.set(txnId, record);
  log.debug(`Created transaction ${txnId} (${input.type})`);
  return record;
}

export function get(txnId: string): TransactionRecord | undefined {
  return byId.get(txnId);
}

export function update(txnId: string, patch: Partial<TransactionRecord>): TransactionRecord | undefined {
  const record = byId.get(txnId);
  if (!record) return undefined;
  Object.assign(record, patch, { updatedAt: Date.now() });
  return record;
}

/** Records the channel for a consultant↔client pair so later actions reuse it. */
export function linkChannel(
  consultantId: string,
  clientEmail: string,
  channelId: string,
  channelName: string,
): void {
  channelByPair.set(pairKey(consultantId, clientEmail), { channelId, channelName });
}

/** Returns the existing channel for a pair, if any (drives reuse). */
export function findChannelForPair(
  consultantId: string,
  clientEmail: string,
): { channelId: string; channelName: string } | undefined {
  return channelByPair.get(pairKey(consultantId, clientEmail));
}

/** All transactions for a consultant (used by UC6 digest later). */
export function listByConsultant(consultantId: string): TransactionRecord[] {
  return [...byId.values()].filter((t) => t.consultantId === consultantId);
}

export function count(): number {
  return byId.size;
}

export function _resetForTests(): void {
  byId.clear();
  channelByPair.clear();
  seq = 0;
}
