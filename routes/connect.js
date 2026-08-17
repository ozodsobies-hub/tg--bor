const express = require('express');
const { db } = require('../db');
const loginSession = require('../userbot/session');
const userbotManager = require('../userbot/userbotManager');

const router = express.Router();

function getValidUser(token) {
  const user = db.prepare('SELECT * FROM users WHERE connect_token = ?').get(token);
  if (!user) return null;
  if (!user.connect_token_expires || new Date(user.connect_token_expires) < new Date()) {
    return null; // muddati o'tgan
  }
  return user;
}

router.get('/:token/check', (req, res) => {
  const user = getValidUser(req.params.token);
  if (!user) return res.status(404).json({ error: "Havola yaroqsiz yoki muddati o'tgan. Botdan yangi havola oling." });
  res.json({ valid: true, alreadyConnected: !!user.session_string });
});

router.post('/:token/send-code', async (req, res) => {
  try {
    const user = getValidUser(req.params.token);
    if (!user) return res.status(404).json({ error: "Havola yaroqsiz yoki muddati o'tgan." });
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber majburiy' });
    await loginSession.sendCode(user.id, phoneNumber);
    db.prepare('UPDATE users SET phone_number = ? WHERE id = ?').run(phoneNumber, user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:token/verify-code', async (req, res) => {
  try {
    const user = getValidUser(req.params.token);
    if (!user) return res.status(404).json({ error: "Havola yaroqsiz yoki muddati o'tgan." });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code majburiy' });

    const result = await loginSession.verifyCode(user.id, code);
    if (result.needPassword) {
      return res.json({ needPassword: true });
    }

    db.prepare(
      "UPDATE users SET session_string = ?, connect_token = '', connect_token_expires = '' WHERE id = ?"
    ).run(result.sessionString, user.id);
    await userbotManager.startInstance(user.id, result.client);
    await notifyConnected(user.id);
    res.json({ needPassword: false, ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:token/verify-password', async (req, res) => {
  try {
    const user = getValidUser(req.params.token);
    if (!user) return res.status(404).json({ error: "Havola yaroqsiz yoki muddati o'tgan." });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'password majburiy' });

    const result = await loginSession.verifyPassword(user.id, password);
    db.prepare(
      "UPDATE users SET session_string = ?, connect_token = '', connect_token_expires = '' WHERE id = ?"
    ).run(result.sessionString, user.id);
    await userbotManager.startInstance(user.id, result.client);
    await notifyConnected(user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function notifyConnected(userId) {
  try {
    const controlBot = require('../controlBot/manager');
    const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId);
    if (user) {
      await controlBot.notifyConnected(user.telegram_id);
    }
  } catch (e) {
    /* jim e'tiborsiz qoldiramiz - asosiy oqimga ta'sir qilmasin */
  }
}

module.exports = router;
