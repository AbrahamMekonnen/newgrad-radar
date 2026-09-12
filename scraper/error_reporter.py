"""Error tracking and reporting for the scraper pipeline.

Collects errors during scraping and reports them via:
1. Console output (always)
2. GitHub Actions summary (if running in CI)
3. Email notification (optional, for critical errors)
4. Supabase log table (for dashboard monitoring)
"""

import os
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class SourceError:
    """Represents an error from a job source."""
    source: str
    error_type: str
    message: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_critical: bool = False  # Critical = entire source unavailable


@dataclass
class ScraperReport:
    """Summary report of a scraper run."""
    start_time: str
    end_time: str = ""
    sources_succeeded: list[str] = field(default_factory=list)
    sources_failed: list[str] = field(default_factory=list)
    sources_skipped: list[str] = field(default_factory=list)
    errors: list[SourceError] = field(default_factory=list)
    jobs_found: int = 0
    jobs_new: int = 0
    jobs_updated: int = 0


class ErrorReporter:
    """Collects and reports errors from the scraper pipeline."""

    def __init__(self):
        self.errors: list[SourceError] = []
        self.succeeded: list[str] = []
        self.skipped: list[str] = []
        self.start_time = datetime.now(timezone.utc).isoformat()

    def add_error(self, source: str, error: Exception, is_critical: bool = False):
        """Record an error from a source."""
        self.errors.append(SourceError(
            source=source,
            error_type=type(error).__name__,
            message=str(error)[:500],  # Truncate long messages
            is_critical=is_critical,
        ))

    def add_success(self, source: str):
        """Record a successful source fetch."""
        self.succeeded.append(source)

    def add_skip(self, source: str, reason: str = ""):
        """Record a skipped source (e.g., missing API key)."""
        self.skipped.append(source)
        # Also add as non-critical error for visibility
        self.errors.append(SourceError(
            source=source,
            error_type="Skipped",
            message=reason or "Source skipped (missing configuration)",
            is_critical=False,
        ))

    def has_errors(self) -> bool:
        """Check if any errors occurred."""
        return len(self.errors) > 0

    def has_critical_errors(self) -> bool:
        """Check if any critical errors occurred."""
        return any(e.is_critical for e in self.errors)

    def get_failed_sources(self) -> list[str]:
        """Get list of sources that failed (not just skipped)."""
        return [e.source for e in self.errors if e.error_type != "Skipped"]

    def print_summary(self):
        """Print error summary to console."""
        if not self.errors:
            print("\n[OK] All sources completed successfully")
            return

        print("\n" + "=" * 40)
        print("ERROR SUMMARY")
        print("=" * 40)

        # Group by severity
        critical = [e for e in self.errors if e.is_critical]
        skipped = [e for e in self.errors if e.error_type == "Skipped"]
        warnings = [e for e in self.errors if not e.is_critical and e.error_type != "Skipped"]

        if critical:
            print(f"\n[CRITICAL] {len(critical)} source(s) completely failed:")
            for e in critical:
                print(f"  - {e.source}: {e.error_type}: {e.message[:100]}")

        if warnings:
            print(f"\n[WARNING] {len(warnings)} source(s) had errors:")
            for e in warnings:
                print(f"  - {e.source}: {e.error_type}: {e.message[:100]}")

        if skipped:
            print(f"\n[SKIPPED] {len(skipped)} source(s) skipped:")
            for e in skipped:
                print(f"  - {e.source}: {e.message[:100]}")

        print(f"\nSuccessful sources: {len(self.succeeded)}")
        print(f"Failed/skipped: {len(self.errors)}")

    def write_github_summary(self):
        """Write summary to GitHub Actions step summary."""
        summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
        if not summary_file:
            return  # Not running in GitHub Actions

        try:
            with open(summary_file, "a") as f:
                f.write("\n## Scraper Run Summary\n\n")

                if not self.errors:
                    f.write("All sources completed successfully.\n\n")
                else:
                    # Errors table
                    f.write("### Errors\n\n")
                    f.write("| Source | Type | Message |\n")
                    f.write("|--------|------|----------|\n")
                    for e in self.errors:
                        msg = e.message[:80].replace("|", "\\|")
                        severity = "CRITICAL" if e.is_critical else ("SKIP" if e.error_type == "Skipped" else "WARN")
                        f.write(f"| {e.source} | {severity} | {msg} |\n")
                    f.write("\n")

                # Stats
                f.write("### Stats\n\n")
                f.write(f"- Successful: {len(self.succeeded)}\n")
                f.write(f"- Failed: {len(self.get_failed_sources())}\n")
                f.write(f"- Skipped: {len(self.skipped)}\n")

        except Exception as e:
            print(f"Could not write GitHub summary: {e}")

    def save_to_supabase(self, dry_run: bool = False):
        """Save error log to Supabase for dashboard monitoring."""
        if dry_run or not self.errors:
            return

        try:
            from db import get_client
            client = get_client()

            # Create run log entry
            log_entry = {
                "run_time": self.start_time,
                "sources_succeeded": self.succeeded,
                "sources_failed": self.get_failed_sources(),
                "sources_skipped": self.skipped,
                "error_count": len(self.errors),
                "errors": [
                    {
                        "source": e.source,
                        "type": e.error_type,
                        "message": e.message[:200],
                        "critical": e.is_critical,
                    }
                    for e in self.errors
                ],
            }

            # Insert to scraper_logs table (create if not exists)
            client.table("scraper_logs").insert(log_entry).execute()

        except Exception as e:
            print(f"Could not save to Supabase: {e}")

    def send_alert_if_critical(self, dry_run: bool = False):
        """Send notification if critical errors occurred."""
        if not self.has_critical_errors() or dry_run:
            return

        try:
            from notify import send_ntfy

            # Get admin topic from env
            admin_topic = os.environ.get("ADMIN_NTFY_TOPIC")
            if not admin_topic:
                return

            critical_sources = [e.source for e in self.errors if e.is_critical]

            send_ntfy(
                topic=admin_topic,
                title="Scraper Alert: Sources Failed",
                message=f"Critical failures: {', '.join(critical_sources)}",
                priority="high",
                tags=["warning", "scraper"],
            )

        except Exception as e:
            print(f"Could not send alert: {e}")

    def report(self, dry_run: bool = False):
        """Generate all reports."""
        self.print_summary()
        self.write_github_summary()
        self.save_to_supabase(dry_run)
        self.send_alert_if_critical(dry_run)


# Global reporter instance
_reporter: Optional[ErrorReporter] = None


def get_reporter() -> ErrorReporter:
    """Get or create the global error reporter."""
    global _reporter
    if _reporter is None:
        _reporter = ErrorReporter()
    return _reporter


def reset_reporter():
    """Reset the global reporter (for testing)."""
    global _reporter
    _reporter = None
