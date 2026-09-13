import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient, splitCaption } from '../src/telegram.js';

test('url uses /bot<token> format (local Bot API rejects /bot/<token>)', () => {
  const client = new TelegramClient({ token: '123:ABC', apiBase: 'http://127.0.0.1:8081/bot' });
  assert.equal(client.url('getMe'), 'http://127.0.0.1:8081/bot123:ABC/getMe');
});

test('url strips trailing slashes from apiBase', () => {
  const client = new TelegramClient({ token: '123:ABC', apiBase: 'https://api.telegram.org/bot/' });
  assert.equal(client.url('sendMessage'), 'https://api.telegram.org/bot123:ABC/sendMessage');
});

test('splitCaption keeps short captions intact', () => {
  const [caption, overflow] = splitCaption('hello');
  assert.equal(caption, 'hello');
  assert.equal(overflow, '');
});

test('splitCaption splits long captions at the limit', () => {
  const long = 'x'.repeat(1500);
  const [caption, overflow] = splitCaption(long);
  assert.equal(caption.length, 1024);
  assert.equal(caption.endsWith('…'), true);
  assert.equal(caption.length - 1 + overflow.length, long.length);
});

test('splitCaption returns undefined for empty caption', () => {
  assert.deepEqual(splitCaption(undefined), [undefined, '']);
});
