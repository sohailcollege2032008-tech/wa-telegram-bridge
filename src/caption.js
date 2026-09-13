export function jidToPhone(jid) {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/[^0-9]/g, '');
}

export function normalizeJid(jid) {
  const raw = String(jid || '');
  const [user, domain] = raw.split('@');
  if (!domain) return raw;
  return `${user.split(':')[0]}@${domain}`;
}

export function isSelfChat(jid, ownId) {
  if (!jid || !ownId) return false;
  return normalizeJid(jid) === normalizeJid(ownId);
}

export function formatPhone(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

export function formatTimestamp(unixSeconds, timezone = 'Africa/Cairo') {
  const date = new Date(Number(unixSeconds || Math.floor(Date.now() / 1000)) * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

export function buildHeader({ senderName, senderPhone, chatName, isGroup, selfChat, timestamp, timezone, kind, duration, viewedOnce }) {
  const lines = [];
  const senderLabel = senderName ? `«${senderName}»` : senderPhone ? formatPhone(senderPhone) : 'مجهول';
  lines.push(selfChat ? '📝 رسالة لنفسك (واتساب)' : `📨 واتساب من ${senderLabel}`);
  if (isGroup) lines.push(`👥 الجروب: ${chatName || 'جروب'}`);
  if (senderPhone) lines.push(`📱 ${formatPhone(senderPhone)}`);
  const typeLabels = {
    voice: '🎤 ريكورد صوتي',
    audio: '🎵 ملف صوتي',
    videoNote: '📹 فيديو نوت',
    image: '🖼 صورة',
    video: '🎬 فيديو',
    document: '📄 مستند',
    sticker: '🏷 ستيكر',
    location: '📍 موقع',
    liveLocation: '📍 موقع مباشر',
    contact: '👤 جهة اتصال',
    poll: '📊 تصويت',
  };
  const parts = [];
  if (viewedOnce) parts.push('🔥 عرض لمرة واحدة');
  if (typeLabels[kind]) parts.push(typeLabels[kind]);
  if (duration) parts.push(`⏱ ${formatDuration(duration)}`);
  if (parts.length) lines.push(parts.join(' · '));
  lines.push(`🕐 ${formatTimestamp(timestamp, timezone)}`);
  return lines.join('\n');
}

export function composeBody({ header, text }) {
  const body = String(text || '').trim();
  return body ? `${header}\n━━━━━━━━━━━━━━\n${body}` : header;
}

export function parseVcard(vcard) {
  const lines = String(vcard || '').split(/\r?\n/);
  const first = {};
  for (const line of lines) {
    const [keyPart, ...rest] = line.split(':');
    if (!keyPart || !rest.length) continue;
    const value = rest.join(':');
    if (keyPart.startsWith('FN') && !first.firstName) first.firstName = value;
    if (keyPart.startsWith('TEL') && !first.phoneNumber) {
      const number = value.replace(/[^0-9+]/g, '');
      if (number) first.phoneNumber = number;
    }
  }
  return first;
}
