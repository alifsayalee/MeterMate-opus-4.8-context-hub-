import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse, ApiError } from './api';

type Role = 'client' | 'admin';

/**
 * App shell. Hosts the Client/Admin role switch and a live health banner so the
 * demo operator can see at a glance whether Maxio + Slack are wired. Per-usecase
 * forms are mounted here as each vertical slice is built.
 */
export default function App() {
  const [role, setRole] = useState<Role>('client');
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
        <p style={{ color: '#999' }}>
          {role === 'client' ? 'Client' : 'Admin'} forms will appear here as each use case is built.
        </p>
      </main>
    </div>
  );
}
