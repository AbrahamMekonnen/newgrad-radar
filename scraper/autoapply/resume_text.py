"""Extract plain text from a resume PDF so the AI drafter has real material.

Without this the drafter has no grounding and honestly returns empty answers for
"why us"/essay questions. We fetch the user's uploaded resume once, pull its
text, and cache it back onto the profile so it's only parsed a single time.
"""
from __future__ import annotations

import io
import logging

import requests

logger = logging.getLogger("resume_text")

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}


def extract_resume_text(url: str, max_chars: int = 8000) -> str:
    """Download a resume (PDF) and return its text, or '' on any failure."""
    if not url or not url.startswith("http"):
        return ""
    try:
        data = requests.get(url, headers=UA, timeout=30).content
        if not data:
            return ""
    except Exception as e:
        logger.warning(f"resume download failed: {e}")
        return ""

    text = _from_pdf(data)
    text = " ".join((text or "").split())  # normalise whitespace
    return text[:max_chars]


def _from_pdf(data: bytes) -> str:
    # Prefer pypdf (pure-python, CI-friendly); fall back to PyMuPDF if present.
    try:
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
    except Exception:
        pass
    try:
        import fitz  # PyMuPDF
        with fitz.open(stream=data, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except Exception as e:
        logger.warning(f"pdf parse failed: {e}")
        return ""


if __name__ == "__main__":
    import sys
    print(extract_resume_text(sys.argv[1])[:600] if len(sys.argv) > 1 else "usage: resume_text.py <url>")
