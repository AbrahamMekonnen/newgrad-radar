"""Push notifications via ntfy.sh."""

import urllib.request
import urllib.error
from typing import Optional


def send_ntfy(
    topic: str,
    title: str,
    message: str,
    url: Optional[str] = None,
    priority: str = "default",
    tags: Optional[list] = None,
) -> bool:
    """Send push notification via ntfy.sh.

    Args:
        topic: The ntfy topic to send to (user's unique topic ID)
        title: Notification title
        message: Notification body text
        url: Optional click-through URL
        priority: Priority level (min, low, default, high, urgent)

    Returns:
        True if notification sent successfully
    """
    headers = {
        "Title": title,
        "Tags": ",".join(tags) if tags else "briefcase",
        "Priority": priority,
    }

    if url:
        headers["Click"] = url

    try:
        req = urllib.request.Request(
            f"https://ntfy.sh/{topic}",
            data=message.encode("utf-8"),
            headers=headers,
            method="POST"
        )
        urllib.request.urlopen(req, timeout=30)
        return True
    except urllib.error.URLError as e:
        print(f"Error sending ntfy notification: {e}")
        return False


def notify_users(new_jobs: list[dict], users_by_job: dict[str, list[dict]], dry_run: bool = False) -> int:
    """Notify users about new jobs.

    Args:
        new_jobs: List of new job dicts
        users_by_job: Dict mapping job ID to list of user preference dicts
        dry_run: If True, don't actually send notifications

    Returns:
        Number of notifications sent
    """
    sent_count = 0

    for job in new_jobs:
        users = users_by_job.get(job["id"], [])

        for user_prefs in users:
            # Check if user has push notifications enabled
            if not user_prefs.get("push_enabled", False):
                continue

            # Check role filter
            role_filters = user_prefs.get("role_filters")
            if role_filters:
                if not any(r in role_filters for r in job.get("role_types", [])):
                    continue

            ntfy_topic = user_prefs.get("ntfy_topic")
            user_id = user_prefs.get("user_id")

            # Prepare notification
            title = f"New job at {job['company_name']}"
            message = f"{job['title']}\n{job['location']}"

            if dry_run:
                print(f"  [DRY RUN] Would notify {user_id or ntfy_topic}: {title}")
                sent_count += 1
                continue

            sent = False
            if ntfy_topic and send_ntfy(topic=ntfy_topic, title=title, message=message, url=job.get("url")):
                sent = True
            # Web Push + persist to Notified Jobs (all-jobs source).
            if user_id:
                from webpush import push_to_user
                from db import get_client, record_notified_jobs
                if push_to_user(get_client(), user_id, title, message, url=job.get("url")) > 0:
                    sent = True
                record_notified_jobs(user_id, [job["id"]], "all_jobs")
            if sent:
                sent_count += 1

    return sent_count


def send_summary(topic: str, new_count: int, companies: list[str], dry_run: bool = False) -> bool:
    """Send a summary notification about new jobs.

    Args:
        topic: The ntfy topic
        new_count: Number of new jobs found
        companies: List of company names with new jobs
        dry_run: If True, don't actually send

    Returns:
        True if sent successfully
    """
    if new_count == 0:
        return True

    title = f"{new_count} new grad jobs found!"
    company_list = ", ".join(companies[:5])
    if len(companies) > 5:
        company_list += f" and {len(companies) - 5} more"
    message = f"Companies: {company_list}"

    if dry_run:
        print(f"  [DRY RUN] Would send summary: {title}")
        return True

    return send_ntfy(topic, title, message, priority="high")
