const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const { getSetting } = require('../db');

// Login jarayoni davomida vaqtincha ulanган MTProto klientlar (userId -> {client, phoneNumber, phoneCodeHash})
const pendingClients = new Map();

function getApiCreds() {
  const apiId = parseInt(getSetting('tg_api_id', '0'), 10);
  const apiHash = getSetting('tg_api_hash', '');
  return { apiId, apiHash };
}

/**
 * Berilgan foydalanuvchi (bizning users.id) uchun telefon raqamga tasdiqlash kodi yuboradi.
 */
async function sendCode(userId, phoneNumber) {
  const { apiId, apiHash } = getApiCreds();
  if (!apiId || !apiHash) {
    throw new Error("Tizim admin TG_API_ID / TG_API_HASH sozlamagan. Admin panelda sozlash kerak.");
  }
  // Eski pending klient bo'lsa tozalaymiz
  cancelPending(userId);

  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });
  await client.connect();
  const result = await client.sendCode({ apiId, apiHash }, phoneNumber);
  pendingClients.set(userId, { client, phoneNumber, phoneCodeHash: result.phoneCodeHash });
  return true;
}

/**
 * Foydalanuvchi kiritgan kodni tasdiqlaydi.
 * Muvaffaqiyatli bo'lsa: { needPassword:false, sessionString, client }
 * 2FA kerak bo'lsa: { needPassword:true }
 */
async function verifyCode(userId, code) {
  const pending = pendingClients.get(userId);
  if (!pending) throw new Error("Avval telefon raqam yuborilishi kerak (kod so'ralmagan).");
  try {
    await pending.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code,
      })
    );
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return { needPassword: true };
    }
    throw err;
  }
  const sessionString = pending.client.session.save();
  const client = pending.client;
  pendingClients.delete(userId);
  return { needPassword: false, sessionString, client };
}

/**
 * 2FA (ikki bosqichli) parolni tasdiqlaydi.
 */
async function verifyPassword(userId, password) {
  const pending = pendingClients.get(userId);
  if (!pending) throw new Error("Sessiya topilmadi, qaytadan '🔗 Akkountni ulash' dan boshlang.");
  const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
  const srpCheck = await computeCheck(passwordInfo, password);
  await pending.client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
  const sessionString = pending.client.session.save();
  const client = pending.client;
  pendingClients.delete(userId);
  return { sessionString, client };
}

function cancelPending(userId) {
  const pending = pendingClients.get(userId);
  if (pending) {
    try {
      pending.client.disconnect();
    } catch (e) {
      /* ignore */
    }
    pendingClients.delete(userId);
  }
}

module.exports = { sendCode, verifyCode, verifyPassword, cancelPending, getApiCreds };
