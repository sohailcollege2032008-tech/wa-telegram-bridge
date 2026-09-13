import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const JSON_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TelegramError extends Error {
  constructor(method, data, status) {
    const description = data?.description || JSON.stringify(data);
    super(`Telegram ${method} -> ${status}: ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.status = status;
    this.description = description;
    this.errorCode = data?.error_code;
  }
}

function safeFilename(name, fallback) {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f/\\]/g, '_').trim();
  return base || fallback;
}

function chunkText(text, limit) {
  const chunks = [];
  let rest = String(text ?? '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

export function splitCaption(caption) {
  const text = String(caption ?? '');
  if (text.length <= CAPTION_LIMIT) return [text || undefined, ''];
  return [text.slice(0, CAPTION_LIMIT - 1) + '…', text.slice(CAPTION_LIMIT - 1)];
}

export class TelegramClient {
  constructor({ token, apiBase = 'https://api.telegram.org/bot', logger }) {
    this.token = token;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.log = logger;
  }

  url(method) {
    return `${this.apiBase}${this.token}/${method}`;
  }

  async getMe() {
    return this.call('getMe', {});
  }

  async call(method, payload, { timeoutMs = JSON_TIMEOUT_MS, retries = 3 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetch(this.url(method), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) return data.result;
        const retryAfter = data?.parameters?.retry_after;
        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt <= retries) {
          const waitMs = retryAfter ? retryAfter * 1000 + 500 : 1000 * 2 ** (attempt - 1);
          this.log?.warn({ method, attempt, waitMs, description: data?.description }, 'telegram retry');
          await sleep(waitMs);
          continue;
        }
        throw new TelegramError(method, data, res.status);
      } catch (err) {
        if (err instanceof TelegramError) throw err;
        if (attempt <= retries) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(`Telegram ${method} failed after ${attempt} attempts: ${err?.message || err}`);
      }
    }
  }

  async callMultipart(method, fields, fileField, filePath, { filename, contentType, timeoutMs = UPLOAD_TIMEOUT_MS, retries = 2 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
        }
        let blob;
        try {
          blob = await openAsBlob(filePath, contentType ? { type: contentType } : undefined);
        } catch {
          blob = new Blob([await readFile(filePath)], contentType ? { type: contentType } : undefined);
        }
        form.append(fileField, blob, safeFilename(filename, path.basename(filePath)));

        const res = await fetch(this.url(method), {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) return data.result;
        const retryAfter = data?.parameters?.retry_after;
        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt <= retries) {
          const waitMs = retryAfter ? retryAfter * 1000 + 500 : 1000 * 2 ** (attempt - 1);
          this.log?.warn({ method, attempt, waitMs, description: data?.description }, 'telegram upload retry');
          await sleep(waitMs);
          continue;
        }
        throw new TelegramError(method, data, res.status);
      } catch (err) {
        if (err instanceof TelegramError) throw err;
        if (attempt <= retries) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`Telegram ${method} upload failed after ${attempt} attempts: ${err?.message || err}`);
      }
    }
  }

  async sendText(chatId, text, { replyToMessageId } = {}) {
    const results = [];
    for (const chunk of chunkText(text, TEXT_LIMIT)) {
      if (!chunk.length) continue;
      results.push(
        await this.call('sendMessage', {
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: true,
          ...(replyToMessageId ? { reply_parameters: JSON.stringify({ message_id: replyToMessageId }) } : {}),
        }),
      );
    }
    return results;
  }

  async #sendWithFallbacks(chain) {
    let lastError;
    for (const step of chain) {
      try {
        const [caption, overflow] = splitCaption(step.caption);
        const result = await step.send({ ...step.fields, ...(caption ? { caption } : {}) });
        if (overflow) await this.sendText(step.chatId, overflow);
        return result;
      } catch (err) {
        lastError = err;
        this.log?.warn({ method: step.name, error: err?.message }, 'telegram media fallback');
      }
    }
    throw lastError;
  }

  async sendVoice(chatId, filePath, { caption, duration, filename, mimeType } = {}) {
    try {
      const result = await this.callMultipart('sendVoice', { chat_id: chatId, duration }, 'voice', filePath, {
        filename,
        contentType: mimeType,
      });
      if (caption) await this.sendText(chatId, caption, { replyToMessageId: result?.message_id });
      return result;
    } catch (err) {
      this.log?.warn({ error: err?.message }, 'sendVoice failed, falling back to sendAudio');
    }
    try {
      return await this.sendAudio(chatId, filePath, { caption, duration, filename, mimeType });
    } catch (err) {
      this.log?.warn({ error: err?.message }, 'sendAudio failed, falling back to sendDocument');
      return this.sendDocument(chatId, filePath, { caption, filename, mimeType });
    }
  }

  async sendAudio(chatId, filePath, { caption, duration, filename, mimeType, performer, title } = {}) {
    return this.callMultipart('sendAudio', { chat_id: chatId, duration, performer, title, caption: splitCaption(caption)[0] }, 'audio', filePath, {
      filename,
      contentType: mimeType,
    });
  }

  async sendPhoto(chatId, filePath, { caption, filename, mimeType } = {}) {
    return this.#sendWithFallbacks([
      {
        name: 'sendPhoto',
        chatId,
        fields: { chat_id: chatId },
        caption,
        send: (f) => this.callMultipart('sendPhoto', f, 'photo', filePath, { filename, contentType: mimeType }),
      },
      {
        name: 'sendDocument',
        chatId,
        fields: { chat_id: chatId },
        caption,
        send: (f) => this.callMultipart('sendDocument', f, 'document', filePath, { filename, contentType: mimeType }),
      },
    ]);
  }

  async sendVideo(chatId, filePath, { caption, duration, width, height, filename, mimeType } = {}) {
    return this.#sendWithFallbacks([
      {
        name: 'sendVideo',
        chatId,
        fields: { chat_id: chatId, duration, width, height },
        caption,
        send: (f) => this.callMultipart('sendVideo', f, 'video', filePath, { filename, contentType: mimeType }),
      },
      {
        name: 'sendDocument',
        chatId,
        fields: { chat_id: chatId },
        caption,
        send: (f) => this.callMultipart('sendDocument', f, 'document', filePath, { filename, contentType: mimeType }),
      },
    ]);
  }

  async sendVideoNote(chatId, filePath, { duration, length, filename, mimeType } = {}) {
    return this.#sendWithFallbacks([
      {
        name: 'sendVideoNote',
        chatId,
        fields: { chat_id: chatId, duration, length },
        caption: undefined,
        send: (f) => this.callMultipart('sendVideoNote', f, 'video_note', filePath, { filename, contentType: mimeType }),
      },
      {
        name: 'sendVideo',
        chatId,
        fields: { chat_id: chatId, duration },
        caption: undefined,
        send: (f) => this.callMultipart('sendVideo', f, 'video', filePath, { filename, contentType: mimeType }),
      },
      {
        name: 'sendDocument',
        chatId,
        fields: { chat_id: chatId },
        caption: undefined,
        send: (f) => this.callMultipart('sendDocument', f, 'document', filePath, { filename, contentType: mimeType }),
      },
    ]);
  }

  async sendSticker(chatId, filePath, { filename, mimeType } = {}) {
    return this.#sendWithFallbacks([
      {
        name: 'sendSticker',
        chatId,
        fields: { chat_id: chatId },
        caption: undefined,
        send: (f) => this.callMultipart('sendSticker', f, 'sticker', filePath, { filename, contentType: mimeType }),
      },
      {
        name: 'sendDocument',
        chatId,
        fields: { chat_id: chatId },
        caption: undefined,
        send: (f) => this.callMultipart('sendDocument', f, 'document', filePath, { filename, contentType: mimeType }),
      },
    ]);
  }

  async sendDocument(chatId, filePath, { caption, filename, mimeType } = {}) {
    return this.callMultipart('sendDocument', { chat_id: chatId, caption: splitCaption(caption)[0] }, 'document', filePath, {
      filename,
      contentType: mimeType,
    });
  }

  async sendLocation(chatId, { latitude, longitude }) {
    return this.call('sendLocation', { chat_id: chatId, latitude, longitude });
  }

  async sendContact(chatId, { phoneNumber, firstName, lastName }) {
    return this.call('sendContact', {
      chat_id: chatId,
      phone_number: phoneNumber,
      first_name: firstName || 'Contact',
      last_name: lastName,
    });
  }
}
