#!/usr/bin/env python3
"""Interview Question Scraper CLI.

A command-line interface for running interview question scrapers.

Usage:
    python cli.py run-all              # Run all scrapers
    python cli.py run devto reddit     # Run specific scrapers
    python cli.py list                 # List available scrapers
    python cli.py status               # Show last run times
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Force UTF-8 stdout/stderr so the ✓/✗/emoji status output doesn't crash on
# Windows consoles (cp1252). No-op where already UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Load .env file
def load_env():
    """Load environment variables from .env file."""
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)

    # Also check parent directory
    parent_env = Path(__file__).parent.parent / '.env.local'
    if parent_env.exists():
        with open(parent_env) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)


# Load env before imports that need it
load_env()

from interview_orchestrator import (
    InterviewQuestionOrchestrator,
    run_all_scrapers,
    run_single,
    run_daily,
    run_weekly,
)


def get_scraper_list() -> list[dict]:
    """Get list of available scrapers with metadata."""
    scrapers = []
    for s in InterviewQuestionOrchestrator.SCRAPERS:
        scrapers.append({
            'name': s.name,
            'source': s.source,
            'priority': s.priority,
            'schedule': s.schedule,
            'enabled': s.enabled,
        })
    return scrapers


def format_duration(seconds: float) -> str:
    """Format duration in human-readable format."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        mins = seconds / 60
        return f"{mins:.1f}m"
    else:
        hours = seconds / 3600
        return f"{hours:.1f}h"


def format_time_ago(dt: datetime) -> str:
    """Format datetime as time ago."""
    if dt is None:
        return "never"

    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    diff = now - dt
    seconds = diff.total_seconds()

    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        return f"{int(seconds/60)}m ago"
    elif seconds < 86400:
        return f"{int(seconds/3600)}h ago"
    else:
        return f"{int(seconds/86400)}d ago"


def cmd_list(args):
    """List available scrapers."""
    scrapers = get_scraper_list()

    print("\n" + "=" * 70)
    print("AVAILABLE INTERVIEW QUESTION SCRAPERS")
    print("=" * 70)
    print(f"{'NAME':<20} {'SOURCE':<15} {'PRIORITY':<10} {'SCHEDULE':<10} {'STATUS'}")
    print("-" * 70)

    for s in sorted(scrapers, key=lambda x: x['priority']):
        status = "✓ enabled" if s['enabled'] else "✗ disabled"
        tier = f"Tier {s['priority']}"
        print(f"{s['name']:<20} {s['source']:<15} {tier:<10} {s['schedule']:<10} {status}")

    print("-" * 70)
    print(f"Total: {len(scrapers)} scrapers")
    print("=" * 70 + "\n")


def cmd_status(args):
    """Show last run times for each scraper."""
    try:
        from supabase import create_client
        from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

        # Fetch last scraped times from interview_sources table
        response = supabase.table('interview_sources').select('*').execute()
        sources = {s['source_name']: s for s in response.data} if response.data else {}

        print("\n" + "=" * 80)
        print("SCRAPER STATUS")
        print("=" * 80)
        print(f"{'NAME':<20} {'LAST RUN':<15} {'QUESTIONS':<12} {'STATUS':<15} {'ERRORS'}")
        print("-" * 80)

        scrapers = get_scraper_list()
        for s in sorted(scrapers, key=lambda x: x['name']):
            source_info = sources.get(s['name'], {})

            last_scraped = source_info.get('last_scraped_at')
            if last_scraped:
                if isinstance(last_scraped, str):
                    last_scraped = datetime.fromisoformat(last_scraped.replace('Z', '+00:00'))
                last_run = format_time_ago(last_scraped)
            else:
                last_run = "never"

            questions = source_info.get('total_questions', 0)
            questions_str = str(questions) if questions else "-"

            is_healthy = source_info.get('is_healthy', True)
            status = "✓ healthy" if is_healthy else "✗ unhealthy"

            error_count = source_info.get('consecutive_errors', 0)
            errors = str(error_count) if error_count > 0 else "-"

            print(f"{s['name']:<20} {last_run:<15} {questions_str:<12} {status:<15} {errors}")

        print("-" * 80)
        print("=" * 80 + "\n")

    except Exception as e:
        print(f"\n⚠️  Could not fetch status from database: {e}")
        print("Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set.\n")
        sys.exit(1)


def cmd_run_all(args):
    """Run all scrapers."""
    print("\n🚀 Running all interview question scrapers...")
    print(f"   Months back: {args.months}")
    print(f"   Dry run: {args.dry_run}")
    print()

    stats = asyncio.run(run_all_scrapers(
        months_back=args.months,
        dry_run=args.dry_run,
        exclude_sources=args.exclude,
    ))

    print_stats(stats)
    # Only fail the whole run on a genuine outage — when NOTHING succeeded. Each
    # scraper saves independently, so one flaky source (e.g. a site that times
    # out) shouldn't mark the daily cron red while the others still added
    # thousands of questions; that just trains us to ignore real failures. The
    # per-scraper failures remain visible in the logs and summary.
    if stats.scrapers_completed == 0 and stats.scrapers_failed > 0:
        print(f"::error::All {stats.scrapers_failed} scrapers failed — treating as outage")
        sys.exit(1)
    if stats.scrapers_failed:
        print(f"::warning::{stats.scrapers_failed} scraper(s) failed but "
              f"{stats.scrapers_completed} succeeded ({stats.questions_new_total} new questions); run stays green")


def cmd_run(args):
    """Run specific scrapers."""
    if not args.sources:
        print("❌ Error: Please specify at least one scraper to run.")
        print("   Use 'python cli.py list' to see available scrapers.")
        sys.exit(1)

    # Validate scraper names
    valid_names = {s.name for s in InterviewQuestionOrchestrator.SCRAPERS}
    invalid = set(args.sources) - valid_names
    if invalid:
        print(f"❌ Error: Unknown scraper(s): {', '.join(invalid)}")
        print("   Use 'python cli.py list' to see available scrapers.")
        sys.exit(1)

    print(f"\n🚀 Running scrapers: {', '.join(args.sources)}")
    print(f"   Months back: {args.months}")
    print(f"   Dry run: {args.dry_run}")
    print()

    stats = asyncio.run(run_all_scrapers(
        months_back=args.months,
        dry_run=args.dry_run,
        only_sources=args.sources,
    ))

    print_stats(stats)
    if stats.scrapers_failed:
        sys.exit(1)


def print_stats(stats):
    """Print run statistics."""
    duration = 0
    if stats.end_time and stats.start_time:
        duration = (stats.end_time - stats.start_time).total_seconds()

    print("\n" + "=" * 60)
    print("RUN COMPLETE")
    print("=" * 60)
    print(f"  Run ID:     {stats.run_id}")
    print(f"  Duration:   {format_duration(duration)}")
    print(f"  Scrapers:   {stats.scrapers_completed}/{stats.scrapers_total} succeeded, "
          f"{stats.scrapers_failed} failed, {stats.scrapers_skipped} skipped")
    print(f"  Questions:  {stats.questions_new_total} new, "
          f"{stats.questions_updated_total} updated, "
          f"{stats.questions_found_total} total found")

    if stats.errors:
        print(f"\n⚠️  Errors ({len(stats.errors)}):")
        for err in stats.errors[:5]:
            print(f"    - {err[:80]}...")
        if len(stats.errors) > 5:
            print(f"    ... and {len(stats.errors) - 5} more")

    print("=" * 60 + "\n")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Interview Question Scraper CLI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cli.py list                    # List all available scrapers
  python cli.py status                  # Show last run times
  python cli.py run-all                 # Run all scrapers
  python cli.py run-all --months 2      # Run all, last 2 months only
  python cli.py run-all --dry-run       # Test without saving to DB
  python cli.py run devto reddit        # Run specific scrapers
  python cli.py run devto --months 1    # Run devto for last month

Environment Variables:
  SUPABASE_URL         Supabase project URL
  SUPABASE_SERVICE_KEY Supabase service role key
  GITHUB_TOKEN         GitHub API token (optional, higher rate limits)
  REDDIT_CLIENT_ID     Reddit API client ID (optional)
  REDDIT_CLIENT_SECRET Reddit API client secret (optional)
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # list command
    list_parser = subparsers.add_parser(
        'list',
        help='List available scrapers',
        description='Show all available interview question scrapers with their status.'
    )
    list_parser.set_defaults(func=cmd_list)

    # status command
    status_parser = subparsers.add_parser(
        'status',
        help='Show scraper run status',
        description='Show last run times and health status for each scraper.'
    )
    status_parser.set_defaults(func=cmd_status)

    # run-all command
    run_all_parser = subparsers.add_parser(
        'run-all',
        help='Run all scrapers',
        description='Run all enabled interview question scrapers.'
    )
    run_all_parser.add_argument(
        '--months', '-m',
        type=int,
        default=5,
        help='Number of months of historical data to fetch (default: 5)'
    )
    run_all_parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run without saving to database'
    )
    run_all_parser.add_argument(
        '--exclude',
        nargs='+',
        metavar='SCRAPER',
        help='Exclude these scrapers from the run'
    )
    run_all_parser.set_defaults(func=cmd_run_all)

    # run command
    run_parser = subparsers.add_parser(
        'run',
        help='Run specific scrapers',
        description='Run one or more specific scrapers.'
    )
    run_parser.add_argument(
        'sources',
        nargs='*',
        metavar='SCRAPER',
        help='Names of scrapers to run (use "list" to see available)'
    )
    run_parser.add_argument(
        '--months', '-m',
        type=int,
        default=5,
        help='Number of months of historical data to fetch (default: 5)'
    )
    run_parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run without saving to database'
    )
    run_parser.set_defaults(func=cmd_run)

    # Parse and execute
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        if os.environ.get('DEBUG'):
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
