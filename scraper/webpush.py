"""Web Push sender (companion to notify.send_ntfy).

Sends browser/PWA push to a user's stored push_subscriptions using VAPID.
Everything here is best-effort: if pywebpush isn't installed, the VAPID keys
aren't set, or the table doesn't exist yet, it silently no-ops so notifications
(and the scrape) never break.
"""
from __future__ import annotations

import json
import os
from typing import Optional

_VAPID_PRIVATE = os.environ.get("VAPID_PRIVATE_KEY", "")
_VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:hello@hireradar.app")

try:
    from pywebpush import webpush, WebPushException  # type: ignore
    _HAS_PYWEBPUSH = True
except Exception:  # pragma: no cover
    _HAS_PYWEBPUSH = False


def webpush_available() -> bool:
    return _HAS_PYWEBPUSH and bool(_VAPID_PRIVATE)


def _send_one(sub: dict, payload: str) -> tuple[bool, Optional[int]]:
    """Send to a single subscription. Returns (ok, http_status)."""
    subscription_info = {
        "endpoint": sub["endpoint"],
        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=_VAPID_PRIVATE,
            vapid_claims={"sub": _VAPID_SUBJECT},
            timeout=15,
        )
        return True, None
    except WebPushException as e:  # type: ignore
        status = getattr(getattr(e, "response", None), "status_code", None)
        return False, status
    except Exception:
        return False, None


def push_to_user(client, user_id: str, title: str, body: str,
                 url: Optional[str] = None, tag: Optional[str] = None) -> int:
    """Send a Web Push to every device the user has subscribed. Returns count
    sent. Expired subscriptions (404/410) are deleted. Never raises."""
    if not webpush_available() or not user_id:
        return 0
    try:
        rows = (client.table("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("user_id", user_id).execute().data) or []
    except Exception:
        return 0  # table missing or query failed — no-op

    if not rows:
        return 0

    payload = json.dumps({k: v for k, v in
                          {"title": title, "body": body, "url": url, "tag": tag}.items()
                          if v is not None})
    sent = 0
    for sub in rows:
        ok, status = _send_one(sub, payload)
        if ok:
            sent += 1
        elif status in (404, 410):
            # Subscription is gone — clean it up.
            try:
                client.table("push_subscriptions").delete().eq("endpoint", sub["endpoint"]).execute()
            except Exception:
                pass
    return sent
