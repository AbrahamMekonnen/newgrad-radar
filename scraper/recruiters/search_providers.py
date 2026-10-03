"""Provider-agnostic web search with automatic fallback.

Tries configured search providers in order and returns the first non-empty,
normalized result set. Lets the recruiter X-Ray use whichever provider has a
key / remaining quota, and degrade gracefully:

    Google CSE (100/day free)  ->  Serper (2.5k one-time)  ->  Brave
    (2k/mo free)  ->  DuckDuckGo (no key, low-volume fallback)

Each provider returns a list of {title, link, snippet} dicts, or [] on
missing-key / error, so the chain simply falls through. Configure via env:
GOOGLE_CSE_KEY + GOOGLE_CSE_ID, SERPER_API_KEY, BRAVE_API_KEY.
"""
from __future__ import annotations

import os
import re
import html
import logging
from typing import List, Dict, Callable

logger = logging.getLogger(__name__)

# Tracks whether a KEYED provider failed with an auth/credit/rate error during
# the current work (as opposed to simply returning no results). Lets callers tell
# "the provider is exhausted, retry later" apart from "genuinely no recruiters
# exist", so a credit outage neither looks like a clean empty run nor burns the
# user request queue to 'failed'. Coarse by design; _process_requests resets it
# per request (it runs sequentially).
_degraded = {"hit": False}


def reset_degraded() -> None:
    _degraded["hit"] = False


def degraded() -> bool:
    """True if a keyed search provider was unavailable (auth/credit/rate) since
    the last reset. A True here with zero results means 'retry later', not 'none found'."""
    return _degraded["hit"]


def _note_provider_down(name: str, status: int, body: str) -> None:
    _degraded["hit"] = True
    logger.warning(f"{name} unavailable ({status}): {body[:120]} — add another "
                   f"search key (BRAVE_API_KEY) or top up; recruiter sourcing is degraded")


def _google(query: str, num: int) -> List[Dict]:
    key, cx = os.environ.get("GOOGLE_CSE_KEY"), os.environ.get("GOOGLE_CSE_ID")
    if not key or not cx:
        return []
    try:
        import requests
        r = requests.get("https://www.googleapis.com/customsearch/v1",
                         params={"key": key, "cx": cx, "q": query, "num": min(num, 10)},
                         timeout=20)
        if r.status_code != 200:
            logger.debug(f"google cse {r.status_code}: {r.text[:120]}")
            return []
        return [{"title": it.get("title", ""), "link": it.get("link", ""),
                 "snippet": it.get("snippet", "")} for it in r.json().get("items", []) or []]
    except Exception as e:
        logger.debug(f"google cse failed: {e}")
        return []


def _serper_keys() -> List[str]:
    """All configured Serper keys, primary first. Lets a run fail over to a
    fresh key when the primary's one-time free credits run out mid-fill, instead
    of stalling. Add SERPER_API_KEY_2 (and _3...) for extra credit pools."""
    keys: List[str] = []
    for name in ("SERPER_API_KEY", "SERPER_API_KEY_2", "SERPER_API_KEY_3",
                 "SERPER_API_KEY_FALLBACK"):
        v = os.environ.get(name)
        if v and v not in keys:
            keys.append(v)
    return keys


def _serper(query: str, num: int) -> List[Dict]:
    keys = _serper_keys()
    if not keys:
        return []
    try:
        import requests
    except Exception as e:
        logger.debug(f"serper import failed: {e}")
        return []
    exhausted = 0
    for i, key in enumerate(keys):
        try:
            r = requests.post("https://google.serper.dev/search",
                              headers={"X-API-KEY": key, "Content-Type": "application/json"},
                              json={"q": query, "num": min(num, 10)}, timeout=20)
            if r.status_code == 200:
                return [{"title": it.get("title", ""), "link": it.get("link", ""),
                         "snippet": it.get("snippet", "")} for it in r.json().get("organic", []) or []]
            # "Not enough credits" comes back as 400; auth/rate as 401/402/403/429.
            # On a credit/auth error, fail over to the NEXT key before giving up.
            if r.status_code in (401, 402, 403, 429) or "credit" in r.text.lower():
                exhausted += 1
                if i + 1 < len(keys):
                    logger.info(f"serper key #{i + 1} unavailable ({r.status_code}) — failing over to the next key")
                continue
            logger.debug(f"serper {r.status_code}: {r.text[:120]}")
            return []  # a non-credit error: don't thrash the other keys
        except Exception as e:
            logger.debug(f"serper key #{i + 1} failed: {e}")
            continue
    # Every configured Serper key is out of credits / unavailable.
    if exhausted:
        _note_provider_down("serper", 0, f"all {len(keys)} serper key(s) exhausted/unavailable")
    return []


def _brave(query: str, num: int) -> List[Dict]:
    key = os.environ.get("BRAVE_API_KEY")
    if not key:
        return []
    try:
        import requests
        r = requests.get("https://api.search.brave.com/res/v1/web/search",
                         headers={"X-Subscription-Token": key, "Accept": "application/json"},
                         params={"q": query, "count": min(num, 20)}, timeout=20)
        if r.status_code != 200:
            if r.status_code in (401, 402, 403, 429):
                _note_provider_down("brave", r.status_code, r.text)
            else:
                logger.debug(f"brave {r.status_code}: {r.text[:120]}")
            return []
        results = (r.json().get("web", {}) or {}).get("results", []) or []
        return [{"title": it.get("title", ""), "link": it.get("url", ""),
                 "snippet": it.get("description", "")} for it in results]
    except Exception as e:
        logger.debug(f"brave failed: {e}")
        return []


_DDG_RESULT_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
    r'(?:class="result__snippet"[^>]*>(.*?)</a>)?',
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


def _ddg(query: str, num: int) -> List[Dict]:
    """No-key fallback via DuckDuckGo's HTML endpoint. Low-volume only."""
    try:
        import requests
        r = requests.post("https://html.duckduckgo.com/html/",
                          data={"q": query},
                          headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                          timeout=20)
        if r.status_code != 200:
            return []
        out = []
        for m in _DDG_RESULT_RE.finditer(r.text):
            link = html.unescape(m.group(1) or "")
            # DDG wraps external links in a redirect: /l/?uddg=<encoded>
            um = re.search(r"uddg=([^&]+)", link)
            if um:
                from urllib.parse import unquote
                link = unquote(um.group(1))
            title = _TAG_RE.sub("", html.unescape(m.group(2) or "")).strip()
            snippet = _TAG_RE.sub("", html.unescape(m.group(3) or "")).strip()
            if link:
                out.append({"title": title, "link": link, "snippet": snippet})
            if len(out) >= num:
                break
        return out
    except Exception as e:
        logger.debug(f"ddg failed: {e}")
        return []


# Order: working keyed providers first. Google CSE is LAST because Google
# closed the Custom Search JSON API to new projects (permanent 403 for new
# keys) — kept only for anyone with legacy access; it fast-fails to [] otherwise.
_PROVIDERS: List[Callable[[str, int], List[Dict]]] = [_serper, _brave, _google, _ddg]


def available_providers() -> List[str]:
    names = []
    if os.environ.get("GOOGLE_CSE_KEY") and os.environ.get("GOOGLE_CSE_ID"):
        names.append("google")
    if _serper_keys():
        names.append(f"serper(x{len(_serper_keys())})")
    if os.environ.get("BRAVE_API_KEY"):
        names.append("brave")
    names.append("duckduckgo")  # always available (no key)
    return names


def web_search(query: str, num: int = 10) -> List[Dict]:
    """Return normalized results from the first provider that yields any."""
    for provider in _PROVIDERS:
        results = provider(query, num)
        if results:
            return results
    return []
