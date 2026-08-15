const fs = require('fs');
const path = require('path');

const map = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'premiumEmojiMap.json'), 'utf-8')
);

const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const emojiRegex =
  sortedKeys.length > 0 ? new RegExp(sortedKeys.map(escapeRegex).join('|'), 'gu') : null;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Bot API (Telegraf) uchun: oddiy matnni parse_mode: 'HTML' bilan yuborishga tayyorlaydi,
 * har bir mos keluvchi emojini <tg-emoji emoji-id="..."> bilan o'raydi.
 */
function toPremiumHTML(text) {
  if (!text) return text;
  const escaped = escapeHtml(text);
  if (!emojiRegex) return escaped;
  return escaped.replace(emojiRegex, (match) => {
    const id = map[match];
    return id ? `<tg-emoji emoji-id="${id}">${match}</tg-emoji>` : match;
  });
}

module.exports = { toPremiumHTML, emojiMap: map };
