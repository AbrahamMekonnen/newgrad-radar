"""Email notifications for new jobs.

Supports multiple providers with fallback:
1. Brevo (formerly Sendinblue) - 300 emails/day free
2. Amazon SES - $0.10 per 1,000 emails
3. Resend - 100 emails/day free
"""

import os
import urllib.request
import urllib.error
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional


# Provider API keys
BREVO_API_KEY = os.environ.get("BREVO_API_KEY")
SES_ACCESS_KEY = os.environ.get("AWS_ACCESS_KEY_ID")
SES_SECRET_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
SES_REGION = os.environ.get("AWS_REGION", "us-east-1")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")

# SMTP settings (for SES or custom)
SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASS = os.environ.get("SMTP_PASS")

FROM_EMAIL = os.environ.get("FROM_EMAIL", "NewGrad Radar <jobs@updates.newgradradar.com>")
FROM_NAME = "NewGrad Radar"


def send_via_brevo(to: str, subject: str, html_body: str, text_body: Optional[str] = None) -> bool:
    """Send email via Brevo (Sendinblue) API. 300 emails/day free."""
    if not BREVO_API_KEY:
        return False

    payload = {
        "sender": {"name": FROM_NAME, "email": FROM_EMAIL.split("<")[-1].rstrip(">").strip() or "jobs@newgradradar.com"},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html_body,
    }

    if text_body:
        payload["textContent"] = text_body

    try:
        req = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "api-key": BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=30)
        return True
    except urllib.error.URLError as e:
        print(f"  Brevo error: {e}")
        return False


def send_via_smtp(to: str, subject: str, html_body: str, text_body: Optional[str] = None) -> bool:
    """Send email via SMTP (works with Amazon SES, Gmail, etc.)."""
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = FROM_EMAIL
        msg["To"] = to

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(FROM_EMAIL, to, msg.as_string())

        return True
    except Exception as e:
        print(f"  SMTP error: {e}")
        return False


def send_via_resend(to: str, subject: str, html_body: str, text_body: Optional[str] = None) -> bool:
    """Send email via Resend API. 100 emails/day free."""
    if not RESEND_API_KEY:
        return False

    payload = {
        "from": FROM_EMAIL,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }

    if text_body:
        payload["text"] = text_body

    try:
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=30)
        return True
    except urllib.error.URLError as e:
        print(f"  Resend error: {e}")
        return False


def send_email(
    to: str,
    subject: str,
    html_body: str,
    text_body: Optional[str] = None,
) -> bool:
    """Send email using available provider (Brevo -> SMTP -> Resend).

    Args:
        to: Recipient email address
        subject: Email subject
        html_body: HTML email body
        text_body: Plain text fallback (optional)

    Returns:
        True if sent successfully
    """
    # Try providers in order of preference (best free tier first)
    if BREVO_API_KEY:
        if send_via_brevo(to, subject, html_body, text_body):
            return True

    if SMTP_HOST:
        if send_via_smtp(to, subject, html_body, text_body):
            return True

    if RESEND_API_KEY:
        if send_via_resend(to, subject, html_body, text_body):
            return True

    print("  No email provider configured. Set BREVO_API_KEY, SMTP_HOST, or RESEND_API_KEY")
    return False


def build_job_email_html(jobs: list[dict], company_name: str) -> str:
    """Build HTML email for new jobs."""
    job_rows = ""
    for job in jobs[:10]:
        job_rows += f"""
        <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
                <a href="{job.get('url', '#')}" style="color: #2563eb; text-decoration: none; font-weight: 500;">
                    {job.get('title', 'Untitled')}
                </a>
                <div style="color: #666; font-size: 14px; margin-top: 4px;">
                    {job.get('location', 'Remote')}
                </div>
            </td>
        </tr>
        """

    more_text = ""
    if len(jobs) > 10:
        more_text = f"<p style='color: #666;'>...and {len(jobs) - 10} more jobs</p>"

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
            </div>
            <div style="padding: 24px;">
                <h2 style="margin: 0 0 16px; color: #333;">
                    {len(jobs)} new job{'' if len(jobs) == 1 else 's'} at {company_name}
                </h2>
                <table style="width: 100%; border-collapse: collapse;">
                    {job_rows}
                </table>
                {more_text}
                <div style="margin-top: 24px; text-align: center;">
                    <a href="https://newgradradar.com" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
                        View All Jobs
                    </a>
                </div>
            </div>
            <div style="background: #f9f9f9; padding: 16px; text-align: center; color: #666; font-size: 12px;">
                <a href="https://newgradradar.com/settings" style="color: #666;">Unsubscribe</a> |
                <a href="https://newgradradar.com" style="color: #666;">NewGrad Radar</a>
            </div>
        </div>
    </body>
    </html>
    """


def build_job_email_text(jobs: list[dict], company_name: str) -> str:
    """Build plain text email for new jobs."""
    lines = [
        f"{len(jobs)} new job{'s' if len(jobs) != 1 else ''} at {company_name}",
        "",
    ]

    for job in jobs[:10]:
        lines.append(f"- {job.get('title', 'Untitled')}")
        lines.append(f"  Location: {job.get('location', 'Remote')}")
        lines.append(f"  Apply: {job.get('url', '')}")
        lines.append("")

    if len(jobs) > 10:
        lines.append(f"...and {len(jobs) - 10} more jobs")
        lines.append("")

    lines.append("View all jobs: https://newgradradar.com")
    lines.append("")
    lines.append("---")
    lines.append("Unsubscribe: https://newgradradar.com/settings")

    return "\n".join(lines)


def build_digest_email_html(jobs_by_company: dict[str, list[dict]]) -> str:
    """Build HTML digest email for multiple companies."""
    total_jobs = sum(len(jobs) for jobs in jobs_by_company.values())

    company_sections = ""
    for company_name, jobs in jobs_by_company.items():
        job_items = ""
        for job in jobs[:5]:
            job_items += f"""
            <li style="margin-bottom: 8px;">
                <a href="{job.get('url', '#')}" style="color: #2563eb; text-decoration: none;">
                    {job.get('title', 'Untitled')}
                </a>
                <span style="color: #666; font-size: 13px;"> - {job.get('location', 'Remote')}</span>
            </li>
            """

        more = ""
        if len(jobs) > 5:
            more = f"<li style='color: #666;'>...and {len(jobs) - 5} more</li>"

        company_sections += f"""
        <div style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px; color: #333; font-size: 18px;">{company_name}</h3>
            <ul style="margin: 0; padding-left: 20px;">
                {job_items}
                {more}
            </ul>
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
            </div>
            <div style="padding: 24px;">
                <h2 style="margin: 0 0 20px; color: #333;">
                    {total_jobs} new job{'' if total_jobs == 1 else 's'} from your tracked companies
                </h2>
                {company_sections}
                <div style="margin-top: 24px; text-align: center;">
                    <a href="https://newgradradar.com" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
                        View All Jobs
                    </a>
                </div>
            </div>
            <div style="background: #f9f9f9; padding: 16px; text-align: center; color: #666; font-size: 12px;">
                <a href="https://newgradradar.com/settings" style="color: #666;">Unsubscribe</a> |
                <a href="https://newgradradar.com" style="color: #666;">NewGrad Radar</a>
            </div>
        </div>
    </body>
    </html>
    """


def notify_user_by_email(
    email: str,
    jobs: list[dict],
    company_name: Optional[str] = None,
    dry_run: bool = False,
) -> bool:
    """Send email notification to a user about new jobs.

    Args:
        email: User's email address
        jobs: List of new job dicts
        company_name: Company name (if single company) or None for digest
        dry_run: If True, don't actually send

    Returns:
        True if sent successfully
    """
    if not jobs:
        return False

    if company_name:
        subject = f"{len(jobs)} new job{'s' if len(jobs) != 1 else ''} at {company_name}"
        html_body = build_job_email_html(jobs, company_name)
        text_body = build_job_email_text(jobs, company_name)
    else:
        # Group by company for digest
        jobs_by_company: dict[str, list[dict]] = {}
        for job in jobs:
            name = job.get("company_name", "Unknown")
            if name not in jobs_by_company:
                jobs_by_company[name] = []
            jobs_by_company[name].append(job)

        total = len(jobs)
        companies = len(jobs_by_company)
        subject = f"{total} new job{'s' if total != 1 else ''} from {companies} compan{'ies' if companies != 1 else 'y'}"
        html_body = build_digest_email_html(jobs_by_company)
        text_body = None  # HTML only for digest

    if dry_run:
        print(f"    [DRY RUN] Would email {email}: {subject}")
        return True

    return send_email(email, subject, html_body, text_body)
