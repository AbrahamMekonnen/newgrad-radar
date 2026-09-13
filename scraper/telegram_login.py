"""One-time Telegram login -> prints a TELEGRAM_SESSION_STRING.

Run this ONCE locally to authenticate. It reads your api_id/api_hash/phone
from scraper/.env, sends a login code to your Telegram app, and (after you
type the code, plus your 2FA password if you have one) prints a session
string. Paste that string back so it can be stored as a secret and used
headlessly (no code prompt) on every future run.

    cd scraper
    ../.venv/Scripts/python.exe telegram_login.py     # Windows
    # or: python telegram_login.py
"""
import os
from pathlib import Path


def _load_env():
    here = Path(__file__).parent
    for p in (here / ".env", here.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    _load_env()
    try:
        from telethon.sync import TelegramClient
        from telethon.sessions import StringSession
    except ImportError:
        raise SystemExit("telethon not installed. Run: pip install telethon")

    api_id = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    phone = os.environ.get("TELEGRAM_PHONE")
    if not api_id or not api_hash:
        raise SystemExit("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in scraper/.env")

    print("Logging in to Telegram — you'll be asked for the code Telegram sends "
          "to your app (and your 2FA password if you have one)...\n")
    client = TelegramClient(StringSession(), int(api_id), api_hash)
    client.start(phone=phone)  # interactive: prompts for code / 2FA password

    session_string = client.session.save()
    client.disconnect()

    print("\n" + "=" * 60)
    print("SUCCESS. Copy the line below (your TELEGRAM_SESSION_STRING):")
    print("=" * 60)
    print(session_string)
    print("=" * 60)
    print("Keep it secret — it grants access to your Telegram account.")


if __name__ == "__main__":
    main()
