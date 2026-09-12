"""Recruiter email enrichment orchestrator.

This module orchestrates finding recruiter emails by:
1. Taking recruiter names and company info
2. Generating email patterns
3. Verifying emails via SMTP
4. Returning verified recruiter data
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from .email_patterns import (
    generate_patterns_from_full_name,
    get_domain_for_company,
)
from .smtp_verify import (
    verify_emails_batch,
    check_domain_accepts_all,
    VerificationResult,
)

logger = logging.getLogger(__name__)


@dataclass
class RecruiterResult:
    """Result of recruiter email finding attempt."""
    name: str
    company_slug: str
    email: Optional[str] = None
    verified: bool = False
    verification_method: str = "none"
    patterns_tried: int = 0
    error: Optional[str] = None


@dataclass
class EnrichmentConfig:
    """Configuration for recruiter enrichment."""
    # SMTP verification settings
    smtp_timeout: float = 10.0
    dns_timeout: float = 5.0
    delay_between_checks: float = 0.5

    # Pattern generation
    include_number_variants: bool = False
    max_patterns_to_try: int = 10

    # Behavior
    skip_catch_all_domains: bool = True
    stop_on_first_valid: bool = True


def find_recruiter_email(
    recruiter_name: str,
    company_slug: str,
    company_domain: Optional[str] = None,
    config: Optional[EnrichmentConfig] = None,
) -> RecruiterResult:
    """Find a recruiter's email address.

    Args:
        recruiter_name: Full name of the recruiter
        company_slug: Company identifier
        company_domain: Company email domain (if not provided, will be looked up)
        config: Enrichment configuration

    Returns:
        RecruiterResult with email if found
    """
    if config is None:
        config = EnrichmentConfig()

    result = RecruiterResult(
        name=recruiter_name,
        company_slug=company_slug,
    )

    # Get domain
    domain = company_domain or get_domain_for_company(company_slug)
    if not domain:
        result.error = f"No domain found for company {company_slug}"
        logger.warning(result.error)
        return result

    # Check if domain is catch-all (accepts all emails)
    if config.skip_catch_all_domains:
        try:
            if check_domain_accepts_all(domain):
                result.error = f"Domain {domain} accepts all emails (catch-all)"
                result.verification_method = "catch_all_skip"
                logger.info(f"Skipping catch-all domain: {domain}")
                return result
        except Exception as e:
            logger.debug(f"Catch-all check failed for {domain}: {e}")
            # Continue anyway

    # Generate email patterns
    patterns = generate_patterns_from_full_name(
        full_name=recruiter_name,
        domain=domain,
        include_numbers=config.include_number_variants,
    )

    if not patterns:
        result.error = "Could not generate email patterns from name"
        return result

    # Limit patterns to try
    patterns = patterns[:config.max_patterns_to_try]
    result.patterns_tried = len(patterns)

    logger.info(f"Trying {len(patterns)} patterns for {recruiter_name} @ {domain}")

    # Verify patterns via SMTP
    try:
        verification_results = verify_emails_batch(
            emails=patterns,
            delay_between=config.delay_between_checks,
            stop_on_valid=config.stop_on_first_valid,
        )
    except Exception as e:
        result.error = f"SMTP verification failed: {str(e)}"
        logger.error(result.error)
        return result

    # Find first valid email
    for vr in verification_results:
        if vr.valid:
            result.email = vr.email
            result.verified = True
            result.verification_method = "smtp"
            logger.info(f"Found valid email: {vr.email}")
            return result

    # No valid email found
    result.error = "No valid email pattern found"
    return result


def find_recruiters(
    company_slug: str,
    company_domain: Optional[str],
    recruiter_names: list[str],
    config: Optional[EnrichmentConfig] = None,
) -> list[RecruiterResult]:
    """Find emails for multiple recruiters at a company.

    Args:
        company_slug: Company identifier
        company_domain: Company email domain
        recruiter_names: List of recruiter names to find
        config: Enrichment configuration

    Returns:
        List of RecruiterResults
    """
    if config is None:
        config = EnrichmentConfig()

    results = []
    domain = company_domain or get_domain_for_company(company_slug)

    # Check catch-all once for the whole domain
    is_catch_all = False
    if config.skip_catch_all_domains and domain:
        try:
            is_catch_all = check_domain_accepts_all(domain)
            if is_catch_all:
                logger.info(f"Domain {domain} is catch-all, skipping verification")
        except Exception as e:
            logger.debug(f"Catch-all check failed: {e}")

    for name in recruiter_names:
        if is_catch_all:
            # For catch-all domains, generate first pattern but mark as unverified
            patterns = generate_patterns_from_full_name(name, domain)
            result = RecruiterResult(
                name=name,
                company_slug=company_slug,
                email=patterns[0] if patterns else None,
                verified=False,
                verification_method="catch_all_guess",
                patterns_tried=1 if patterns else 0,
            )
        else:
            result = find_recruiter_email(
                recruiter_name=name,
                company_slug=company_slug,
                company_domain=domain,
                config=config,
            )
        results.append(result)

        logger.info(
            f"Recruiter {name}: "
            f"{'found ' + result.email if result.email else 'not found'}"
        )

    return results


def enrich_jobs_with_recruiters(
    jobs: list[dict],
    recruiter_data: dict[str, list[str]],
    config: Optional[EnrichmentConfig] = None,
) -> list[dict]:
    """Enrich job listings with recruiter contact info.

    Args:
        jobs: List of job dicts from the scraper
        recruiter_data: Mapping of company_slug -> list of recruiter names
        config: Enrichment configuration

    Returns:
        Jobs list with added 'recruiters' field where available
    """
    if config is None:
        config = EnrichmentConfig()

    # Build recruiter lookup by company
    company_recruiters: dict[str, list[RecruiterResult]] = {}

    for company_slug, names in recruiter_data.items():
        if names:
            results = find_recruiters(
                company_slug=company_slug,
                company_domain=None,  # Will be looked up
                recruiter_names=names,
                config=config,
            )
            company_recruiters[company_slug] = results

    # Enrich jobs
    for job in jobs:
        slug = job.get("company_slug")
        if slug and slug in company_recruiters:
            recruiters = company_recruiters[slug]
            job["recruiters"] = [
                {
                    "name": r.name,
                    "email": r.email,
                    "verified": r.verified,
                }
                for r in recruiters
                if r.email  # Only include if we found an email
            ]

    return jobs
