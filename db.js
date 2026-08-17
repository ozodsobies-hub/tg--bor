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
-- Global sozlamalar (super-admin, control bot tokeni, MTProto app credentials)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Har bir yakuniy foydalanuvchi (bot orqali /start bosgan va akkountini ulagan kishi)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,      -- control botga /start bosgan odamning Telegram ID'si
  telegram_username TEXT,
  phone_number TEXT,
  session_string TEXT DEFAULT '',        -- MTProto sessiya (shaxsiy akkountga kirish)
  away_mode TEXT DEFAULT 'when_offline', -- 'always' | 'when_offline'
  away_timeout_minutes INTEGER DEFAULT 5,
  autoreply_status TEXT DEFAULT 'on',    -- 'on' | 'off_temp' | 'off_permanent'
  ai_enabled INTEGER DEFAULT 0,
  connect_token TEXT DEFAULT '',         -- akkount ulash uchun bir martalik token (saytda ishlatiladi)
  connect_token_expires TEXT DEFAULT '',
  first_message_text TEXT DEFAULT '',    -- kimdir birinchi marta yozganda yuboriladigan matn
  subsequent_message_text TEXT DEFAULT '', -- AI o'chirilgan bo'lsa, keyingi xabarlarga yuboriladigan matn
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Har bir foydalanuvchi uchun avval yozgan kishilar ro'yxati (1-xabar/keyingi xabar farqi uchun)
CREATE TABLE IF NOT EXISTS contact_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_tg_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, contact_tg_id)
);

-- Har bir foydalanuvchi uchun avto-javob berilmasligi kerak bo'lgan kishilar ("do'stlar rejimi")
CREATE TABLE IF NOT EXISTS excluded_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_ref TEXT NOT NULL,   -- @username yoki nom (ko'rsatish uchun)
  contact_tg_id TEXT,          -- moslashtirish uchun raqamli Telegram ID
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Har bir foydalanuvchining o'z avto-javob qoidalari
CREATE TABLE IF NOT EXISTS autoreply_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'contains', -- 'exact' | 'contains'
  trigger_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Har bir foydalanuvchining o'z AI bilim bazasi
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Umumiy (butun tizim uchun bitta) AI kalitlar hovuzi - 20 slot
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
`);

// Eski (v3'dan oldingi) bazalar uchun xavfsiz migratsiya - ustun allaqachon bo'lsa xato e'tiborga olinmaydi
const migrations = [
  "ALTER TABLE users ADD COLUMN connect_token TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN connect_token_expires TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN first_message_text TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN subsequent_message_text TEXT DEFAULT ''",
];
for (const m of migrations) {
  try {
    db.exec(m);
  } catch (e) {
    /* ustun allaqachon mavjud - e'tiborsiz qoldiramiz */
  }
}

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

function initDefaults() {
  if (getSetting('admin_username') === null) setSetting('admin_username', 'admin123');
  if (getSetting('admin_password_hash') === null) {
    setSetting('admin_password_hash', bcrypt.hashSync('adminparol', 10));
  }
  if (getSetting('jwt_secret') === null) {
    setSetting('jwt_secret', require('crypto').randomBytes(32).toString('hex'));
  }
  // Markaziy (control) bot - BotFather'dan olinadi, ko'p foydalanuvchili "eshik"
  if (getSetting('control_bot_token') === null) setSetting('control_bot_token', '');
  if (getSetting('control_bot_webhook_secret') === null) {
    setSetting('control_bot_webhook_secret', require('crypto').randomBytes(16).toString('hex'));
  }
  // MTProto ilova credentiallari (my.telegram.org) - barcha foydalanuvchilar uchun umumiy
  if (getSetting('tg_api_id') === null) setSetting('tg_api_id', '');
  if (getSetting('tg_api_hash') === null) setSetting('tg_api_hash', '');
  // Bot havola generatsiya qilishi uchun sayt (frontend) manzili
  if (getSetting('frontend_url') === null) setSetting('frontend_url', '');
}
initDefaults();

module.exports = { db, getSetting, setSetting, getAllSettings };
