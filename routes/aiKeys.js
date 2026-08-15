const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { db } = require('../db');

const router = express.Router();
const MAX_KEYS = 20;
const MAX_PRIMARY = 3;

router.get('/', authMiddleware, (req, res) => {
  const keys = db
    .prepare(
      `SELECT id, provider, label, is_primary, active, fail_count, created_at,
              (substr(api_key,1,4) || '...' || substr(api_key,-4)) as api_key_preview
       FROM ai_keys ORDER BY is_primary DESC, id ASC`
    )
    .all();
  res.json({ keys, total: keys.length, max: MAX_KEYS });
});

router.post('/', authMiddleware, (req, res) => {
  const { provider, api_key, label, is_primary } = req.body;
  if (!provider || !api_key) return res.status(400).json({ error: 'provider va api_key majburiy' });
  if (!['openrouter', 'gemini'].includes(provider)) {
    return res.status(400).json({ error: "provider 'openrouter' yoki 'gemini' bo'lishi kerak" });
  }

  const total = db.prepare('SELECT COUNT(*) c FROM ai_keys').get().c;
  if (total >= MAX_KEYS) return res.status(400).json({ error: `Maksimal ${MAX_KEYS} ta kalit joyi to'ldi` });

  const primaryCount = db.prepare('SELECT COUNT(*) c FROM ai_keys WHERE is_primary=1').get().c;
  const primary = is_primary && primaryCount < MAX_PRIMARY ? 1 : 0;

  const info = db
    .prepare('INSERT INTO ai_keys (provider, label, api_key, is_primary) VALUES (?,?,?,?)')
    .run(provider, label || '', api_key, primary);
  res.json({ id: info.lastInsertRowid, is_primary: primary });
});

router.put('/:id', authMiddleware, (req, res) => {
  const { active, is_primary, label, api_key } = req.body;

  if (is_primary === 1) {
    const primaryCount = db
      .prepare('SELECT COUNT(*) c FROM ai_keys WHERE is_primary=1 AND id != ?')
      .get(req.params.id).c;
    if (primaryCount >= MAX_PRIMARY) {
      return res.status(400).json({ error: `Asosiy kalitlar soni ${MAX_PRIMARY} tadan oshmasin` });
    }
  }

  db.prepare(
    `UPDATE ai_keys SET
      active = COALESCE(?, active),
      is_primary = COALESCE(?, is_primary),
      label = COALESCE(?, label),
      api_key = COALESCE(?, api_key),
      fail_count = 0
     WHERE id = ?`
  ).run(active, is_primary, label, api_key, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM ai_keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
