import React, { useState } from 'react';
import IconPicker, { isMaterialIcon } from './IconPicker';

function IconDisplay({ value }) {
  if (!value) return null;
  return isMaterialIcon(value)
    ? <span className="material-icons" style={{ fontSize: '1rem', verticalAlign: 'middle', color: 'var(--v300)' }}>{value}</span>
    : <span>{value}</span>;
}

/* Load preset sections from VITE_PRESET_SECTIONS env var */
const loadPreset = () => {
  try { return JSON.parse(import.meta.env.VITE_PRESET_SECTIONS) || []; }
  catch { return []; }
};

function DraggableLinks({ links, setLinks }) {
  const [draggedIdx, setDraggedIdx] = useState(null);

  const handleDrop = (idx) => {
    if (draggedIdx === null || draggedIdx === idx) return;
    const next = [...links];
    const [moved] = next.splice(draggedIdx, 1);
    next.splice(idx, 0, moved);
    setLinks(next);
    setDraggedIdx(null);
  };

  return (
    <ul className="ob-link-list">
      {links.map((l, idx) => (
        <li
          key={idx}
          className="ob-link-item"
          draggable
          onDragStart={() => setDraggedIdx(idx)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDrop(idx)}
        >
          <span className="ob-link-drag">⠿</span>
          {l.icon && <IconDisplay value={l.icon} />}
          <span>{l.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{l.url}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Onboarding({ onComplete }) {
  /* ── Credentials (required) ── */
  const [username,        setUsername]        = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /* ── Sections builder ── */
  const [sections,  setSections]  = useState(loadPreset);
  const [title,     setTitle]     = useState('');
  const [icon,      setIcon]      = useState('');
  const [links,     setLinks]     = useState([]);
  const [linkName,  setLinkName]  = useState('');
  const [linkUrl,   setLinkUrl]   = useState('');
  const [linkIcon,  setLinkIcon]  = useState('');

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const addLink = () => {
    if (!linkName || !linkUrl) return;
    setLinks([...links, { name: linkName, url: linkUrl, icon: linkIcon }]);
    setLinkName(''); setLinkUrl(''); setLinkIcon('');
  };

  const addSection = () => {
    if (!title || !links.length) return;
    setSections([...sections, { title, icon, links }]);
    setTitle(''); setIcon(''); setLinks([]);
  };

  const saveConfig = async () => {
    setError('');
    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    if (password.length < 4) { setError('Password must be at least 4 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          sections: JSON.stringify(sections),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Setup failed');
        setSaving(false);
        return;
      }
      onComplete(sections);
    } catch {
      setError('Cannot reach server — is the backend running?');
      setSaving(false);
    }
  };

  const credsValid = username.trim() && password && password.length >= 4 && password === confirmPassword;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">

        <div className="ob-logo-wrap">
          <img src="/favicon.svg" className="ob-logo-img" alt="" />
        </div>

        <h2>Welcome to VioletDen</h2>
        <p>
          Set up your admin credentials and organize your dashboard.
        </p>

        <div className="onboarding-section-builder">

          <h3>
            <span className="material-icons" style={{ fontSize: '1.1rem', verticalAlign: 'middle', marginRight: '6px', color: 'var(--v400)' }}>lock</span>
            Create Admin Account
          </h3>
          <p className="ob-hint">Choose a username and password to secure your dashboard.</p>
          <div className="ob-cred-fields">
            <input
              className="ob-input"
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            <input
              className="ob-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input
              className="ob-input"
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {credsValid && (
            <div className="ob-cred-ok">
              <span className="material-icons" style={{ fontSize: '0.9rem' }}>check_circle</span>
              Credentials ready
            </div>
          )}

          <div className="ob-divider" />

          <h3>Create a Section</h3>
          <div className="ob-section-fields">
            <IconPicker value={icon} onChange={setIcon} placeholder="icon" />
            <input className="ob-input" type="text" placeholder="Section Title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <h3>
            Add Links&nbsp;
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, fontSize: '0.78rem' }}>
              (drag to reorder)
            </span>
          </h3>
          <div className="ob-link-fields">
            <IconPicker value={linkIcon} onChange={setLinkIcon} placeholder="icon" />
            <input className="ob-input" type="text" placeholder="Link Name" value={linkName} onChange={e => setLinkName(e.target.value)} />
            <input className="ob-input" type="text" placeholder="URL"       value={linkUrl}  onChange={e => setLinkUrl(e.target.value)}  onKeyDown={e => e.key === 'Enter' && addLink()} />
            <button className="ob-btn ob-btn-primary" onClick={addLink}>Add</button>
          </div>

          <DraggableLinks links={links} setLinks={setLinks} />

          <button className="ob-btn ob-btn-primary" onClick={addSection}>Add Section</button>

          {sections.length > 0 && (
            <div className="ob-sections-preview">
              <h3>Preview</h3>
              {sections.map((s, idx) => (
                <div key={idx} className="ob-preview-section">
                  <strong>
                    {s.icon && <><IconDisplay value={s.icon} />&nbsp;</>}{s.title}
                  </strong>
                  {s.links.map((l, li) => (
                    <span key={li} className="ob-preview-link">
                      →&nbsp;{l.icon && <><IconDisplay value={l.icon} />&nbsp;</>}{l.name}&nbsp;
                      <span style={{ color: 'var(--text-muted)' }}>{l.url}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {error && <div className="ob-msg ob-msg-error">{error}</div>}

          <button className="btn-finish" onClick={saveConfig} disabled={saving || !credsValid}>
            {saving ? 'Saving…' : 'Save & Finish Setup'}
          </button>
          {!credsValid && (
            <p className="ob-hint" style={{ textAlign: 'center', marginTop: '8px' }}>
              Fill in credentials above to continue
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
