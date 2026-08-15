const fs = require('fs');
const path = require('path');

const map = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'premiumEmojiMap.json'), 'utf-8')
);

// Kalitlarni uzunlik bo'yicha kamayish tartibida saralaymiz
// (ZWJ ketma-ketlikdagi uzun emojilar avval mos kelishi uchun)
const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const emojiRegex = new RegExp(sortedKeys.map(escapeRegex).join('|'), 'gu');

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Oddiy matnni Telegram HTML parse_mode uchun tayyorlaydi:
 * - HTML maxsus belgilarini escape qiladi
 * - Har bir mos keluvchi oddiy emojini <tg-emoji emoji-id="..."> bilan o'raydi
 * Natijada: bot.telegram.sendMessage(chatId, result, { parse_mode: 'HTML' })
 */
function toPremiumHTML(text) {
  if (!text) return text;
  const escaped = escapeHtml(text);
  if (sortedKeys.length === 0) return escaped;
  return escaped.replace(emojiRegex, (match) => {
    const id = map[match];
    return id ? `<tg-emoji emoji-id="${id}">${match}</tg-emoji>` : match;
  });
}

module.exports = { toPremiumHTML, emojiMap: map };
