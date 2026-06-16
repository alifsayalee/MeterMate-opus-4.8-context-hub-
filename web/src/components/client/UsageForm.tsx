import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  getLastTxn,
  getProducts,
  recordUsage,
  type ComponentOption,
  type UsageSuccess,
} from '../../api';

/**
 * UC2 — Report Session Usage (client form). Records metered/event-based usage
 * against an existing transaction's subscription. Component options load from
 * the backend catalog; txnRef defaults to the last booking made in this browser.
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

export default function UsageForm() {
  const [components, setComponents] = useState<ComponentOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [txnRef, setTxnRef] = useState<string>(getLastTxn());
  const [componentHandle, setComponentHandle] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('30');
  const [memo, setMemo] = useState<string>('');
  const [timestamp, setTimestamp] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UsageSuccess | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    getProducts()
      .then((p) => {
        setComponents(p.components);
        setComponentHandle(p.components[0]?.handle ?? '');
      })
      .catch((e: unknown) => setCatalogError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingCatalog(false));
  }, []);

  function errorFor(path: string): string | undefined {
    return fieldErrors.find((e) => e.path === path)?.message;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setFieldErrors([]);
    setSubmitError(null);

    const qty = Number(quantity);
    try {
      const res = await recordUsage({
        txnRef: txnRef.trim(),
        componentHandle,
        quantity: qty,
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        // datetime-local has no timezone; convert to an ISO instant.
        ...(timestamp ? { timestamp: new Date(timestamp).toISOString() } : {}),
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const payload = err.payload as
          | { status?: string; errors?: FieldError[]; error?: string }
          | undefined;
        if (payload?.status === 'invalid' && Array.isArray(payload.errors)) {
          setFieldErrors(payload.errors);
        } else if (payload?.error) {
          setSubmitError(payload.error);
        } else {
          setSubmitError(`Request failed (${err.httpStatus})`);
        }
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Unexpected error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingCatalog) return <p style={{ color: '#999' }}>Loading usage form…</p>;
  if (catalogError) return <p style={{ color: '#b00' }}>Could not load catalog: {catalogError}</p>;

  const selected = components.find((c) => c.handle === componentHandle);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={onSubmit} aria-label="Report usage">
        <h2 style={{ marginTop: 0 }}>Report usage</h2>

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
          {!txnRef && (
            <small style={{ color: '#999' }}>Tip: book a session first; its transaction ID is remembered here.</small>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="component">Component</label>
          <select
            id="component"
            style={inputStyle}
            value={componentHandle}
            onChange={(e) => setComponentHandle(e.target.value)}
          >
            {components.map((c) => (
              <option key={c.handle} value={c.handle}>
                {c.name} ({c.kind})
              </option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="quantity">
            Quantity{selected ? ` (${selected.unitName}s)` : ''}
          </label>
          <input
            id="quantity"
            type="number"
            min={1}
            step={1}
            style={inputStyle}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
          {errorFor('quantity') && <small style={{ color: '#b00' }}>{errorFor('quantity')}</small>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="memo">Memo (optional)</label>
          <input
            id="memo"
            style={inputStyle}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. Strategy call"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="timestamp">Timestamp (optional)</label>
          <input
            id="timestamp"
            type="datetime-local"
            style={inputStyle}
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: submitting ? '#888' : '#2b6cb0',
            color: '#fff',
            fontSize: 15,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Recording…' : 'Record usage'}
        </button>

        {submitError && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Usage failed:</strong> {submitError}
          </div>
        )}
      </form>

      <div>
        <h2 style={{ marginTop: 0 }}>Result</h2>
        {!result ? (
          <p style={{ color: '#999' }}>Record usage to bill it against the subscription and narrate it in Slack.</p>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: UsageSuccess }) {
  const u = result.usage;
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 14 };
  const unit = u.quantity === 1 ? u.unitName : `${u.unitName}s`;
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef7ee', border: '1px solid #bcd9bc' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>✅ Usage recorded</div>
      <div style={row}><span>Component</span><strong>{u.componentName}</strong></div>
      <div style={row}><span>Quantity</span><strong>{u.quantity} {unit}</strong></div>
      {u.periodTotal != null && (
        <div style={row}><span>Period total</span><strong>{u.periodTotal} {u.unitName}s</strong></div>
      )}
      {u.recordedEvents != null && (
        <div style={row}><span>Events recorded</span><strong>{u.recordedEvents}</strong></div>
      )}
      <div style={row}><span>Transaction</span><strong>{result.txnId}</strong></div>
      <div style={row}>
        <span>Slack channel</span>
        <strong>{result.channelName ? `#${result.channelName}` : 'not created'}</strong>
      </div>
      <p style={{ marginTop: 12, marginBottom: 0, color: '#3a6b3a', fontSize: 13 }}>Accrues to the next invoice.</p>
    </div>
  );
}
