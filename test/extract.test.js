import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMessage, unwrapMessage } from '../src/extract.js';

test('plain conversation becomes text', () => {
  const d = extractMessage({ conversation: 'hello' });
  assert.equal(d.kind, 'text');
  assert.equal(d.text, 'hello');
});

test('extended text becomes text', () => {
  const d = extractMessage({ extendedTextMessage: { text: 'yo', contextInfo: {} } });
  assert.equal(d.kind, 'text');
  assert.equal(d.text, 'yo');
});

test('image with caption', () => {
  const d = extractMessage({ imageMessage: { mimetype: 'image/jpeg', caption: 'pic', width: 100, height: 200 } });
  assert.equal(d.kind, 'image');
  assert.equal(d.caption, 'pic');
  assert.equal(d.media, true);
});

test('ptt audio becomes voice', () => {
  const d = extractMessage({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 12 } });
  assert.equal(d.kind, 'voice');
  assert.equal(d.ptt, true);
  assert.equal(d.seconds, 12);
});

test('non-ptt audio stays audio', () => {
  const d = extractMessage({ audioMessage: { mimetype: 'audio/mp4', ptt: false, seconds: 3 } });
  assert.equal(d.kind, 'audio');
});

test('document keeps filename', () => {
  const d = extractMessage({ documentMessage: { mimetype: 'application/pdf', fileName: 'notes.pdf' } });
  assert.equal(d.kind, 'document');
  assert.equal(d.fileName, 'notes.pdf');
});

test('documentWithCaptionMessage wrapper unwraps', () => {
  const d = extractMessage({
    documentWithCaptionMessage: {
      message: { documentMessage: { mimetype: 'application/pdf', fileName: 'x.pdf', caption: 'cap' } },
    },
  });
  assert.equal(d.kind, 'document');
  assert.equal(d.caption, 'cap');
});

test('ephemeral wrapper unwraps to text', () => {
  const d = extractMessage({ ephemeralMessage: { message: { conversation: 'disappearing' } } });
  assert.equal(d.kind, 'text');
  assert.equal(d.text, 'disappearing');
});

test('view once wrapper marks viewOnce', () => {
  const d = extractMessage({
    viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', caption: '' } } },
  });
  assert.equal(d.kind, 'image');
  assert.equal(d.viewOnce, true);
});

test('sticker', () => {
  const d = extractMessage({ stickerMessage: { mimetype: 'image/webp', isAnimated: false } });
  assert.equal(d.kind, 'sticker');
});

test('contact', () => {
  const d = extractMessage({ contactMessage: { displayName: 'Doc', vcard: 'BEGIN:VCARD' } });
  assert.equal(d.kind, 'contact');
  assert.equal(d.contacts.length, 1);
});

test('location', () => {
  const d = extractMessage({ locationMessage: { degreesLatitude: 30.1, degreesLongitude: 31.2 } });
  assert.equal(d.kind, 'location');
});

test('poll', () => {
  const d = extractMessage({ pollCreationMessage: { name: 'Q?', options: [{ optionName: 'A' }, { optionName: 'B' }] } });
  assert.equal(d.kind, 'poll');
  assert.deepEqual(d.poll.options, ['A', 'B']);
});

test('protocol message is skipped', () => {
  const d = extractMessage({ protocolMessage: { type: 0 } });
  assert.equal(d.kind, 'skip');
});

test('reaction is skipped', () => {
  const d = extractMessage({ reactionMessage: { text: '❤️' } });
  assert.equal(d.kind, 'skip');
});

test('edited message is skipped', () => {
  const d = extractMessage({
    editedMessage: { message: { protocolMessage: { editedMessage: { conversation: 'new' } } } },
  });
  assert.equal(d.kind, 'skip');
  assert.equal(d.reason, 'edited');
});

test('empty message is skipped', () => {
  assert.equal(extractMessage(null).kind, 'skip');
  assert.equal(extractMessage({ messageContextInfo: {} }).kind, 'skip');
});

test('unknown type is unsupported', () => {
  const d = extractMessage({ someFutureMessage: { foo: 1 } });
  assert.equal(d.kind, 'unsupported');
  assert.equal(d.type, 'someFutureMessage');
});

test('unwrap handles deviceSentMessage', () => {
  const { content } = unwrapMessage({ deviceSentMessage: { message: { conversation: 'hi' } } });
  assert.deepEqual(content, { conversation: 'hi' });
});
