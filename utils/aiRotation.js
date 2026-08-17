const axios = require('axios');
const { db } = require('../db');

// -------- Provider chaqiruvlari (suhbat konteksti bilan) --------
// messages: [{role:'user'|'assistant', content: '...'}, ...] - eskidan yangiga qarab tartiblangan

async function callOpenRouter(apiKey, systemPrompt, messages) {
  const resp = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openrouter/auto',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return resp.data?.choices?.[0]?.message?.content?.trim() || null;
}

async function callGemini(apiKey, systemPrompt, messages) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

/** Faqat JSON qaytaradigan chaqiruv - bilim bazasini yangilash uchun */
async function callOpenRouterJSON(apiKey, systemPrompt, userText) {
  const resp = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    }
  );
  return resp.data?.choices?.[0]?.message?.content?.trim() || null;
}

async function callGeminiJSON(apiKey, systemPrompt, userText) {
  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// -------- Kalitlarni tanlash tartibi --------
function getOrderedActiveKeys() {
  const primary = db
    .prepare('SELECT * FROM ai_keys WHERE active = 1 AND is_primary = 1 ORDER BY id ASC')
    .all();
  const backup = db
    .prepare('SELECT * FROM ai_keys WHERE active = 1 AND is_primary = 0 ORDER BY id ASC')
    .all();
  return [...primary, ...backup];
}

function markFailure(id) {
  db.prepare(
    'UPDATE ai_keys SET fail_count = fail_count + 1, active = CASE WHEN fail_count + 1 >= 5 THEN 0 ELSE active END WHERE id = ?'
  ).run(id);
}

function resetFailure(id) {
  db.prepare('UPDATE ai_keys SET fail_count = 0 WHERE id = ?').run(id);
}

function buildSystemPrompt(knowledgeList = []) {
  const knowledgeText = knowledgeList.map((k) => `- ${k}`).join('\n');
  return (
    `Sen odamning shaxsiy Telegram akkounti nomidan, u band/oflayn bo'lganda ` +
    `unga yozganlarga o'rniga javob beryapsan. Xuddi shu odamning o'zi yozayotgandek gapir.\n\n` +
    `QOIDALAR:\n` +
    `- O'zbek tilida, qisqa (1-3 gap), samimiy va TABIIY javob ber - shablon yoki umumiy "salom" bilan cheklanma.\n` +
    `- Suhbat tarixini albatta hisobga ol - agar savol avvalgi xabarlarga bog'liq bo'lsa, kontekstga mos javob ber.\n` +
    `- Faqat aniq savolga javob ber, ortiqcha ma'lumot qo'shma.\n` +
    `- Agar quyidagi ma'lumotlarda javob bo'lsa, aynan o'shanga tayan; bo'lmasa, umumiy odobli javob ber (masalan hozir band ekanini ayt).\n` +
    (knowledgeText ? `\nMA'LUMOTLAR BAZASI (eng dolzarb faktlar, eskirganlari avtomatik o'chiriladi):\n${knowledgeText}` : '\n(Hozircha bilim bazasi bo\'sh)')
  );
}

/**
 * 20 ta kalit orasidan navbat bilan urinib, AI javobini qaytaradi.
 * history - [{role:'user'|'assistant', content}] suhbat tarixi (охирги xabar - eng oxirida, foydalanuvchidan).
 * knowledgeList - shu foydalanuvchining o'z bilim bazasidagi matnlar ro'yxati.
 */
async function getAIReply(history, knowledgeList = []) {
  const systemPrompt = buildSystemPrompt(knowledgeList);
  const keys = getOrderedActiveKeys();
  const messages = Array.isArray(history) ? history : [{ role: 'user', content: String(history) }];

  for (const key of keys) {
    try {
      let reply = null;
      if (key.provider === 'openrouter') {
        reply = await callOpenRouter(key.api_key, systemPrompt, messages);
      } else if (key.provider === 'gemini') {
        reply = await callGemini(key.api_key, systemPrompt, messages);
      }
      if (reply) {
        resetFailure(key.id);
        return reply;
      }
    } catch (err) {
      console.error(`AI kalit #${key.id} (${key.provider}) xato:`, err.response?.data || err.message);
      markFailure(key.id);
      continue;
    }
  }
  return null;
}

/**
 * Yangi kiritilgan bilim (fakt) eski ma'lumotlar bilan ziddiyatli/uni yangilaydigan
 * bo'lsa, qaysi eski yozuvlar o'chirilishi kerakligini AI orqali aniqlaydi.
 * existingRows: [{id, content}], newFact: string
 * Qaytaradi: { replaceIds: number[], finalText: string }
 */
async function reconcileKnowledge(existingRows, newFact) {
  if (!existingRows.length) {
    return { replaceIds: [], finalText: newFact };
  }

  const systemPrompt =
    `Senga foydalanuvchi haqidagi eski faktlar ro'yxati va yangi kiritilgan fakt beriladi. ` +
    `Vazifang: agar yangi fakt eski faktlardan birini ESKIRGAN yoki NOTO'G'RI qilib qo'ysa ` +
    `(masalan "futboldaman, 11dan keyin chiqaman" keyin "futboldan chiqdim" desa, birinchisi eskiradi), ` +
    `o'sha eski faktlarning ID raqamlarini "replace_ids" ro'yxatiga yoz. ` +
    `Agar yangi fakt mustaqil (hech narsani eskirtirmasa), "replace_ids" bo'sh bo'lsin. ` +
    `"final_text" maydoniga yangi faktni qisqa va aniq holda yoz. ` +
    `FAQAT quyidagi JSON formatda javob ber, boshqa hech narsa yozma:\n` +
    `{"replace_ids": [raqamlar], "final_text": "matn"}`;

  const userText =
    `Eski faktlar:\n` +
    existingRows.map((r) => `ID ${r.id}: ${r.content}`).join('\n') +
    `\n\nYangi fakt: ${newFact}`;

  const keys = getOrderedActiveKeys();
  for (const key of keys) {
    try {
      let raw = null;
      if (key.provider === 'openrouter') {
        raw = await callOpenRouterJSON(key.api_key, systemPrompt, userText);
      } else if (key.provider === 'gemini') {
        raw = await callGeminiJSON(key.api_key, systemPrompt, userText);
      }
      if (raw) {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        resetFailure(key.id);
        return {
          replaceIds: Array.isArray(parsed.replace_ids) ? parsed.replace_ids : [],
          finalText: parsed.final_text || newFact,
        };
      }
    } catch (err) {
      markFailure(key.id);
      continue;
    }
  }
  // AI ishlamasa - eskisini o'chirmasdan, faqat yangisini qo'shamiz (xavfsiz fallback)
  return { replaceIds: [], finalText: newFact };
}

/**
 * Foydalanuvchi oddiy o'zbek tilida yozgan buyruqni (masalan "faqat men oflayn
 * bo'lganimda javob yoz") aniq amalga (sozlama o'zgarishiga) aylantiradi.
 * Qaytadi: {action:'set_away_mode'|'set_autoreply_status'|'set_ai_enabled'|'exclude_contact'|'unknown', ...}
 */
async function parseCommand(instructionText) {
  const systemPrompt =
    `Foydalanuvchi o'zining shaxsiy Telegram avto-javob botiga sozlama beryapti. ` +
    `Uning gapini quyidagi amallardan FAQAT BIRIGA moslashtir va aynan shu formatda JSON qaytar:\n\n` +
    `1) Faqat oflayn/band bo'lganda javob berish: {"action":"set_away_mode","value":"when_offline","minutes":N}\n` +
    `   (agar daqiqa aytilmagan bo'lsa "minutes" maydonini qo'shma)\n` +
    `2) Doim (onlayn bo'lsa ham) javob berish: {"action":"set_away_mode","value":"always"}\n` +
    `3) Avto-javobni to'liq o'chirish: {"action":"set_autoreply_status","value":"off_permanent"}\n` +
    `4) Avto-javobni vaqtincha o'chirish: {"action":"set_autoreply_status","value":"off_temp"}\n` +
    `5) Avto-javobni yoqish/qayta ishga tushirish: {"action":"set_autoreply_status","value":"on"}\n` +
    `6) AI'ni yoqish: {"action":"set_ai_enabled","value":true}\n` +
    `7) AI'ni o'chirish: {"action":"set_ai_enabled","value":false}\n` +
    `8) Muayyan kishiga (@username) javob berilmasin: {"action":"exclude_contact","username":"@..."}\n` +
    `9) Hech biriga mos kelmasa yoki tushunarsiz bo'lsa: {"action":"unknown"}\n\n` +
    `FAQAT JSON qaytar, hech qanday izoh yozma.`;

  const keys = getOrderedActiveKeys();
  for (const key of keys) {
    try {
      let raw = null;
      if (key.provider === 'openrouter') {
        raw = await callOpenRouterJSON(key.api_key, systemPrompt, instructionText);
      } else if (key.provider === 'gemini') {
        raw = await callGeminiJSON(key.api_key, systemPrompt, instructionText);
      }
      if (raw) {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        resetFailure(key.id);
        return parsed;
      }
    } catch (err) {
      markFailure(key.id);
      continue;
    }
  }
  return { action: 'unknown' };
}

module.exports = { getAIReply, reconcileKnowledge, parseCommand };
