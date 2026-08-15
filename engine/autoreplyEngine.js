const { db } = require('../db');
const { getAIReply } = require('../utils/aiRotation');

function findRuleMatch(userId, text) {
  const rules = db
    .prepare('SELECT * FROM autoreply_rules WHERE user_id = ? AND active = 1')
    .all(userId);
  const lower = text.toLowerCase().trim();

  for (const r of rules) {
    if (r.match_type === 'exact' && r.trigger_text.toLowerCase().trim() === lower) {
      return r.response_text;
    }
  }
  for (const r of rules) {
    if (r.match_type === 'contains' && lower.includes(r.trigger_text.toLowerCase().trim())) {
      return r.response_text;
    }
  }
  return null;
}

/**
 * Berilgan foydalanuvchi (users.id) uchun kelgan xabarga avto-javob generatsiya qiladi.
 * Tartib: 1) shu foydalanuvchining o'z qoidalari 2) AI (agar u yoqqan bo'lsa, o'z bilim bazasi bilan)
 */
async function generateAutoReply(userId, text) {
  const ruleMatch = findRuleMatch(userId, text);
  if (ruleMatch) return ruleMatch;

  const user = db.prepare('SELECT ai_enabled FROM users WHERE id = ?').get(userId);
  if (user && user.ai_enabled) {
    const knowledge = db
      .prepare('SELECT content FROM ai_knowledge WHERE user_id = ? ORDER BY id ASC')
      .all(userId)
      .map((k) => k.content);
    const aiReply = await getAIReply(text, knowledge);
    if (aiReply) return aiReply;
  }
  return null;
}

module.exports = { generateAutoReply, findRuleMatch };
