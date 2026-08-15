const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { db } = require('../db');
const userbotManager = require('../userbot/userbotManager');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const users = db
    .prepare(
      `SELECT id, telegram_id, telegram_username, phone_number, session_string,
              away_mode, away_timeout_minutes, autoreply_status, ai_enabled, created_at
       FROM users ORDER BY id DESC`
    )
    .all();

  const out = users.map((u) => {
    const status = userbotManager.getInstanceStatus(u.id);
    return {
      id: u.id,
      telegram_id: u.telegram_id,
      telegram_username: u.telegram_username,
      connected: !!u.session_string,
      running: status?.connected || false,
      autoreply_status: u.autoreply_status,
      ai_enabled: !!u.ai_enabled,
      away_mode: u.away_mode,
      away_timeout_minutes: u.away_timeout_minutes,
      created_at: u.created_at,
    };
  });
  res.json(out);
});

// Admin tomonidan majburiy uzish (qo'llab-quvvatlash uchun)
router.post('/:id/disconnect', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await userbotManager.stopInstance(id, true);
  db.prepare("UPDATE users SET session_string = '' WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
