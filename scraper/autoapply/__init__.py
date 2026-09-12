"""Auto-apply module for job applications."""

from .agent import (
    apply_to_job,
    process_pending_applications,
    fetch_user_profile,
    fetch_pending_applications,
    UserProfile,
    JobApplication,
)

__all__ = [
    "apply_to_job",
    "process_pending_applications",
    "fetch_user_profile",
    "fetch_pending_applications",
    "UserProfile",
    "JobApplication",
]
