const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const botManager = require('../bot/botManager');

const router = express.Router();

router.get('/status', authMiddleware, (req, res) => {
  res.json(botManager.getStatus());
});

router.post('/reload', authMiddleware, async (req, res) => {
  res.json(await botManager.reloadBot());
});

router.post('/stop-permanent', authMiddleware, async (req, res) => {
  res.json(await botManager.stopBotPermanent());
});

router.post('/stop-temp', authMiddleware, async (req, res) => {
  res.json(await botManager.stopBotTemp());
});

router.post('/start', authMiddleware, async (req, res) => {
  res.json(await botManager.startBot());
});

module.exports = router;
