import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse, ApiError, clearAdminAuth, hasAdminAuth } from './api';
import BookForm from './components/client/BookForm';
import UsageForm from './components/client/UsageForm';
import PlanChangeForm from './components/client/PlanChangeForm';
import LifecycleForm from './components/client/LifecycleForm';
import AdminLogin from './components/admin/AdminLogin';
import InvoiceForm from './components/admin/InvoiceForm';

type Role = 'client' | 'admin';
type ClientTab = 'book' | 'usage' | 'plan' | 'lifecycle';

const CLIENT_TABS: Array<{ id: ClientTab; label: string }> = [
  { id: 'book', label: 'Book & Subscribe' },
  { id: 'usage', label: 'Report Usage' },
  { id: 'plan', label: 'Change Plan' },
  { id: 'lifecycle', label: 'Lifecycle' },
];

/**
 * App shell. Hosts the Client/Admin role switch and a live health banner so the
 * demo operator can see at a glance whether Maxio + Slack are wired. Per-usecase
 * forms are mounted here as each vertical slice is built.
 */
export default function App() {
  const [role, setRole] = useState<Role>('client');
  const [clientTab, setClientTab] = useState<ClientTab>('book');
  const [adminAuthed, setAdminAuthed] = useState<boolean>(hasAdminAuth());
  const [adminNotice, setAdminNotice] = useState<string | undefined>(undefined);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? `${e.message} (${e.httpStatus})` : String(e));
      });
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 920, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>MeterMate</h1>
        <div role="tablist" aria-label="Role" style={{ display: 'flex', gap: 8 }}>
          {(['client', 'admin'] as const).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={role === r}
              onClick={() => setRole(r)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #ccc',
                background: role === r ? '#222' : '#fff',
                color: role === r ? '#fff' : '#222',
                cursor: 'pointer',
              }}
            >
              {r === 'client' ? 'Client' : 'Admin'}
            </button>
          ))}
        </div>
      </header>

      <p style={{ color: '#666' }}>
        A two-sided billing concierge — Maxio runs the billing, a private Slack channel narrates
        each transaction.
      </p>

      <section
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 8,
          background: error ? '#fdeaea' : '#eef7ee',
          border: `1px solid ${error ? '#e0b4b4' : '#bcd9bc'}`,
          fontSize: 14,
        }}
      >
        {error ? (
          <span>Backend unreachable: {error}</span>
        ) : health ? (
          <span>
            Backend <strong>{health.status}</strong> · Maxio{' '}
            <strong>{health.maxioConfigured ? 'configured' : 'not configured'}</strong> · Slack{' '}
            <strong>{health.slackConfigured ? 'configured' : 'not configured'}</strong>
            {health.demoMode ? ' · demo mode' : ''}
          </span>
        ) : (
          <span>Checking backend…</span>
        )}
      </section>

      <main style={{ marginTop: 24 }}>
        {role === 'client' ? (
          <>
            <nav style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 12 }}>
              {CLIENT_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setClientTab(t.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    background: clientTab === t.id ? '#2b6cb0' : '#fff',
                    color: clientTab === t.id ? '#fff' : '#333',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {clientTab === 'book' ? (
              <BookForm />
            ) : clientTab === 'usage' ? (
              <UsageForm />
            ) : clientTab === 'plan' ? (
              <PlanChangeForm />
            ) : (
              <LifecycleForm />
            )}
          </>
        ) : !adminAuthed ? (
          <AdminLogin
            notice={adminNotice}
            onAuthed={() => {
              setAdminNotice(undefined);
              setAdminAuthed(true);
            }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                onClick={() => {
                  clearAdminAuth();
                  setAdminAuthed(false);
                }}
                style={{ border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', padding: '6px 12px', fontSize: 13 }}
              >
                Sign out
              </button>
            </div>
            <InvoiceForm
              onAuthExpired={(notice) => {
                setAdminNotice(notice);
                setAdminAuthed(false);
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
