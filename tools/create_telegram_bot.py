#!/usr/bin/env python3
"""Create a Telegram bot via @BotFather using an existing Telethon session.

Required environment variables:
    TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING

Example:
    python3 tools/create_telegram_bot.py \
        --name "WA Bridge" \
        --username sohail_wa_bridge_bot \
        --description "بوت تحويل رسائل وملفات واتساب إلى تليجرام" \
        --commands "start - تشغيل البوت"

The script prints a JSON line with {name, username, token} on success.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time

from telethon import TelegramClient
from telethon.sessions import StringSession

TOKEN_RE = re.compile(r"\b(\d{6,12}:[A-Za-z0-9_-]{30,40})\b")
BOTFATHER = "BotFather"


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"missing required env var: {name}", file=sys.stderr)
        sys.exit(2)
    return value


async def ask(client: TelegramClient, text: str, timeout: float = 20.0) -> list:
    """Send `text` to BotFather and collect its replies (new messages only)."""
    recent = await client.get_messages(BOTFATHER, limit=5)
    last_id = max((m.id for m in recent), default=0)
    await client.send_message(BOTFATHER, text)
    deadline = time.monotonic() + timeout
    collected: list = []
    last_seen = last_id
    quiet = 0
    while time.monotonic() < deadline:
        await asyncio.sleep(1.0)
        new = await client.get_messages(BOTFATHER, min_id=last_seen, limit=10)
        incoming = [m for m in new if not m.out]
        if incoming:
            collected.extend(incoming)
            last_seen = max(m.id for m in new)
            quiet = 0
        elif collected:
            quiet += 1
            if quiet >= 3:
                break
    return collected


def joined_text(messages: list) -> str:
    return "\n".join(m.message or "" for m in messages)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Create a Telegram bot via BotFather")
    parser.add_argument("--name", required=True, help="Bot display name")
    parser.add_argument("--username", required=True, help="Preferred bot username (must end with 'bot')")
    parser.add_argument("--username-alt", action="append", default=[], help="Fallback usernames")
    parser.add_argument("--description", default="", help="Bot description shown in the empty chat")
    parser.add_argument("--about", default="", help="About text in the bot profile")
    parser.add_argument("--commands", default="", help="Commands list: 'start - description' per line")
    parser.add_argument("--token-file", default="", help="Optional path to write the token (mode 600)")
    args = parser.parse_args()

    api_id = int(env("TELEGRAM_API_ID"))
    api_hash = env("TELEGRAM_API_HASH")
    session_string = env("TELEGRAM_SESSION_STRING")

    usernames = [args.username, *args.username_alt]
    invalid = [u for u in usernames if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,30}bot", u)]
    if invalid:
        print(f"invalid usernames (must end with 'bot'): {invalid}", file=sys.stderr)
        return 2

    client = TelegramClient(StringSession(session_string), api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("session is not authorized", file=sys.stderr)
        return 3

    me = await client.get_me()
    print(f"account: {me.first_name} (@{me.username}, id={me.id})", file=sys.stderr)

    replies = await ask(client, "/newbot", timeout=25)
    if "How are we going to call it" not in joined_text(replies):
        print(f"unexpected BotFather reply:\n{joined_text(replies)}", file=sys.stderr)
        return 4

    replies = await ask(client, args.name, timeout=25)
    text = joined_text(replies)
    if "choose a username" not in text and "username" not in text.lower():
        print(f"unexpected reply after name:\n{text}", file=sys.stderr)
        return 4

    token = ""
    username = ""
    for candidate in usernames:
        replies = await ask(client, candidate, timeout=25)
        text = joined_text(replies)
        match = TOKEN_RE.search(text)
        if match:
            token = match.group(1)
            username = candidate
            break
        if "taken" in text.lower() or "already" in text.lower():
            print(f"username {candidate} is taken, trying next", file=sys.stderr)
            continue
        print(f"unexpected reply for {candidate}:\n{text}", file=sys.stderr)
        return 4

    if not token:
        print("could not create bot: no token found", file=sys.stderr)
        return 5

    selection = f"@{username}"

    for command, payload, label in (
        ("/setdescription", args.description, "description"),
        ("/setabouttext", args.about, "about"),
        ("/setcommands", args.commands, "commands"),
    ):
        if not payload:
            continue
        try:
            replies = await ask(client, command, timeout=15)
            if "Choose a bot" not in joined_text(replies) and "select" not in joined_text(replies).lower():
                print(f"skip {label}: unexpected prompt:\n{joined_text(replies)}", file=sys.stderr)
                continue
            replies = await ask(client, selection, timeout=15)
            if payload not in joined_text(replies) and "send me" not in joined_text(replies).lower():
                print(f"skip {label}: unexpected reply:\n{joined_text(replies)}", file=sys.stderr)
                continue
            replies = await ask(client, payload, timeout=15)
            print(f"{label} set: {joined_text(replies)[:120]}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 - best-effort extra setup
            print(f"skip {label}: {exc}", file=sys.stderr)

    if args.token_file:
        with open(args.token_file, "w", encoding="utf-8") as fh:
            fh.write(token + "\n")
        os.chmod(args.token_file, 0o600)

    print(json.dumps({"name": args.name, "username": username, "token": token}, ensure_ascii=False))
    await client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
