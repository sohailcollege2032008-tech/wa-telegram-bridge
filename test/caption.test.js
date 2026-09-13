import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeader,
  composeBody,
  formatDuration,
  formatPhone,
  formatTimestamp,
  isSelfChat,
  jidToPhone,
  normalizeJid,
  parseVcard,
} from '../src/caption.js';

test('jidToPhone strips device and domain', () => {
  assert.equal(jidToPhone('201234567890:12@s.whatsapp.net'), '201234567890');
  assert.equal(jidToPhone('201234567890@s.whatsapp.net'), '201234567890');
  assert.equal(jidToPhone(''), '');
});

test('normalizeJid removes device id', () => {
  assert.equal(normalizeJid('201234567890:5@s.whatsapp.net'), '201234567890@s.whatsapp.net');
  assert.equal(normalizeJid('123@g.us'), '123@g.us');
});

test('isSelfChat compares normalized jids', () => {
  assert.equal(isSelfChat('201234567890@s.whatsapp.net', '201234567890:9@s.whatsapp.net'), true);
  assert.equal(isSelfChat('201234567891@s.whatsapp.net', '201234567890:9@s.whatsapp.net'), false);
});

test('formatPhone adds plus', () => {
  assert.equal(formatPhone('201234567890'), '+201234567890');
  assert.equal(formatPhone(''), '');
});

test('formatTimestamp uses timezone', () => {
  const ts = Date.UTC(2026, 0, 15, 12, 0, 0) / 1000;
  assert.equal(formatTimestamp(ts, 'UTC'), '2026-01-15 12:00');
  assert.equal(formatTimestamp(ts, 'Africa/Cairo'), '2026-01-15 14:00');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(undefined), '0:00');
});

test('buildHeader contains sender and phone', () => {
  const header = buildHeader({
    senderName: 'سهيل',
    senderPhone: '201234567890',
    chatName: '',
    isGroup: false,
    selfChat: false,
    timestamp: Date.UTC(2026, 0, 15, 12, 0, 0) / 1000,
    timezone: 'Africa/Cairo',
    kind: 'voice',
    duration: 12,
  });
  assert.match(header, /سهيل/);
  assert.match(header, /\+201234567890/);
  assert.match(header, /ريكورد صوتي/);
  assert.match(header, /0:12/);
  assert.match(header, /2026-01-15 14:00/);
});

test('buildHeader group + view once labels', () => {
  const header = buildHeader({
    senderName: 'Ali',
    senderPhone: '20111',
    chatName: 'شلة الطب',
    isGroup: true,
    selfChat: false,
    timestamp: Date.UTC(2026, 0, 15, 12, 0, 0) / 1000,
    timezone: 'UTC',
    kind: 'image',
    viewedOnce: true,
  });
  assert.match(header, /شلة الطب/);
  assert.match(header, /عرض لمرة واحدة/);
});

test('composeBody joins header and text', () => {
  assert.equal(composeBody({ header: 'H', text: 'B' }), 'H\n━━━━━━━━━━━━━━\nB');
  assert.equal(composeBody({ header: 'H', text: '  ' }), 'H');
});

test('parseVcard extracts name and phone', () => {
  const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ahmed Ali', 'TEL;type=CELL:+201234567890', 'END:VCARD'].join('\r\n');
  const parsed = parseVcard(vcard);
  assert.equal(parsed.firstName, 'Ahmed Ali');
  assert.equal(parsed.phoneNumber, '+201234567890');
});
