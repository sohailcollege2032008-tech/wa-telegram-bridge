import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { TelegramClient } from './telegram.js';
import { createForwarder } from './forward.js';
import { createWhatsAppConnection, loadBaileys } from './whatsapp.js';
import { jidToPhone } from './caption.js';

const PAIRING_HINT =
  'افتح واتساب على الرقم الجديد → الإعدادات → الأجهزة المرتبطة → ربط جهاز → "الربط برقم الهاتف بدلاً من ذلك" ثم اكتب الكود.\nالكود صالح لدقائق قليلة، ولو انتهى هيتبعت كود جديد تلقائياً.';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info({ authDir: config.whatsapp.authDir, pairingMode: config.whatsapp.pairingMode }, 'starting wa-telegram-bridge');

  const telegram = new TelegramClient({ ...config.telegram, logger });
  const me = await telegram.getMe();
  logger.info({ username: me.username, id: me.id }, 'telegram bot authenticated');

  const baileys = await loadBaileys();
  const tempRoot = path.join(os.tmpdir(), 'wa-telegram-bridge');
  const handleMessage = createForwarder({ config, telegram, logger, baileys, tempRoot });

  let lastOpenNoticeAt = 0;
  let lastQrSentAt = 0;

  const connection = await createWhatsAppConnection({
    config: config.whatsapp,
    logger,
    baileys,
    onMessage: handleMessage,
    onPairingCode: async (code) => {
      logger.info({ code }, 'whatsapp pairing code generated');
      await telegram.sendText(
        config.telegram.chatId,
        `🔐 كود ربط واتساب الجديد:\n\n${code}\n\n${PAIRING_HINT}`,
      );
    },
    onQr: async (qr) => {
      if (Date.now() - lastQrSentAt < 60_000) return;
      lastQrSentAt = Date.now();
      const QRCode = (await import('qrcode')).default;
      const dir = await mkdtemp(path.join(os.tmpdir(), 'wa-qr-'));
      const file = path.join(dir, 'whatsapp-qr.png');
      try {
        await writeFile(file, await QRCode.toBuffer(qr, { type: 'png', width: 720, margin: 2 }));
        await telegram.sendPhoto(config.telegram.chatId, file, {
          caption: `📷 امسح كود QR من واتساب: الإعدادات → الأجهزة المرتبطة → ربط جهاز.\n${PAIRING_HINT}`,
          filename: 'whatsapp-qr.png',
          mimeType: 'image/png',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    onStateChange: async (state, info) => {
      if (state === 'open' && Date.now() - lastOpenNoticeAt > 5 * 60_000) {
        lastOpenNoticeAt = Date.now();
        const phone = jidToPhone(info.user?.id || '');
        await telegram.sendText(
          config.telegram.chatId,
          `✅ واتساب اتوصل بنجاح — الجسر شغال دلوقتي.\n📱 الرقم: ${phone ? `+${phone}` : 'غير معروف'}`,
        );
      } else if (state === 'loggedOut') {
        await telegram.sendText(
          config.telegram.chatId,
          '⚠️ جلسة واتساب اتلغيت (logged out). محتاج إعادة ربط بكود جديد — كلمني عشان أعمل لك كود.',
        );
      }
    },
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    connection.stop();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
