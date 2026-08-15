const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');
const bigInt = require('big-integer');

const map = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'premiumEmojiMap.json'), 'utf-8')
);

const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const emojiRegex =
  sortedKeys.length > 0 ? new RegExp(sortedKeys.map(escapeRegex).join('|'), 'gu') : null;

/**
 * Oddiy matnni MTProto xabar + premium emoji entity ro'yxatiga aylantiradi.
 * Foydalanish: client.sendMessage(peer, { message: text, formattingEntities: entities })
 * MUHIM: Bu userga Telegram Premium bo'lishi shart emas - premium emoji
 * har qanday akkountdan (agar u custom_emoji_id bilan yuborilsa) ko'rinadi.
 */
function buildPremiumMessage(text) {
  if (!text || !emojiRegex) return { text, entities: [] };
  const entities = [];
  emojiRegex.lastIndex = 0;
  let match;
  while ((match = emojiRegex.exec(text)) !== null) {
    const id = map[match[0]];
    if (id) {
      entities.push(
        new Api.MessageEntityCustomEmoji({
          offset: match.index,
          length: match[0].length,
          documentId: bigInt(id),
        })
      );
    }
    if (match[0].length === 0) emojiRegex.lastIndex += 1; // sonsiz tsikldan himoya
  }
  return { text, entities };
}

module.exports = { buildPremiumMessage, emojiMap: map };
