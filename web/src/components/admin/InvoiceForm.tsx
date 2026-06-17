import { useState, type FormEvent } from 'react';
import {
  ApiError,
  clearAdminAuth,
  getLastTxn,
  issueInvoice,
  type InvoiceLineItem,
  type InvoiceSuccess,
} from '../../api';

/**
 * UC5 — Invoice Issue + Send (admin form). Builds an ad-hoc invoice with one or
 * more line items, issues it, and optionally emails the client. A 401 from the
 * server (bad/expired admin creds) bounces back to the login gate.
 */

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #ccc',
  fontSize: 14,
  boxSizing: 'border-box',
};
const fieldStyle: React.CSSProperties = { marginBottom: 14 };

interface FieldError {
  path: string;
  message: string;
}

interface LineItemDraft {
  title: string;
  quantity: string;
  unitPrice: string;
}

const emptyItem: LineItemDraft = { title: '', quantity: '1', unitPrice: '' };

export default function InvoiceForm({ onAuthExpired }: { onAuthExpired: (notice: string) => void }) {
  const [txnRef, setTxnRef] = useState<string>(getLastTxn());
  const [items, setItems] = useState<LineItemDraft[]>([{ ...emptyItem }]);
  const [memo, setMemo] = useState('');
  const [sendEmail, setSendEmail] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InvoiceSuccess | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<LineItemDraft>) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((cur) => [...cur, { ...emptyItem }]);
  }
  function removeItem(idx: number) {
    setItems((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : cur));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setFieldErrors([]);
    setError(null);

    const lineItems: InvoiceLineItem[] = items.map((it) => ({
      title: it.title.trim(),
      quantity: Number(it.quantity),
      unitPrice: it.unitPrice.trim(),
    }));

    try {
      const res = await issueInvoice({
        txnRef: txnRef.trim(),
        lineItems,
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        sendEmail,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.httpStatus === 401) {
          clearAdminAuth();
          onAuthExpired('Admin credentials were rejected. Please sign in again.');
          return;
        }
        const payload = err.payload as { status?: string; errors?: FieldError[]; error?: string } | undefined;
        if (payload?.status === 'invalid' && Array.isArray(payload.errors)) setFieldErrors(payload.errors);
        else if (payload?.error) setError(payload.error);
        else setError(`Request failed (${err.httpStatus})`);
      } else {
        setError(err instanceof Error ? err.message : 'Unexpected error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function errorFor(path: string): string | undefined {
    return fieldErrors.find((e) => e.path === path)?.message;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={onSubmit} aria-label="Issue invoice">
        <h2 style={{ marginTop: 0 }}>Issue invoice</h2>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txnRef">Transaction ID</label>
          <input
            id="txnRef"
            style={inputStyle}
            value={txnRef}
            onChange={(e) => setTxnRef(e.target.value)}
            placeholder="txn_… (from a booking)"
            required
          />
          {errorFor('txnRef') && <small style={{ color: '#b00' }}>{errorFor('txnRef')}</small>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Line items</label>
          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                style={{ ...inputStyle, flex: 3 }}
                placeholder="Title"
                value={it.title}
                onChange={(e) => updateItem(idx, { title: e.target.value })}
                required
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="number"
                min={1}
                step={1}
                placeholder="Qty"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                required
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="0.00"
                value={it.unitPrice}
                onChange={(e) => updateItem(idx, { unitPrice: e.target.value })}
                required
              />
              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                title="Remove line"
                style={{ border: '1px solid #ccc', borderRadius: 8, background: '#fff', cursor: items.length === 1 ? 'default' : 'pointer', padding: '0 10px' }}
              >
                ×
              </button>
            </div>
          ))}
          {(errorFor('lineItems') || fieldErrors.some((e) => e.path.startsWith('lineItems'))) && (
            <small style={{ color: '#b00' }}>
              {errorFor('lineItems') ?? 'Check line item titles, quantities, and prices (e.g. "500.00").'}
            </small>
          )}
          <button
            type="button"
            onClick={addItem}
            style={{ marginTop: 4, border: '1px dashed #999', borderRadius: 8, background: '#fafafa', cursor: 'pointer', padding: '6px 10px', fontSize: 13 }}
          >
            + Add line item
          </button>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="memo">Memo (optional)</label>
          <input id="memo" style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. One-time professional services" />
        </div>

        <div style={fieldStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the invoice to the client
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: submitting ? '#888' : '#2b6cb0', color: '#fff', fontSize: 15, cursor: submitting ? 'default' : 'pointer' }}
        >
          {submitting ? 'Issuing…' : 'Issue invoice'}
        </button>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Invoice failed:</strong> {error}
          </div>
        )}
      </form>

      <div>
        <h2 style={{ marginTop: 0 }}>Result</h2>
        {!result ? (
          <p style={{ color: '#999' }}>Issue an invoice to generate a hosted payment link and narrate it in Slack.</p>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: InvoiceSuccess }) {
  const i = result.invoice;
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 14 };
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef7ee', border: '1px solid #bcd9bc' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🧾 Invoice issued</div>
      <div style={row}><span>Invoice</span><strong>{i.invoiceUid}</strong></div>
      <div style={row}><span>Status</span><strong>{i.status}</strong></div>
      <div style={row}><span>Amount due</span><strong>{i.dueAmount != null ? `$${i.dueAmount}` : '—'}</strong></div>
      <div style={row}><span>Due date</span><strong>{i.dueDate ?? '—'}</strong></div>
      <div style={row}><span>Emailed</span><strong>{i.emailed ? 'yes' : 'no'}</strong></div>
      <div style={row}>
        <span>Slack channel</span>
        <strong>{result.channelName ? `#${result.channelName}` : 'not created'}</strong>
      </div>
      {i.publicUrl && (
        <a
          href={i.publicUrl}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 12, padding: '8px 14px', borderRadius: 8, background: '#2b6cb0', color: '#fff', textDecoration: 'none', fontSize: 14 }}
        >
          Pay Invoice
        </a>
      )}
    </div>
  );
}
