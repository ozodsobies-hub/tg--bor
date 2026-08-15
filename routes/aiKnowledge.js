const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { db, getSetting, setSetting } = require('../db');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM ai_knowledge ORDER BY id DESC').all());
});

router.post('/', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content majburiy' });
  const info = db.prepare('INSERT INTO ai_knowledge (content) VALUES (?)').run(content);
  res.json({ id: info.lastInsertRowid });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM ai_knowledge WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/toggle-status', authMiddleware, (req, res) => {
  res.json({ ai_enabled: getSetting('ai_enabled', '0') === '1' });
});

router.post('/toggle', authMiddleware, (req, res) => {
  const current = getSetting('ai_enabled', '0') === '1';
  setSetting('ai_enabled', current ? '0' : '1');
  res.json({ ai_enabled: !current });
});

module.exports = router;
