import { useState, type FormEvent } from 'react';
import {
  ApiError,
  getLastTxn,
  lifecycle,
  type CancelType,
  type LifecycleAction,
  type LifecycleSuccess,
} from '../../api';

/**
 * UC4 — Lifecycle Control (client form). One form, four actions. cancelType is
 * shown only when cancelling. The result panel renders the state transition,
 * including a scheduled end-of-period cancellation.
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

const ACTIONS: Array<{ value: LifecycleAction; label: string }> = [
  { value: 'pause', label: 'Pause (hold)' },
  { value: 'resume', label: 'Resume' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'reactivate', label: 'Reactivate' },
];

interface FieldError {
  path: string;
  message: string;
}

function effectiveLabel(effectiveDate: string | null): string {
  return effectiveDate ? new Date(effectiveDate).toLocaleString() : 'Immediately';
}

export default function LifecycleForm() {
  const [txnRef, setTxnRef] = useState<string>(getLastTxn());
  const [action, setAction] = useState<LifecycleAction>('pause');
  const [cancelType, setCancelType] = useState<CancelType>('immediate');
  const [reasonCode, setReasonCode] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LifecycleSuccess | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isCancel = action === 'cancel';

  function errorFor(path: string): string | undefined {
    return fieldErrors.find((e) => e.path === path)?.message;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setFieldErrors([]);
    setError(null);
    try {
      const res = await lifecycle({
        txnRef: txnRef.trim(),
        action,
        ...(isCancel ? { cancelType } : {}),
        ...(isCancel && reasonCode.trim() ? { reasonCode: reasonCode.trim() } : {}),
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={onSubmit} aria-label="Lifecycle control">
        <h2 style={{ marginTop: 0 }}>Manage subscription</h2>

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
          <label style={labelStyle} htmlFor="action">Action</label>
          <select
            id="action"
            style={inputStyle}
            value={action}
            onChange={(e) => setAction(e.target.value as LifecycleAction)}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>

        {isCancel && (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cancelType">Cancel type</label>
              <select
                id="cancelType"
                style={inputStyle}
                value={cancelType}
                onChange={(e) => setCancelType(e.target.value as CancelType)}
              >
                <option value="immediate">Immediate</option>
                <option value="end-of-period">End of period (keep access until renewal)</option>
              </select>
              {errorFor('cancelType') && <small style={{ color: '#b00' }}>{errorFor('cancelType')}</small>}
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="reasonCode">Reason code (optional)</label>
              <input
                id="reasonCode"
                style={inputStyle}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="e.g. too_expensive"
              />
            </div>
          </>
        )}

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
          {submitting ? 'Applying…' : 'Apply action'}
        </button>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Action failed:</strong> {error}
          </div>
        )}
      </form>

      <div>
        <h2 style={{ marginTop: 0 }}>Result</h2>
        {!result ? (
          <p style={{ color: '#999' }}>Apply a lifecycle action to update the subscription and narrate it in Slack.</p>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid #eee',
  fontSize: 14,
};

function ResultPanel({ result }: { result: LifecycleSuccess }) {
  const l = result.lifecycle;
  const target = l.scheduledCancellation ? 'canceling at period end' : l.toState;
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef7ee', border: '1px solid #bcd9bc' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🚦 {l.fromState} → {target}</div>
      <div style={row}>
        <span>State</span>
        <strong>{l.scheduledCancellation ? `${l.toState} (pending cancellation)` : l.toState}</strong>
      </div>
      <div style={row}><span>Action</span><strong>{l.action}{l.cancelType ? ` (${l.cancelType})` : ''}</strong></div>
      <div style={row}><span>Reason</span><strong>{l.reasonCode ?? '—'}</strong></div>
      <div style={row}><span>Effective</span><strong>{effectiveLabel(l.effectiveDate)}</strong></div>
      <div style={row}>
        <span>Slack channel</span>
        <strong>{result.channelName ? `#${result.channelName}` : 'not created'}</strong>
      </div>
      <a
        href={l.maxioUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 12, padding: '8px 14px', borderRadius: 8, background: '#2b6cb0', color: '#fff', textDecoration: 'none', fontSize: 14 }}
      >
        View in Maxio
      </a>
    </div>
  );
}
