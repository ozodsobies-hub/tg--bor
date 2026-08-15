const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Railway'da persistence uchun Volume mount qiling (masalan /data)
// va DB_PATH=/data/db.sqlite qilib environment variable bering.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ai_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,       -- 'openrouter' | 'gemini'
  label TEXT,
  api_key TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0, -- 1 = asosiy (3 tasi), 0 = zaxira
  active INTEGER DEFAULT 1,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS autoreply_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_type TEXT NOT NULL DEFAULT 'contains', -- 'exact' | 'contains'
  trigger_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// Default sozlamalarni bir marta o'rnatish
function initDefaults() {
  if (getSetting('admin_username') === null) {
    setSetting('admin_username', 'admin123');
  }
  if (getSetting('admin_password_hash') === null) {
    const hash = bcrypt.hashSync('adminparol', 10);
    setSetting('admin_password_hash', hash);
  }
  if (getSetting('jwt_secret') === null) {
    setSetting('jwt_secret', require('crypto').randomBytes(32).toString('hex'));
  }
  if (getSetting('autoreply_status') === null) {
    setSetting('autoreply_status', 'on'); // on | off_temp | off_permanent
  }
  if (getSetting('ai_enabled') === null) {
    setSetting('ai_enabled', '0');
  }
  if (getSetting('welcome_text') === null) {
    setSetting('welcome_text', '👋 Salom! Xush kelibsiz. Quyidagi tugmalardan birini tanlang.');
  }
  if (getSetting('about_text') === null) {
    setSetting('about_text', '🤖 Bu bot avtomatik javob beruvchi AI yordamchi. Savollaringizga tezkor javob beramiz.');
  }
  if (getSetting('webhook_secret') === null) {
    setSetting('webhook_secret', require('crypto').randomBytes(16).toString('hex'));
  }
}
initDefaults();

module.exports = { db, getSetting, setSetting, getAllSettings };
