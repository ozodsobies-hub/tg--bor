const { db, getSetting } = require('../db');
const { getAIReply } = require('../utils/aiRotation');

function findRuleMatch(text) {
  const rules = db.prepare('SELECT * FROM autoreply_rules WHERE active = 1').all();
  const lower = text.toLowerCase().trim();

  // Avval aniq (exact) moslik
  for (const r of rules) {
    if (r.match_type === 'exact' && r.trigger_text.toLowerCase().trim() === lower) {
      return r.response_text;
    }
  }
  // Keyin "ichida bor" (contains) moslik
  for (const r of rules) {
    if (r.match_type === 'contains' && lower.includes(r.trigger_text.toLowerCase().trim())) {
      return r.response_text;
    }
  }
  return null;
}

/**
 * Kimdir botga yozganda chaqiriladi.
 * Tartib: 1) avto-javob yoqilganmi? 2) qoidalar 3) AI (agar yoqilgan bo'lsa)
 */
async function generateAutoReply(text) {
  const status = getSetting('autoreply_status', 'on');
  if (status !== 'on') return null;

  const ruleMatch = findRuleMatch(text);
  if (ruleMatch) return ruleMatch;

  const aiEnabled = getSetting('ai_enabled', '0') === '1';
  if (aiEnabled) {
    const aiReply = await getAIReply(text);
    if (aiReply) return aiReply;
  }
  return null;
}

module.exports = { generateAutoReply };
