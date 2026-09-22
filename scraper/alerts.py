"""Smart job alerts processing module.

Handles instant and digest alert delivery for job_alerts system.
Integrates with ntfy.sh for push notifications and email providers.
"""

from datetime import datetime, timezone
from typing import Optional
import os

from db import get_client
from notify import send_ntfy
from email_notify import send_email


# ============================================
# QUERY FUNCTIONS
# ============================================


def get_instant_alerts(job_ids: list[str]) -> dict[str, list[dict]]:
    """Query alert_matches for instant delivery, grouped by user_id.

    Args:
        job_ids: List of job IDs to check for matches

    Returns:
        Dict mapping user_id to list of match info dicts:
        {
            "user_id": [{
                "match_id": str,
                "alert_id": str,
                "alert_name": str,
                "job_id": str,
                "push_enabled": bool,
                "email_enabled": bool,
                "ntfy_topic": str | None,
                "email": str | None,
                "job": {...}
            }, ...]
        }
    """
    if not job_ids:
        return {}

    client = get_client()

    # Query pending instant matches for the given jobs
    # Join with job_alerts for alert details, user_preferences for ntfy_topic,
    # user_profiles for email, and jobs for job details
    result = client.table("alert_matches").select(
        "id, alert_id, job_id, "
        "job_alerts!inner(id, user_id, name, push_enabled, email_enabled), "
        "jobs!inner(id, title, company_name, company_slug, location, url, apply_url, ats_type, tier, role_types)"
    ).in_("job_id", job_ids).eq(
        "delivery_status", "pending"
    ).eq(
        "delivery_mode", "instant"
    ).execute()

    if not result.data:
        return {}

    # Get unique user IDs to fetch contact info
    user_ids = list({row["job_alerts"]["user_id"] for row in result.data})

    # Fetch user contact info (ntfy_topic from user_preferences, email from user_profiles)
    prefs_result = client.table("user_preferences").select(
        "user_id, ntfy_topic"
    ).in_("user_id", user_ids).execute()

    profiles_result = client.table("user_profiles").select(
        "user_id, email"
    ).in_("user_id", user_ids).execute()

    # Build lookup maps
    ntfy_by_user = {p["user_id"]: p.get("ntfy_topic") for p in (prefs_result.data or [])}
    email_by_user = {p["user_id"]: p.get("email") for p in (profiles_result.data or [])}

    # Group by user_id
    alerts_by_user: dict[str, list[dict]] = {}

    for row in result.data:
        alert = row["job_alerts"]
        user_id = alert["user_id"]
        job = row["jobs"]

        match_info = {
            "match_id": row["id"],
            "alert_id": row["alert_id"],
            "alert_name": alert["name"],
            "job_id": row["job_id"],
            "push_enabled": alert["push_enabled"],
            "email_enabled": alert["email_enabled"],
            "ntfy_topic": ntfy_by_user.get(user_id),
            "email": email_by_user.get(user_id),
            "job": job,
        }

        if user_id not in alerts_by_user:
            alerts_by_user[user_id] = []
        alerts_by_user[user_id].append(match_info)

    return alerts_by_user


def get_digest_alerts(mode: str = "daily") -> dict[str, list[dict]]:
    """Query pending digest matches with job and alert details.

    Args:
        mode: "daily" or "weekly"

    Returns:
        Dict mapping user_id to list of match info dicts with job details
    """
    client = get_client()
    delivery_mode = f"{mode}_digest"

    # Query pending digest matches
    result = client.table("alert_matches").select(
        "id, alert_id, job_id, "
        "job_alerts!inner(id, user_id, name, push_enabled, email_enabled), "
        "jobs!inner(id, title, company_name, company_slug, location, url, apply_url, ats_type, tier, role_types)"
    ).eq(
        "delivery_status", "pending"
    ).eq(
        "delivery_mode", delivery_mode
    ).execute()

    if not result.data:
        return {}

    # Get unique user IDs for contact info
    user_ids = list({row["job_alerts"]["user_id"] for row in result.data})

    # Fetch contact info
    prefs_result = client.table("user_preferences").select(
        "user_id, ntfy_topic"
    ).in_("user_id", user_ids).execute()

    profiles_result = client.table("user_profiles").select(
        "user_id, email"
    ).in_("user_id", user_ids).execute()

    ntfy_by_user = {p["user_id"]: p.get("ntfy_topic") for p in (prefs_result.data or [])}
    email_by_user = {p["user_id"]: p.get("email") for p in (profiles_result.data or [])}

    # Group by user_id
    alerts_by_user: dict[str, list[dict]] = {}

    for row in result.data:
        alert = row["job_alerts"]
        user_id = alert["user_id"]
        job = row["jobs"]

        match_info = {
            "match_id": row["id"],
            "alert_id": row["alert_id"],
            "alert_name": alert["name"],
            "job_id": row["job_id"],
            "push_enabled": alert["push_enabled"],
            "email_enabled": alert["email_enabled"],
            "ntfy_topic": ntfy_by_user.get(user_id),
            "email": email_by_user.get(user_id),
            "job": job,
        }

        if user_id not in alerts_by_user:
            alerts_by_user[user_id] = []
        alerts_by_user[user_id].append(match_info)

    return alerts_by_user


# ============================================
# DELIVERY FUNCTIONS
# ============================================


def send_instant_alert(
    ntfy_topic: Optional[str],
    email: Optional[str],
    alert_name: str,
    job: dict,
    push_enabled: bool,
    email_enabled: bool,
    dry_run: bool = False,
) -> dict[str, bool]:
    """Send instant alert for a single job match.

    Args:
        ntfy_topic: User's ntfy topic for push notifications
        email: User's email address
        alert_name: Name of the alert that matched
        job: Job dict with title, company_name, url, location, etc.
        push_enabled: Whether push notifications are enabled for this alert
        email_enabled: Whether email is enabled for this alert
        dry_run: If True, don't actually send notifications

    Returns:
        Dict with push_sent and email_sent booleans
    """
    result = {"push_sent": False, "email_sent": False}

    app_url = (os.getenv("APP_URL") or "https://newgradradar.com").rstrip("/")
    history_url = f"{app_url}/applications?section=alerts"

    # Send push notification
    if push_enabled and ntfy_topic:
        # Lead with the company + role the user actually wants — never the alert
        # label (which people name things like "kk").
        title = f"New job at {job['company_name']}"
        message = f"{job['title']}\n{job.get('location', 'Remote')}"

        if dry_run:
            print(f"    [DRY RUN] Push to {ntfy_topic}: {title}")
            result["push_sent"] = True
        else:
            if send_ntfy(ntfy_topic, title, message, url=history_url, priority="high"):
                result["push_sent"] = True

    # Send email — never let an email failure affect push (push already sent
    # above). ntfy works entirely on its own; email is best-effort.
    if email_enabled and email:
        subject = f"{alert_name}: New job at {job['company_name']}"
        try:
            html_body = build_single_alert_email(alert_name, job)
            if dry_run:
                print(f"    [DRY RUN] Email to {email}: {subject}")
                result["email_sent"] = True
            elif send_email(email, subject, html_body):
                result["email_sent"] = True
        except Exception as e:
            print(f"    [email] send failed (push unaffected): {e}")

    return result


def send_digest_notifications(
    user_id: str,
    matches: list[dict],
    mode: str,
    dry_run: bool = False,
) -> dict[str, int]:
    """Send digest notifications for a user's accumulated matches.

    Args:
        user_id: The user ID
        matches: List of match dicts with job and alert info
        mode: "daily" or "weekly"
        dry_run: If True, don't actually send notifications

    Returns:
        Dict with push_count and email_count
    """
    result = {"push_count": 0, "email_count": 0}
    app_url = (os.getenv("APP_URL") or "https://newgradradar.com").rstrip("/")
    history_url = f"{app_url}/applications?section=alerts"

    if not matches:
        return result

    # Group jobs by alert name
    jobs_by_alert: dict[str, list[dict]] = {}
    for match in matches:
        alert_name = match["alert_name"]
        if alert_name not in jobs_by_alert:
            jobs_by_alert[alert_name] = []
        jobs_by_alert[alert_name].append(match["job"])

    total_jobs = sum(len(jobs) for jobs in jobs_by_alert.values())

    # Get contact info from first match (same user = same contact)
    first_match = matches[0]
    ntfy_topic = first_match.get("ntfy_topic")
    email = first_match.get("email")
    push_enabled = first_match.get("push_enabled", False)
    email_enabled = first_match.get("email_enabled", False)

    # Send summary push notification
    if push_enabled and ntfy_topic:
        mode_label = "Daily" if mode == "daily" else "Weekly"
        title = f"{mode_label} Job Digest: {total_jobs} new jobs"
        # Show the actual companies + roles, not the user's alert labels (which
        # people name things like "kk"/"test" and mean nothing in a push).
        lines, seen = [], set()
        for jobs in jobs_by_alert.values():
            for j in jobs:
                key = (j.get("company_name"), j.get("title"))
                if key in seen:
                    continue
                seen.add(key)
                lines.append(f"{j.get('company_name', 'Unknown')} - {j.get('title', '')}".strip(" -"))
        message = "\n".join(lines[:5])
        if len(lines) > 5:
            message += f"\n…and {len(lines) - 5} more"

        if dry_run:
            print(f"    [DRY RUN] Digest push to {ntfy_topic}: {title}")
            result["push_count"] = 1
        else:
            if send_ntfy(ntfy_topic, title, message, url=history_url, priority="default"):
                result["push_count"] = 1

    # Send detailed email digest
    if email_enabled and email:
        mode_label = "Daily" if mode == "daily" else "Weekly"
        subject = f"{mode_label} Job Digest: {total_jobs} new jobs from your alerts"
        html_body = build_digest_alert_email(jobs_by_alert, mode)

        if dry_run:
            print(f"    [DRY RUN] Digest email to {email}: {subject}")
            result["email_count"] = 1
        else:
            if send_email(email, subject, html_body):
                result["email_count"] = 1

    return result


def queue_auto_apply_matches(alerts_by_user: dict[str, list[dict]], dry_run: bool = False) -> int:
    """Queue matched jobs for users who enabled Auto-Apply. Delivery remains independent."""
    if dry_run or not alerts_by_user:
        return 0
    client = get_client()
    queued = 0
    supported = {"greenhouse", "lever", "ashby", "workday"}
    for user_id, matches in alerts_by_user.items():
        try:
            profile_rows = (client.table("user_profiles")
                            .select("auto_apply_enabled,auto_submit")
                            .eq("user_id", user_id).limit(1).execute().data) or []
            profile = profile_rows[0] if profile_rows else {}
            if not profile.get("auto_apply_enabled"):
                continue
            for match in matches:
                job = match.get("job") or {}
                ats = str(job.get("ats_type") or "").lower()
                job_url = job.get("apply_url") or job.get("url")
                if ats not in supported or not job_url:
                    continue
                existing = (client.table("autoapply_job_queue").select("id")
                            .eq("user_id", user_id).eq("job_id", match["job_id"])
                            .limit(1).execute().data) or []
                if existing:
                    continue
                client.table("autoapply_job_queue").insert({
                    "user_id": user_id, "job_id": match["job_id"],
                    "job_title": job.get("title") or "Untitled",
                    "company_slug": job.get("company_slug") or "unknown",
                    "company_name": job.get("company_name") or "Unknown",
                    "job_url": job_url, "ats_type": ats, "status": "pending", "priority": 3,
                    "answers": {"submit_after_prepare": bool(profile.get("auto_submit")), "origin": "job_alert"},
                }).execute()
                queued += 1
        except Exception as exc:
            print(f"    [auto-apply] queueing failed for user {user_id}: {exc}")
    return queued


# ============================================
# DATABASE UPDATE FUNCTIONS
# ============================================


def mark_alerts_delivered(match_ids: list[str]) -> int:
    """Update alert_matches delivery_status to 'delivered'.

    Args:
        match_ids: List of match IDs to mark as delivered

    Returns:
        Number of rows updated
    """
    if not match_ids:
        return 0

    client = get_client()

    # Use the database function if available, otherwise do direct update
    try:
        # Try the PostgreSQL function first (more atomic)
        result = client.rpc("mark_alerts_delivered", {"p_match_ids": match_ids}).execute()
        return result.data if isinstance(result.data, int) else len(match_ids)
    except Exception:
        # Fallback to direct update
        now = datetime.now(timezone.utc).isoformat()
        updated = 0
        for match_id in match_ids:
            try:
                client.table("alert_matches").update({
                    "delivery_status": "delivered",
                    "delivered_at": now,
                }).eq("id", match_id).execute()
                updated += 1
            except Exception as e:
                print(f"    Error marking match {match_id} delivered: {e}")

        return updated


# ============================================
# MAIN PROCESSING FUNCTIONS
# ============================================


def process_instant_alerts(new_jobs: list[dict], dry_run: bool = False) -> dict:
    """Process instant alerts for newly upserted jobs.

    Main entry point called after job upsert in radar.py.

    Args:
        new_jobs: List of new job dicts with at least 'id' field
        dry_run: If True, don't send notifications or update database

    Returns:
        Summary stats dict
    """
    stats = {
        "jobs_checked": len(new_jobs),
        "users_notified": 0,
        "push_sent": 0,
        "email_sent": 0,
        "matches_delivered": 0,
        "auto_apply_queued": 0,
    }

    if not new_jobs:
        return stats

    job_ids = [j["id"] for j in new_jobs]

    try:
        alerts_by_user = get_instant_alerts(job_ids)
    except Exception as e:
        print(f"  Error fetching instant alerts: {e}")
        return stats

    if not alerts_by_user:
        return stats

    print(f"  Processing instant alerts for {len(alerts_by_user)} users...")
    stats["auto_apply_queued"] = queue_auto_apply_matches(alerts_by_user, dry_run)

    delivered_match_ids = []

    for user_id, matches in alerts_by_user.items():
        user_push = 0
        user_email = 0

        for match in matches:
            result = send_instant_alert(
                ntfy_topic=match.get("ntfy_topic"),
                email=match.get("email"),
                alert_name=match["alert_name"],
                job=match["job"],
                push_enabled=match.get("push_enabled", False),
                email_enabled=match.get("email_enabled", False),
                dry_run=dry_run,
            )

            if result["push_sent"]:
                user_push += 1
                stats["push_sent"] += 1
            if result["email_sent"]:
                user_email += 1
                stats["email_sent"] += 1

            delivered_match_ids.append(match["match_id"])

        if user_push > 0 or user_email > 0:
            stats["users_notified"] += 1

    # Mark matches as delivered
    if not dry_run and delivered_match_ids:
        stats["matches_delivered"] = mark_alerts_delivered(delivered_match_ids)

    return stats


def process_digest_alerts(mode: str = "daily", dry_run: bool = False) -> dict:
    """Process digest alerts (daily or weekly).

    Called by scheduler for digest delivery.

    Args:
        mode: "daily" or "weekly"
        dry_run: If True, don't send notifications or update database

    Returns:
        Summary stats dict
    """
    stats = {
        "mode": mode,
        "users_notified": 0,
        "push_sent": 0,
        "email_sent": 0,
        "total_jobs": 0,
        "matches_delivered": 0,
        "auto_apply_queued": 0,
    }

    try:
        alerts_by_user = get_digest_alerts(mode)
    except Exception as e:
        print(f"  Error fetching {mode} digest alerts: {e}")
        return stats

    if not alerts_by_user:
        print(f"  No pending {mode} digest alerts")
        return stats

    print(f"  Processing {mode} digest for {len(alerts_by_user)} users...")
    stats["auto_apply_queued"] = queue_auto_apply_matches(alerts_by_user, dry_run)

    delivered_match_ids = []

    for user_id, matches in alerts_by_user.items():
        stats["total_jobs"] += len(matches)

        result = send_digest_notifications(
            user_id=user_id,
            matches=matches,
            mode=mode,
            dry_run=dry_run,
        )

        if result["push_count"] > 0:
            stats["push_sent"] += result["push_count"]
            stats["users_notified"] += 1
        if result["email_count"] > 0:
            stats["email_sent"] += result["email_count"]
            if result["push_count"] == 0:  # Don't double count
                stats["users_notified"] += 1

        # Collect match IDs for marking delivered
        delivered_match_ids.extend(m["match_id"] for m in matches)

    # Mark matches as delivered
    if not dry_run and delivered_match_ids:
        stats["matches_delivered"] = mark_alerts_delivered(delivered_match_ids)

    return stats


# ============================================
# EMAIL HTML BUILDERS
# ============================================


def build_single_alert_email(alert_name: str, job: dict) -> str:
    """Build HTML email for a single job instant alert.

    Args:
        alert_name: Name of the alert that matched
        job: Job dict with title, company_name, url, location, tier, role_types

    Returns:
        HTML email body string
    """
    app_url = (os.getenv("APP_URL") or "https://newgradradar.com").rstrip("/")
    history_url = f"{app_url}/applications?section=alerts"
    role_badges = ""
    for role in job.get("role_types", []):
        role_badges += f'<span style="display: inline-block; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 4px;">{role}</span>'

    tier_color = {
        "faang": "#dc2626",
        "ai": "#7c3aed",
        "unicorn": "#059669",
        "yc": "#ea580c",
        "fintech": "#0284c7",
        "infra": "#475569",
    }.get(job.get("tier", ""), "#6b7280")

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="background: #2563eb; color: white; padding: 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">NewGrad Radar</h1>
                <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Alert: {alert_name}</p>
            </div>
            <div style="padding: 24px;">
                <div style="margin-bottom: 16px;">
                    <span style="display: inline-block; background: {tier_color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">{job.get('tier', 'other')}</span>
                </div>
                <h2 style="margin: 0 0 8px; color: #333; font-size: 20px;">
                    {job.get('company_name', 'Unknown Company')}
                </h2>
                <h3 style="margin: 0 0 12px; color: #2563eb; font-size: 18px;">
                    <a href="{job.get('url', '#')}" style="color: #2563eb; text-decoration: none;">
                        {job.get('title', 'Untitled Position')}
                    </a>
                </h3>
                <p style="margin: 0 0 16px; color: #666;">
                    {job.get('location', 'Remote')}
                </p>
                <div style="margin-bottom: 24px;">
                    {role_badges}
                </div>
                <div style="text-align: center;">
                    <a href="{history_url}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                        View in Applications
                    </a>
                </div>
            </div>
            <div style="background: #f9f9f9; padding: 16px; text-align: center; color: #666; font-size: 12px;">
                <p style="margin: 0 0 8px;">This job matched your alert: <strong>{alert_name}</strong></p>
                <a href="{app_url}/alerts" style="color: #666;">Manage Alerts</a> |
                <a href="{app_url}/settings" style="color: #666;">Unsubscribe</a>
            </div>
        </div>
    </body>
    </html>
    """


def build_digest_alert_email(jobs_by_alert: dict[str, list[dict]], mode: str) -> str:
    """Build HTML digest email with jobs grouped by alert.

    Args:
        jobs_by_alert: Dict mapping alert_name to list of job dicts
        mode: "daily" or "weekly"

    Returns:
        HTML email body string
    """
    app_url = (os.getenv("APP_URL") or "https://newgradradar.com").rstrip("/")
    history_url = f"{app_url}/applications?section=alerts"
    mode_label = "Daily" if mode == "daily" else "Weekly"
    total_jobs = sum(len(jobs) for jobs in jobs_by_alert.values())
    total_alerts = len(jobs_by_alert)

    alert_sections = ""
    for alert_name, jobs in jobs_by_alert.items():
        job_items = ""
        for job in jobs[:10]:  # Limit per alert
            tier_color = {
                "faang": "#dc2626",
                "ai": "#7c3aed",
                "unicorn": "#059669",
                "yc": "#ea580c",
                "fintech": "#0284c7",
                "infra": "#475569",
            }.get(job.get("tier", ""), "#6b7280")

            job_items += f"""
            <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
                    <div style="margin-bottom: 4px;">
                        <span style="display: inline-block; background: {tier_color}; color: white; padding: 1px 6px; border-radius: 3px; font-size: 10px; text-transform: uppercase;">{job.get('tier', 'other')}</span>
                        <strong style="color: #333; margin-left: 8px;">{job.get('company_name', 'Unknown')}</strong>
                    </div>
                    <a href="{job.get('url', '#')}" style="color: #2563eb; text-decoration: none; font-weight: 500;">
                        {job.get('title', 'Untitled')}
                    </a>
                    <div style="color: #666; font-size: 13px; margin-top: 4px;">
                        {job.get('location', 'Remote')}
                    </div>
                </td>
            </tr>
            """

        more_text = ""
        if len(jobs) > 10:
            more_text = f"<tr><td style='padding: 8px 0; color: #666; font-size: 13px;'>...and {len(jobs) - 10} more jobs</td></tr>"

        alert_sections += f"""
        <div style="margin-bottom: 32px;">
            <h3 style="margin: 0 0 16px; padding: 12px 16px; background: #f0f9ff; border-left: 4px solid #2563eb; color: #1e40af; font-size: 16px;">
                {alert_name}
                <span style="font-weight: normal; color: #64748b; font-size: 14px;">({len(jobs)} job{'s' if len(jobs) != 1 else ''})</span>
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
                {job_items}
                {more_text}
            </table>
        </div>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="background: #2563eb; color: white; padding: 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">NewGrad Radar</h1>
                <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">{mode_label} Job Digest</p>
            </div>
            <div style="padding: 24px;">
                <div style="text-align: center; margin-bottom: 24px; padding: 16px; background: #f8fafc; border-radius: 8px;">
                    <div style="font-size: 36px; font-weight: bold; color: #2563eb;">{total_jobs}</div>
                    <div style="color: #64748b;">new job{'s' if total_jobs != 1 else ''} from {total_alerts} alert{'s' if total_alerts != 1 else ''}</div>
                </div>
                {alert_sections}
                <div style="margin-top: 24px; text-align: center;">
                    <a href="{history_url}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                        View Notified Jobs
                    </a>
                </div>
            </div>
            <div style="background: #f9f9f9; padding: 16px; text-align: center; color: #666; font-size: 12px;">
                <a href="{app_url}/alerts" style="color: #666;">Manage Alerts</a> |
                <a href="{app_url}/settings" style="color: #666;">Unsubscribe</a>
            </div>
        </div>
    </body>
    </html>
    """
