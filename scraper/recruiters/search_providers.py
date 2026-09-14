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


def _serper(query: str, num: int) -> List[Dict]:
    key = os.environ.get("SERPER_API_KEY")
    if not key:
        return []
    try:
        import requests
        r = requests.post("https://google.serper.dev/search",
                          headers={"X-API-KEY": key, "Content-Type": "application/json"},
                          json={"q": query, "num": min(num, 10)}, timeout=20)
        if r.status_code != 200:
            logger.debug(f"serper {r.status_code}: {r.text[:120]}")
            return []
        return [{"title": it.get("title", ""), "link": it.get("link", ""),
                 "snippet": it.get("snippet", "")} for it in r.json().get("organic", []) or []]
    except Exception as e:
        logger.debug(f"serper failed: {e}")
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


# Ordered by cost/quality: paid-ish keys first (best results), free no-key last.
_PROVIDERS: List[Callable[[str, int], List[Dict]]] = [_google, _serper, _brave, _ddg]


def available_providers() -> List[str]:
    names = []
    if os.environ.get("GOOGLE_CSE_KEY") and os.environ.get("GOOGLE_CSE_ID"):
        names.append("google")
    if os.environ.get("SERPER_API_KEY"):
        names.append("serper")
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
