import { useState, type FormEvent } from 'react';
import { setAdminAuth } from '../../api';

/**
 * Hardcoded-cred admin gate (plan §4.2). Stores HTTP Basic credentials for the
 * session; validity is enforced server-side by adminGuard on the first admin
 * request (a 401 bounces back here). Placeholder for real auth.
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

export default function AdminLogin({ onAuthed, notice }: { onAuthed: () => void; notice?: string }) {
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setAdminAuth(user.trim(), password);
    onAuthed();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Admin sign in" style={{ maxWidth: 360 }}>
      <h2 style={{ marginTop: 0 }}>Admin sign in</h2>
      {notice && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: '#fdeaea', border: '1px solid #e0b4b4', fontSize: 13 }}>
          {notice}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle} htmlFor="adminUser">Username</label>
        <input id="adminUser" style={inputStyle} value={user} onChange={(e) => setUser(e.target.value)} required />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle} htmlFor="adminPass">Password</label>
        <input
          id="adminPass"
          type="password"
          style={inputStyle}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button
        type="submit"
        style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#2b6cb0', color: '#fff', fontSize: 15, cursor: 'pointer' }}
      >
        Sign in
      </button>
      <p style={{ color: '#999', fontSize: 12, marginTop: 12 }}>
        Credentials are checked by the server (adminGuard); they are not validated here.
      </p>
    </form>
  );
}
