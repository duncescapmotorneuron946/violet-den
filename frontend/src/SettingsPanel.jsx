import React, { useState, useEffect } from 'react';
import { api } from './api';

export default function SettingsPanel({ onClose }) {
  const [tab, setTab] = useState('creds'); // 'creds' | 'cert' | 'data'

  return (
    <div className="settings-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        <div className="settings-header">
          <span className="material-icons" style={{ fontSize: '1.2rem', color: 'var(--v400)' }}>settings</span>
          <h2>Settings</h2>
          <button className="btn-icon btn-cancel settings-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="settings-tabs">
          {[
            { key: 'creds', icon: 'manage_accounts', label: 'Credentials' },
            { key: 'cert',  icon: 'shield',          label: 'Certificate' },
            { key: 'data',  icon: 'database',         label: 'Data' },
          ].map(t => (
            <button
              key={t.key}
              className={`settings-tab${tab === t.key ? ' settings-tab-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="material-icons" style={{ fontSize: '1rem' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'creds' && <CredsTab />}
          {tab === 'cert'  && <CertTab />}
          {tab === 'data'  && <DataTab />}
        </div>
      </div>
    </div>
  );
}

/* ── Credentials Tab ─────────────────────────────── */
function CredsTab() {
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [confirm,  setConfirm]        = useState('');
  const [msg, setMsg]                 = useState('');
  const [ok, setOk]                   = useState(null);

  const save = async () => {
    setMsg('');
    if (!username || !password) { setMsg('Both fields required'); setOk(false); return; }
    if (password !== confirm) { setMsg('Passwords do not match'); setOk(false); return; }
    try {
      const res = await api('/api/change-creds', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      setOk(data.success);
      setMsg(data.success ? 'Credentials updated!' : (data.error || 'Failed'));
      if (data.success) { setUsername(''); setPassword(''); setConfirm(''); }
    } catch (err) {
      setOk(false); setMsg(`Error: ${err.message}`);
    }
  };

  return (
    <div className="settings-section">
      <h3>Change Admin Credentials</h3>
      <p className="settings-hint">Update the username and password used to log in to this dashboard.</p>
      <div className="settings-form">
        <input className="settings-input" type="text" placeholder="New Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" />
        <input className="settings-input" type="password" placeholder="New Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
        <input className="settings-input" type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
        <button className="settings-btn settings-btn-primary" onClick={save}>Update Credentials</button>
      </div>
      {msg && <div className={`settings-msg ${ok ? 'settings-msg-ok' : 'settings-msg-err'}`}>{msg}</div>}
    </div>
  );
}

/* ── Certificate Tab ─────────────────────────────── */
function CertTab() {
  const [cert, setCert]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [domain, setDomain]         = useState('');
  const [msg, setMsg]               = useState('');
  const [ok, setOk]                 = useState(null);
  const [generating, setGenerating] = useState(false);

  const loadCert = async () => {
    setLoading(true);
    try {
      const res = await api('/api/cert-status');
      setCert(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadCert(); }, []);

  const genSelfSigned = async () => {
    if (!domain) { setMsg('Domain required'); setOk(false); return; }
    setGenerating(true); setMsg('');
    try {
      const res = await api('/api/generate-cert', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      setOk(data.success); setMsg(data.message || data.error);
      if (data.success) loadCert();
    } catch (err) {
      setOk(false); setMsg(`Error: ${err.message}`);
    }
    setGenerating(false);
  };

  const deleteCert = async () => {
    try {
      const res = await api('/api/cert', { method: 'DELETE' });
      const data = await res.json();
      setOk(data.success); setMsg(data.message || data.error);
      loadCert();
    } catch (err) {
      setOk(false); setMsg(`Error: ${err.message}`);
    }
  };

  return (
    <div className="settings-section">
      <h3>SSL/TLS Certificate</h3>

      {loading ? (
        <p className="settings-hint">Loading certificate status…</p>
      ) : cert?.exists ? (
        <div className="cert-info">
          <div className="cert-badge cert-badge-ok">
            <span className="material-icons" style={{ fontSize: '1rem' }}>verified</span>
            Certificate installed
          </div>
          <div className="cert-details">
            {cert.subject   && <div><strong>Subject:</strong> {cert.subject}</div>}
            {cert.issuer    && <div><strong>Issuer:</strong> {cert.issuer}</div>}
            {cert.validFrom && <div><strong>Valid from:</strong> {cert.validFrom}</div>}
            {cert.validTo   && <div><strong>Valid until:</strong> {cert.validTo}</div>}
          </div>
          <button className="settings-btn settings-btn-danger" onClick={deleteCert}>Remove Certificate</button>
        </div>
      ) : (
        <div className="cert-info">
          <div className="cert-badge cert-badge-none">
            <span className="material-icons" style={{ fontSize: '1rem' }}>gpp_maybe</span>
            No certificate installed
          </div>
        </div>
      )}

      <div className="settings-divider" />

      <h3>Generate Self-Signed Certificate</h3>
      <p className="settings-hint">Creates a self-signed certificate for HTTPS on your local network. Your browser will show a warning, but the connection will be encrypted.</p>
      <div className="settings-form">
        <input className="settings-input" type="text" placeholder="Domain (e.g. home.local)" value={domain} onChange={e => setDomain(e.target.value)} />
        <button className="settings-btn settings-btn-primary" onClick={genSelfSigned} disabled={generating}>
          {generating ? 'Generating…' : 'Generate Certificate'}
        </button>
      </div>
      {msg && <div className={`settings-msg ${ok ? 'settings-msg-ok' : 'settings-msg-err'}`}>{msg}</div>}
    </div>
  );
}

/* ── Data Tab ────────────────────────────────────── */
function DataTab() {
  const [msg, setMsg] = useState('');
  const [ok, setOk]   = useState(null);

  const clearData = async (target) => {
    const labels = { sections: 'all sections', ssh_services: 'all SSH servers', credentials: 'stored credentials', all: 'ALL data' };
    if (!confirm(`Are you sure you want to clear ${labels[target]}? This cannot be undone.`)) return;
    try {
      const res = await api('/api/clear-data', {
        method: 'POST',
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      setOk(data.success); setMsg(data.message || data.error);
    } catch (err) {
      setOk(false); setMsg(`Error: ${err.message}`);
    }
  };

  return (
    <div className="settings-section">
      <h3>Manage Stored Data</h3>
      <p className="settings-hint">Clear specific data from the database. These actions cannot be undone.</p>

      <div className="data-actions">
        <div className="data-action-row">
          <div className="data-action-info">
            <span className="material-icons" style={{ fontSize: '1.1rem', color: 'var(--v400)' }}>view_module</span>
            <div>
              <strong>Dashboard Sections</strong>
              <span>All link sections and their contents</span>
            </div>
          </div>
          <button className="settings-btn settings-btn-danger-sm" onClick={() => clearData('sections')}>Clear</button>
        </div>

        <div className="data-action-row">
          <div className="data-action-info">
            <span className="material-icons" style={{ fontSize: '1.1rem', color: 'var(--v400)' }}>terminal</span>
            <div>
              <strong>SSH/Telnet Servers</strong>
              <span>All saved server connections</span>
            </div>
          </div>
          <button className="settings-btn settings-btn-danger-sm" onClick={() => clearData('ssh_services')}>Clear</button>
        </div>

        <div className="data-action-row">
          <div className="data-action-info">
            <span className="material-icons" style={{ fontSize: '1.1rem', color: 'var(--v400)' }}>manage_accounts</span>
            <div>
              <strong>Stored Credentials</strong>
              <span>Reverts to env-var defaults</span>
            </div>
          </div>
          <button className="settings-btn settings-btn-danger-sm" onClick={() => clearData('credentials')}>Clear</button>
        </div>

        <div className="settings-divider" />

        <div className="data-action-row data-action-destructive">
          <div className="data-action-info">
            <span className="material-icons" style={{ fontSize: '1.1rem', color: '#f87171' }}>delete_forever</span>
            <div>
              <strong>Factory Reset</strong>
              <span>Clear everything — sections, servers, credentials</span>
            </div>
          </div>
          <button className="settings-btn settings-btn-danger" onClick={() => clearData('all')}>Reset All</button>
        </div>
      </div>

      {msg && <div className={`settings-msg ${ok ? 'settings-msg-ok' : 'settings-msg-err'}`}>{msg}</div>}
    </div>
  );
}
