import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  book,
  formatMoney,
  getConsultants,
  getProducts,
  rememberLastTxn,
  type BookSuccess,
  type CollectionMethod,
  type ConsultantOption,
  type PlanOption,
} from '../../api';

/**
 * UC1 — Book & Subscribe (client form). Loads consultant/plan dropdowns from
 * the backend catalog, submits to POST /api/book, and renders the result:
 * subscription facts, the transaction channel that was created/reused, and a
 * clean failure state for validation (400) and maxio_failed (502) responses.
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

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  consultantId: string;
  productHandle: string;
  collectionMethod: CollectionMethod;
  couponCode: string;
}

const initialForm: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  consultantId: '',
  productHandle: '',
  collectionMethod: 'remittance',
  couponCode: '',
};

interface FieldError {
  path: string;
  message: string;
}

export default function BookForm() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookSuccess | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load dropdown data once.
  useEffect(() => {
    Promise.all([getConsultants(), getProducts()])
      .then(([c, p]) => {
        setConsultants(c.consultants);
        setPlans(p.plans);
        setForm((f) => ({
          ...f,
          consultantId: c.consultants[0]?.id ?? '',
          productHandle: p.plans[0]?.handle ?? '',
        }));
      })
      .catch((e: unknown) => setCatalogError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingCatalog(false));
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setFieldErrors([]);
    setSubmitError(null);

    try {
      const res = await book({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        consultantId: form.consultantId,
        productHandle: form.productHandle,
        collectionMethod: form.collectionMethod,
        ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
      });
      setResult(res);
      rememberLastTxn(res.txnId);
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

  function errorFor(path: string): string | undefined {
    return fieldErrors.find((e) => e.path === path)?.message;
  }

  if (loadingCatalog) return <p style={{ color: '#999' }}>Loading booking form…</p>;
  if (catalogError)
    return <p style={{ color: '#b00' }}>Could not load catalog: {catalogError}</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={onSubmit} aria-label="Book & subscribe">
        <h2 style={{ marginTop: 0 }}>Book a session</h2>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="firstName">First name</label>
            <input
              id="firstName"
              style={inputStyle}
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              required
            />
            {errorFor('firstName') && <small style={{ color: '#b00' }}>{errorFor('firstName')}</small>}
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle} htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              style={inputStyle}
              value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              required
            />
            {errorFor('lastName') && <small style={{ color: '#b00' }}>{errorFor('lastName')}</small>}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            style={inputStyle}
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
          {errorFor('email') && <small style={{ color: '#b00' }}>{errorFor('email')}</small>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="consultant">Consultant</label>
          <select
            id="consultant"
            style={inputStyle}
            value={form.consultantId}
            onChange={(e) => update('consultantId', e.target.value)}
          >
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="plan">Plan</label>
          <select
            id="plan"
            style={inputStyle}
            value={form.productHandle}
            onChange={(e) => update('productHandle', e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.handle} value={p.handle}>
                {p.name} — {formatMoney(p.priceInCents)}/mo
              </option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="collection">Payment collection</label>
          <select
            id="collection"
            style={inputStyle}
            value={form.collectionMethod}
            onChange={(e) => update('collectionMethod', e.target.value as CollectionMethod)}
          >
            <option value="remittance">Remittance (invoice, no card)</option>
            <option value="automatic">Automatic (stored card)</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="coupon">Coupon code (optional)</label>
          <input
            id="coupon"
            style={inputStyle}
            value={form.couponCode}
            onChange={(e) => update('couponCode', e.target.value)}
            placeholder="e.g. WELCOME10"
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
          {submitting ? 'Booking…' : 'Book & subscribe'}
        </button>

        {submitError && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Booking failed:</strong> {submitError}
          </div>
        )}
      </form>

      <div>
        <h2 style={{ marginTop: 0 }}>Result</h2>
        {!result ? (
          <p style={{ color: '#999' }}>Submit the form to create a subscription and a private Slack channel.</p>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: BookSuccess }) {
  const s = result.subscription;
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 14 };
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef7ee', border: '1px solid #bcd9bc' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        🎉 Subscription active
        {result.idempotentReplay && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#666', fontWeight: 400 }}>(idempotent replay)</span>
        )}
      </div>
      <div style={row}><span>Plan</span><strong>{s.planName}</strong></div>
      <div style={row}><span>MRR</span><strong>{formatMoney(s.mrrInCents)} / month</strong></div>
      <div style={row}><span>State</span><strong>{s.state}</strong></div>
      <div style={row}><span>Next bill</span><strong>{s.nextAssessmentAt ?? '—'}</strong></div>
      <div style={row}><span>Collection</span><strong>{s.collectionMethod}</strong></div>
      <div style={row}><span>Subscription ID</span><strong>{s.subscriptionId}</strong></div>
      <div style={row}><span>Transaction</span><strong>{result.txnId}</strong></div>
      <div style={row}>
        <span>Slack channel</span>
        <strong>{result.channelName ? `#${result.channelName}` : 'not created'}</strong>
      </div>
      <a
        href={s.maxioUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 12, padding: '8px 14px', borderRadius: 8, background: '#2b6cb0', color: '#fff', textDecoration: 'none', fontSize: 14 }}
      >
        View in Maxio
      </a>
    </div>
  );
}
