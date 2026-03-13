import { useEffect, useState, useRef, useCallback, Component } from 'react';
import { api, getToken } from './api';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

/* ── Error Boundary — prevents xterm crashes from killing the whole UI ── */
class TerminalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="xterm-container">
          <div className="xterm-toolbar">
            <span className="xterm-status xterm-status-error">
              <span className="xterm-status-dot"></span> Terminal Error
            </span>
            <button className="ssh-btn ssh-btn-ghost xterm-disconnect" onClick={this.props.onDisconnect}>
              <span className="material-icons" style={{ fontSize: '0.9rem', marginRight: '4px' }}>close</span>
              Close
            </button>
          </div>
          <pre style={{ padding: '16px', color: '#f87171', background: '#06061a', margin: 0, fontSize: '0.82rem' }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Server Form Dialog ──────────────────────────────── */
function ServerForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', host: '', port: '22', username: '', password: '', protocol: 'ssh' }
  );
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="ssh-dialog">
      <h3>{initial ? 'Edit Server' : 'Add Server'}</h3>
      <div className="ssh-dialog-grid">
        <label>Name</label>
        <input className="ssh-field" value={form.name}     onChange={e => set('name', e.target.value)}     placeholder="My Router" />
        <label>Host</label>
        <input className="ssh-field" value={form.host}     onChange={e => set('host', e.target.value)}     placeholder="192.168.1.1" />
        <label>Port</label>
        <input className="ssh-field" value={form.port}     onChange={e => set('port', e.target.value)}     placeholder="22" type="number" />
        <label>Protocol</label>
        <select className="ssh-field" value={form.protocol} onChange={e => set('protocol', e.target.value)}>
          <option value="ssh">SSH</option>
          <option value="telnet">Telnet</option>
        </select>
        <label>Username</label>
        <input className="ssh-field" value={form.username} onChange={e => set('username', e.target.value)} placeholder="root" />
        <label>Password</label>
        <input className="ssh-field" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••" type="password" autoComplete="new-password" />
      </div>
      <div className="ssh-dialog-actions">
        <button className="ssh-btn ssh-btn-primary" onClick={() => onSave(form)}>Save</button>
        <button className="ssh-btn ssh-btn-ghost"   onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ── Saved Commands Manager ──────────────────────────── */
function SavedCommands({ serviceId, onSendCommand }) {
  const [commands, setCommands]   = useState([]);
  const [adding,   setAdding]     = useState(false);
  const [newName,  setNewName]    = useState('');
  const [newCmd,   setNewCmd]     = useState('');
  const [editId,   setEditId]     = useState(null);
  const [editName, setEditName]   = useState('');
  const [editCmd,  setEditCmd]    = useState('');

  const load = useCallback(() => {
    if (!serviceId) return;
    api(`/api/ssh-services/${serviceId}/commands`).then(r => r.json()).then(setCommands).catch(() => {});
  }, [serviceId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newName || !newCmd) return;
    await api(`/api/ssh-services/${serviceId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ name: newName, command: newCmd }),
    });
    setNewName(''); setNewCmd(''); setAdding(false);
    load();
  };

  const handleUpdate = async (id) => {
    if (!editName || !editCmd) return;
    await api(`/api/commands/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editName, command: editCmd }),
    });
    setEditId(null);
    load();
  };

  const handleDelete = async (id) => {
    await api(`/api/commands/${id}`, { method: 'DELETE' });
    load();
  };

  if (!serviceId) return null;

  return (
    <div className="saved-commands">
      <div className="saved-commands-header">
        <span className="material-icons" style={{ fontSize: '0.95rem', color: 'var(--v400)' }}>bookmark</span>
        <span>Saved Commands</span>
        {!adding && (
          <button className="ssh-btn ssh-btn-ghost saved-cmd-add-btn" onClick={() => setAdding(true)}>+ Add</button>
        )}
      </div>

      {adding && (
        <div className="saved-cmd-form">
          <input className="ssh-field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Label" />
          <input className="ssh-field" value={newCmd}  onChange={e => setNewCmd(e.target.value)}  placeholder="command" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <button className="btn-icon btn-save" onClick={handleAdd}>✓</button>
          <button className="btn-icon btn-cancel" onClick={() => setAdding(false)}>✕</button>
        </div>
      )}

      {commands.length === 0 && !adding && (
        <div className="saved-cmd-empty">No saved commands</div>
      )}

      <div className="saved-cmd-list">
        {commands.map(cmd => (
          <div key={cmd.id} className="saved-cmd-item">
            {editId === cmd.id ? (
              <div className="saved-cmd-form">
                <input className="ssh-field" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Label" />
                <input className="ssh-field" value={editCmd}  onChange={e => setEditCmd(e.target.value)}  placeholder="command" onKeyDown={e => e.key === 'Enter' && handleUpdate(cmd.id)} />
                <button className="btn-icon btn-save" onClick={() => handleUpdate(cmd.id)}>✓</button>
                <button className="btn-icon btn-cancel" onClick={() => setEditId(null)}>✕</button>
              </div>
            ) : (
              <>
                <button className="saved-cmd-run" onClick={() => onSendCommand(cmd.command)} title="Run command">
                  <span className="material-icons" style={{ fontSize: '0.85rem' }}>play_arrow</span>
                </button>
                <span className="saved-cmd-name">{cmd.name}</span>
                <code className="saved-cmd-code">{cmd.command}</code>
                <button className="btn-icon btn-edit" onClick={() => { setEditId(cmd.id); setEditName(cmd.name); setEditCmd(cmd.command); }} title="Edit">✎</button>
                <button className="btn-icon btn-delete" onClick={() => handleDelete(cmd.id)} title="Delete">✕</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── XTerm Terminal Component ────────────────────────── */
function XTerminal({ serviceId, freeConn, onDisconnect }) {
  const termRef    = useRef(null);
  const termInst   = useRef(null);
  const fitAddon   = useRef(null);
  const wsRef      = useRef(null);
  const statusRef  = useRef('connecting');
  const [status, setStatus] = useState('connecting'); // connecting | connected | disconnected | error

  // Keep statusRef in sync so the ws.onclose callback sees current value
  useEffect(() => { statusRef.current = status; }, [status]);

  const [initError, setInitError] = useState(null);

  // Connect WebSocket and set up xterm
  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    let term, fit, ws, resizeObs, resizeTimeout;

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 14,
        lineHeight: 1.35,
        allowProposedApi: true,
        rows: 24,
        cols: 80,
        theme: {
          background:    '#06061a',
          foreground:    '#ece8ff',
          cursor:        '#a78bfa',
          cursorAccent:  '#06061a',
          selectionBackground: 'rgba(139, 92, 246, 0.35)',
          black:         '#1a1a2e',
          red:           '#f87171',
          green:         '#4ade80',
          yellow:        '#fbbf24',
          blue:          '#60a5fa',
          magenta:       '#c084fc',
          cyan:          '#22d3ee',
          white:         '#ece8ff',
          brightBlack:   '#635d80',
          brightRed:     '#fca5a5',
          brightGreen:   '#86efac',
          brightYellow:  '#fde68a',
          brightBlue:    '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan:    '#67e8f9',
          brightWhite:   '#ffffff',
        },
      });

      fit = new FitAddon();
      fitAddon.current = fit;
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      termInst.current = term;
    } catch (err) {
      console.error('xterm init failed:', err);
      setInitError(err.message);
      return;
    }

    // Delayed fit: wait for container to have layout dimensions
    const doFit = () => {
      try {
        const { clientWidth, clientHeight } = container;
        if (clientWidth > 0 && clientHeight > 0) {
          fit.fit();
        }
      } catch {}
    };
    // Multiple delays to handle layout timing
    setTimeout(doFit, 0);
    setTimeout(doFit, 100);
    setTimeout(doFit, 300);

    // Build WebSocket URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken();
    const wsUrl = `${proto}//${window.location.host}/ws/terminal?token=${encodeURIComponent(token)}`;

    ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      try { fit.fit(); } catch {}
      const connectMsg = serviceId
        ? { type: 'connect', serviceId, cols: term.cols, rows: term.rows }
        : { type: 'connect', ...freeConn, cols: term.cols, rows: term.rows };
      ws.send(JSON.stringify(connectMsg));
      term.writeln('\x1b[38;5;141mConnecting...\x1b[0m');
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'connected') {
        setStatus('connected');
        // Fit after connected to ensure canvas is properly sized
        setTimeout(() => { try { fit.fit(); } catch {} }, 50);
        term.focus();
      } else if (msg.type === 'data') {
        term.write(msg.data);
      } else if (msg.type === 'error') {
        term.writeln(`\r\n\x1b[31m${msg.data}\x1b[0m`);
        setStatus('error');
      } else if (msg.type === 'disconnected') {
        term.writeln('\r\n\x1b[38;5;141m--- Session ended ---\x1b[0m');
        setStatus('disconnected');
      }
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31mWebSocket connection error\x1b[0m');
      setStatus('error');
    };

    ws.onclose = () => {
      if (statusRef.current !== 'disconnected') {
        setStatus('disconnected');
      }
    };

    // Forward keyboard input to SSH
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          fit.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        } catch {}
      }, 100);
    };

    resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);

    return () => {
      clearTimeout(resizeTimeout);
      if (resizeObs) resizeObs.disconnect();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        if (ws) ws.close();
      } catch {}
      try { if (term) term.dispose(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCommand = useCallback((cmd) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
    }
  }, []);

  const disconnect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'disconnect' }));
      wsRef.current.close();
    }
    setStatus('disconnected');
    onDisconnect();
  };

  if (initError) {
    return (
      <div className="xterm-container">
        <div className="xterm-toolbar">
          <span className="xterm-status xterm-status-error">
            <span className="xterm-status-dot"></span> Terminal Error
          </span>
          <button className="ssh-btn ssh-btn-ghost xterm-disconnect" onClick={onDisconnect}>
            <span className="material-icons" style={{ fontSize: '0.9rem', marginRight: '4px' }}>close</span>
            Close
          </button>
        </div>
        <pre style={{ padding: '16px', color: '#f87171', background: '#06061a', margin: 0, fontSize: '0.82rem' }}>
          {initError}
        </pre>
      </div>
    );
  }

  return (
    <div className="xterm-container">
      <div className="xterm-toolbar">
        <span className={`xterm-status xterm-status-${status}`}>
          <span className="xterm-status-dot"></span>
          {status === 'connecting' ? 'Connecting…' : status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Disconnected'}
        </span>
        <button className="ssh-btn ssh-btn-ghost xterm-disconnect" onClick={disconnect}>
          <span className="material-icons" style={{ fontSize: '0.9rem', marginRight: '4px' }}>power_settings_new</span>
          Disconnect
        </button>
      </div>
      <div ref={termRef} className="xterm-terminal" />
      {serviceId && <SavedCommands serviceId={serviceId} onSendCommand={sendCommand} />}
    </div>
  );
}

/* ── Main SSHPanel ────────────────────────────────────── */
export default function SSHPanel() {
  const [tab,       setTab]      = useState('saved');   // 'saved' | 'free' | 'telnet'
  const [services,  setServices] = useState([]);

  /* Terminal state — when activeTerminal is set, show xterm */
  const [activeTerminal, setActiveTerminal] = useState(null); // { serviceId } or { freeConn: {...} }

  /* Command-execute fallback state */
  const [output,    setOutput]   = useState('');
  const [running,   setRunning]  = useState(false);

  /* Saved-servers state */
  const [selectedId, setSelectedId] = useState(null);
  const [command,    setCommand]    = useState('');
  const [showForm,   setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  /* Free SSH state */
  const [freeHost, setFreeHost] = useState('');
  const [freePort, setFreePort] = useState('22');
  const [freeUser, setFreeUser] = useState('');
  const [freePass, setFreePass] = useState('');

  /* Telnet state */
  const [telHost, setTelHost] = useState('');
  const [telPort, setTelPort] = useState('23');
  const [telCmd,  setTelCmd]  = useState('');

  const outputRef = useRef(null);

  const loadServices = () =>
    api('/api/ssh-services').then(r => r.json()).then(setServices).catch(() => {});

  useEffect(() => { loadServices(); }, []);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const appendOutput = (text) => setOutput(prev => (prev ? prev + '\n\n' : '') + text);

  /* ── Connect to terminal (saved server) ── */
  const connectSaved = () => {
    if (!selectedId) return;
    setActiveTerminal({ serviceId: selectedId });
  };

  /* ── Connect to terminal (free SSH) ── */
  const connectFree = () => {
    if (!freeHost) return;
    setActiveTerminal({
      freeConn: { host: freeHost, port: freePort, username: freeUser, password: freePass }
    });
  };

  /* ── Run command (exec mode for saved) ── */
  const runSavedExec = async () => {
    if (!selectedId || !command) return;
    setRunning(true);
    try {
      const res  = await api('/api/ssh', {
        method: 'POST',
        body:   JSON.stringify({ id: selectedId, command }),
      });
      const data = await res.json();
      appendOutput(data.output || data.error || '(no output)');
    } catch (err) {
      appendOutput(`Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  /* ── Telnet ── */
  const runTelnet = async () => {
    if (!telHost) return;
    setRunning(true);
    try {
      const res  = await api('/api/telnet', {
        method: 'POST',
        body:   JSON.stringify({ host: telHost, port: telPort, command: telCmd }),
      });
      const data = await res.json();
      appendOutput(data.output || data.error || '(no output)');
    } catch (err) {
      appendOutput(`Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  /* ── Server CRUD ── */
  const handleSaveServer = async (form) => {
    const url    = editTarget ? `/api/ssh-services/${editTarget.id}` : '/api/ssh-services';
    const method = editTarget ? 'PUT' : 'POST';
    await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...form, port: Number(form.port) }),
    });
    setShowForm(false);
    setEditTarget(null);
    loadServices();
  };

  const handleDeleteServer = async (id) => {
    await api(`/api/ssh-services/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    loadServices();
  };

  const openEdit = (svc) => { setEditTarget(svc); setShowForm(true); };
  const openAdd  = ()    => { setEditTarget(null); setShowForm(true); };

  const selected = services.find(s => s.id === selectedId);

  return (
    <div className="ssh-panel">
      <div className="ssh-panel-header">
        <span className="ssh-indicator"></span>
        <h2>Terminal Panel</h2>
        <div className="ssh-tabs">
          {['saved', 'free', 'telnet'].map(t => (
            <button
              key={t}
              className={`ssh-tab${tab === t ? ' ssh-tab-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'saved' ? 'Saved Servers' : t === 'free' ? 'SSH' : 'Telnet'}
            </button>
          ))}
        </div>
      </div>

      <div className="ssh-body">

        {/* ── Saved Servers Tab ── */}
        {tab === 'saved' && (
          <>
            {showForm && (
              <ServerForm
                initial={editTarget}
                onSave={handleSaveServer}
                onCancel={() => { setShowForm(false); setEditTarget(null); }}
              />
            )}

            <div className="ssh-server-list">
              {services.length === 0 && !showForm && (
                <div className="ssh-empty">No saved servers yet.</div>
              )}
              {services.map(svc => (
                <div
                  key={svc.id}
                  className={`ssh-server-item${selectedId === svc.id ? ' ssh-server-selected' : ''}`}
                  onClick={() => setSelectedId(svc.id)}
                >
                  <span className="material-icons ssh-proto-icon">
                    {svc.protocol === 'telnet' ? 'settings_ethernet' : 'terminal'}
                  </span>
                  <div className="ssh-server-info">
                    <span className="ssh-server-name">{svc.name}</span>
                    <span className="ssh-server-addr">{svc.username ? `${svc.username}@` : ''}{svc.host}:{svc.port}</span>
                  </div>
                  <span className="ssh-proto-badge">{svc.protocol}</span>
                  <button className="btn-icon btn-edit"   onClick={e => { e.stopPropagation(); openEdit(svc); }} title="Edit">✎</button>
                  <button className="btn-icon btn-delete" onClick={e => { e.stopPropagation(); handleDeleteServer(svc.id); }} title="Delete">✕</button>
                </div>
              ))}
            </div>

            <div className="ssh-add-bar">
              <button className="ssh-btn ssh-btn-ghost" onClick={openAdd}>+ Add Server</button>
            </div>

            {selected && (
              <div className="ssh-action-bar">
                <span className="ssh-connected-to">
                  <span className="material-icons" style={{fontSize:'0.95rem',verticalAlign:'middle',marginRight:'5px',color:'var(--v400)'}}>
                    {selected.protocol === 'telnet' ? 'settings_ethernet' : 'terminal'}
                  </span>
                  {selected.name}
                </span>

                {selected.protocol === 'ssh' && (
                  <button className="ssh-connect-btn" onClick={connectSaved}>
                    <span className="material-icons" style={{ fontSize: '1rem', marginRight: '5px' }}>laptop</span>
                    Open Terminal
                  </button>
                )}

                <div className="ssh-exec-row">
                  <input
                    className="ssh-input"
                    type="text"
                    placeholder={selected.protocol === 'telnet' ? 'Send text…' : 'Quick command (exec)…'}
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !running && runSavedExec()}
                  />
                  <button className="ssh-run-btn" onClick={runSavedExec} disabled={running}>
                    {running ? '…' : 'Run'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Free SSH Tab ── */}
        {tab === 'free' && (
          <>
            <div className="ssh-free-grid">
              <input className="ssh-field" value={freeHost} onChange={e => setFreeHost(e.target.value)} placeholder="Host / IP" />
              <input className="ssh-field" value={freePort} onChange={e => setFreePort(e.target.value)} placeholder="Port" type="number" style={{width:'80px'}} />
              <input className="ssh-field" value={freeUser} onChange={e => setFreeUser(e.target.value)} placeholder="Username" />
              <input className="ssh-field" value={freePass} onChange={e => setFreePass(e.target.value)} placeholder="Password" type="password" autoComplete="off" />
            </div>
            <div className="ssh-controls">
              <button className="ssh-connect-btn" onClick={connectFree} disabled={!freeHost}>
                <span className="material-icons" style={{ fontSize: '1rem', marginRight: '5px' }}>laptop</span>
                Open Terminal
              </button>
            </div>
          </>
        )}

        {/* ── Telnet Tab ── */}
        {tab === 'telnet' && (
          <>
            <div className="ssh-free-grid">
              <input className="ssh-field" value={telHost} onChange={e => setTelHost(e.target.value)} placeholder="Host / IP" />
              <input className="ssh-field" value={telPort} onChange={e => setTelPort(e.target.value)} placeholder="Port" type="number" style={{width:'80px'}} />
            </div>
            <div className="ssh-controls">
              <input
                className="ssh-input"
                type="text"
                placeholder="Initial command / string to send (optional)…"
                value={telCmd}
                onChange={e => setTelCmd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !running && runTelnet()}
              />
              <button className="ssh-run-btn" onClick={runTelnet} disabled={running || !telHost}>
                {running ? '…' : 'Connect'}
              </button>
            </div>
          </>
        )}

        {/* ── Inline Terminal ── */}
        {activeTerminal && (
          <TerminalErrorBoundary
            key={activeTerminal.serviceId || JSON.stringify(activeTerminal.freeConn)}
            onDisconnect={() => setActiveTerminal(null)}
          >
            <XTerminal
              key={activeTerminal.serviceId || JSON.stringify(activeTerminal.freeConn)}
              serviceId={activeTerminal.serviceId || null}
              freeConn={activeTerminal.freeConn || null}
              onDisconnect={() => setActiveTerminal(null)}
            />
          </TerminalErrorBoundary>
        )}

        {/* ── Output (exec mode) ── */}
        {output && (
          <>
            <pre className="ssh-output" ref={outputRef}>
              {output}
            </pre>
            <button className="ssh-clear-btn" onClick={() => setOutput('')}>Clear output</button>
          </>
        )}
      </div>
    </div>
  );
}
