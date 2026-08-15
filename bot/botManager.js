const { Telegraf, Markup } = require('telegraf');
const { db, getSetting, setSetting } = require('../db');
const { toPremiumHTML } = require('../utils/premiumEmoji');
const { generateAutoReply } = require('./autoreplyEngine');
const { getAIReply } = require('../utils/aiRotation');

let bot = null;
let botInfo = null;

// Faqat xotirada saqlanadigan holat (owner navigatsiyasi uchun)
const sessions = new Map(); // chatId -> 'autoreply_menu' | 'awaiting_rule' | 'awaiting_knowledge'
const aiChatMode = new Set(); // chatId -> AI erkin suhbat rejimida

function isOwner(ctx) {
  const ownerId = getSetting('owner_telegram_id', '');
  if (!ownerId) return false;
  return String(ctx.from.id) === String(ownerId);
}

function mainKeyboard(owner) {
  if (!owner) return Markup.keyboard([['🤖 Bot haqida']]).resize();
  return Markup.keyboard([['🤖 Bot haqida', '⚙️ Avto javob']]).resize();
}

function autoreplyKeyboard() {
  return Markup.keyboard([
    ["📝 Ma'lumot kiritish"],
    ["🔴 Butunlay o'chirish", "🟡 Vaqtincha o'chirish"],
    ["🔄 Qayta ishga tushirish"],
    ["🧠 AI bilan suhbat", "🔛 AI yoqish/o'chirish"],
    ["📚 AI ga ma'lumot kiritish"],
    ["⬅️ Orqaga"],
  ]).resize();
}

async function sendPremium(ctx, text, extra = {}) {
  return ctx.reply(toPremiumHTML(text), { parse_mode: 'HTML', ...extra });
}

function setupHandlers(instance) {
  instance.start(async (ctx) => {
    sessions.delete(ctx.chat.id);
    aiChatMode.delete(ctx.chat.id);
    await sendPremium(ctx, getSetting('welcome_text'), mainKeyboard(isOwner(ctx)));
  });

  instance.hears('🤖 Bot haqida', async (ctx) => {
    await sendPremium(ctx, getSetting('about_text'), mainKeyboard(isOwner(ctx)));
  });

  instance.hears('⚙️ Avto javob', async (ctx) => {
    if (!isOwner(ctx)) return;
    sessions.set(ctx.chat.id, 'autoreply_menu');
    const status = getSetting('autoreply_status', 'on');
    const aiEnabled = getSetting('ai_enabled', '0') === '1';
    const statusText =
      status === 'on' ? "🟢 Yoqilgan" : status === 'off_temp' ? "🟡 Vaqtincha o'chirilgan" : "🔴 Butunlay o'chirilgan";
    await sendPremium(
      ctx,
      `⚙️ Avto javob boshqaruvi\n\nHolat: ${statusText}\nAI: ${aiEnabled ? '🟢 Yoqilgan' : "🔴 O'chirilgan"}`,
      autoreplyKeyboard()
    );
  });

  instance.hears('⬅️ Orqaga', async (ctx) => {
    if (!isOwner(ctx)) return;
    sessions.delete(ctx.chat.id);
    aiChatMode.delete(ctx.chat.id);
    await sendPremium(ctx, '⬅️ Bosh menyu', mainKeyboard(true));
  });

  instance.hears("📝 Ma'lumot kiritish", async (ctx) => {
    if (!isOwner(ctx)) return;
    sessions.set(ctx.chat.id, 'awaiting_rule');
    await sendPremium(
      ctx,
      "📝 Yangi avto-javob qoidasi qo'shish uchun quyidagi formatda yozing:\n\nSO'ROV | JAVOB\n\nMisol:\nsalom | Assalomu alaykum! 👋 Xush kelibsiz."
    );
  });

  instance.hears("🔴 Butunlay o'chirish", async (ctx) => {
    if (!isOwner(ctx)) return;
    setSetting('autoreply_status', 'off_permanent');
    await sendPremium(ctx, "🔴 Avto javob butunlay o'chirildi.");
  });

  instance.hears("🟡 Vaqtincha o'chirish", async (ctx) => {
    if (!isOwner(ctx)) return;
    setSetting('autoreply_status', 'off_temp');
    await sendPremium(ctx, "🟡 Avto javob vaqtincha o'chirildi.");
  });

  instance.hears("🔄 Qayta ishga tushirish", async (ctx) => {
    if (!isOwner(ctx)) return;
    setSetting('autoreply_status', 'on');
    await sendPremium(ctx, "🔄 Avto javob qayta ishga tushirildi (yoqildi).");
  });

  instance.hears("🔛 AI yoqish/o'chirish", async (ctx) => {
    if (!isOwner(ctx)) return;
    const current = getSetting('ai_enabled', '0') === '1';
    setSetting('ai_enabled', current ? '0' : '1');
    await sendPremium(ctx, current ? "🔴 AI o'chirildi." : '🟢 AI yoqildi.');
  });

  instance.hears("📚 AI ga ma'lumot kiritish", async (ctx) => {
    if (!isOwner(ctx)) return;
    sessions.set(ctx.chat.id, 'awaiting_knowledge');
    await sendPremium(
      ctx,
      '📚 AI uchun ma\'lumot yuboring (masalan: "Mening ismim Aziz", "Bot ish vaqti 9:00-18:00"). AI shu ma\'lumotlar asosida javob beradi.'
    );
  });

  instance.hears('🧠 AI bilan suhbat', async (ctx) => {
    if (!isOwner(ctx)) return;
    aiChatMode.add(ctx.chat.id);
    await sendPremium(ctx, '🧠 AI bilan suhbat rejimi yoqildi. Xabar yozing. Chiqish uchun "⬅️ Orqaga" bosing.');
  });

  instance.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const owner = isOwner(ctx);
    const state = sessions.get(chatId);

    if (owner && state === 'awaiting_rule') {
      const parts = text.split('|');
      if (parts.length < 2) {
        await sendPremium(ctx, "❗ Format xato. Iltimos: SO'ROV | JAVOB shaklida yuboring.");
        return;
      }
      const trigger = parts[0].trim();
      const response = parts.slice(1).join('|').trim();
      db.prepare('INSERT INTO autoreply_rules (match_type, trigger_text, response_text) VALUES (?,?,?)').run(
        'contains',
        trigger,
        response
      );
      sessions.set(chatId, 'autoreply_menu');
      await sendPremium(ctx, `✅ Qoida qo'shildi:\n"${trigger}" ➔ "${response}"`, autoreplyKeyboard());
      return;
    }

    if (owner && state === 'awaiting_knowledge') {
      db.prepare('INSERT INTO ai_knowledge (content) VALUES (?)').run(text);
      sessions.set(chatId, 'autoreply_menu');
      await sendPremium(ctx, "✅ Ma'lumot AI bazasiga qo'shildi.", autoreplyKeyboard());
      return;
    }

    if (owner && aiChatMode.has(chatId)) {
      const aiReply = await getAIReply(text);
      await sendPremium(ctx, aiReply || "⚠️ AI javob bera olmadi (kalitlar tugagan yoki xato).");
      return;
    }

    // Oddiy foydalanuvchi (yoki owner menyu tashqarisida) - avto javob dvigateli
    const autoReply = await generateAutoReply(text);
    if (autoReply) {
      await sendPremium(ctx, autoReply);
    }
  });
}

async function setWebhook() {
  const publicUrl = process.env.PUBLIC_URL;
  const secret = getSetting('webhook_secret');
  if (!publicUrl) {
    console.warn("⚠️ PUBLIC_URL environment o'zgaruvchisi yo'q, webhook o'rnatilmadi.");
    return;
  }
  await bot.telegram.setWebhook(`${publicUrl}/webhook/${secret}`);
  console.log('✅ Webhook o\'rnatildi:', `${publicUrl}/webhook/${secret}`);
}

async function initBot() {
  const token = getSetting('bot_token', '');
  if (!token) {
    console.warn("⚠️ Bot tokeni sozlanmagan. Dashboard orqali /api/settings ga PUT qilib kiriting, so'ng /api/bot/reload chaqiring.");
    return;
  }
  bot = new Telegraf(token);
  setupHandlers(bot);
  try {
    botInfo = await bot.telegram.getMe();
  } catch (err) {
    console.error('❌ Bot tokeni yaroqsiz:', err.message);
    bot = null;
    return;
  }

  const status = getSetting('autoreply_status', 'on');
  if (status === 'off_permanent') {
    console.log("Bot butunlay o'chirilgan holatda saqlangan, webhook o'rnatilmaydi.");
    return;
  }
  await setWebhook();
}

async function handleUpdate(secret, update) {
  const currentSecret = getSetting('webhook_secret');
  if (secret !== currentSecret) return false;
  if (!bot) return false;
  await bot.handleUpdate(update);
  return true;
}

async function reloadBot() {
  if (bot) {
    try {
      await bot.telegram.deleteWebhook();
    } catch (e) {
      /* ignore */
    }
  }
  bot = null;
  botInfo = null;
  await initBot();
  return getStatus();
}

async function stopBotPermanent() {
  setSetting('autoreply_status', 'off_permanent');
  if (bot) {
    try {
      await bot.telegram.deleteWebhook();
    } catch (e) {
      /* ignore */
    }
  }
  return getStatus();
}

async function stopBotTemp() {
  setSetting('autoreply_status', 'off_temp');
  return getStatus();
}

async function startBot() {
  setSetting('autoreply_status', 'on');
  if (!bot) {
    await initBot();
  } else {
    await setWebhook();
  }
  return getStatus();
}

function getStatus() {
  return {
    running: !!bot,
    username: botInfo?.username || null,
    autoreply_status: getSetting('autoreply_status', 'on'),
    ai_enabled: getSetting('ai_enabled', '0') === '1',
  };
}

module.exports = {
  initBot,
  reloadBot,
  stopBotPermanent,
  stopBotTemp,
  startBot,
  handleUpdate,
  getStatus,
};
