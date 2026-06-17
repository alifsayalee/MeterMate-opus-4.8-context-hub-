import { beforeEach, describe, expect, it, vi } from 'vitest';

const createInvoiceMock = vi.fn();
const issueInvoiceMock = vi.fn();
const sendInvoiceMock = vi.fn();

vi.mock('../../src/maxioClient.js', () => ({
  invoicesController: () => ({
    createInvoice: createInvoiceMock,
    issueInvoice: issueInvoiceMock,
    sendInvoice: sendInvoiceMock,
  }),
  isMaxioConfigured: () => true,
}));

import { issueInvoiceForSubscription } from '../../src/services/maxioService.js';
import { MaxioServiceError } from '../../src/services/maxioErrors.js';

const lineItems = [{ title: 'Onboarding', quantity: 1, unitPrice: '500.00' }];

beforeEach(() => {
  vi.clearAllMocks();
  createInvoiceMock.mockResolvedValue({ result: { invoice: { uid: 'inv_1', publicUrl: 'https://pay/inv_1' } } });
  issueInvoiceMock.mockResolvedValue({
    result: {
      status: 'open',
      totalAmount: '500.00',
      dueAmount: '500.00',
      dueDate: '2026-07-01',
      issueDate: '2026-06-17',
      publicUrl: 'https://pay/inv_1',
    },
  });
  sendInvoiceMock.mockResolvedValue(undefined);
});

describe('issueInvoiceForSubscription', () => {
  it('creates a draft, issues it, emails it, and returns the hosted URL', async () => {
    const out = await issueInvoiceForSubscription({
      subscriptionId: 222,
      lineItems,
      memo: 'Pro services',
      sendEmail: true,
      recipientEmail: 'client@example.com',
    });

    // create as draft
    const createArgs = createInvoiceMock.mock.calls[0];
    expect(createArgs[0]).toBe(222);
    expect(createArgs[1].invoice.status).toBe('draft');
    expect(createArgs[1].invoice.lineItems[0]).toMatchObject({ title: 'Onboarding', unitPrice: '500.00' });
    // issue with onFailedPayment
    expect(issueInvoiceMock).toHaveBeenCalledWith('inv_1', expect.objectContaining({ onFailedPayment: expect.any(String) }));
    // email to the client
    expect(sendInvoiceMock).toHaveBeenCalledWith('inv_1', { recipientEmails: ['client@example.com'] });

    expect(out).toMatchObject({
      invoiceUid: 'inv_1',
      status: 'open',
      dueAmount: '500.00',
      publicUrl: 'https://pay/inv_1',
      emailed: true,
    });
  });

  it('does not email when sendEmail is false', async () => {
    const out = await issueInvoiceForSubscription({ subscriptionId: 222, lineItems, sendEmail: false });
    expect(sendInvoiceMock).not.toHaveBeenCalled();
    expect(out.emailed).toBe(false);
  });

  it('rejects when there are no line items (before any API call)', async () => {
    await expect(
      issueInvoiceForSubscription({ subscriptionId: 222, lineItems: [], sendEmail: false }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it('throws when Maxio returns no invoice uid', async () => {
    createInvoiceMock.mockResolvedValue({ result: { invoice: {} } });
    await expect(
      issueInvoiceForSubscription({ subscriptionId: 222, lineItems, sendEmail: false }),
    ).rejects.toBeInstanceOf(MaxioServiceError);
    expect(issueInvoiceMock).not.toHaveBeenCalled();
  });
});
