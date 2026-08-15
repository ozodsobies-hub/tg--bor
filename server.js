require('dotenv').config();
const express = require('express');
const cors = require('cors');

const controlBot = require('./controlBot/manager');
const userbotManager = require('./userbot/userbotManager');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const botControlRoutes = require('./routes/botControl');
const aiKeysRoutes = require('./routes/aiKeys');
const adminUsersRoutes = require('./routes/adminUsers');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'telegram-multiuser-ai-autoreply-backend' });
});

// Markaziy (control) bot webhook manzili
app.post('/webhook/:secret', async (req, res) => {
  try {
    const handled = await controlBot.handleUpdate(req.params.secret, req.body);
    res.sendStatus(handled ? 200 : 403);
  } catch (err) {
    console.error('Webhook xatosi:', err);
    res.sendStatus(500);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/bot', botControlRoutes);
app.use('/api/ai-keys', aiKeysRoutes);
app.use('/api/admin-users', adminUsersRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server ${PORT} portda ishga tushdi`);
  await controlBot.initBot();
  await userbotManager.bootAllUsers();
});
