import type { KnownBlock } from '@slack/web-api';

/**
 * Pure Block Kit builders (plan §5). Each returns a blocks array and touches no
 * Slack client, so they are unit-testable in isolation. Pattern: header +
 * context + fields grid + optional button.
 */

function header(text: string): KnownBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function context(text: string): KnownBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function fields(pairs: Array<[string, string]>): KnownBlock {
  return {
    type: 'section',
    fields: pairs.map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${v}` })),
  };
}

function linkButton(text: string, url: string): KnownBlock {
  return {
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text, emoji: true }, url }],
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Channel-opened announcement (any UC, first action of a pair). */
export function transactionStartedBlocks(input: {
  consultantName: string;
  clientName: string;
  type: string;
}): KnownBlock[] {
  return [
    header(':wave: Transaction started'),
    context(`Consultant *${input.consultantName}* · Client *${input.clientName}*`),
    fields([
      ['Consultant', input.consultantName],
      ['Client', input.clientName],
      ['Type', input.type],
    ]),
  ];
}

/** UC1 in-progress. */
export function bookingProgressBlocks(planName: string): KnownBlock[] {
  return [
    header(':hourglass_flowing_sand: Creating subscription…'),
    context(`Enrolling on *${planName}*`),
  ];
}

/** UC1 completion — subscription active. */
export function subscriptionActiveBlocks(input: {
  customerName: string;
  planName: string;
  mrrInCents: number;
  state: string;
  nextAssessmentAt: string | undefined;
  maxioUrl: string;
}): KnownBlock[] {
  return [
    header(':tada: Subscription active'),
    context(`*${input.customerName}* is now on *${input.planName}*`),
    fields([
      ['Customer', input.customerName],
      ['Plan', input.planName],
      ['MRR', `${money(input.mrrInCents)} / month`],
      ['State', input.state],
      ['Next bill', input.nextAssessmentAt ?? '—'],
    ]),
    linkButton('View in Maxio', input.maxioUrl),
  ];
}

/** UC2 in-progress. */
export function usageRecordingBlocks(componentName: string): KnownBlock[] {
  return [
    header(':bar_chart: Recording usage…'),
    context(`Component *${componentName}*`),
  ];
}

/** UC2 completion — usage recorded. */
export function usageRecordedBlocks(input: {
  componentName: string;
  quantity: number;
  unitName: string;
  periodTotal: number | undefined;
  recordedEvents: number | undefined;
}): KnownBlock[] {
  const unit = input.quantity === 1 ? input.unitName : `${input.unitName}s`;
  const detail =
    input.periodTotal != null
      ? [['Period total', `${input.periodTotal} ${input.unitName}s`] as [string, string]]
      : input.recordedEvents != null
        ? [['Events recorded', String(input.recordedEvents)] as [string, string]]
        : [];
  return [
    header(':white_check_mark: Usage recorded'),
    context('Accrues to the next invoice.'),
    fields([
      ['Component', input.componentName],
      ['Quantity', `${input.quantity} ${unit}`],
      ...detail,
    ]),
  ];
}

function prorationLabel(cents: number): string {
  if (cents === 0) return 'no proration';
  const sign = cents > 0 ? '+' : '−';
  return `${sign}${money(Math.abs(cents))}`;
}

/** UC3 preview — prorated cost before commit. */
export function planChangePreviewBlocks(input: {
  fromName: string | null;
  toName: string;
  timing: string;
  proratedAdjustmentInCents: number;
  paymentDueInCents: number;
  effectiveLabel: string;
}): KnownBlock[] {
  return [
    header(':mag: Plan change preview'),
    context(`*${input.fromName ?? 'current plan'}* → *${input.toName}* (${input.timing})`),
    fields([
      ['From', input.fromName ?? '—'],
      ['To', input.toName],
      ['Proration', prorationLabel(input.proratedAdjustmentInCents)],
      ['Due now', money(input.paymentDueInCents)],
      ['Effective', input.effectiveLabel],
    ]),
  ];
}

/** UC3 completion — plan changed. */
export function planChangedBlocks(input: {
  fromName: string | null;
  toName: string;
  timing: string;
  proratedAdjustmentInCents: number;
  effectiveLabel: string;
  maxioUrl: string;
}): KnownBlock[] {
  return [
    header(':arrows_counterclockwise: Plan changed'),
    context(`*${input.fromName ?? 'current plan'}* → *${input.toName}*`),
    fields([
      ['From', input.fromName ?? '—'],
      ['To', input.toName],
      ['Proration', prorationLabel(input.proratedAdjustmentInCents)],
      ['Effective', input.effectiveLabel],
    ]),
    linkButton('View in Maxio', input.maxioUrl),
  ];
}

/** Note posted when the client could not be invited (tier-2 fallback). */
export function clientByEmailNoticeBlocks(clientEmail: string): KnownBlock[] {
  return [
    context(
      `:email: ${clientEmail} isn't a workspace member — they'll be notified by email instead of in this channel.`,
    ),
  ];
}

/** Generic failure block (any UC). */
export function failureBlocks(useCase: string, errorSummary: string): KnownBlock[] {
  return [
    header(`:warning: ${useCase} failed`),
    fields([['What failed', useCase]]),
    context(`Maxio error: ${errorSummary}`),
  ];
}
