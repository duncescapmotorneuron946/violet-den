import React, { useState, useEffect } from 'react';
import { setToken, getToken, api } from './api';

export default function AuthWrapper({ children }) {
  const [authed,   setAuthed]   = useState(false);
  const [checking, setChecking] = useState(() => !!getToken()); // only check if we have a stored token
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Validate stored token on mount — catches stale tokens after backend restart
  useEffect(() => {
    if (!getToken()) return;
    api('/api/validate-token')
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setAuthed(true);
        } else {
          setToken(null);
        }
      })
      .catch(() => {
        // Backend unreachable — clear stale token
        setToken(null);
      })
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
        setAuthed(true);
      } else {
        setError('Invalid credentials');
      }
    } catch {
      setError('Cannot reach server — is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  // Show loading spinner while validating stored token
  if (checking) {
    return (
      <div className="auth-screen">
        <div className="app-logo-wrap" style={{ margin: '0 auto' }}>
          <img src="/favicon.svg" className="app-logo" alt="" />
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo-wrap">
            <img src="/favicon.svg" className="auth-logo-img" alt="" />
          </div>
          <h2>Welcome back</h2>
          <span className="auth-subtitle">Sign in to your smart home dashboard</span>
          <form className="auth-form" onSubmit={handleLogin}>
            <input
              className="auth-input"
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            {error && <div className="auth-error">{error}</div>}
          </form>
        </div>
      </div>
    );
  }

  return children;
}
