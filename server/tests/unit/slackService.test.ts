import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared fake Slack Web API surface; reconfigured per test.
const api = {
  auth: { test: vi.fn() },
  users: { lookupByEmail: vi.fn() },
  conversations: { create: vi.fn(), invite: vi.fn(), list: vi.fn() },
  chat: { postMessage: vi.fn() },
};

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => api),
}));

import * as slackService from '../../src/services/slackService.js';
import * as transactionStore from '../../src/stores/transactionStore.js';
import type { Consultant, TransactionRecord } from '../../src/types.js';

const consultant: Consultant = {
  id: 'c1',
  name: 'Alex Rivera',
  slackEmail: 'alex@example.com',
  slug: 'alex',
};

function makeTxn(email = 'client@example.com'): TransactionRecord {
  return transactionStore.create({
    consultantId: 'c1',
    clientEmail: email,
    clientName: 'Client One',
    type: 'subscription',
  });
}

function slackErr(code: string) {
  return Object.assign(new Error(code), { data: { error: code } });
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionStore._resetForTests();
  slackService._resetForTests();
  api.conversations.create.mockResolvedValue({ channel: { id: 'C100', name: 'txn-alex-client-1' } });
  api.conversations.invite.mockResolvedValue({ ok: true });
  api.chat.postMessage.mockResolvedValue({ ts: '111.222' });
});

describe('slackService.ensureTxnChannel', () => {
  it('tier 1: invites both parties when they are workspace members (AC-02/03)', async () => {
    api.users.lookupByEmail
      .mockResolvedValueOnce({ user: { id: 'U_CONSULT' } }) // consultant
      .mockResolvedValueOnce({ user: { id: 'U_CLIENT' } }); // client

    const txn = makeTxn();
    const res = await slackService.ensureTxnChannel(txn, consultant);

    expect(res?.created).toBe(true);
    expect(res?.consultantInvited).toBe(true);
    expect(res?.clientInvited).toBe(true);
    expect(api.conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({ is_private: true }),
    );
    expect(api.conversations.invite).toHaveBeenCalledTimes(2);
    // "started" message posted.
    expect(api.chat.postMessage).toHaveBeenCalled();
  });

  it('tier 2: client not found falls back to email without throwing (AC-04)', async () => {
    api.users.lookupByEmail
      .mockResolvedValueOnce({ user: { id: 'U_CONSULT' } }) // consultant found
      .mockRejectedValueOnce(slackErr('users_not_found')); // client not found

    const txn = makeTxn();
    const res = await slackService.ensureTxnChannel(txn, consultant);

    expect(res?.created).toBe(true);
    expect(res?.clientInvited).toBe(false);
    // consultant invited once; client never invited.
    expect(api.conversations.invite).toHaveBeenCalledTimes(1);
    // started + email-notice messages.
    expect(api.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(transactionStore.get(txn.txnId)?.clientByEmail).toBe(true);
  });

  it('name_taken: looks up and reuses the existing channel (§3.3)', async () => {
    api.users.lookupByEmail.mockResolvedValue({ user: { id: 'U' } });
    api.conversations.create.mockRejectedValueOnce(slackErr('name_taken'));
    // Match whatever channel name ensureTxnChannel actually tried to create
    // (the seq suffix is non-deterministic across tests).
    api.conversations.list.mockImplementation(async () => ({
      channels: [{ id: 'C_EXIST', name: api.conversations.create.mock.calls[0]?.[0]?.name }],
      response_metadata: {},
    }));

    const txn = makeTxn();
    const res = await slackService.ensureTxnChannel(txn, consultant);
    expect(res?.channelId).toBe('C_EXIST');
  });

  it('AC-05: second action for the same pair reuses the channel, no new create', async () => {
    api.users.lookupByEmail.mockResolvedValue({ user: { id: 'U' } });

    const first = await slackService.ensureTxnChannel(makeTxn(), consultant);
    expect(first?.created).toBe(true);

    api.conversations.create.mockClear();
    const second = await slackService.ensureTxnChannel(makeTxn(), consultant);
    expect(second?.created).toBe(false);
    expect(second?.channelId).toBe('C100');
    expect(api.conversations.create).not.toHaveBeenCalled();
  });

  it('postBlocks never throws on a Slack failure (AC-16)', async () => {
    api.chat.postMessage.mockRejectedValueOnce(slackErr('channel_not_found'));
    await expect(slackService.postBlocks('C1', [], 'x')).resolves.toBeUndefined();
  });
});
