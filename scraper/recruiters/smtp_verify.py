"""SMTP email verification.

This module verifies email addresses by:
1. Checking if MX records exist for the domain
2. Connecting to the SMTP server
3. Checking if the mailbox exists via RCPT TO command

Note: Many modern email servers don't reliably respond to RCPT TO verification
(they accept all addresses to prevent enumeration). This is a best-effort check.
"""

import socket
import smtplib
import dns.resolver
from dataclasses import dataclass
from typing import Optional
import logging
import time

logger = logging.getLogger(__name__)

# Timeouts in seconds
DNS_TIMEOUT = 5.0
SMTP_TIMEOUT = 10.0
SMTP_HELO_DOMAIN = "newgrad-radar.app"

# Common SMTP response codes
SMTP_OK = 250
SMTP_USER_NOT_LOCAL = 251
SMTP_CANNOT_VERIFY = 252
SMTP_MAILBOX_UNAVAILABLE = 550
SMTP_USER_NOT_FOUND = 551
SMTP_MAILBOX_NOT_FOUND = 553


@dataclass
class VerificationResult:
    """Result of email verification attempt."""
    email: str
    valid: bool
    reason: str
    smtp_code: Optional[int] = None
    mx_host: Optional[str] = None


def get_mx_records(domain: str, timeout: float = DNS_TIMEOUT) -> list[str]:
    """Get MX records for a domain, sorted by priority.

    Args:
        domain: Email domain to look up
        timeout: DNS query timeout in seconds

    Returns:
        List of MX hostnames sorted by priority (lowest first)

    Raises:
        dns.resolver.NXDOMAIN: Domain doesn't exist
        dns.resolver.NoAnswer: No MX records found
        dns.exception.Timeout: DNS query timed out
    """
    resolver = dns.resolver.Resolver()
    resolver.timeout = timeout
    resolver.lifetime = timeout

    try:
        mx_records = resolver.resolve(domain, "MX")
        # Sort by priority (lower = higher priority)
        sorted_mx = sorted(mx_records, key=lambda x: x.preference)
        return [str(mx.exchange).rstrip(".") for mx in sorted_mx]
    except dns.resolver.NoAnswer:
        # No MX records, try A record as fallback (per RFC 5321)
        try:
            resolver.resolve(domain, "A")
            return [domain]  # Use domain itself as mail server
        except Exception:
            raise
    except Exception:
        raise


def verify_email(
    email: str,
    smtp_timeout: float = SMTP_TIMEOUT,
    dns_timeout: float = DNS_TIMEOUT,
    from_address: str = "verify@newgrad-radar.app",
) -> VerificationResult:
    """Verify if an email address likely exists.

    This performs a three-step verification:
    1. Check MX records exist for the domain
    2. Connect to the SMTP server
    3. Issue RCPT TO to check if mailbox exists

    Args:
        email: Email address to verify
        smtp_timeout: Timeout for SMTP operations
        dns_timeout: Timeout for DNS lookups
        from_address: Address to use in MAIL FROM command

    Returns:
        VerificationResult with validity status and details
    """
    email = email.lower().strip()

    # Parse email
    if "@" not in email:
        return VerificationResult(
            email=email,
            valid=False,
            reason="Invalid email format: missing @"
        )

    local_part, domain = email.rsplit("@", 1)

    if not local_part or not domain:
        return VerificationResult(
            email=email,
            valid=False,
            reason="Invalid email format: empty local part or domain"
        )

    # Step 1: Check MX records
    try:
        mx_hosts = get_mx_records(domain, timeout=dns_timeout)
    except dns.resolver.NXDOMAIN:
        return VerificationResult(
            email=email,
            valid=False,
            reason=f"Domain {domain} does not exist"
        )
    except dns.resolver.NoAnswer:
        return VerificationResult(
            email=email,
            valid=False,
            reason=f"No MX records found for {domain}"
        )
    except dns.exception.Timeout:
        return VerificationResult(
            email=email,
            valid=False,
            reason=f"DNS lookup timed out for {domain}"
        )
    except Exception as e:
        return VerificationResult(
            email=email,
            valid=False,
            reason=f"DNS error: {str(e)}"
        )

    if not mx_hosts:
        return VerificationResult(
            email=email,
            valid=False,
            reason=f"No MX records found for {domain}"
        )

    # Step 2 & 3: Connect to SMTP and verify
    last_error = None
    for mx_host in mx_hosts[:3]:  # Try top 3 MX servers
        try:
            result = _check_smtp(
                email=email,
                mx_host=mx_host,
                from_address=from_address,
                timeout=smtp_timeout,
            )
            if result is not None:
                return result
        except Exception as e:
            last_error = str(e)
            logger.debug(f"SMTP check failed for {mx_host}: {e}")
            continue

    # All MX servers failed
    return VerificationResult(
        email=email,
        valid=False,
        reason=f"Could not connect to any mail server: {last_error}"
    )


def _check_smtp(
    email: str,
    mx_host: str,
    from_address: str,
    timeout: float,
) -> Optional[VerificationResult]:
    """Check email via SMTP connection.

    Returns:
        VerificationResult if conclusive, None if should try next MX
    """
    domain = email.rsplit("@", 1)[1]

    try:
        smtp = smtplib.SMTP(timeout=timeout)
        smtp.connect(mx_host, 25)
        smtp.helo(SMTP_HELO_DOMAIN)

        # Some servers require MAIL FROM before RCPT TO
        smtp.mail(from_address)

        # The key check: RCPT TO
        code, message = smtp.rcpt(email)

        smtp.quit()

        if code == SMTP_OK:
            return VerificationResult(
                email=email,
                valid=True,
                reason="Mailbox exists",
                smtp_code=code,
                mx_host=mx_host,
            )
        elif code == SMTP_USER_NOT_LOCAL:
            # Will forward, consider valid
            return VerificationResult(
                email=email,
                valid=True,
                reason="User will be forwarded",
                smtp_code=code,
                mx_host=mx_host,
            )
        elif code == SMTP_CANNOT_VERIFY:
            # Server can't verify - common anti-enumeration
            # Consider as "possible" but not confirmed
            return VerificationResult(
                email=email,
                valid=True,  # Assume valid since we can't verify
                reason="Cannot verify (server doesn't confirm)",
                smtp_code=code,
                mx_host=mx_host,
            )
        elif code in (SMTP_MAILBOX_UNAVAILABLE, SMTP_USER_NOT_FOUND, SMTP_MAILBOX_NOT_FOUND):
            return VerificationResult(
                email=email,
                valid=False,
                reason=f"Mailbox does not exist: {message.decode('utf-8', errors='ignore')}",
                smtp_code=code,
                mx_host=mx_host,
            )
        else:
            # Other codes - treat as inconclusive
            return VerificationResult(
                email=email,
                valid=False,
                reason=f"SMTP returned code {code}",
                smtp_code=code,
                mx_host=mx_host,
            )

    except smtplib.SMTPServerDisconnected:
        # Server disconnected - might be rate limiting
        return None
    except smtplib.SMTPConnectError:
        # Connection failed - try next MX
        return None
    except socket.timeout:
        # Timeout - try next MX
        return None
    except socket.gaierror as e:
        # DNS resolution failed for MX host
        return None
    except Exception as e:
        logger.debug(f"SMTP error for {mx_host}: {e}")
        return None


def verify_emails_batch(
    emails: list[str],
    delay_between: float = 0.5,
    stop_on_valid: bool = True,
) -> list[VerificationResult]:
    """Verify multiple emails with rate limiting.

    Args:
        emails: List of email addresses to verify
        delay_between: Seconds to wait between checks (rate limiting)
        stop_on_valid: If True, stop checking after first valid email found

    Returns:
        List of VerificationResults for checked emails
    """
    results = []

    for i, email in enumerate(emails):
        if i > 0 and delay_between > 0:
            time.sleep(delay_between)

        result = verify_email(email)
        results.append(result)

        if stop_on_valid and result.valid:
            break

    return results


def check_domain_accepts_all(domain: str) -> bool:
    """Check if a domain accepts all email addresses (catch-all).

    Tests by trying a random/unlikely address.

    Args:
        domain: Email domain to test

    Returns:
        True if domain appears to accept all addresses
    """
    import uuid
    random_local = f"nonexistent-test-{uuid.uuid4().hex[:8]}"
    test_email = f"{random_local}@{domain}"

    result = verify_email(test_email)
    return result.valid
