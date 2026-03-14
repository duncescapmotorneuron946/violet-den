const express      = require('express');
const cors         = require('cors');
const crypto       = require('crypto');
const dotenv       = require('dotenv');
const { Client }   = require('ssh2');
const net          = require('net');
const fs           = require('fs');
const path         = require('path');
const { execFile } = require('child_process');
const http         = require('http');
const { WebSocketServer } = require('ws');
const { db, getConfig, setConfig, encrypt, decrypt } = require('./db');

dotenv.config();

const app    = express();
const server = http.createServer(app);

// ── CORS — restrict to same-origin in production ─────────────────────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : null;
app.use(cors(ALLOWED_ORIGINS
  ? { origin: ALLOWED_ORIGINS, credentials: true }
  : undefined
));
app.use(express.json());

const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, '../certs');

// ── Home Assistant integration mode ─────────────────────────────────────────
const HA_INTEGRATION = process.env.HA_INTEGRATION === 'true';
const HA_URL         = process.env.HA_URL || null;

// Serve built frontend static files in HA mode (single-container deployment)
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// ── Session tokens (in-memory) ──────────────────────────────────────────────
const activeSessions = new Map();  // token → { created, username }
const SESSION_TTL    = 24 * 60 * 60 * 1000;  // 24h

const cleanSessions = () => {
  const now = Date.now();
  for (const [tok, sess] of activeSessions) {
    if (now - sess.created > SESSION_TTL) activeSessions.delete(tok);
  }
};

const isValidToken = (token) => {
  if (!token) return false;
  const sess = activeSessions.get(token);
  if (!sess || Date.now() - sess.created > SESSION_TTL) {
    activeSessions.delete(token);
    return false;
  }
  return true;
};

// ── Rate limiting (login brute-force protection) ─────────────────────────────
const loginAttempts = new Map();  // ip → { count, firstAttempt }
const RATE_WINDOW   = 15 * 60 * 1000;  // 15 min
const MAX_ATTEMPTS  = 10;

const checkRateLimit = (ip) => {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAttempt > RATE_WINDOW) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_ATTEMPTS;
};

// ── Auth middleware ──────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
};

// ── Health (public) ─────────────────────────────────────────────────────────
const backendVersion = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
})();
app.get('/', (req, res) => {
  if (fs.existsSync(DIST_DIR)) {
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  }
  res.json({ status: 'Backend running', version: backendVersion, ha_mode: HA_INTEGRATION });
});

// ── Login (public, rate-limited) ─────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many login attempts. Try again in 15 minutes.' });
  }

  const { username, password } = req.body;
  const storedUser = getConfig('admin_username', process.env.ADMIN_USERNAME || 'admin');
  const storedPass = getConfig('admin_password', process.env.ADMIN_PASSWORD || 'changeme');
  if (username === storedUser && password === storedPass) {
    cleanSessions();
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { created: Date.now(), username });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// ── Home Assistant auth (public — validates HA token, returns VioletDen session) ─
app.post('/api/ha-auth', async (req, res) => {
  if (!HA_INTEGRATION) {
    return res.status(404).json({ error: 'HA integration not enabled' });
  }
  if (!HA_URL) {
    return res.status(500).json({ error: 'HA_URL not configured' });
  }

  const { ha_token } = req.body;
  if (!ha_token) {
    return res.status(400).json({ error: 'ha_token required' });
  }

  // Validate the HA access token against the HA API
  try {
    const haRes = await fetch(`${HA_URL}/api/`, {
      headers: { 'Authorization': `Bearer ${ha_token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!haRes.ok) {
      return res.status(401).json({ error: 'Invalid Home Assistant token' });
    }

    // HA token is valid — ensure setup is complete (auto-setup if needed)
    if (getConfig('admin_username', null) === null) {
      // Auto-complete setup for HA mode with generated credentials
      const autoUser = 'ha-admin';
      const autoPass = crypto.randomBytes(32).toString('hex');
      setConfig('admin_username', autoUser);
      setConfig('admin_password', autoPass);
    }

    // Create a VioletDen session
    cleanSessions();
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { created: Date.now(), username: 'ha-user' });
    res.json({ success: true, token });
  } catch (err) {
    return res.status(502).json({ error: `Cannot reach Home Assistant: ${err.message}` });
  }
});

// ── Token validation (public — used by frontend to check if session is alive) ─
app.get('/api/validate-token', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  const token = header.slice(7);
  res.json({ valid: isValidToken(token) });
});

// ── Setup status (public — check if first-time setup is needed) ──────────────
app.get('/api/setup-status', (req, res) => {
  const hasCustomCreds = getConfig('admin_username', null) !== null;
  res.json({ setup_complete: hasCustomCreds, ha_mode: HA_INTEGRATION });
});

// ── First-time setup (public — only works when no custom creds have been set) ─
app.post('/api/setup', (req, res) => {
  // Block if setup was already completed (custom credentials exist)
  if (getConfig('admin_username', null) !== null) {
    return res.status(403).json({ success: false, error: 'Setup already completed. Use login instead.' });
  }

  const { username, password, sections } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  // Save credentials
  setConfig('admin_username', username);
  setConfig('admin_password', password);

  // Save sections if provided
  if (sections) {
    setConfig('sections', typeof sections === 'string' ? sections : JSON.stringify(sections));
  }

  res.json({ success: true });
});

// ── Sections (public read; write protected) ──────────────────────────────────
app.get('/api/sections', (req, res) => {
  try {
    const raw = getConfig('sections', '[]');
    res.json(JSON.parse(raw));
  } catch {
    res.json([]);
  }
});

app.post('/api/save-sections', requireAuth, (req, res) => {
  const { config } = req.body;
  setConfig('sections', config);
  res.json({ success: true });
});

// ── Credentials (protected) ─────────────────────────────────────────────────
app.post('/api/change-creds', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }
  setConfig('admin_username', username);
  setConfig('admin_password', password);
  res.json({ success: true });
});

// ── Dashboard Settings (protected) ───────────────────────────────────────────
app.get('/api/dashboard-settings', requireAuth, (req, res) => {
  const showUrls = getConfig('show_urls', 'true');
  res.json({ show_urls: showUrls === 'true' });
});

app.post('/api/dashboard-settings', requireAuth, (req, res) => {
  if (req.body.show_urls !== undefined) {
    setConfig('show_urls', req.body.show_urls ? 'true' : 'false');
  }
  res.json({ success: true });
});

// ── SSH Services CRUD (all protected) ────────────────────────────────────────
app.get('/api/ssh-services', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM ssh_services ORDER BY id').all();
  res.json(rows.map(r => ({ ...r, password: r.password ? '••••••' : '' })));
});

app.post('/api/ssh-services', requireAuth, (req, res) => {
  const { name, host, port, username, password, protocol } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name and host required' });
  const encPw = encrypt(password || '');
  const info = db.prepare(
    'INSERT INTO ssh_services (name, host, port, username, password, protocol) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, host, Number(port) || 22, username || '', encPw, protocol || 'ssh');
  res.json({ id: info.lastInsertRowid, name, host, port: Number(port) || 22, username: username || '', protocol: protocol || 'ssh' });
});

app.put('/api/ssh-services/:id', requireAuth, (req, res) => {
  const { name, host, port, username, password, protocol } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name and host required' });
  let encPw;
  if (password === '••••••') {
    const existing = db.prepare('SELECT password FROM ssh_services WHERE id = ?').get(req.params.id);
    encPw = existing ? existing.password : '';
  } else {
    encPw = encrypt(password || '');
  }
  db.prepare(
    'UPDATE ssh_services SET name=?, host=?, port=?, username=?, password=?, protocol=? WHERE id=?'
  ).run(name, host, Number(port) || 22, username || '', encPw, protocol || 'ssh', req.params.id);
  res.json({ success: true });
});

app.delete('/api/ssh-services/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_commands WHERE service_id = ?').run(req.params.id);
  db.prepare('DELETE FROM ssh_services WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Saved Commands CRUD (all protected) ──────────────────────────────────────
app.get('/api/ssh-services/:id/commands', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM saved_commands WHERE service_id = ? ORDER BY id').all(req.params.id);
  res.json(rows);
});

app.post('/api/ssh-services/:id/commands', requireAuth, (req, res) => {
  const { name, command } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'name and command required' });
  const info = db.prepare(
    'INSERT INTO saved_commands (service_id, name, command) VALUES (?, ?, ?)'
  ).run(req.params.id, name, command);
  res.json({ id: info.lastInsertRowid, service_id: Number(req.params.id), name, command });
});

app.put('/api/commands/:id', requireAuth, (req, res) => {
  const { name, command } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'name and command required' });
  db.prepare('UPDATE saved_commands SET name=?, command=? WHERE id=?').run(name, command, req.params.id);
  res.json({ success: true });
});

app.delete('/api/commands/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM saved_commands WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── SSH Execute — saved service (protected) ──────────────────────────────────
app.post('/api/ssh', requireAuth, (req, res) => {
  const { id, command } = req.body;
  if (!id) return res.status(400).json({ error: 'service id required' });
  const svc = db.prepare('SELECT * FROM ssh_services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const realPw = decrypt(svc.password);
  if (svc.protocol === 'telnet') {
    _runTelnet(svc.host, svc.port, command, res);
  } else {
    _runSSH(svc.host, svc.port, svc.username, realPw, command, res);
  }
});

// ── SSH Free-form (protected) ────────────────────────────────────────────────
app.post('/api/ssh-free', requireAuth, (req, res) => {
  const { host, port, username, password, command } = req.body;
  if (!host || !command) return res.status(400).json({ error: 'host and command required' });
  _runSSH(host, Number(port) || 22, username || '', password || '', command, res);
});

// ── Telnet Free-form (protected) ──────────────────────────────────────────────
app.post('/api/telnet', requireAuth, (req, res) => {
  const { host, port, command } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });
  _runTelnet(host, Number(port) || 23, command || '', res);
});

// ── Internal SSH runner ──────────────────────────────────────────────────────
function _runSSH(host, port, username, password, command, res) {
  const conn = new Client();
  let responded = false;

  const fail = (msg) => {
    if (responded) return;
    responded = true;
    try { conn.end(); } catch {}
    res.status(500).json({ error: msg });
  };

  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) return fail(`SSH exec error: ${err.message}`);
      let out = '', errOut = '';
      stream.on('data',        d => { out    += d; });
      stream.stderr.on('data', d => { errOut += d; });
      stream.on('close', () => {
        if (responded) return;
        responded = true;
        conn.end();
        res.json({ output: (out + errOut) || '(no output)' });
      });
    });
  });

  conn.on('error', err => fail(`SSH connection error: ${err.message}`));

  conn.connect({ host, port: Number(port) || 22, username, password, readyTimeout: 10000 });
}

// ── Internal Telnet runner ───────────────────────────────────────────────────
function _runTelnet(host, port, command, res) {
  const socket = new net.Socket();
  let output = '';
  let done   = false;

  const finish = () => {
    if (done) return;
    done = true;
    socket.destroy();
    res.json({ output: output.trim() || '(no output)' });
  };

  socket.setTimeout(8000);
  socket.on('timeout', finish);

  socket.on('error', err => {
    if (done) return;
    done = true;
    res.status(500).json({ error: `Telnet error: ${err.message}` });
  });

  socket.on('data', data => {
    output += data.toString('binary')
      .replace(/\xff[\xfb-\xfe]./gs, '')
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
  });

  socket.on('close', finish);

  socket.connect(Number(port) || 23, host, () => {
    setTimeout(() => {
      if (command) socket.write(command + '\r\n');
      setTimeout(finish, 3000);
    }, 1500);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Shared SSH/Telnet session helpers ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function resolveConnectionInfo(msg) {
  if (msg.serviceId) {
    const svc = db.prepare('SELECT * FROM ssh_services WHERE id = ?').get(msg.serviceId);
    if (!svc) return { error: 'Server not found' };
    return { host: svc.host, port: svc.port, username: svc.username, password: decrypt(svc.password), protocol: svc.protocol || 'ssh' };
  }
  return { host: msg.host, port: Number(msg.port) || 22, username: msg.username || '', password: msg.password || '', protocol: msg.protocol || 'ssh' };
}

function createTelnetSession({ host, port }, callbacks) {
  const socket = new net.Socket();
  let connected = false;

  socket.on('connect', () => {
    connected = true;
    callbacks.onConnected();
  });

  socket.on('data', (data) => {
    // Strip telnet negotiation sequences (IAC commands)
    let cleaned = '';
    const buf = Buffer.from(data);
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === 0xff && i + 2 < buf.length) {
        const cmd = buf[i + 1];
        if (cmd >= 0xfb && cmd <= 0xfe) {
          // WILL/WONT/DO/DONT — 3-byte sequences, respond with refusal
          const opt = buf[i + 2];
          if (cmd === 0xfb || cmd === 0xfd) {
            // Reply WONT/DONT
            const reply = Buffer.from([0xff, cmd === 0xfb ? 0xfe : 0xfc, opt]);
            try { socket.write(reply); } catch {}
          }
          i += 3;
          continue;
        }
        if (cmd === 0xfa) {
          // Sub-negotiation — skip until IAC SE (0xff 0xf0)
          i += 2;
          while (i < buf.length - 1) {
            if (buf[i] === 0xff && buf[i + 1] === 0xf0) { i += 2; break; }
            i++;
          }
          continue;
        }
        // Other IAC commands (2 bytes)
        i += 2;
        continue;
      }
      cleaned += String.fromCharCode(buf[i]);
      i++;
    }
    if (cleaned) callbacks.onData(cleaned);
  });

  socket.on('error', (err) => callbacks.onError(`Telnet error: ${err.message}`));
  socket.on('close', () => callbacks.onDisconnected());
  socket.on('timeout', () => {
    callbacks.onError('Telnet connection timed out');
    socket.destroy();
  });

  socket.setTimeout(300000); // 5 min idle timeout
  socket.connect(Number(port) || 23, host);

  return {
    conn: { end: () => { try { socket.destroy(); } catch {} } },
    getStream: () => connected ? socket : null,
  };
}

function createSSHSession({ host, port, username, password, cols, rows }, callbacks) {
  const sshConn = new Client();
  let stream = null;

  sshConn.on('ready', () => {
    sshConn.shell({ term: 'xterm-256color', cols: cols || 80, rows: rows || 24 }, (err, s) => {
      if (err) { callbacks.onError(`Shell error: ${err.message}`); return; }
      stream = s;
      callbacks.onConnected(stream);
      s.on('data', (data) => callbacks.onData(data.toString('binary')));
      s.stderr.on('data', (data) => callbacks.onData(data.toString('binary')));
      s.on('close', () => callbacks.onDisconnected());
    });
  });

  sshConn.on('error', (err) => callbacks.onError(`SSH error: ${err.message}`));
  sshConn.on('close', () => callbacks.onDisconnected());

  sshConn.connect({ host, port, username, password, readyTimeout: 15000, keepaliveInterval: 30000 });

  return { conn: sshConn, getStream: () => stream };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── WebSocket SSH Terminal ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const wss = new WebSocketServer({ server, path: '/ws/terminal', perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  const url    = new URL(req.url, `http://${req.headers.host}`);
  const token  = url.searchParams.get('token');

  if (!isValidToken(token)) { ws.close(4001, 'Unauthorized'); return; }

  let session = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'connect') {
      const info = resolveConnectionInfo(msg);
      if (info.error) { ws.send(JSON.stringify({ type: 'error', data: info.error })); return; }

      if (session) { try { session.conn.end(); } catch {} }

      const callbacks = {
        onConnected: () => { ws.send(JSON.stringify({ type: 'connected' })); },
        onData:      (data) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data })); },
        onError:     (data) => { ws.send(JSON.stringify({ type: 'error', data })); },
        onDisconnected: () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'disconnected' })); },
      };

      if (info.protocol === 'telnet') {
        session = createTelnetSession({ host: info.host, port: info.port }, callbacks);
      } else {
        session = createSSHSession({ ...info, cols: msg.cols, rows: msg.rows }, callbacks);
      }
    }

    if (msg.type === 'input' && session?.getStream()) {
      session.getStream().write(msg.data);
    }

    if (msg.type === 'resize' && session?.getStream()) {
      const stream = session.getStream();
      if (typeof stream.setWindow === 'function') {
        stream.setWindow(msg.rows, msg.cols, 0, 0);
      }
    }

    if (msg.type === 'disconnect' && session) {
      try { session.conn.end(); } catch {}
      session = null;
    }
  });

  ws.on('close', () => {
    if (session) { try { session.conn.end(); } catch {} }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── HTTP Polling Terminal (Safari fallback) ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const pollingSessions = new Map();

// Cleanup stale sessions every 30s
const pollingCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of pollingSessions) {
    if (now - sess.lastAccess > 5 * 60 * 1000) {
      try { sess.conn.end(); } catch {}
      pollingSessions.delete(id);
    }
  }
}, 30000);
if (pollingCleanupInterval.unref) pollingCleanupInterval.unref();

app.post('/api/terminal/create', requireAuth, (req, res) => {
  const info = resolveConnectionInfo(req.body);
  if (info.error) return res.status(400).json({ error: info.error });

  const sessionId = crypto.randomUUID();
  const outputBuffer = [];

  const callbacks = {
    onConnected:    () => { outputBuffer.push({ type: 'connected' }); },
    onData:         (data) => { outputBuffer.push({ type: 'data', data }); },
    onError:        (data) => { outputBuffer.push({ type: 'error', data }); },
    onDisconnected: () => { outputBuffer.push({ type: 'disconnected' }); },
  };

  const session = info.protocol === 'telnet'
    ? createTelnetSession({ host: info.host, port: info.port }, callbacks)
    : createSSHSession({ ...info, cols: req.body.cols, rows: req.body.rows }, callbacks);

  pollingSessions.set(sessionId, {
    ...session,
    outputBuffer,
    lastAccess: Date.now(),
    authToken: req.headers.authorization,
  });

  res.json({ sessionId });
});

app.post('/api/terminal/:id/input', requireAuth, (req, res) => {
  const sess = pollingSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (sess.authToken !== req.headers.authorization) return res.status(403).json({ error: 'Forbidden' });

  sess.lastAccess = Date.now();
  const { type, data, cols, rows } = req.body;

  if (type === 'input' && sess.getStream()) sess.getStream().write(data);
  if (type === 'resize' && sess.getStream() && typeof sess.getStream().setWindow === 'function') sess.getStream().setWindow(rows, cols, 0, 0);
  if (type === 'disconnect') {
    try { sess.conn.end(); } catch {}
    pollingSessions.delete(req.params.id);
  }

  res.json({ success: true });
});

app.get('/api/terminal/:id/poll', requireAuth, (req, res) => {
  const sess = pollingSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (sess.authToken !== req.headers.authorization) return res.status(403).json({ error: 'Forbidden' });

  sess.lastAccess = Date.now();
  const messages = sess.outputBuffer.splice(0);
  res.json({ messages });
});

// ── Certificate status (protected) ────────────────────────────────────────────
app.get('/api/cert-status', requireAuth, (req, res) => {
  const certFile = path.join(CERT_DIR, 'cert.pem');
  const keyFile  = path.join(CERT_DIR, 'key.pem');
  const exists   = fs.existsSync(certFile) && fs.existsSync(keyFile);
  let issuer = null, validFrom = null, validTo = null, subject = null;
  if (exists) {
    try {
      const { execFileSync } = require('child_process');
      const info = execFileSync('openssl', [
        'x509', '-in', certFile, '-noout',
        '-issuer', '-subject', '-dates',
      ], { timeout: 5000 }).toString();
      const m = (key) => { const r = info.match(new RegExp(`${key}=(.+)`)); return r ? r[1].trim() : null; };
      issuer    = m('issuer');
      subject   = m('subject');
      validFrom = m('notBefore');
      validTo   = m('notAfter');
    } catch {}
  }
  res.json({ exists, issuer, subject, validFrom, validTo });
});

// ── Generate self-signed certificate (protected) ─────────────────────────────
app.post('/api/generate-cert', requireAuth, (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ success: false, error: 'Domain required' });

  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '').substring(0, 253);
  if (!safeDomain) return res.status(400).json({ success: false, error: 'Invalid domain name' });

  const certFile = path.join(CERT_DIR, 'cert.pem');
  const keyFile  = path.join(CERT_DIR, 'key.pem');
  const extFile  = path.join(CERT_DIR, 'san.cnf');

  try { fs.mkdirSync(CERT_DIR, { recursive: true }); }
  catch (e) { return res.status(500).json({ success: false, error: `Cannot create cert directory: ${e.message}` }); }

  const sanConfig = [
    '[req]',
    'distinguished_name = req_dn',
    'x509_extensions = v3_req',
    'prompt = no',
    '[req_dn]',
    `CN = ${safeDomain}`,
    '[v3_req]',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    `subjectAltName = DNS:${safeDomain}, DNS:*.${safeDomain}`,
  ].join('\n');

  try { fs.writeFileSync(extFile, sanConfig); }
  catch (e) { return res.status(500).json({ success: false, error: `Cannot write config: ${e.message}` }); }

  execFile('openssl', [
    'req', '-x509',
    '-newkey', 'rsa:2048',
    '-keyout', keyFile,
    '-out',    certFile,
    '-days',   '365',
    '-nodes',
    '-config', extFile,
  ], { timeout: 30000 }, (error, _stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        error: `openssl failed: ${(stderr || error.message).trim()}`,
      });
    }
    res.json({
      success: true,
      message: `Certificate generated for ${safeDomain}. Restart nginx to activate HTTPS: docker compose restart violetden-nginx`,
    });
  });
});

// ── Delete certificate (protected) ───────────────────────────────────────────
app.delete('/api/cert', requireAuth, (req, res) => {
  const certFile = path.join(CERT_DIR, 'cert.pem');
  const keyFile  = path.join(CERT_DIR, 'key.pem');
  try { if (fs.existsSync(certFile)) fs.unlinkSync(certFile); } catch {}
  try { if (fs.existsSync(keyFile))  fs.unlinkSync(keyFile);  } catch {}
  res.json({ success: true, message: 'Certificate removed. Restart nginx to revert to self-signed.' });
});

// ── Clear stored data (protected) ────────────────────────────────────────────
app.post('/api/clear-data', requireAuth, (req, res) => {
  const { target } = req.body; // 'sections' | 'ssh_services' | 'credentials' | 'all'
  if (target === 'sections' || target === 'all') {
    setConfig('sections', '[]');
  }
  if (target === 'ssh_services' || target === 'all') {
    db.prepare('DELETE FROM saved_commands').run();
    db.prepare('DELETE FROM ssh_services').run();
  }
  if (target === 'credentials' || target === 'all') {
    db.prepare("DELETE FROM config WHERE key IN ('admin_username', 'admin_password')").run();
  }
  if (target === 'all') {
    db.prepare('DELETE FROM config').run();
    db.prepare('DELETE FROM saved_commands').run();
    db.prepare('DELETE FROM ssh_services').run();
  }
  res.json({ success: true, message: `Cleared: ${target}` });
});

// ── SPA fallback — serve index.html for non-API routes (single-container mode) ─
if (fs.existsSync(DIST_DIR)) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ── Start ────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.BACKEND_PORT || 4000;
  server.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
}

module.exports = app;
