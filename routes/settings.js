const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getAllSettings, setSetting } = require('../db');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const s = getAllSettings();
  delete s.admin_password_hash;
  delete s.jwt_secret;
  delete s.webhook_secret;
  // Tokenni to'liq ko'rsatmaymiz, faqat oxirgi 4 belgisini
  if (s.bot_token) {
    s.bot_token_preview = '...' + s.bot_token.slice(-6);
    s.bot_token_set = true;
    delete s.bot_token;
  } else {
    s.bot_token_set = false;
  }
  res.json(s);
});

router.put('/', authMiddleware, (req, res) => {
  const allowed = ['bot_token', 'owner_telegram_id', 'welcome_text', 'about_text'];
  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== '') {
      setSetting(key, req.body[key]);
    }
  }
  res.json({ ok: true });
});

module.exports = router;
