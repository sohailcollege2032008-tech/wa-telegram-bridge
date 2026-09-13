import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusText } from '../src/commands.js';

test('status text shows connected whatsapp with phone', () => {
  const text = buildStatusText({ waState: 'open', waPhone: '201234567890' });
  assert.match(text, /متصل ✅/);
  assert.match(text, /\+201234567890/);
});

test('status text shows unpaired state', () => {
  const text = buildStatusText({ waState: 'unpaired' });
  assert.match(text, /مش مربوط/);
});

test('status text shows pairing hint', () => {
  const text = buildStatusText({ waState: 'connecting', pairing: true });
  assert.match(text, /كود الربط/);
});

test('status text shows logged out state', () => {
  const text = buildStatusText({ waState: 'loggedOut' });
  assert.match(text, /محتاج ربط جديد/);
});
