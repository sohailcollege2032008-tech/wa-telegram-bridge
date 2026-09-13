import path from 'node:path';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const apiBase = (env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot').trim().replace(/\/+$/, '');
  const chatId = (env.TELEGRAM_CHAT_ID || '2035706891').trim();

  return {
    telegram: {
      token,
      chatId,
      apiBase: apiBase.endsWith('/bot') ? apiBase : `${apiBase}/bot`,
    },
    whatsapp: {
      phone: (env.WHATSAPP_PHONE || '').replace(/[^0-9]/g, ''),
      authDir: path.resolve(env.WHATSAPP_AUTH_DIR || './auth_state'),
      pairingMode: (env.WHATSAPP_PAIRING_MODE || 'code').trim().toLowerCase() === 'qr' ? 'qr' : 'code',
    },
    rules: {
      allowedSenders: splitList(env.ALLOWED_SENDERS).map((s) => s.replace(/[^0-9]/g, '')),
      forwardIncoming: bool(env.FORWARD_INCOMING, true),
      forwardFromMe: bool(env.FORWARD_FROM_ME, false),
      forwardSelfChat: bool(env.FORWARD_SELF_CHAT, true),
    },
    logLevel: (env.LOG_LEVEL || 'info').trim(),
    timezone: (env.TZ || 'Africa/Cairo').trim(),
  };
}
