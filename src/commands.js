const STATE_LABELS = {
  connecting: '⏳ بيتصل...',
  open: 'متصل ✅',
  close: 'انقطع الاتصال — بيحاول تاني 🔄',
  loggedOut: 'الجلسة اتلغيت — محتاج ربط جديد ⚠️',
  unpaired: 'مش مربوط بأي رقم واتساب لحد الآن ⚠️',
};

export function buildStatusText({ waState, waPhone, pairing = false }) {
  const state = STATE_LABELS[waState] || STATE_LABELS.connecting;
  const lines = [
    '🌉 جسر واتساب → تليجرام',
    '',
    `• تليجرام: متصل ✅`,
    `• واتساب: ${state}`,
  ];
  if (waPhone) lines.push(`• الرقم المرتبط: +${waPhone}`);
  if (pairing) lines.push('• في انتظار إدخال كود الربط على الموبايل 🔐');
  lines.push('', 'ابعت أي رسالة أو ريكورد أو ملف على واتساب وهتلاقيه هنا فوراً.');
  return lines.join('\n');
}

const HELP_TEXT = [
  '👋 أهلاً يا سهيل!',
  '',
  'ده البوت اللي بيتابع جسر واتساب → تليجرام.',
  '',
  'الأوامر:',
  '/status — حالة الاتصال بالواتساب',
  '',
  'مش محتاج تعمل حاجة هنا: أي رسالة أو ريكورد أو ملف بيوصلك على واتساب، هيتبعت هنا أوتوماتيك.',
].join('\n');

export function createCommandPoller({ telegram, logger, chatId, getStatus, longPollSeconds = 30 }) {
  let offset = 0;
  let stopped = false;
  let conflictNotified = false;

  async function handleUpdate(update) {
    const message = update?.message;
    if (!message?.text) return;
    if (String(message.chat?.id) !== String(chatId)) return;
    const text = message.text.trim().toLowerCase().replace(/@\w+$/, '');
    if (text === '/start' || text === '/help') {
      await telegram.sendText(chatId, HELP_TEXT);
      return;
    }
    if (text === '/status') {
      const status = getStatus?.() || {};
      await telegram.sendText(chatId, buildStatusText(status));
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        const updates = await telegram.call(
          'getUpdates',
          { offset, timeout: longPollSeconds, allowed_updates: JSON.stringify(['message']) },
          { timeoutMs: (longPollSeconds + 15) * 1000, retries: 1 },
        );
        conflictNotified = false;
        for (const update of updates || []) {
          offset = update.update_id + 1;
          await handleUpdate(update).catch((err) => logger.warn({ error: err?.message }, 'command handling failed'));
        }
      } catch (err) {
        if (stopped) return;
        const isConflict = String(err?.description || err?.message || '').includes('terminated by other getUpdates');
        if (!isConflict || !conflictNotified) {
          logger.warn({ error: err?.description || err?.message }, 'getUpdates failed');
          conflictNotified = isConflict;
        }
        await new Promise((r) => setTimeout(r, isConflict ? 10_000 : 3_000));
      }
    }
  }

  loop();

  return {
    stop() {
      stopped = true;
    },
  };
}
