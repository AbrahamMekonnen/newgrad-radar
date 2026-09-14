"""Learn a company's email pattern from real public data, then derive & verify
a person's work email — the same working pattern Hunter/Apollo use, built free.

How it works (no fabrication, no proprietary DB):
  1. Learn the domain's format from REAL name<->email pairs harvested from
     public GitHub commit authors at the company (e.g. "George Birch" ->
     "gbirch@stripe.com" implies the {f}{last} format). A handful of pairs is
     enough to detect the dominant pattern.
  2. Apply the learned pattern to the target person's name.
  3. Verify: MX check + catch-all probe + SMTP RCPT (via smtp_verify), so a
     catch-all domain doesn't produce false positives.

Best for companies with any GitHub footprint (most tech employers). Recruiters
share the same company email format as engineers, so an engineer-derived
pattern applies to recruiters too.
"""
from __future__ import annotations

import os
import re
import logging
from collections import Counter
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", (s or "").lower())


# local-part builders keyed by pattern name
_PATTERNS = {
    "first.last": lambda f, l: f"{f}.{l}",
    "firstlast": lambda f, l: f"{f}{l}",
    "flast": lambda f, l: f"{f[:1]}{l}",
    "f.last": lambda f, l: f"{f[:1]}.{l}",
    "first.l": lambda f, l: f"{f}.{l[:1]}",
    "firstl": lambda f, l: f"{f}{l[:1]}",
    "lastf": lambda f, l: f"{l}{f[:1]}",
    "last.first": lambda f, l: f"{l}.{f}",
    "lastfirst": lambda f, l: f"{l}{f}",
    "first": lambda f, l: f"{f}",
    "first_last": lambda f, l: f"{f}_{l}",
}


def _pattern_of(name: str, local: str) -> Optional[str]:
    """Which pattern turns `name` into email local-part `local`? None if unclear."""
    parts = [p for p in re.split(r"[\s.]+", name.strip()) if p]
    if len(parts) < 2:
        return None
    f, l = _norm(parts[0]), _norm(parts[-1])
    local = local.lower().split("+")[0]
    if not f or not l:
        return None
    for key, build in _PATTERNS.items():
        try:
            if build(f, l) == local:
                return key
        except Exception:
            continue
    return None


def _github_pairs(org: str, domain: str, max_repos: int = 5, max_commits: int = 30) -> List[Tuple[str, str]]:
    """Harvest real name<->email pairs from an org's public GitHub commits."""
    try:
        import requests
    except ImportError:
        return []
    h = {"Accept": "application/vnd.github+json", "User-Agent": "newgrad-radar"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    pairs: List[Tuple[str, str]] = []
    try:
        repos = requests.get(
            f"https://api.github.com/orgs/{org}/repos",
            params={"per_page": max_repos, "sort": "pushed"}, headers=h, timeout=20,
        ).json()
        if not isinstance(repos, list):
            return []
        for repo in repos[:max_repos]:
            name = repo.get("name")
            if not name:
                continue
            commits = requests.get(
                f"https://api.github.com/repos/{org}/{name}/commits",
                params={"per_page": max_commits}, headers=h, timeout=20,
            ).json()
            for c in (commits if isinstance(commits, list) else []):
                a = (c.get("commit") or {}).get("author") or {}
                em = (a.get("email") or "").lower()
                nm = a.get("name") or ""
                if em.endswith("@" + domain) and " " in nm.strip():
                    pairs.append((nm, em.split("@")[0]))
            if len(pairs) >= 20:
                break
    except Exception as e:
        logger.debug(f"github pairs failed for {org}: {e}")
    # dedupe by local-part
    seen = set()
    return [(n, lp) for n, lp in pairs if not (lp in seen or seen.add(lp))]


def learn_domain_pattern(domain: str, github_org: str) -> List[Tuple[str, int]]:
    """Return ranked (pattern_key, count) learned from real emails, best first."""
    pairs = _github_pairs(github_org, domain)
    tally: Counter = Counter()
    for name, local in pairs:
        key = _pattern_of(name, local)
        if key:
            tally[key] += 1
    return tally.most_common()


def guess_email(name: str, domain: str, pattern_key: str) -> Optional[str]:
    parts = [p for p in re.split(r"[\s.]+", name.strip()) if p]
    if len(parts) < 2:
        return None
    f, l = _norm(parts[0]), _norm(parts[-1])
    if not f or not l or pattern_key not in _PATTERNS:
        return None
    return f"{_PATTERNS[pattern_key](f, l)}@{domain}"


def _is_catch_all(domain: str) -> bool:
    """A domain that accepts a random nonexistent mailbox is catch-all — SMTP
    verification can't be trusted there."""
    try:
        from smtp_verify import verify_email
    except ImportError:
        try:
            from recruiters.smtp_verify import verify_email
        except Exception:
            return False
    import random, string
    rnd = "".join(random.choices(string.ascii_lowercase, k=16)) + "@" + domain
    try:
        return bool(getattr(verify_email(rnd), "valid", False))
    except Exception:
        return False


def find_work_email(
    name: str,
    domain: str,
    github_org: Optional[str] = None,
    verify: bool = True,
) -> Dict:
    """Derive a person's work email via the learned company pattern.

    Returns {email, pattern, confidence, verified, catch_all}. Confidence:
    'high' (pattern-verified via SMTP), 'medium' (learned pattern, catch-all or
    unverifiable), 'low' (guessed common pattern, no learning). email may be None.
    """
    result = {"email": None, "pattern": None, "confidence": None,
              "verified": False, "catch_all": False}
    org = github_org or _norm(domain.split(".")[0])
    ranked = learn_domain_pattern(domain, org)

    # candidate patterns: learned ones first, else the ~80%-coverage defaults
    candidates = [k for k, _ in ranked] or ["first.last", "firstlast", "flast"]
    result["pattern"] = candidates[0] if ranked else None

    if verify:
        catch_all = _is_catch_all(domain)
        result["catch_all"] = catch_all
        if catch_all:
            # can't SMTP-verify; trust the learned pattern if we have one
            email = guess_email(name, domain, candidates[0])
            result.update(email=email,
                          confidence="medium" if ranked else "low")
            return result
        try:
            from smtp_verify import verify_email
        except ImportError:
            from recruiters.smtp_verify import verify_email
        for key in candidates[:5]:
            email = guess_email(name, domain, key)
            if not email:
                continue
            try:
                if getattr(verify_email(email), "valid", False):
                    result.update(email=email, pattern=key, verified=True,
                                  confidence="high")
                    return result
            except Exception:
                continue
        # nothing verified — return best learned guess at medium/low
        email = guess_email(name, domain, candidates[0])
        result.update(email=email, confidence="medium" if ranked else "low")
        return result

    result["email"] = guess_email(name, domain, candidates[0])
    result["confidence"] = "medium" if ranked else "low"
    return result
