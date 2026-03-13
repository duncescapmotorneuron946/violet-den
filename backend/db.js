const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'violetden.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ssh_services (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    host     TEXT    NOT NULL,
    port     INTEGER NOT NULL DEFAULT 22,
    username TEXT    NOT NULL DEFAULT '',
    password TEXT    NOT NULL DEFAULT '',
    protocol TEXT    NOT NULL DEFAULT 'ssh'
  );

  CREATE TABLE IF NOT EXISTS saved_commands (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    command    TEXT    NOT NULL,
    FOREIGN KEY (service_id) REFERENCES ssh_services(id) ON DELETE CASCADE
  );
`);

/* ── Config helpers ───────────────────────────────────────────────────────── */
const getConfig = (key, fallback = null) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

const setConfig = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
};

/* ── Encryption helpers (AES-256-GCM for SSH passwords) ───────────────────
   The encryption key is derived from a secret stored in the data dir.
   If no secret exists yet, one is generated automatically.            ───── */
const SECRET_FILE = path.join(DATA_DIR, '.violetden_secret');
let ENC_KEY;

if (fs.existsSync(SECRET_FILE)) {
  ENC_KEY = Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
} else {
  ENC_KEY = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, ENC_KEY.toString('hex'), { mode: 0o600 });
}

const encrypt = (plaintext) => {
  if (!plaintext) return '';
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  // Format: iv:tag:ciphertext  (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (blob) => {
  if (!blob || !blob.includes(':')) return blob || '';
  try {
    const [ivHex, tagHex, encHex] = blob.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    // If decryption fails (old plain-text data), return as-is
    return blob;
  }
};

module.exports = { db, getConfig, setConfig, encrypt, decrypt };
