import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  commitPlanChange,
  formatMoney,
  formatSignedMoney,
  getCurrentPlan,
  getLastTxn,
  getProducts,
  previewPlanChange,
  rememberCurrentPlan,
  type CommitSuccess,
  type PlanChangeTiming,
  type PlanOption,
  type PreviewSuccess,
} from '../../api';

/**
 * UC3 — Plan Change with proration preview (client form). Two-step: Preview
 * computes the prorated delta (and narrates it in Slack); Confirm commits it.
 * The preview is cleared whenever inputs change so a commit always matches the
 * numbers the user last saw.
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

function effectiveLabel(timing: PlanChangeTiming, effectiveDate: string | null): string {
  if (effectiveDate) return new Date(effectiveDate).toLocaleString();
  return timing === 'prorate' ? 'Immediately' : 'next renewal';
}

export default function PlanChangeForm() {
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [txnRef, setTxnRef] = useState<string>(getLastTxn());
  const [targetHandle, setTargetHandle] = useState<string>('');
  const [timing, setTiming] = useState<PlanChangeTiming>('prorate');

  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewSuccess | null>(null);
  const [committed, setCommitted] = useState<CommitSuccess | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProducts()
      .then((p) => {
        setPlans(p.plans);
        setTargetHandle(p.plans[0]?.handle ?? '');
      })
      .catch((e: unknown) => setCatalogError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingCatalog(false));
  }, []);

  // Any input change invalidates a prior preview/commit.
  function resetOutputs() {
    setPreview(null);
    setCommitted(null);
    setFieldErrors([]);
    setError(null);
  }

  function handleApiError(err: unknown) {
    if (err instanceof ApiError) {
      const payload = err.payload as { status?: string; errors?: FieldError[]; error?: string } | undefined;
      if (payload?.status === 'invalid' && Array.isArray(payload.errors)) setFieldErrors(payload.errors);
      else if (payload?.error) setError(payload.error);
      else setError(`Request failed (${err.httpStatus})`);
    } else {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    }
  }

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    resetOutputs();

    // Client-side guard: block a no-op change before any API call. The backend
    // enforces this too (authoritative), so a stale/unknown local value just
    // falls through to the server check.
    const knownCurrent = getCurrentPlan(txnRef.trim());
    if (knownCurrent && knownCurrent === targetHandle) {
      setError('This subscription is already on that plan. Choose a different plan.');
      return;
    }

    setPreviewing(true);
    try {
      const res = await previewPlanChange({ txnRef: txnRef.trim(), targetHandle, timing });
      setPreview(res);
      // Keep the local "current plan" accurate from the authoritative read.
      if (res.preview.fromHandle) rememberCurrentPlan(txnRef.trim(), res.preview.fromHandle);
    } catch (err) {
      handleApiError(err);
    } finally {
      setPreviewing(false);
    }
  }

  async function onConfirm() {
    setCommitting(true);
    setError(null);
    try {
      const res = await commitPlanChange({ txnRef: txnRef.trim(), targetHandle, timing });
      setCommitted(res);
      // A prorated change takes effect now, so the current plan is the new one.
      // An at-renewal change does not change the current plan yet.
      if (res.planChange.timing === 'prorate') {
        rememberCurrentPlan(txnRef.trim(), res.planChange.toHandle);
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      setCommitting(false);
    }
  }

  function errorFor(path: string): string | undefined {
    return fieldErrors.find((e) => e.path === path)?.message;
  }

  if (loadingCatalog) return <p style={{ color: '#999' }}>Loading plan-change form…</p>;
  if (catalogError) return <p style={{ color: '#b00' }}>Could not load catalog: {catalogError}</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={onPreview} aria-label="Plan change">
        <h2 style={{ marginTop: 0 }}>Change plan</h2>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="txnRef">Transaction ID</label>
          <input
            id="txnRef"
            style={inputStyle}
            value={txnRef}
            onChange={(e) => {
              setTxnRef(e.target.value);
              resetOutputs();
            }}
            placeholder="txn_… (from a booking)"
            required
          />
          {errorFor('txnRef') && <small style={{ color: '#b00' }}>{errorFor('txnRef')}</small>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="target">Target plan</label>
          <select
            id="target"
            style={inputStyle}
            value={targetHandle}
            onChange={(e) => {
              setTargetHandle(e.target.value);
              resetOutputs();
            }}
          >
            {plans.map((p) => (
              <option key={p.handle} value={p.handle}>
                {p.name} — {formatMoney(p.priceInCents)}/mo
              </option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="timing">Timing</label>
          <select
            id="timing"
            style={inputStyle}
            value={timing}
            onChange={(e) => {
              setTiming(e.target.value as PlanChangeTiming);
              resetOutputs();
            }}
          >
            <option value="prorate">Prorate now (immediate)</option>
            <option value="at-renewal">At renewal (no proration)</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={previewing || committing}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: '1px solid #2b6cb0',
            background: '#fff',
            color: '#2b6cb0',
            fontSize: 15,
            cursor: previewing ? 'default' : 'pointer',
          }}
        >
          {previewing ? 'Previewing…' : 'Preview change'}
        </button>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Failed:</strong> {error}
          </div>
        )}
      </form>

      <div>
        <h2 style={{ marginTop: 0 }}>{committed ? 'Result' : 'Preview'}</h2>
        {committed ? (
          <CommittedPanel result={committed} />
        ) : preview ? (
          <PreviewPanel preview={preview} onConfirm={onConfirm} committing={committing} />
        ) : (
          <p style={{ color: '#999' }}>Preview a plan change to see the prorated delta before committing.</p>
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

function PreviewPanel({
  preview,
  onConfirm,
  committing,
}: {
  preview: PreviewSuccess;
  onConfirm: () => void;
  committing: boolean;
}) {
  const p = preview.preview;
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#fff8e6', border: '1px solid #e6d39c' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🔍 Plan change preview</div>
      <div style={row}><span>From</span><strong>{p.fromName ?? '—'}</strong></div>
      <div style={row}><span>To</span><strong>{p.targetName}</strong></div>
      <div style={row}><span>Timing</span><strong>{p.timing}</strong></div>
      <div style={row}><span>Proration</span><strong>{formatSignedMoney(p.proratedAdjustmentInCents)}</strong></div>
      <div style={row}><span>Due now</span><strong>{formatMoney(p.paymentDueInCents)}</strong></div>
      <div style={row}><span>Effective</span><strong>{effectiveLabel(p.timing, p.effectiveDate)}</strong></div>
      <button
        onClick={onConfirm}
        disabled={committing}
        style={{
          marginTop: 14,
          padding: '10px 18px',
          borderRadius: 8,
          border: 'none',
          background: committing ? '#888' : '#2b6cb0',
          color: '#fff',
          fontSize: 15,
          cursor: committing ? 'default' : 'pointer',
        }}
      >
        {committing ? 'Applying…' : 'Confirm change'}
      </button>
    </div>
  );
}

function CommittedPanel({ result }: { result: CommitSuccess }) {
  const c = result.planChange;
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef7ee', border: '1px solid #bcd9bc' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🔄 Plan changed</div>
      <div style={row}><span>From</span><strong>{c.fromName ?? '—'}</strong></div>
      <div style={row}><span>To</span><strong>{c.toName}</strong></div>
      <div style={row}><span>Timing</span><strong>{c.timing}</strong></div>
      <div style={row}><span>Proration</span><strong>{formatSignedMoney(c.proratedAdjustmentInCents)}</strong></div>
      <div style={row}><span>State</span><strong>{c.state}</strong></div>
      <div style={row}><span>Effective</span><strong>{effectiveLabel(c.timing, c.effectiveDate)}</strong></div>
      <div style={row}>
        <span>Slack channel</span>
        <strong>{result.channelName ? `#${result.channelName}` : 'not created'}</strong>
      </div>
      <a
        href={c.maxioUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 12, padding: '8px 14px', borderRadius: 8, background: '#2b6cb0', color: '#fff', textDecoration: 'none', fontSize: 14 }}
      >
        View in Maxio
      </a>
    </div>
  );
}
