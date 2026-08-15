const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { db } = require('../db');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM autoreply_rules ORDER BY id DESC').all());
});

router.post('/', authMiddleware, (req, res) => {
  const { trigger_text, response_text, match_type } = req.body;
  if (!trigger_text || !response_text) {
    return res.status(400).json({ error: 'trigger_text va response_text majburiy' });
  }
  const info = db
    .prepare('INSERT INTO autoreply_rules (match_type, trigger_text, response_text) VALUES (?,?,?)')
    .run(match_type === 'exact' ? 'exact' : 'contains', trigger_text, response_text);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', authMiddleware, (req, res) => {
  const { trigger_text, response_text, match_type, active } = req.body;
  db.prepare(
    `UPDATE autoreply_rules SET
      trigger_text = COALESCE(?, trigger_text),
      response_text = COALESCE(?, response_text),
      match_type = COALESCE(?, match_type),
      active = COALESCE(?, active)
     WHERE id = ?`
  ).run(trigger_text, response_text, match_type, active, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM autoreply_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
