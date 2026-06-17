import { useEffect, useState } from 'react';
import {
  ApiError,
  clearAdminAuth,
  formatMoney,
  getConsultants,
  requestDigest,
  type ConsultantOption,
  type DigestSuccess,
} from '../../api';

/**
 * UC6 — Billing Activity Digest (admin panel). Per-consultant summary built
 * from Maxio's live data and posted to the digest channel. Manual trigger.
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

export default function ActivityPanel({ onAuthExpired }: { onAuthExpired: (notice: string) => void }) {
  const [consultants, setConsultants] = useState<ConsultantOption[]>([]);
  const [consultantId, setConsultantId] = useState('');
  const [windowDays, setWindowDays] = useState('30');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<DigestSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConsultants()
      .then((c) => {
        setConsultants(c.consultants);
        setConsultantId(c.consultants[0]?.id ?? '');
      })
      .catch((e: unknown) => setCatalogError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingCatalog(false));
  }, []);

  async function onBuild() {
    setBuilding(true);
    setResult(null);
    setError(null);
    try {
      const res = await requestDigest({ consultantId, windowDays: Number(windowDays) });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.httpStatus === 401) {
          clearAdminAuth();
          onAuthExpired('Admin credentials were rejected. Please sign in again.');
          return;
        }
        const payload = err.payload as { error?: string } | undefined;
        setError(payload?.error ?? `Request failed (${err.httpStatus})`);
      } else {
        setError(err instanceof Error ? err.message : 'Unexpected error');
      }
    } finally {
      setBuilding(false);
    }
  }

  if (loadingCatalog) return <p style={{ color: '#999' }}>Loading…</p>;
  if (catalogError) return <p style={{ color: '#b00' }}>Could not load consultants: {catalogError}</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      <div aria-label="Billing digest">
        <h2 style={{ marginTop: 0 }}>Billing digest</h2>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="consultant">Consultant</label>
          <select id="consultant" style={inputStyle} value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="windowDays">Window (days)</label>
          <input
            id="windowDays"
            type="number"
            min={1}
            max={365}
            style={inputStyle}
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
          />
        </div>

        <button
          onClick={onBuild}
          disabled={building}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: building ? '#888' : '#2b6cb0', color: '#fff', fontSize: 15, cursor: building ? 'default' : 'pointer' }}
        >
          {building ? 'Building…' : 'Build digest'}
        </button>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 14 }}>
            <strong>Digest failed:</strong> {error}
          </div>
        )}
      </div>

      <div>
        <h2 style={{ marginTop: 0 }}>Result</h2>
        {!result ? (
          <p style={{ color: '#999' }}>Build a digest to summarize a consultant's billing activity and post it to Slack.</p>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: DigestSuccess }) {
  const d = result.digest;
  const card: React.CSSProperties = { padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e3e3e3', textAlign: 'center' };
  const num: React.CSSProperties = { fontSize: 22, fontWeight: 700 };
  const cap: React.CSSProperties = { fontSize: 12, color: '#666' };
  return (
    <div style={{ padding: 16, borderRadius: 10, background: '#eef4fb', border: '1px solid #bcd0e6' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>📈 Billing digest — {d.consultantName}</div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>last {d.windowDays} days · {new Date(d.generatedAt).toLocaleString()}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div style={card}><div style={num}>{d.activeCount}</div><div style={cap}>Active</div></div>
        <div style={card}><div style={num}>{formatMoney(d.mrrInCents)}</div><div style={cap}>MRR / mo</div></div>
        <div style={card}><div style={num}>{d.newSignups}</div><div style={cap}>New signups</div></div>
        <div style={card}><div style={num}>{d.churned}</div><div style={cap}>Churn</div></div>
        <div style={card}><div style={num}>{d.openInvoices}</div><div style={cap}>Open invoices</div></div>
        <div style={card}><div style={num}>{d.overdueInvoices}</div><div style={cap}>Overdue</div></div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: '#444' }}>
        {result.posted ? (
          <>Posted to <strong>{result.digestChannel}</strong>.</>
        ) : (
          <>Not posted{result.digestChannel ? ` (channel ${result.digestChannel})` : ' (no digest channel configured)'}.</>
        )}
      </div>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: '#888' }}>
        Reporting data is for reconciliation, not real-time confirmation — counts may lag live state slightly.
      </p>
    </div>
  );
}
