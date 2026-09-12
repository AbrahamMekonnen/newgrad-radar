"""Generate common email patterns from name and domain.

This module generates various email format patterns that companies typically use.
Common patterns include first.last, firstlast, f.last, first.l, flast, etc.
"""

import re


def normalize_name(name: str) -> str:
    """Normalize a name by removing special characters and converting to lowercase.

    Args:
        name: Raw name string

    Returns:
        Cleaned lowercase name with only alphabetic characters
    """
    # Remove accents/diacritics by keeping only ASCII letters
    cleaned = re.sub(r"[^a-zA-Z]", "", name)
    return cleaned.lower()


def parse_name(full_name: str) -> tuple[str, str]:
    """Parse a full name into first and last name components.

    Args:
        full_name: Full name string (e.g., "John Smith", "Mary Jane Watson")

    Returns:
        Tuple of (first_name, last_name), both normalized
    """
    parts = full_name.strip().split()

    if len(parts) == 0:
        return "", ""
    elif len(parts) == 1:
        return normalize_name(parts[0]), ""
    else:
        # First word is first name, last word is last name
        # Middle names are ignored for email patterns
        first = normalize_name(parts[0])
        last = normalize_name(parts[-1])
        return first, last


def generate_patterns(
    first_name: str,
    last_name: str,
    domain: str,
    include_numbers: bool = False,
) -> list[str]:
    """Generate common email patterns for a given name and domain.

    Args:
        first_name: First name (will be normalized)
        last_name: Last name (will be normalized)
        domain: Company domain (e.g., "stripe.com")
        include_numbers: If True, include patterns with common number suffixes

    Returns:
        List of potential email addresses to try
    """
    first = normalize_name(first_name)
    last = normalize_name(last_name)

    if not first or not last:
        return []

    # Get initials
    f_init = first[0]
    l_init = last[0]

    # Base patterns (ordered by commonality)
    patterns = [
        # Most common corporate patterns
        f"{first}.{last}",           # john.smith
        f"{first}{last}",            # johnsmith
        f"{first}_{last}",           # john_smith
        f"{f_init}{last}",           # jsmith
        f"{first}{l_init}",          # johns
        f"{first}.{l_init}",         # john.s
        f"{f_init}.{last}",          # j.smith
        f"{f_init}_{last}",          # j_smith

        # Last name first patterns
        f"{last}.{first}",           # smith.john
        f"{last}{first}",            # smithjohn
        f"{last}_{first}",           # smith_john
        f"{last}{f_init}",           # smithj
        f"{last}.{f_init}",          # smith.j
        f"{l_init}{first}",          # sjohn

        # First name only (common at smaller companies)
        first,                       # john

        # Hyphenated patterns
        f"{first}-{last}",           # john-smith
        f"{f_init}-{last}",          # j-smith
    ]

    # Add number variants if requested (for common names)
    if include_numbers:
        base_patterns = patterns.copy()
        for pattern in base_patterns[:5]:  # Only add numbers to most common patterns
            patterns.append(f"{pattern}1")
            patterns.append(f"{pattern}2")

    # Build full email addresses
    domain = domain.lower().strip()
    if not domain:
        return []

    return [f"{pattern}@{domain}" for pattern in patterns]


def generate_patterns_from_full_name(
    full_name: str,
    domain: str,
    include_numbers: bool = False,
) -> list[str]:
    """Generate email patterns from a full name string.

    Args:
        full_name: Full name (e.g., "John Smith")
        domain: Company domain
        include_numbers: If True, include patterns with number suffixes

    Returns:
        List of potential email addresses
    """
    first, last = parse_name(full_name)
    return generate_patterns(first, last, domain, include_numbers)


# Mapping of common company slugs to their email domains
# This helps when domain isn't provided
COMPANY_DOMAINS = {
    "meta": "meta.com",
    "apple": "apple.com",
    "amazon": "amazon.com",
    "netflix": "netflix.com",
    "google": "google.com",
    "microsoft": "microsoft.com",
    "nvidia": "nvidia.com",
    "anthropic": "anthropic.com",
    "openai": "openai.com",
    "stripe": "stripe.com",
    "databricks": "databricks.com",
    "figma": "figma.com",
    "notion": "notion.so",
    "canva": "canva.com",
    "discord": "discord.com",
    "reddit": "reddit.com",
    "instacart": "instacart.com",
    "doordash": "doordash.com",
    "coinbase": "coinbase.com",
    "robinhood": "robinhood.com",
    "plaid": "plaid.com",
    "ramp": "ramp.com",
    "brex": "brex.com",
    "airtable": "airtable.com",
    "linear": "linear.app",
    "vercel": "vercel.com",
    "supabase": "supabase.io",
    "retool": "retool.com",
    "airbnb": "airbnb.com",
    "dropbox": "dropbox.com",
    "gusto": "gusto.com",
    "affirm": "affirm.com",
    "chime": "chime.com",
    "hashicorp": "hashicorp.com",
    "mongodb": "mongodb.com",
    "cloudflare": "cloudflare.com",
    "datadog": "datadoghq.com",
    "palantir": "palantir.com",
}


def get_domain_for_company(company_slug: str) -> str | None:
    """Get the email domain for a known company.

    Args:
        company_slug: Company slug from companies.py

    Returns:
        Email domain if known, None otherwise
    """
    return COMPANY_DOMAINS.get(company_slug.lower())
