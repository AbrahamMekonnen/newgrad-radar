#!/usr/bin/env python3
"""Weekly Funding Scan Script.

Scans for recently funded companies and identifies hot hiring opportunities.
Companies that raised in the last 90 days are likely actively hiring.

Can be run:
- Manually: python funding_scan.py
- Weekly via GitHub Actions: .github/workflows/funding_scan.yml
- As a cron job: 0 0 * * 0 python funding_scan.py

Output:
- Prints summary of funded companies
- Optionally saves to database
- Optionally notifies about new opportunities
"""

import os
import sys
import json
import argparse
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sources.funding_signals import (
    fetch_funding_signals,
    get_hot_hiring_companies,
    discover_career_page,
    FUNDED_COMPANY_CAREERS,
)

try:
    from db import get_supabase
    HAS_DB = True
except ImportError:
    HAS_DB = False


def save_funded_companies_to_db(companies: list[dict]) -> int:
    """Save funded companies to the database.

    Creates entries in a funding_signals table (if it exists).
    Returns count of new entries.
    """
    if not HAS_DB:
        print("Database not configured, skipping save")
        return 0

    try:
        supabase = get_supabase()
        if not supabase:
            print("Could not connect to database")
            return 0

        # Upsert funded companies
        new_count = 0
        for company in companies:
            try:
                # Check if company already exists
                result = supabase.table("funding_signals").select("id").eq(
                    "company_name", company["company_name"]
                ).execute()

                if not result.data:
                    # Insert new company
                    supabase.table("funding_signals").insert({
                        "company_name": company["company_name"],
                        "funding_amount": company.get("funding_amount"),
                        "round_type": company.get("round_type"),
                        "funding_date": company.get("funding_date"),
                        "source_url": company.get("source_url"),
                        "careers_url": company.get("careers_url"),
                        "ats_type": company.get("ats_type"),
                        "ats_token": company.get("ats_token"),
                        "is_growth_stage": company.get("is_growth_stage", False),
                        "created_at": datetime.now().isoformat(),
                    }).execute()
                    new_count += 1
                else:
                    # Update existing
                    supabase.table("funding_signals").update({
                        "funding_amount": company.get("funding_amount"),
                        "round_type": company.get("round_type"),
                        "funding_date": company.get("funding_date"),
                        "updated_at": datetime.now().isoformat(),
                    }).eq("company_name", company["company_name"]).execute()

            except Exception as e:
                print(f"Error saving {company['company_name']}: {e}")

        return new_count

    except Exception as e:
        print(f"Database error: {e}")
        return 0


def print_summary(companies: list[dict], verbose: bool = False) -> None:
    """Print a summary of funded companies."""
    print("\n" + "=" * 70)
    print("WEEKLY FUNDING SCAN RESULTS")
    print("=" * 70)
    print(f"Scan date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Total funded companies found: {len(companies)}")

    # Stats
    growth_stage = sum(1 for c in companies if c.get("is_growth_stage"))
    with_careers = sum(1 for c in companies if c.get("careers_url"))
    by_round = {}
    for c in companies:
        rt = c.get("round_type") or "Unknown"
        by_round[rt] = by_round.get(rt, 0) + 1

    print(f"\nBreakdown:")
    print(f"  - Growth stage (Series A-C): {growth_stage}")
    print(f"  - With known career pages: {with_careers}")

    print(f"\nBy round type:")
    for rt, count in sorted(by_round.items(), key=lambda x: -x[1]):
        print(f"  - {rt}: {count}")

    if verbose:
        print("\n" + "-" * 70)
        print("HOT HIRING OPPORTUNITIES (Recently Funded)")
        print("-" * 70)

        for i, company in enumerate(companies[:30], 1):
            print(f"\n{i}. {company['company_name']}")
            if company.get("funding_amount"):
                print(f"   Raised: {company['funding_amount']} ({company.get('round_type') or 'Unknown'})")
            if company.get("funding_date"):
                print(f"   Date: {company['funding_date'][:10]}")
            if company.get("careers_url"):
                print(f"   Careers: {company['careers_url']}")
                print(f"   ATS: {company.get('ats_type', 'Unknown')}")
            else:
                print("   Careers: Not mapped (discovery needed)")
            if company.get("source_url"):
                print(f"   Source: {company['source_url'][:60]}...")

    print("\n" + "=" * 70)


def export_to_json(companies: list[dict], output_file: str) -> None:
    """Export companies to JSON file."""
    with open(output_file, "w") as f:
        json.dump({
            "scan_date": datetime.now().isoformat(),
            "total_count": len(companies),
            "companies": companies,
        }, f, indent=2, default=str)
    print(f"Exported to {output_file}")


def discover_missing_careers(companies: list[dict], max_discover: int = 10) -> list[dict]:
    """Try to discover career pages for companies without mappings."""
    print(f"\nDiscovering career pages for unmapped companies (max {max_discover})...")

    discovered = 0
    for company in companies:
        if company.get("careers_url"):
            continue

        if discovered >= max_discover:
            break

        print(f"  Checking {company['company_name']}...", end=" ", flush=True)
        career_url = discover_career_page(company["company_name"])

        if career_url:
            company["careers_url"] = career_url
            # Detect ATS type from URL
            if "greenhouse" in career_url:
                company["ats_type"] = "greenhouse"
            elif "lever" in career_url:
                company["ats_type"] = "lever"
            elif "ashby" in career_url:
                company["ats_type"] = "ashby"
            print(f"Found: {career_url}")
            discovered += 1
        else:
            print("Not found")

    print(f"Discovered {discovered} new career pages")
    return companies


def main():
    parser = argparse.ArgumentParser(
        description="Weekly funding scan - find hot hiring opportunities"
    )
    parser.add_argument(
        "--days", type=int, default=90,
        help="Look back N days for funding (default: 90)"
    )
    parser.add_argument(
        "--all-stages", action="store_true",
        help="Include all funding stages, not just Series A-C"
    )
    parser.add_argument(
        "--discover", action="store_true",
        help="Try to discover career pages for unmapped companies"
    )
    parser.add_argument(
        "--max-discover", type=int, default=10,
        help="Max companies to discover career pages for (default: 10)"
    )
    parser.add_argument(
        "--save-db", action="store_true",
        help="Save results to database"
    )
    parser.add_argument(
        "--output", "-o", type=str,
        help="Export to JSON file"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Print detailed company list"
    )
    parser.add_argument(
        "--hot-only", action="store_true",
        help="Only show companies we can actually scrape (have career URLs)"
    )

    args = parser.parse_args()

    # Run the scan
    print("Starting weekly funding scan...")
    print(f"Looking back {args.days} days")
    print(f"Growth stage only: {not args.all_stages}")

    companies = fetch_funding_signals(
        days=args.days,
        growth_stage_only=not args.all_stages,
    )

    # Discover missing career pages
    if args.discover:
        companies = discover_missing_careers(companies, args.max_discover)

    # Filter to hot only
    if args.hot_only:
        companies = [c for c in companies if c.get("careers_url")]
        print(f"\nFiltered to {len(companies)} scrapeable companies")

    # Print summary
    print_summary(companies, verbose=args.verbose)

    # Save to DB
    if args.save_db:
        new_count = save_funded_companies_to_db(companies)
        print(f"\nSaved to database: {new_count} new entries")

    # Export to JSON
    if args.output:
        export_to_json(companies, args.output)

    # Return count for CI/CD checks
    return len(companies)


if __name__ == "__main__":
    count = main()
    sys.exit(0 if count > 0 else 1)
