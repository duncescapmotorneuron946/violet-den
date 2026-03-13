import React, { useState, useEffect } from 'react';
import './App.css';
import AuthWrapper from './AuthWrapper';
import SSHPanel from './SSHPanel';
import Onboarding from './Onboarding';
import IconPicker, { isMaterialIcon } from './IconPicker';
import { api } from './api';
import SettingsPanel from './SettingsPanel';

/* Render a stored icon value — Material Icon name or emoji/text */
function IconDisplay({ value }) {
  if (!value) return null;
  return isMaterialIcon(value)
    ? <span className="material-icons mi-sm">{value}</span>
    : <span>{value}</span>;
}

/* ══════════════════════════════════════════════════════════════
   VIEW MODE — Clean, read-only dashboard
   ══════════════════════════════════════════════════════════════ */

function ViewLinkRow({ link }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className="view-link-row">
      <span className="view-link-icon">
        {link.icon ? <IconDisplay value={link.icon} /> : <span className="material-icons mi-sm">link</span>}
      </span>
      <span className="view-link-name">{link.name}</span>
      <span className="view-link-url">{link.url}</span>
      <span className="material-icons view-link-arrow">open_in_new</span>
    </a>
  );
}

function ViewSectionCard({ section }) {
  return (
    <div className="view-section">
      <div className="view-section-header">
        {section.icon && <span className="view-section-icon"><IconDisplay value={section.icon} /></span>}
        <h2 className="view-section-title">{section.title}</h2>
        <span className="view-section-count">{section.links.length}</span>
      </div>
      <div className="view-link-list">
        {section.links.map((link, idx) => (
          <ViewLinkRow key={idx} link={link} />
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   EDIT MODE — Full editing with drag-drop, inline editing
   ══════════════════════════════════════════════════════════════ */

function EditLinkRow({ link, idx, onEdit, onDelete, onDragStart, onDragOver, onDrop, dragging, dragOver }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: link.name, url: link.url, icon: link.icon || '' });

  const commit = () => { onEdit(idx, { ...form }); setEditing(false); };
  const cancel = () => { setForm({ name: link.name, url: link.url, icon: link.icon || '' }); setEditing(false); };

  const cls = [
    'section-row',
    dragging ? 'dragging-row'  : '',
    dragOver ? 'drag-over-row' : '',
    editing  ? 'editing-row'   : '',
  ].filter(Boolean).join(' ');

  return (
    <tr
      className={cls}
      draggable={!editing}
      onDragStart={() => !editing && onDragStart(idx)}
      onDragOver={e  => { e.preventDefault(); !editing && onDragOver(idx); }}
      onDrop={e      => { e.preventDefault(); !editing && onDrop(idx); }}
    >
      <td className="col-drag"><span className="drag-handle">⠿</span></td>
      <td className="col-icon">
        {editing
          ? <IconPicker value={form.icon} onChange={v => setForm({ ...form, icon: v })} />
          : <IconDisplay value={link.icon} />}
      </td>
      <td className="col-name">
        {editing
          ? <input className="inline-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" autoFocus />
          : <a href={link.url} target="_blank" rel="noopener noreferrer">{link.name}</a>}
      </td>
      <td className="col-url">
        {editing
          ? <input className="inline-input" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
          : <span className="url-text">{link.url}</span>}
      </td>
      <td className="col-actions">
        <div className="row-actions">
          {editing ? (
            <>
              <button className="btn-icon btn-save"   onClick={commit} title="Save">✓</button>
              <button className="btn-icon btn-cancel" onClick={cancel} title="Cancel">✕</button>
            </>
          ) : (
            <>
              <button className="btn-icon btn-edit"   onClick={() => setEditing(true)} title="Edit">✎</button>
              <button className="btn-icon btn-delete" onClick={() => onDelete(idx)}   title="Delete">✕</button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function EditSectionCard({ section, sectionIdx, onUpdate, onDelete, sectionDrag }) {
  const [draggedIdx,   setDraggedIdx]   = useState(null);
  const [dragOverIdx,  setDragOverIdx]  = useState(null);
  const [adding,       setAdding]       = useState(false);
  const [newLink,      setNewLink]      = useState({ name: '', url: '', icon: '' });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleForm,    setTitleForm]    = useState({ title: section.title, icon: section.icon || '' });

  const setLinks = (links) => onUpdate(sectionIdx, { ...section, links });

  const handleEdit   = (idx, data) => { const l = [...section.links]; l[idx] = data; setLinks(l); };
  const handleDelete = (idx)       => setLinks(section.links.filter((_, i) => i !== idx));

  const handleDragStart = (idx) => setDraggedIdx(idx);
  const handleDragOver  = (idx) => setDragOverIdx(idx);
  const handleDrop      = (idx) => {
    if (draggedIdx === null || draggedIdx === idx) { setDraggedIdx(null); setDragOverIdx(null); return; }
    const links = [...section.links];
    const [moved] = links.splice(draggedIdx, 1);
    links.splice(idx, 0, moved);
    setLinks(links);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleAddLink = () => {
    if (!newLink.name || !newLink.url) return;
    setLinks([...section.links, { ...newLink }]);
    setNewLink({ name: '', url: '', icon: '' });
    setAdding(false);
  };

  const commitTitle = () => {
    onUpdate(sectionIdx, { ...section, title: titleForm.title, icon: titleForm.icon });
    setEditingTitle(false);
  };

  const sectionCls = [
    'section',
    sectionDrag?.isDragging ? 'section-dragging' : '',
    sectionDrag?.isDragOver ? 'section-drag-over' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={sectionCls}
      onDragOver={e => { if (sectionDrag) { e.preventDefault(); sectionDrag.onDragOver(); } }}
      onDrop={e => { if (sectionDrag) { e.preventDefault(); sectionDrag.onDrop(); } }}
    >
      <div className="section-header">
        {sectionDrag && !editingTitle && (
          <span
            className="section-drag-handle"
            draggable
            onDragStart={e => { e.stopPropagation(); sectionDrag.onDragStart(); }}
            onDragEnd={sectionDrag.onDragEnd}
            title="Drag to reorder section"
          >⠿</span>
        )}
        {editingTitle ? (
          <div className="section-title-edit">
            <IconPicker value={titleForm.icon} onChange={v => setTitleForm({ ...titleForm, icon: v })} />
            <input className="inline-input" value={titleForm.title} onChange={e => setTitleForm({ ...titleForm, title: e.target.value })} placeholder="Section Title" autoFocus onKeyDown={e => e.key === 'Enter' && commitTitle()} />
            <button className="btn-icon btn-save"   onClick={commitTitle}>✓</button>
            <button className="btn-icon btn-cancel" onClick={() => setEditingTitle(false)}>✕</button>
          </div>
        ) : (
          <h2 className="section-title">
            {section.icon && <span className="section-icon"><IconDisplay value={section.icon} /></span>}
            {section.title}
            <button className="btn-icon btn-edit-title" onClick={() => setEditingTitle(true)} title="Edit title">✎</button>
          </h2>
        )}
        <button className="btn-icon btn-delete-section" onClick={() => onDelete(sectionIdx)} title="Delete section">✕</button>
      </div>

      <table className="section-table">
        <thead>
          <tr>
            <th className="col-drag"></th>
            <th className="col-icon">Icon</th>
            <th className="col-name">Name</th>
            <th className="col-url">URL</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {section.links.map((link, idx) => (
            <EditLinkRow
              key={idx}
              link={link}
              idx={idx}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              dragging={draggedIdx  === idx}
              dragOver={dragOverIdx === idx && draggedIdx !== idx}
            />
          ))}
          {adding && (
            <tr className="section-row editing-row">
              <td></td>
              <td><IconPicker value={newLink.icon} onChange={v => setNewLink({ ...newLink, icon: v })} /></td>
              <td><input className="inline-input" value={newLink.name} onChange={e => setNewLink({ ...newLink, name: e.target.value })} placeholder="Name" autoFocus onKeyDown={e => e.key === 'Enter' && handleAddLink()} /></td>
              <td><input className="inline-input" value={newLink.url}  onChange={e => setNewLink({ ...newLink, url: e.target.value })}  placeholder="https://…" onKeyDown={e => e.key === 'Enter' && handleAddLink()} /></td>
              <td>
                <div className="row-actions">
                  <button className="btn-icon btn-save"   onClick={handleAddLink}>✓</button>
                  <button className="btn-icon btn-cancel" onClick={() => setAdding(false)}>✕</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!adding && (
        <button className="btn-add-row" onClick={() => setAdding(true)}>+ Add Row</button>
      )}
    </div>
  );
}

function AddSectionForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('');
  const [icon,  setIcon]  = useState('');

  const handleAdd = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), icon: icon.trim(), links: [] });
  };

  return (
    <div className="add-section-form">
      <h3>New Section</h3>
      <div className="form-fields">
        <IconPicker value={icon} onChange={setIcon} />
        <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Section Title" autoFocus onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <button className="btn-icon btn-save"   onClick={handleAdd}>✓</button>
        <button className="btn-icon btn-cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   APP — Main component with view/edit mode
   ══════════════════════════════════════════════════════════════ */
/* Dashboard content — rendered inside AuthWrapper so auth token is always available */
function Dashboard({ showSettings, setShowSettings }) {
  const [sections,        setSections]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [editMode,        setEditMode]        = useState(false);
  const [addingSection,   setAddingSection]   = useState(false);
  const [dragSectionIdx,  setDragSectionIdx]  = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);

  useEffect(() => {
    api('/api/sections')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSections(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="app-logo-wrap" style={{ margin: '0 auto' }}>
          <img src="/favicon.svg" className="app-logo" alt="" />
        </div>
      </div>
    );
  }

  const updateSection = (idx, section) =>
    setSections(prev => { const s = [...prev]; s[idx] = section; return s; });

  const deleteSection = (idx) =>
    setSections(prev => prev.filter((_, i) => i !== idx));

  const addSection = (section) => {
    setSections(prev => [...prev, section]);
    setAddingSection(false);
  };

  const handleSectionDrop = (toIdx) => {
    if (dragSectionIdx === null || dragSectionIdx === toIdx) {
      setDragSectionIdx(null); setDragOverSection(null); return;
    }
    setSections(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragSectionIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setDragSectionIdx(null);
    setDragOverSection(null);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api('/api/save-sections', {
        method:  'POST',
        body:    JSON.stringify({ config: JSON.stringify(sections) }),
      });
    } finally {
      setSaving(false);
      setEditMode(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <div className="header-left">
          <div className="app-logo-wrap">
            <img src="/favicon.svg" className="app-logo" alt="" />
          </div>
          <h1>VioletDen</h1>
        </div>
        <div className="header-actions">
          <button className="btn-settings" onClick={() => setShowSettings(true)} title="Settings">
            <span className="material-icons">settings</span>
          </button>
          {editMode ? (
            <>
              <button className="btn-cancel-edit" onClick={() => setEditMode(false)}>Cancel</button>
              <button className="btn-save-config" onClick={saveConfig} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button className="btn-edit-mode" onClick={() => setEditMode(true)}>
              <span className="material-icons" style={{ fontSize: '1rem', marginRight: '6px' }}>edit</span>
              Edit
            </button>
          )}
        </div>
      </header>

      <main>
        {editMode ? (
          /* ── EDIT MODE ── */
          <>
            {sections.map((section, idx) => (
              <EditSectionCard
                key={idx}
                section={section}
                sectionIdx={idx}
                onUpdate={updateSection}
                onDelete={deleteSection}
                sectionDrag={{
                  isDragging:  dragSectionIdx === idx,
                  isDragOver:  dragOverSection === idx && dragSectionIdx !== idx,
                  onDragStart: () => setDragSectionIdx(idx),
                  onDragOver:  () => setDragOverSection(idx),
                  onDragEnd:   () => { setDragSectionIdx(null); setDragOverSection(null); },
                  onDrop:      () => handleSectionDrop(idx),
                }}
              />
            ))}
            {addingSection
              ? <AddSectionForm onAdd={addSection} onCancel={() => setAddingSection(false)} />
              : <button className="btn-add-section" onClick={() => setAddingSection(true)}>+ Add Section</button>
            }
          </>
        ) : (
          /* ── VIEW MODE — Clean dashboard ── */
          <div className="view-dashboard">
            {sections.length === 0 ? (
              <div className="view-empty">
                <span className="material-icons" style={{ fontSize: '2.5rem', color: 'var(--v400)', marginBottom: '12px' }}>dashboard</span>
                <p>No sections yet. Click <strong>Edit</strong> to get started.</p>
              </div>
            ) : (
              <div className="view-grid">
                {sections.map((section, idx) => (
                  <ViewSectionCard key={idx} section={section} />
                ))}
              </div>
            )}
          </div>
        )}

        <SSHPanel />
      </main>
      {/* SettingsPanel is now handled in App */}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   APP — Routes: Setup check → Onboarding OR Auth → Dashboard
   ══════════════════════════════════════════════════════════════ */
function App() {
  const [checking,      setChecking]      = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetch('/api/setup-status')
      .then(r => r.json())
      .then(data => setSetupComplete(data.setup_complete))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="auth-screen">
        <div className="app-logo-wrap" style={{ margin: '0 auto' }}>
          <img src="/favicon.svg" className="app-logo" alt="" />
        </div>
      </div>
    );
  }

  if (!setupComplete) {
    return (
      <Onboarding
        onComplete={() => setSetupComplete(true)}
      />
    );
  }

  return (
    <AuthWrapper>
      <Dashboard key={refreshKey} showSettings={showSettings} setShowSettings={setShowSettings} />
      {showSettings && (
        <SettingsPanel onClose={() => { setShowSettings(false); setRefreshKey(k => k + 1); }} />
      )}
    </AuthWrapper>
  );
}

export default App;
