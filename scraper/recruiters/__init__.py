"""Recruiter email finding module for NewGrad Radar."""

from .email_patterns import generate_patterns
from .smtp_verify import verify_email, verify_emails_batch
from .enricher import find_recruiters, RecruiterResult

__all__ = [
    "generate_patterns",
    "verify_email",
    "verify_emails_batch",
    "find_recruiters",
    "RecruiterResult",
]
