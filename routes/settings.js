const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getAllSettings, setSetting } = require('../db');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  const s = getAllSettings();
  delete s.admin_password_hash;
  delete s.jwt_secret;
  delete s.control_bot_webhook_secret;
  if (s.control_bot_token) {
    s.control_bot_token_preview = '...' + s.control_bot_token.slice(-6);
    s.control_bot_token_set = true;
    delete s.control_bot_token;
  } else {
    s.control_bot_token_set = false;
  }
  s.tg_api_hash_set = !!s.tg_api_hash;
  delete s.tg_api_hash;
  res.json(s);
});

router.put('/', authMiddleware, (req, res) => {
  const allowed = ['control_bot_token', 'tg_api_id', 'tg_api_hash'];
  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== '') {
      setSetting(key, req.body[key]);
    }
  }
  res.json({ ok: true });
});

module.exports = router;
