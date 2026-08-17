const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { db, getSetting } = require('../db');
const { toPremiumHTML } = require('../utils/premiumEmoji');
const userbotManager = require('../userbot/userbotManager');
const { getAIReply, reconcileKnowledge } = require('../utils/aiRotation');

let bot = null;
let botInfo = null;

// chatId -> { state, ... } - vaqtinchalik navigatsiya holati
const nav = new Map();

function getOrCreateUser(telegramId, username) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  if (!user) {
    db.prepare('INSERT INTO users (telegram_id, telegram_username) VALUES (?,?)').run(
      String(telegramId),
      username || ''
    );
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  }
  return user;
}

function mainKeyboard(connected) {
  if (connected) {
    return Markup.keyboard([
      ['⚙️ Avto javob boshqaruvi'],
      ["🔌 Akkountni uzish", 'ℹ️ Bot haqida'],
    ]).resize();
  }
  return Markup.keyboard([['🔗 Akkountni ulash'], ['ℹ️ Bot haqida']]).resize();
}

function autoreplyKeyboard() {
  return Markup.keyboard([
    ["📝 Ma'lumot kiritish", '🚫 Kimlarga javob berilmasin'],
    ["🔴 Butunlay o'chirish", "🟡 Vaqtincha o'chirish"],
    ["🔄 Qayta ishga tushirish"],
    ["🧠 AI bilan suhbat", "🔀 AI yoqish/o'chirish"],
    ["📚 AI ga ma'lumot kiritish", '🗣 Sozlamani yozib ayting'],
    ['✉️ 1-xabar matni', '✉️ Keyingi xabar matni'],
    ['⏰ Oflayn sozlamalari'],
    ['⬅️ Orqaga'],
  ]).resize();
}

function excludeKeyboard() {
  return Markup.keyboard([
    ["➕ Kishi qo'shish", "📋 Ro'yxat"],
    ['⬅️ Orqaga'],
  ]).resize();
}

async function send(ctx, text, extra = {}) {
  return ctx.reply(toPremiumHTML(text), { parse_mode: 'HTML', ...extra });
}

function statusSummary(user) {
  const statusText =
    user.autoreply_status === 'on'
      ? '🟢 Yoqilgan'
      : user.autoreply_status === 'off_temp'
      ? "🟡 Vaqtincha o'chirilgan"
      : "🔴 Butunlay o'chirilgan";
  const awayText =
    user.away_mode === 'always' ? 'Doim yoqilgan' : `Faqat ${user.away_timeout_minutes} daqiqa jimlikdan keyin`;
  return (
    `⚙️ Avto javob boshqaruvi\n\n` +
    `Holat: ${statusText}\n` +
    `AI: ${user.ai_enabled ? '🟢 Yoqilgan' : "🔴 O'chirilgan"}\n` +
    `Oflayn rejimi: ${awayText}\n` +
    `1-xabar matni: ${user.first_message_text ? "✅ sozlangan" : "sozlanmagan (qoida/AI ishlaydi)"}\n` +
    `Keyingi xabar matni (AI o'chirilganda): ${user.subsequent_message_text ? "✅ sozlangan" : "sozlanmagan"}\n\n` +
    `ℹ️ Qanday ishlaydi:\n` +
    `• Sizga kimdir BIRINCHI marta yozsa → "1-xabar matni" (agar sozlangan bo'lsa) yuboriladi.\n` +
    `• Shu odam yana yozsa (keyingi xabarlar) → AI yoqilgan bo'lsa AI javob beradi (suhbat tarixini o'qib); AI o'chirilgan bo'lsa "Keyingi xabar matni" yuboriladi.\n` +
    `• Bularning birortasi sozlanmagan bo'lsa, oddiy qoida (📝) yoki AI ishlatiladi.`
  );
}

function setupHandlers(instance) {
  instance.start(async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.delete(ctx.chat.id);
    const connected = !!user.session_string;
    await send(
      ctx,
      "👋 Assalomu alaykum! Bu bot sizning shaxsiy Telegram akkountingiz uchun AI avto-javob xizmatini sozlashga yordam beradi.\n\n💤 Siz band yoki oflayn bo'lganingizda, sizga yozganlarga akkountingiz nomidan avtomatik, premium emoji bilan javob beriladi.",
      mainKeyboard(connected)
    );
  });

  instance.hears('ℹ️ Bot haqida', async (ctx) => {
    await send(
      ctx,
      "🤖 Bu bot orqali:\n\n1️⃣ '🔗 Akkountni ulash' orqali telefon raqamingiz bilan shaxsiy akkountingizni ulaysiz\n2️⃣ Avto-javob qoidalari va AI'ni sozlaysiz\n3️⃣ Band/oflayn bo'lganingizda sizga yozganlarga akkountingiz nomidan avtomatik javob beriladi ✨"
    );
  });

  instance.hears('🔗 Akkountni ulash', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    const frontendUrl = getSetting('frontend_url', '');
    if (!frontendUrl) {
      await send(ctx, "⚠️ Tizim hali to'liq sozlanmagan (sayt manzili yo'q). Iltimos, birozdan so'ng qayta urinib ko'ring.");
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET connect_token=?, connect_token_expires=? WHERE id=?').run(
      token,
      expires,
      user.id
    );
    const link = `${frontendUrl.replace(/\/$/, '')}/connect.html?token=${token}`;
    await send(
      ctx,
      `🔗 Akkountingizni xavfsiz ulash uchun quyidagi havolaga o'ting (15 daqiqa amal qiladi):\n\n${link}\n\n⚠️ MUHIM: xavfsizlik uchun Telegram tasdiqlash kodini FAQAT shu havoladagi rasmiy formaga kiriting. Kodni hech qachon botga (yoki boshqa hech kimga) yozmang — aks holda Telegram uni avtomatik bekor qiladi va akkountingizni vaqtincha cheklashi mumkin.`
    );
  });

  instance.hears('🔌 Akkountni uzish', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    await userbotManager.stopInstance(user.id, true);
    db.prepare("UPDATE users SET session_string = '' WHERE id = ?").run(user.id);
    nav.delete(ctx.chat.id);
    await send(ctx, '🔌 Akkount uzildi. Xohlasangiz qaytadan ulashingiz mumkin.', mainKeyboard(false));
  });

  instance.hears('⚙️ Avto javob boshqaruvi', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    if (!user.session_string) {
      await send(ctx, "❗ Avval akkountingizni ulang: '🔗 Akkountni ulash'");
      return;
    }
    nav.set(ctx.chat.id, { state: 'autoreply_menu', userId: user.id });
    await send(ctx, statusSummary(user), autoreplyKeyboard());
  });

  instance.hears('⬅️ Orqaga', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.delete(ctx.chat.id);
    await send(ctx, '⬅️ Bosh menyu', mainKeyboard(!!user.session_string));
  });

  instance.hears("📝 Ma'lumot kiritish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_rule', userId: user.id });
    await send(
      ctx,
      "📝 SO'ROV | JAVOB formatida yuboring.\n\nMisol:\nnarx | Narxlar haqida hozir band bo'lishim mumkin, tez orada javob beraman 🙏"
    );
  });

  instance.hears("🔴 Butunlay o'chirish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    db.prepare("UPDATE users SET autoreply_status='off_permanent' WHERE id=?").run(user.id);
    await userbotManager.stopInstance(user.id, false);
    await send(ctx, "🔴 Avto javob butunlay o'chirildi.");
  });

  instance.hears("🟡 Vaqtincha o'chirish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    db.prepare("UPDATE users SET autoreply_status='off_temp' WHERE id=?").run(user.id);
    await send(ctx, "🟡 Avto javob vaqtincha o'chirildi.");
  });

  instance.hears("🔄 Qayta ishga tushirish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    db.prepare("UPDATE users SET autoreply_status='on' WHERE id=?").run(user.id);
    const result = await userbotManager.reloadInstance(user.id);
    await send(ctx, result.ok ? '🔄 Avto javob qayta ishga tushirildi.' : `⚠️ ${result.error}`);
  });

  instance.hears("🔀 AI yoqish/o'chirish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    const newVal = user.ai_enabled ? 0 : 1;
    db.prepare('UPDATE users SET ai_enabled=? WHERE id=?').run(newVal, user.id);
    await send(ctx, newVal ? '🟢 AI yoqildi.' : "🔴 AI o'chirildi.");
  });

  instance.hears("📚 AI ga ma'lumot kiritish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_knowledge', userId: user.id });
    await send(ctx, "📚 AI uchun ma'lumot yuboring (masalan: \"Ismim Aziz\", \"Ish vaqtim 9:00-18:00\"):");
  });

  instance.hears('🧠 AI bilan suhbat', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'ai_chat_mode', userId: user.id });
    await send(ctx, '🧠 AI bilan suhbat rejimi. Xabar yozing. Chiqish uchun "⬅️ Orqaga".');
  });

  instance.hears('⏰ Oflayn sozlamalari', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'away_settings', userId: user.id });
    await send(
      ctx,
      '⏰ Qachon avto-javob berilsin?\n\n1 — Doim yoqilgan\n2 — Faqat men oflayn (jim) bo\'lganimda\n\nRaqam bilan javob bering (1 yoki 2).\n\nℹ️ Bu avtomatik ishlaydi: siz istalgan qurilmangizdan Telegram\'da yozsangiz, tizim buni "faollik" deb biladi. Belgilangan daqiqadan ko\'p jim tursangiz, "oflayn" hisoblanasiz — sizga hech qanday qo\'shimcha harakat kerak emas.'
    );
  });

  instance.hears('🚫 Kimlarga javob berilmasin', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    const list = db.prepare('SELECT contact_ref FROM excluded_contacts WHERE user_id=?').all(user.id);
    nav.set(ctx.chat.id, { state: 'exclude_menu', userId: user.id });
    const text = list.length
      ? `🚫 Hozir avto-javob berilmaydigan kishilar ("do'stlar rejimi"):\n${list
          .map((r, i) => `${i + 1}. ${r.contact_ref}`)
          .join('\n')}`
      : "🚫 Hozircha hech kim istisno qilinmagan. Masalan, yaqin do'stlaringiz/oilangizga avto-javob yubormaslik uchun shu yerdan qo'shishingiz mumkin.";
    await send(ctx, text, excludeKeyboard());
  });

  instance.hears("➕ Kishi qo'shish", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_exclude_contact', userId: user.id });
    await send(ctx, "➕ Avto-javob berilmasligi kerak bo'lgan kishining @username'ini yuboring (masalan: @ali_valiyev):");
  });

  instance.hears("📋 Ro'yxat", async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    const list = db.prepare('SELECT id, contact_ref FROM excluded_contacts WHERE user_id=?').all(user.id);
    if (!list.length) {
      await send(ctx, "📋 Ro'yxat hozircha bo'sh.", excludeKeyboard());
      return;
    }
    nav.set(ctx.chat.id, { state: 'awaiting_exclude_removal', userId: user.id, excludeList: list });
    const text = "🗑 O'chirmoqchi bo'lgan kishining raqamini yuboring:\n" + list.map((r, i) => `${i + 1}. ${r.contact_ref}`).join('\n');
    await send(ctx, text);
  });

  instance.hears('🗣 Sozlamani yozib ayting', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_smart_command', userId: user.id });
    await send(
      ctx,
      '🗣 Nima qilishni xohlaysiz — oddiy gapda yozing, AI o\'zi tushunib sozlaydi.\n\nMisollar:\n• "Faqat men oflayn bo\'lganimda javob yoz"\n• "Avto javobni vaqtincha o\'chir"\n• "AI ni yoq"\n• "@dostim ga javob berma"'
    );
  });

  instance.hears('✉️ 1-xabar matni', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_first_message_text', userId: user.id });
    await send(
      ctx,
      "✉️ Kimdir sizga BIRINCHI marta yozganda avtomatik yuboriladigan matnni kiriting.\n\nMisol: \"Salom! Hozir band bo'lishim mumkin, imkon qadar tezroq javob beraman 🙏\"\n\nO'chirish uchun \"-\" yuboring."
    );
  });

  instance.hears('✉️ Keyingi xabar matni', async (ctx) => {
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    nav.set(ctx.chat.id, { state: 'awaiting_subsequent_message_text', userId: user.id });
    await send(
      ctx,
      "✉️ AI O'CHIRILGAN bo'lsa, shu odamning KEYINGI xabarlariga yuboriladigan matn.\n(AI yoqilgan bo'lsa, bu matn ishlatilmaydi - AI o'zi javob beradi.)\n\nMisol: \"Hali ham bandman, tez orada albatta javob beraman 🙏\"\n\nO'chirish uchun \"-\" yuboring."
    );
  });

  instance.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const user = getOrCreateUser(ctx.from.id, ctx.from.username);
    const navState = nav.get(chatId);
    const state = navState?.state;

    if (state === 'awaiting_rule') {
      const parts = text.split('|');
      if (parts.length < 2) {
        await send(ctx, "❗ Format xato. Iltimos: SO'ROV | JAVOB shaklida yuboring.");
        return;
      }
      const trigger = parts[0].trim();
      const response = parts.slice(1).join('|').trim();
      db.prepare(
        'INSERT INTO autoreply_rules (user_id, match_type, trigger_text, response_text) VALUES (?,?,?,?)'
      ).run(user.id, 'contains', trigger, response);
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      await send(ctx, `✅ Qoida qo'shildi:\n"${trigger}" ➔ "${response}"`, autoreplyKeyboard());
      return;
    }

    if (state === 'awaiting_knowledge') {
      await send(ctx, '⏳ Tekshirilmoqda...');
      const existingRows = db
        .prepare('SELECT id, content FROM ai_knowledge WHERE user_id = ?')
        .all(user.id);
      const { replaceIds, finalText } = await reconcileKnowledge(existingRows, text);
      if (replaceIds.length) {
        const placeholders = replaceIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM ai_knowledge WHERE user_id = ? AND id IN (${placeholders})`).run(
          user.id,
          ...replaceIds
        );
      }
      db.prepare('INSERT INTO ai_knowledge (user_id, content) VALUES (?,?)').run(user.id, finalText);
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      const note = replaceIds.length
        ? `✅ Ma'lumot qo'shildi va ${replaceIds.length} ta eskirgan ma'lumot avtomatik yangilandi.`
        : "✅ Ma'lumot AI bazasiga qo'shildi.";
      await send(ctx, note, autoreplyKeyboard());
      return;
    }

    if (state === 'away_settings') {
      if (text.trim() === '1') {
        db.prepare("UPDATE users SET away_mode='always' WHERE id=?").run(user.id);
        nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
        await send(ctx, '✅ Doim yoqilgan rejimi tanlandi.', autoreplyKeyboard());
      } else if (text.trim() === '2') {
        nav.set(chatId, { state: 'away_timeout_input', userId: user.id });
        await send(ctx, "Necha daqiqadan keyin oflayn hisoblansin? (raqam kiriting, masalan 5)");
      } else {
        await send(ctx, 'Iltimos 1 yoki 2 raqamini kiriting.');
      }
      return;
    }

    if (state === 'away_timeout_input') {
      const minutes = parseInt(text.trim(), 10);
      if (!minutes || minutes < 1) {
        await send(ctx, "Iltimos to'g'ri raqam kiriting (masalan 5).");
        return;
      }
      db.prepare("UPDATE users SET away_mode='when_offline', away_timeout_minutes=? WHERE id=?").run(
        minutes,
        user.id
      );
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      await send(ctx, `✅ Saqlandi: ${minutes} daqiqa jimlikdan keyin oflayn hisoblanadi.`, autoreplyKeyboard());
      return;
    }

    if (state === 'awaiting_exclude_contact') {
      const username = text.trim();
      const inst = userbotManager.instances.get(user.id);
      if (!inst) {
        await send(ctx, "❗ Avval akkountingiz ulangan va faol bo'lishi kerak.");
        return;
      }
      try {
        const entity = await inst.client.getEntity(username);
        const tgId = entity.id?.toString();
        db.prepare(
          'INSERT INTO excluded_contacts (user_id, contact_ref, contact_tg_id) VALUES (?,?,?)'
        ).run(user.id, username, tgId);
        nav.set(chatId, { state: 'exclude_menu', userId: user.id });
        await send(ctx, `✅ ${username} endi avto-javobdan istisno qilindi.`, excludeKeyboard());
      } catch (err) {
        await send(ctx, "❌ Bu foydalanuvchi topilmadi. @username to'g'ri ekanini tekshiring.");
      }
      return;
    }

    if (state === 'awaiting_exclude_removal') {
      const idx = parseInt(text.trim(), 10) - 1;
      const list = navState.excludeList || [];
      if (isNaN(idx) || !list[idx]) {
        await send(ctx, "❗ To'g'ri raqam kiriting.");
        return;
      }
      db.prepare('DELETE FROM excluded_contacts WHERE id=?').run(list[idx].id);
      nav.set(chatId, { state: 'exclude_menu', userId: user.id });
      await send(ctx, `🗑 ${list[idx].contact_ref} ro'yxatdan o'chirildi.`, excludeKeyboard());
      return;
    }

    if (state === 'awaiting_first_message_text') {
      const value = text.trim() === '-' ? '' : text.trim();
      db.prepare('UPDATE users SET first_message_text=? WHERE id=?').run(value, user.id);
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      await send(ctx, value ? "✅ 1-xabar matni saqlandi." : "✅ 1-xabar matni o'chirildi.", autoreplyKeyboard());
      return;
    }

    if (state === 'awaiting_subsequent_message_text') {
      const value = text.trim() === '-' ? '' : text.trim();
      db.prepare('UPDATE users SET subsequent_message_text=? WHERE id=?').run(value, user.id);
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      await send(ctx, value ? "✅ Keyingi xabar matni saqlandi." : "✅ Keyingi xabar matni o'chirildi.", autoreplyKeyboard());
      return;
    }

    if (state === 'awaiting_smart_command') {
      await send(ctx, '⏳ Tahlil qilinmoqda...');
      const { parseCommand } = require('../utils/aiRotation');
      const cmd = await parseCommand(text);

      if (cmd.action === 'set_away_mode') {
        if (cmd.value === 'always') {
          db.prepare("UPDATE users SET away_mode='always' WHERE id=?").run(user.id);
          await send(ctx, '✅ Tushundim: endi doim avto-javob yoqilgan.', autoreplyKeyboard());
        } else {
          const minutes = cmd.minutes && cmd.minutes > 0 ? cmd.minutes : user.away_timeout_minutes;
          db.prepare("UPDATE users SET away_mode='when_offline', away_timeout_minutes=? WHERE id=?").run(
            minutes,
            user.id
          );
          await send(ctx, `✅ Tushundim: faqat ${minutes} daqiqa jim tursangiz avto-javob ishlaydi.`, autoreplyKeyboard());
        }
      } else if (cmd.action === 'set_autoreply_status') {
        db.prepare('UPDATE users SET autoreply_status=? WHERE id=?').run(cmd.value, user.id);
        if (cmd.value === 'on') await userbotManager.reloadInstance(user.id);
        else await userbotManager.stopInstance(user.id, false);
        await send(ctx, '✅ Bajarildi.', autoreplyKeyboard());
      } else if (cmd.action === 'set_ai_enabled') {
        db.prepare('UPDATE users SET ai_enabled=? WHERE id=?').run(cmd.value ? 1 : 0, user.id);
        await send(ctx, cmd.value ? '✅ AI yoqildi.' : "✅ AI o'chirildi.", autoreplyKeyboard());
      } else if (cmd.action === 'exclude_contact' && cmd.username) {
        const inst = userbotManager.instances.get(user.id);
        try {
          const entity = await inst.client.getEntity(cmd.username);
          db.prepare(
            'INSERT INTO excluded_contacts (user_id, contact_ref, contact_tg_id) VALUES (?,?,?)'
          ).run(user.id, cmd.username, entity.id.toString());
          await send(ctx, `✅ ${cmd.username} avto-javobdan istisno qilindi.`, autoreplyKeyboard());
        } catch (e) {
          await send(ctx, "❌ Bu foydalanuvchini topa olmadim, @username aniqroq yozing.");
        }
      } else {
        await send(
          ctx,
          '🤔 Buni tushunolmadim. Iltimos aniqroq yozing, masalan:\n"Faqat men oflayn bo\'lganimda javob yoz"\n"Avto javobni butunlay o\'chir"\n"@ali ga javob berma"',
          autoreplyKeyboard()
        );
      }
      nav.set(chatId, { state: 'autoreply_menu', userId: user.id });
      return;
    }

    if (state === 'ai_chat_mode') {
      const knowledge = db
        .prepare('SELECT content FROM ai_knowledge WHERE user_id=?')
        .all(user.id)
        .map((k) => k.content);
      if (!navState.testHistory) navState.testHistory = [];
      navState.testHistory.push({ role: 'user', content: text });
      const trimmed = navState.testHistory.slice(-8);
      const reply = await getAIReply(trimmed, knowledge);
      if (reply) navState.testHistory.push({ role: 'assistant', content: reply });
      await send(ctx, reply || '⚠️ AI javob bera olmadi (kalitlar tugagan yoki xato).');
      return;
    }

    // Boshqa holatlarda hech narsa qilmaymiz - bu control botning o'z chati,
    // avto-javob mantiqi shaxsiy akkountlarga tegishli (userbotManager orqali).
  });
}

async function setWebhook() {
  const publicUrl = process.env.PUBLIC_URL;
  const secret = getSetting('control_bot_webhook_secret');
  if (!publicUrl) {
    console.warn("⚠️ PUBLIC_URL environment o'zgaruvchisi yo'q, webhook o'rnatilmadi.");
    return;
  }
  await bot.telegram.setWebhook(`${publicUrl}/webhook/${secret}`);
  console.log('✅ Control bot webhook o\'rnatildi:', `${publicUrl}/webhook/${secret}`);
}

async function initBot() {
  const token = getSetting('control_bot_token', '');
  if (!token) {
    console.warn("⚠️ control_bot_token sozlanmagan. Admin panel orqali kiriting.");
    return;
  }
  bot = new Telegraf(token);
  setupHandlers(bot);
  try {
    botInfo = await bot.telegram.getMe();
  } catch (err) {
    console.error('❌ Control bot tokeni yaroqsiz:', err.message);
    bot = null;
    return;
  }
  await setWebhook();
}

async function handleUpdate(secret, update) {
  const currentSecret = getSetting('control_bot_webhook_secret');
  if (secret !== currentSecret || !bot) return false;
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

function getStatus() {
  return { running: !!bot, username: botInfo?.username || null };
}

/**
 * Saytdagi (connect.html) login tugagach, foydalanuvchiga bot orqali xabar yuborish uchun.
 */
/**
 * Saytdagi (connect.html) login tugagach, foydalanuvchiga bot orqali xabar
 * yuborish uchun - YANGI tugmalar (⚙️ Avto javob boshqaruvi) bilan birga.
 * Aynan shu funksiya oldingi xatoni tuzatadi: ulanish tugagach tugma chiqmasligi muammosi.
 */
async function notifyConnected(telegramId) {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(
      telegramId,
      toPremiumHTML(
        "✅ Akkountingiz muvaffaqiyatli ulandi! Endi quyidagi tugmalar orqali sozlashingiz mumkin."
      ),
      { parse_mode: 'HTML', ...mainKeyboard(true) }
    );
  } catch (err) {
    console.warn('notifyConnected xatosi:', err.message);
  }
}

async function notifyUser(telegramId, text) {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(telegramId, toPremiumHTML(text), { parse_mode: 'HTML' });
  } catch (err) {
    console.warn('notifyUser xatosi:', err.message);
  }
}

module.exports = { initBot, reloadBot, handleUpdate, getStatus, notifyUser, notifyConnected };
