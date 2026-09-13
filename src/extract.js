const WRAPPER_KEYS = [
  'deviceSentMessage',
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'botInvokeMessage',
  'editedMessage',
];

const SKIP_TYPES = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'pollResultSnapshotMessage',
  'keepInChatMessage',
  'stickerPackMessage',
  'sharePhoneNumberMessage',
  'requestPhoneNumberMessage',
  'paymentInviteMessage',
  'callLogMessage',
  'eventMessage',
  'encEventResponseMessage',
  'newsletterAdminInviteMessage',
]);

export function unwrapMessage(message) {
  let content = message;
  let viewOnce = false;
  for (let depth = 0; depth < 8 && content; depth += 1) {
    if (content.protocolMessage?.editedMessage) {
      return { content, viewOnce, edited: true };
    }
    const wrapper = WRAPPER_KEYS.find((key) => content[key]?.message);
    if (!wrapper) break;
    if (wrapper.startsWith('viewOnce')) viewOnce = true;
    content = content[wrapper].message;
  }
  return { content, viewOnce, edited: false };
}

function firstMeaningfulKey(content) {
  if (!content) return undefined;
  return Object.keys(content).find((key) => key !== 'messageContextInfo');
}

function asArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

/**
 * Normalizes a Baileys `message.message` payload into a descriptor the
 * forwarder can dispatch on.
 */
export function extractMessage(rawMessage) {
  const { content, viewOnce, edited } = unwrapMessage(rawMessage);
  if (!content) return { kind: 'skip', reason: 'empty' };
  if (edited) return { kind: 'skip', reason: 'edited' };

  if (content.conversation) {
    return { kind: 'text', text: content.conversation, viewOnce };
  }

  if (content.extendedTextMessage) {
    return { kind: 'text', text: content.extendedTextMessage.text || '', viewOnce };
  }

  const image = content.imageMessage;
  if (image) {
    return {
      kind: 'image',
      caption: image.caption || '',
      mimetype: image.mimetype || 'image/jpeg',
      seconds: image.seconds,
      width: image.width,
      height: image.height,
      viewOnce,
      media: true,
    };
  }

  if (content.ptvMessage) {
    const ptv = content.ptvMessage;
    return {
      kind: 'videoNote',
      caption: ptv.caption || '',
      mimetype: ptv.mimetype || 'video/mp4',
      seconds: ptv.seconds,
      viewOnce,
      media: true,
    };
  }

  const video = content.videoMessage;
  if (video) {
    return {
      kind: 'video',
      caption: video.caption || '',
      mimetype: video.mimetype || 'video/mp4',
      seconds: video.seconds,
      width: video.width,
      height: video.height,
      viewOnce,
      media: true,
    };
  }

  const audio = content.audioMessage;
  if (audio) {
    return {
      kind: audio.ptt ? 'voice' : 'audio',
      caption: '',
      mimetype: audio.mimetype || 'audio/ogg; codecs=opus',
      seconds: audio.seconds,
      ptt: !!audio.ptt,
      viewOnce,
      media: true,
    };
  }

  const document = content.documentMessage;
  if (document) {
    return {
      kind: 'document',
      caption: document.caption || '',
      mimetype: document.mimetype || 'application/octet-stream',
      fileName: document.fileName || document.title || 'document',
      fileLength: document.fileLength,
      viewOnce,
      media: true,
    };
  }

  const sticker = content.stickerMessage;
  if (sticker) {
    return {
      kind: 'sticker',
      caption: '',
      mimetype: sticker.mimetype || 'image/webp',
      isAnimated: !!sticker.isAnimated,
      viewOnce,
      media: true,
    };
  }

  const contact = content.contactMessage;
  if (contact) {
    return {
      kind: 'contact',
      contacts: [{ displayName: contact.displayName || 'Contact', vcard: contact.vcard || '' }],
      viewOnce,
    };
  }

  const contacts = content.contactsArrayMessage;
  if (contacts) {
    return {
      kind: 'contact',
      contacts: asArray(contacts.contacts).map((c) => ({
        displayName: c.displayName || 'Contact',
        vcard: c.vcard || '',
      })),
      viewOnce,
    };
  }

  const location = content.locationMessage;
  if (location) {
    return {
      kind: 'location',
      latitude: location.degreesLatitude,
      longitude: location.degreesLongitude,
      name: location.name || '',
      address: location.address || '',
      viewOnce,
    };
  }

  const live = content.liveLocationMessage;
  if (live) {
    return {
      kind: 'liveLocation',
      latitude: live.degreesLatitude,
      longitude: live.degreesLongitude,
      name: live.caption || '',
      viewOnce,
    };
  }

  const poll = content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3;
  if (poll) {
    return {
      kind: 'poll',
      poll: {
        name: poll.name || 'Poll',
        options: asArray(poll.options).map((o) => o.optionName).filter(Boolean),
        selectableCount: poll.selectableOptionsCount,
      },
      viewOnce,
    };
  }

  const type = firstMeaningfulKey(content);
  if (!type) return { kind: 'skip', reason: 'empty' };
  if (SKIP_TYPES.has(type)) return { kind: 'skip', reason: type };
  return { kind: 'unsupported', type, viewOnce };
}
