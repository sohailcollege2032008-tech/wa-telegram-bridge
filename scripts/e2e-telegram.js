import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { TelegramClient } from '../src/telegram.js';

const exec = promisify(execFile);
const have = async (cmd) => {
  try {
    await exec('which', [cmd]);
    return true;
  } catch {
    return false;
  }
};

async function main() {
  const config = loadConfig();
  const logger = createLogger(process.env.LOG_LEVEL || 'info');
  const tg = new TelegramClient({ ...config.telegram, logger });
  const me = await tg.getMe();
  console.log(`bot: @${me.username} (id=${me.id}) -> chat ${config.telegram.chatId}`);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'wa-tg-e2e-'));
  const tag = new Date().toISOString();
  const result = {};

  try {
    result.text = await tg.sendText(config.telegram.chatId, `🧪 test 1/4 — نص عادي\n${tag}`);

    if (await have('ffmpeg')) {
      const voice = path.join(dir, 'voice.ogg');
      await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus', '-b:a', '32k', voice]);
      result.voice = await tg.sendVoice(config.telegram.chatId, voice, {
        caption: '🧪 test 2/4 — ريكورد صوتي (ogg/opus)',
        duration: 2,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg; codecs=opus',
      });

      const image = path.join(dir, 'test.png');
      await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:d=1', '-frames:v', '1', image]);
      result.photo = await tg.sendPhoto(config.telegram.chatId, image, {
        caption: '🧪 test 3/4 — صورة',
        filename: 'test.png',
        mimeType: 'image/png',
      });
    } else {
      console.warn('ffmpeg not found; skipping voice/photo tests');
    }

    const doc = path.join(dir, 'test-document.txt');
    await writeFile(doc, `wa-telegram-bridge e2e test\n${tag}\n`, 'utf8');
    result.document = await tg.sendDocument(config.telegram.chatId, doc, {
      caption: '🧪 test 4/4 — مستند',
      filename: 'test-document.txt',
      mimeType: 'text/plain',
    });

    const ids = Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x?.message_id) : v?.message_id]),
    );
    console.log(JSON.stringify({ ok: true, message_ids: ids }, null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('e2e failed:', err?.message || err);
  process.exit(1);
});
