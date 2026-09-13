import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractMessage, unwrapMessage } from './extract.js';
import { buildHeader, composeBody, formatDuration, isSelfChat, jidToPhone, parseVcard } from './caption.js';

const DEDUPE_TTL_MS = 10 * 60_000;
const GROUP_CACHE_TTL_MS = 60 * 60_000;

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

function pickExtension(data) {
  const base = String(data.mimetype || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base];
  const subtype = base.split('/')[1];
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : 'bin';
}

function safeFileName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  return cleaned || fallback;
}

export function createForwarder({ config, telegram, logger, baileys, tempRoot }) {
  const seen = new Map();
  const groupCache = new Map();
  let lastChatId = config.telegram.chatId;

  function isDuplicate(key) {
    if (!key?.id) return false;
    if (seen.has(key.id)) return true;
    seen.set(key.id, Date.now());
    if (seen.size > 1000) {
      const cutoff = Date.now() - DEDUPE_TTL_MS;
      for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
    }
    return false;
  }

  async function resolveGroupName(sock, jid) {
    const cached = groupCache.get(jid);
    if (cached && Date.now() - cached.at < GROUP_CACHE_TTL_MS) return cached.subject;
    try {
      const meta = await sock.groupMetadata(jid);
      groupCache.set(jid, { subject: meta.subject, at: Date.now() });
      return meta.subject;
    } catch {
      return '';
    }
  }

  async function downloadToTemp(msg, sock, data) {
    const { content } = unwrapMessage(msg.message);
    const buffer = await baileys.downloadMediaMessage(
      { ...msg, message: content },
      'buffer',
      {},
      { logger: sock.logger, reuploadRequest: sock.updateMediaMessage },
    );
    if (data.viewOnce && !buffer) throw new Error('view-once media unavailable');
    await mkdir(tempRoot, { recursive: true });
    const dir = await mkdtemp(path.join(tempRoot, 'msg-'));
    const ext = pickExtension(data);
    let fileName;
    if (data.kind === 'document') {
      fileName = safeFileName(data.fileName, `document.${ext}`);
    } else if (data.kind === 'voice') {
      fileName = `voice-${msg.key.id}.ogg`;
    } else {
      fileName = `${data.kind}-${msg.key.id}.${ext}`;
    }
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, buffer);
    return { filePath, dir, fileName };
  }

  async function dispatch({ msg, sock, data, header, chatJid, isGroup, senderName }) {
    const caption = (text) => composeBody({ header, text });
    switch (data.kind) {
      case 'text':
        await telegram.sendText(lastChatId, caption(data.text));
        return;

      case 'voice': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendVoice(lastChatId, filePath, {
            caption: header,
            duration: data.seconds,
            filename: fileName,
            mimeType: data.mimetype,
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'audio': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendAudio(lastChatId, filePath, {
            caption: caption(data.caption),
            duration: data.seconds,
            filename: fileName,
            mimeType: data.mimetype,
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'image': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendPhoto(lastChatId, filePath, {
            caption: caption(data.caption),
            filename: fileName,
            mimeType: data.mimetype,
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'video': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendVideo(lastChatId, filePath, {
            caption: caption(data.caption),
            duration: data.seconds,
            width: data.width,
            height: data.height,
            filename: fileName,
            mimeType: data.mimetype,
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'videoNote': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendVideoNote(lastChatId, filePath, {
            duration: data.seconds,
            filename: fileName,
            mimeType: data.mimetype,
          });
          await telegram.sendText(lastChatId, header);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'document': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendDocument(lastChatId, filePath, {
            caption: caption(data.caption),
            filename: fileName,
            mimeType: data.mimetype,
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'sticker': {
        const { filePath, dir, fileName } = await downloadToTemp(msg, sock, data);
        try {
          await telegram.sendSticker(lastChatId, filePath, { filename: fileName, mimeType: data.mimetype });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        return;
      }

      case 'contact': {
        await telegram.sendText(lastChatId, header);
        for (const c of data.contacts) {
          const parsed = parseVcard(c.vcard);
          if (parsed.phoneNumber) {
            await telegram.sendContact(lastChatId, {
              phoneNumber: parsed.phoneNumber,
              firstName: c.displayName || parsed.firstName || 'Contact',
            });
          } else {
            await telegram.sendText(lastChatId, `👤 ${c.displayName || 'جهة اتصال'}\n\n${c.vcard}`);
          }
        }
        return;
      }

      case 'location': {
        await telegram.sendLocation(lastChatId, { latitude: data.latitude, longitude: data.longitude });
        const extra = [data.name, data.address].filter(Boolean).join(' - ');
        await telegram.sendText(lastChatId, extra ? `${header}\n${extra}` : header);
        return;
      }

      case 'liveLocation': {
        await telegram.sendLocation(lastChatId, { latitude: data.latitude, longitude: data.longitude });
        await telegram.sendText(lastChatId, `${header} (موقع مباشر)`);
        return;
      }

      case 'poll': {
        const options = data.poll.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
        await telegram.sendText(lastChatId, `${caption(`📊 ${data.poll.name}`)}\n${options}`);
        return;
      }

      default: {
        await telegram.sendText(lastChatId, `${header}\n⚠️ نوع رسالة غير مدعوم: ${data.type || 'unknown'}`);
        return;
      }
    }
  }

  return async function handleMessage(msg, sock) {
    const key = msg.key || {};
    const chatJid = key.remoteJid || '';
    if (!chatJid) return;
    if (chatJid === 'status@broadcast' || chatJid.endsWith('@broadcast') || chatJid.endsWith('@newsletter')) return;
    if (msg.messageStubType && !msg.message) return;
    if (isDuplicate(key)) return;

    const fromMe = !!key.fromMe;
    const selfChat = isSelfChat(chatJid, sock.user?.id);
    const isGroup = chatJid.endsWith('@g.us');

    if (fromMe) {
      if (selfChat && !config.rules.forwardSelfChat) return;
      if (!selfChat && !config.rules.forwardFromMe) return;
    } else if (!config.rules.forwardIncoming) {
      return;
    }

    const senderJid = isGroup ? key.participant || chatJid : fromMe ? sock.user?.id || chatJid : chatJid;
    const senderPhone = jidToPhone(senderJid);

    if (!fromMe && config.rules.allowedSenders.length) {
      const allowed = config.rules.allowedSenders.includes(senderPhone);
      if (!allowed) {
        logger.debug({ senderPhone, chatJid }, 'sender not in allowlist, skipping');
        return;
      }
    }

    const data = extractMessage(msg.message);
    if (data.kind === 'skip') {
      logger.debug({ reason: data.reason, id: key.id }, 'skipped message');
      return;
    }

    const chatName = isGroup ? await resolveGroupName(sock, chatJid) : '';
    const header = buildHeader({
      senderName: msg.pushName || (fromMe ? 'أنا' : ''),
      senderPhone,
      chatName,
      isGroup,
      selfChat,
      timestamp: Number(msg.messageTimestamp),
      timezone: config.timezone,
      kind: data.kind,
      duration: data.seconds,
      viewedOnce: data.viewOnce,
    });

    logger.info(
      {
        id: key.id,
        kind: data.kind,
        fromMe,
        selfChat,
        isGroup,
        sender: senderPhone,
      },
      'forwarding message',
    );

    try {
      await dispatch({ msg, sock, data, header, chatJid, isGroup, senderName: msg.pushName });
    } catch (err) {
      logger.error({ error: err?.message, kind: data.kind, id: key.id }, 'forward failed');
      try {
        await telegram.sendText(lastChatId, `${header}\n❌ فشل إرسال المحتوى: ${String(err?.message || err).slice(0, 300)}`);
      } catch (notifyErr) {
        logger.error({ error: notifyErr?.message }, 'failed to notify about forward failure');
      }
    }
  };
}
