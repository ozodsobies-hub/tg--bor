const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getSetting, setSetting } = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const storedUser = getSetting('admin_username');
  const storedHash = getSetting('admin_password_hash');

  if (!username || !password || username !== storedUser || !bcrypt.compareSync(password, storedHash)) {
    return res.status(401).json({ error: 'Login yoki parol xato' });
  }

  const secret = getSetting('jwt_secret');
  const token = jwt.sign({ username }, secret, { expiresIn: '7d' });
  res.json({ token });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ username: req.admin.username });
});

router.post('/change-credentials', authMiddleware, (req, res) => {
  const { newUsername, newPassword, currentPassword } = req.body;
  const storedHash = getSetting('admin_password_hash');

  if (!currentPassword || !bcrypt.compareSync(currentPassword, storedHash)) {
    return res.status(401).json({ error: 'Joriy parol xato' });
  }
  if (newUsername) setSetting('admin_username', newUsername);
  if (newPassword) setSetting('admin_password_hash', bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true });
});

module.exports = router;
