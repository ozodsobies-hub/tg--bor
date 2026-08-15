require('dotenv').config();
const express = require('express');
const cors = require('cors');

const botManager = require('./bot/botManager');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const botControlRoutes = require('./routes/botControl');
const autoreplyRoutes = require('./routes/autoreply');
const aiKeysRoutes = require('./routes/aiKeys');
const aiKnowledgeRoutes = require('./routes/aiKnowledge');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'telegram-ai-autoreply-backend' });
});

// Telegram webhook - bot manager o'zi secret'ni tekshiradi
app.post('/webhook/:secret', async (req, res) => {
  try {
    const handled = await botManager.handleUpdate(req.params.secret, req.body);
    res.sendStatus(handled ? 200 : 403);
  } catch (err) {
    console.error('Webhook xatosi:', err);
    res.sendStatus(500);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/bot', botControlRoutes);
app.use('/api/autoreply', autoreplyRoutes);
app.use('/api/ai-keys', aiKeysRoutes);
app.use('/api/ai-knowledge', aiKnowledgeRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server ${PORT} portda ishga tushdi`);
  await botManager.initBot();
});
