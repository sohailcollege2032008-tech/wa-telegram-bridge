import { mkdir } from 'node:fs/promises';

const PAIRING_RETRY_MS = 4 * 60_000;
const MAX_PAIRING_ATTEMPTS = 6;

export async function createWhatsAppConnection({
  config,
  logger,
  baileys,
  onMessage,
  onPairingCode,
  onQr,
  onStateChange,
}) {
  const { state, saveCreds } = await baileys.useMultiFileAuthState(config.authDir);
  let pairingRequestedAt = 0;
  let pairingAttempts = 0;
  let reconnectDelay = 3_000;
  let stopped = false;
  let sock;

  await mkdir(config.authDir, { recursive: true });

  async function requestPairing() {
    if (config.pairingMode !== 'code' || !config.phone) return;
    if (pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
      logger.warn('pairing attempts exhausted; restart the service to request a new code');
      return;
    }
    const now = Date.now();
    if (pairingRequestedAt && now - pairingRequestedAt < PAIRING_RETRY_MS) return;
    pairingRequestedAt = now;
    pairingAttempts += 1;
    try {
      const code = await sock.requestPairingCode(config.phone);
      logger.info({ attempt: pairingAttempts }, 'pairing code requested');
      await onPairingCode?.(code);
    } catch (err) {
      logger.warn({ error: err?.message }, 'pairing code request failed; will retry on next qr event');
      pairingRequestedAt = 0;
    }
  }

  async function connect() {
    if (stopped) return;
    const { version } = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = baileys.makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: 'baileys' }, { level: 'warn' }),
      browser: baileys.Browsers.ubuntu('WA Telegram Bridge'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !state.creds.registered) {
        logger.debug('whatsapp qr event received');
        if (config.pairingMode === 'code') await requestPairing();
        else await onQr?.(qr);
      }

      if (connection === 'open') {
        reconnectDelay = 3_000;
        pairingAttempts = 0;
        logger.info({ user: sock.user?.id }, 'whatsapp connected');
        await onStateChange?.('open', { user: sock.user });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        const replaced = statusCode === baileys.DisconnectReason.connectionReplaced;
        logger.warn({ statusCode, loggedOut, replaced }, 'whatsapp connection closed');
        await onStateChange?.('close', { statusCode, loggedOut, replaced });
        if (stopped) return;
        if (loggedOut) {
          stopped = true;
          await onStateChange?.('loggedOut', {});
          return;
        }
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
        setTimeout(connect, delay);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) {
        try {
          await onMessage?.(message, sock);
        } catch (err) {
          logger.error({ error: err?.message, id: message?.key?.id }, 'message handling failed');
        }
      }
    });

    return sock;
  }

  await connect();

  return {
    get socket() {
      return sock;
    },
    stop() {
      stopped = true;
      try {
        sock?.end(undefined);
      } catch {
        // ignore
      }
    },
  };
}

export async function loadBaileys() {
  const mod = await import('baileys');
  const baileys = mod.default && mod.useMultiFileAuthState ? mod : mod.default;
  return {
    makeWASocket: baileys.makeWASocket || baileys.default,
    useMultiFileAuthState: baileys.useMultiFileAuthState,
    fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
    downloadMediaMessage: baileys.downloadMediaMessage,
    DisconnectReason: baileys.DisconnectReason,
    Browsers: baileys.Browsers,
  };
}
