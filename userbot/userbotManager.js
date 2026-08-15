const { NewMessage } = require('telegram/events');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { db } = require('../db');
const { generateAutoReply } = require('../engine/autoreplyEngine');
const { buildPremiumMessage } = require('../utils/premiumEntities');
const loginSession = require('./session');

// users.id -> { client, handler, me, lastOwnActivity }
const instances = new Map();
// `${userId}:${senderId}` -> oxirgi javob vaqti (spam himoyasi)
const lastReplyAt = new Map();
const REPLY_COOLDOWN_MS = 25 * 1000;

function makeHandler(userDbId) {
  return async function handler(event) {
    const message = event.message;
    if (!message) return;
    const inst = instances.get(userDbId);
    if (!inst) return;

    // O'zi (istalgan qurilmadan) xabar yozsa - "faollik" hisoblanadi
    if (message.out) {
      inst.lastOwnActivity = Date.now();
      return;
    }
    if (!message.isPrivate) return; // faqat shaxsiy (1-1) chatlar

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userDbId);
    if (!user || user.autoreply_status !== 'on') return;

    if (user.away_mode === 'when_offline') {
      const idleMs = Date.now() - inst.lastOwnActivity;
      if (idleMs < user.away_timeout_minutes * 60 * 1000) return; // hali "onlayn"
    }

    const text = message.message;
    if (!text) return;

    const senderId = message.senderId?.toString();
    const cooldownKey = `${userDbId}:${senderId}`;
    if (senderId) {
      const last = lastReplyAt.get(cooldownKey) || 0;
      if (Date.now() - last < REPLY_COOLDOWN_MS) return;
    }

    try {
      const replyText = await generateAutoReply(userDbId, text);
      if (replyText) {
        const { text: finalText, entities } = buildPremiumMessage(replyText);
        await inst.client.sendMessage(message.senderId, {
          message: finalText,
          formattingEntities: entities,
        });
        if (senderId) lastReplyAt.set(cooldownKey, Date.now());
      }
    } catch (err) {
      console.error(`Userbot #${userDbId} avto-javob xatosi:`, err.message || err);
    }
  };
}

/**
 * Berilgan foydalanuvchi uchun userbot instansiyasini ishga tushiradi.
 * existingClient berilsa (login jarayonidan keyin), qayta ulanmasdan shuni ishlatadi.
 */
async function startInstance(userDbId, existingClient = null) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userDbId);
  if (!user || !user.session_string) {
    return { ok: false, error: 'Akkount ulanmagan' };
  }
  if (user.autoreply_status === 'off_permanent') {
    return { ok: false, error: "Avto javob butunlay o'chirilgan" };
  }

  // Eski instansiya bo'lsa, avval tozalaymiz
  await stopInstance(userDbId, existingClient ? false : true);

  let client = existingClient;
  if (!client) {
    const { apiId, apiHash } = loginSession.getApiCreds();
    const session = new StringSession(user.session_string);
    client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
  }

  const me = await client.getMe();
  const handler = makeHandler(userDbId);
  client.addEventHandler(handler, new NewMessage({}));

  instances.set(userDbId, {
    client,
    handler,
    me,
    lastOwnActivity: Date.now(),
  });
  return { ok: true, username: me.username || me.phone };
}

async function stopInstance(userDbId, disconnect = true) {
  const inst = instances.get(userDbId);
  if (!inst) return;
  try {
    inst.client.removeEventHandler(inst.handler, new NewMessage({}));
  } catch (e) {
    /* ignore */
  }
  if (disconnect) {
    try {
      await inst.client.disconnect();
    } catch (e) {
      /* ignore */
    }
  }
  instances.delete(userDbId);
}

async function reloadInstance(userDbId) {
  await stopInstance(userDbId, true);
  return startInstance(userDbId);
}

function getInstanceStatus(userDbId) {
  const inst = instances.get(userDbId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userDbId);
  if (!user) return null;
  return {
    connected: !!inst,
    username: inst?.me?.username || inst?.me?.phone || null,
    autoreply_status: user.autoreply_status,
    ai_enabled: !!user.ai_enabled,
    away_mode: user.away_mode,
    away_timeout_minutes: user.away_timeout_minutes,
    idle_minutes: inst ? Math.floor((Date.now() - inst.lastOwnActivity) / 60000) : null,
  };
}

/**
 * Server ishga tushganda, bazadagi barcha oldin ulangan foydalanuvchilarni avtomatik qayta ulaydi.
 */
async function bootAllUsers() {
  const users = db
    .prepare("SELECT id FROM users WHERE session_string != '' AND autoreply_status != 'off_permanent'")
    .all();
  let ok = 0;
  for (const u of users) {
    try {
      const res = await startInstance(u.id);
      if (res.ok) ok++;
    } catch (err) {
      console.error('Boot xatosi, user', u.id, err.message);
    }
  }
  console.log(`✅ ${ok}/${users.length} ta foydalanuvchi userbot sessiyasi ishga tushirildi.`);
}

module.exports = {
  startInstance,
  stopInstance,
  reloadInstance,
  getInstanceStatus,
  bootAllUsers,
  instances,
};
