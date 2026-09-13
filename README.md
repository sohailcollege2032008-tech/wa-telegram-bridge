# wa-telegram-bridge

جسر يحوّل رسائل واتساب (نصوص، ريكوردات، صور، فيديوهات، مستندات، ستيكرات، جهات اتصال، مواقع) إلى تليجرام فوراً باستخدام بوت تليجرام مستقل.

A WhatsApp → Telegram bridge built on [Baileys](https://github.com/WhiskeySockets/Baileys) (no browser, low memory) that forwards everything the linked WhatsApp account receives to a Telegram bot chat.

## Architecture

```
WhatsApp (new number)  ──linked device──▶  wa-telegram-bridge (Node.js, systemd)
                                                    │  downloads media
                                                    ▼
                              Telegram Bot API (local server :8081, up to 2GB)
                                                    │
                                                    ▼
                                          Telegram bot → your DM
```

## Features

- Text, voice notes (sent as Telegram voice), audio, images, videos, video notes, documents, stickers, contacts, locations and polls.
- Voice notes keep the original `ogg/opus` format so they arrive as playable Telegram voice messages.
- Media up to 2GB through the local Bot API server.
- Pairing-code login (no QR needed) or QR delivered to Telegram as fallback.
- Sender allowlist, from-me forwarding toggles, duplicate protection, auto-reconnect with backoff.
- Friendly Arabic captions with sender name, phone, chat and timestamp.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token (`tools/create_telegram_bot.py` automates this).
2. `cp .env.example .env` and fill `TELEGRAM_BOT_TOKEN` and `WHATSAPP_PHONE` (E.164 digits only).
3. `npm install`
4. `npm start` — the pairing code is sent to `TELEGRAM_CHAT_ID`.
5. On the phone: WhatsApp → Settings → Linked Devices → Link a device → *Link with phone number instead* → enter the code.
6. That's it. Messages received by the linked account are forwarded to Telegram.

### Deploy on the server

```bash
REPO_URL=git@github.com:sohailcollege2032008-tech/wa-telegram-bridge.git bash deploy/install.sh
```

The script installs `deploy/wa-telegram-bridge.service` and enables it.

## Environment

See [.env.example](.env.example) for all options: destination chat, local Bot API base, pairing mode, forwarding rules and allowlist.

## Tests

```bash
npm test                # unit tests for message extraction and captions
npm run e2e:telegram    # sends real test messages to TELEGRAM_CHAT_ID
```

## Notes

- Baileys is an unofficial WhatsApp Web multi-device client. Use it with an account you own.
- `auth_state/` holds the linked-device credentials; keep it private and backed up. If the phone unlinks the device, delete it and pair again.
