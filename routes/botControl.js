const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const controlBot = require('../controlBot/manager');

const router = express.Router();

// Bu endi MARKAZIY (control) botning holati - ko'p foydalanuvchili "eshik" bot.
router.get('/status', authMiddleware, (req, res) => {
  res.json(controlBot.getStatus());
});

router.post('/reload', authMiddleware, async (req, res) => {
  res.json(await controlBot.reloadBot());
});

module.exports = router;
