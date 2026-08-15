const axios = require('axios');
const { db } = require('../db');

// -------- Provider chaqiruvlari --------

async function callOpenRouter(apiKey, systemPrompt, userText) {
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return resp.data?.choices?.[0]?.message?.content?.trim() || null;
}

async function callGemini(apiKey, systemPrompt, userText) {
  const resp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: `${systemPrompt}\n\nFoydalanuvchi: ${userText}` }] }],
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// -------- Kalitlarni tanlash tartibi --------
// 1) is_primary=1 va active=1 bo'lganlar (3 tasi) avval
// 2) keyin qolgan active=1 zaxira kalitlar
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

function buildSystemPrompt() {
  const knowledge = db.prepare('SELECT content FROM ai_knowledge ORDER BY id ASC').all();
  const knowledgeText = knowledge.map((k) => `- ${k.content}`).join('\n');
  return (
    `Sen Telegram bot uchun ishlayotgan yordamchi AI'san. ` +
    `Foydalanuvchi savoliga o'zbek tilida, qisqa, samimiy va aniq javob ber. ` +
    (knowledgeText
      ? `\n\nQuyidagi ma'lumotlarga tayanib javob ber (agar savol shu bilan bog'liq bo'lsa):\n${knowledgeText}`
      : '')
  );
}

/**
 * 20 ta kalit orasidan navbat bilan urinib, AI javobini qaytaradi.
 * Barcha kalitlar ishlamasa, null qaytaradi.
 */
async function getAIReply(userText) {
  const systemPrompt = buildSystemPrompt();
  const keys = getOrderedActiveKeys();

  for (const key of keys) {
    try {
      let reply = null;
      if (key.provider === 'openrouter') {
        reply = await callOpenRouter(key.api_key, systemPrompt, userText);
      } else if (key.provider === 'gemini') {
        reply = await callGemini(key.api_key, systemPrompt, userText);
      }
      if (reply) {
        resetFailure(key.id);
        return reply;
      }
    } catch (err) {
      console.error(`AI kalit #${key.id} (${key.provider}) xato:`, err.response?.data || err.message);
      markFailure(key.id);
      continue; // keyingi kalitga o'tish
    }
  }
  return null;
}

module.exports = { getAIReply };
