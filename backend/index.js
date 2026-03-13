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
app.get('/', (req, res) => res.json({ status: 'Backend running' }));

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
  const hasSections    = (() => {
    try { return JSON.parse(getConfig('sections', '[]')).length > 0; }
    catch { return false; }
  })();
  res.json({ setup_complete: hasCustomCreds && hasSections });
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
// ── WebSocket SSH Terminal ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws, req) => {
  // Authenticate via query param: ?token=xxx
  const url    = new URL(req.url, `http://${req.headers.host}`);
  const token  = url.searchParams.get('token');

  if (!isValidToken(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  let sshConn  = null;
  let sshReady = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Connect to SSH server ──
    if (msg.type === 'connect') {
      const { serviceId, host, port, username, password } = msg;
      let connHost, connPort, connUser, connPass;

      if (serviceId) {
        // Saved server
        const svc = db.prepare('SELECT * FROM ssh_services WHERE id = ?').get(serviceId);
        if (!svc) { ws.send(JSON.stringify({ type: 'error', data: 'Server not found' })); return; }
        connHost = svc.host;
        connPort = svc.port;
        connUser = svc.username;
        connPass = decrypt(svc.password);
      } else {
        // Free-form
        connHost = host;
        connPort = Number(port) || 22;
        connUser = username || '';
        connPass = password || '';
      }

      if (sshConn) { try { sshConn.end(); } catch {} }

      sshConn = new Client();

      sshConn.on('ready', () => {
        sshReady = true;
        sshConn.shell({ term: 'xterm-256color', cols: msg.cols || 80, rows: msg.rows || 24 }, (err, stream) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', data: `Shell error: ${err.message}` }));
            return;
          }

          ws.send(JSON.stringify({ type: 'connected' }));

          stream.on('data', (data) => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data: data.toString('binary') }));
          });

          stream.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data: data.toString('binary') }));
          });

          stream.on('close', () => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'disconnected' }));
            sshReady = false;
          });

          // Forward terminal input from client to SSH
          ws._sshStream = stream;
        });
      });

      sshConn.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', data: `SSH error: ${err.message}` }));
        sshReady = false;
      });

      sshConn.on('close', () => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'disconnected' }));
        sshReady = false;
      });

      sshConn.connect({
        host: connHost,
        port: connPort,
        username: connUser,
        password: connPass,
        readyTimeout: 15000,
        keepaliveInterval: 30000,
      });
    }

    // ── Terminal input ──
    if (msg.type === 'input' && ws._sshStream) {
      ws._sshStream.write(msg.data);
    }

    // ── Resize ──
    if (msg.type === 'resize' && ws._sshStream) {
      ws._sshStream.setWindow(msg.rows, msg.cols, 0, 0);
    }

    // ── Disconnect ──
    if (msg.type === 'disconnect') {
      if (sshConn) { try { sshConn.end(); } catch {} }
      sshConn  = null;
      sshReady = false;
    }
  });

  ws.on('close', () => {
    if (sshConn) { try { sshConn.end(); } catch {} }
  });
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

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.BACKEND_PORT || 4000;
server.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
