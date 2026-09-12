"""Source health monitoring for job scrapers.

Tracks success/failure rates, scrape duration, and job counts per source.
Alerts when sources fail consistently.
"""

import json
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Callable, Any, Optional


# Default paths for health data
DEFAULT_HEALTH_FILE = Path(__file__).parent / "health_data.json"
DEFAULT_DASHBOARD_FILE = Path(__file__).parent / "dashboard.json"


@dataclass
class SourceMetrics:
    """Metrics for a single source."""
    name: str
    total_runs: int = 0
    successful_runs: int = 0
    failed_runs: int = 0
    consecutive_failures: int = 0
    total_jobs_found: int = 0
    last_job_count: int = 0
    total_duration_ms: float = 0.0
    last_duration_ms: float = 0.0
    last_run: Optional[str] = None
    last_success: Optional[str] = None
    last_failure: Optional[str] = None
    last_error: Optional[str] = None

    @property
    def success_rate(self) -> float:
        """Calculate success rate as percentage."""
        if self.total_runs == 0:
            return 0.0
        return (self.successful_runs / self.total_runs) * 100

    @property
    def avg_duration_ms(self) -> float:
        """Calculate average duration in milliseconds."""
        if self.successful_runs == 0:
            return 0.0
        return self.total_duration_ms / self.successful_runs

    @property
    def avg_jobs_per_run(self) -> float:
        """Calculate average jobs found per successful run."""
        if self.successful_runs == 0:
            return 0.0
        return self.total_jobs_found / self.successful_runs

    @property
    def is_healthy(self) -> bool:
        """Check if source is healthy (not failing consistently)."""
        return self.consecutive_failures < 3

    @property
    def status(self) -> str:
        """Get health status string."""
        if self.consecutive_failures >= 5:
            return "critical"
        elif self.consecutive_failures >= 3:
            return "warning"
        elif self.total_runs == 0:
            return "unknown"
        else:
            return "healthy"

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            **asdict(self),
            "success_rate": round(self.success_rate, 2),
            "avg_duration_ms": round(self.avg_duration_ms, 2),
            "avg_jobs_per_run": round(self.avg_jobs_per_run, 2),
            "status": self.status,
        }


class SourceHealthMonitor:
    """Monitor health of job scraping sources."""

    def __init__(
        self,
        health_file: Path = DEFAULT_HEALTH_FILE,
        dashboard_file: Path = DEFAULT_DASHBOARD_FILE,
        alert_threshold: int = 3,
    ):
        """Initialize the health monitor.

        Args:
            health_file: Path to store health data JSON
            dashboard_file: Path to write dashboard JSON
            alert_threshold: Number of consecutive failures before alerting
        """
        self.health_file = Path(health_file)
        self.dashboard_file = Path(dashboard_file)
        self.alert_threshold = alert_threshold
        self.sources: dict[str, SourceMetrics] = {}
        self._alerts: list[dict] = []
        self._load_health_data()

    def _load_health_data(self) -> None:
        """Load existing health data from disk."""
        if self.health_file.exists():
            try:
                with open(self.health_file, "r") as f:
                    data = json.load(f)
                for name, metrics in data.get("sources", {}).items():
                    self.sources[name] = SourceMetrics(
                        name=name,
                        total_runs=metrics.get("total_runs", 0),
                        successful_runs=metrics.get("successful_runs", 0),
                        failed_runs=metrics.get("failed_runs", 0),
                        consecutive_failures=metrics.get("consecutive_failures", 0),
                        total_jobs_found=metrics.get("total_jobs_found", 0),
                        last_job_count=metrics.get("last_job_count", 0),
                        total_duration_ms=metrics.get("total_duration_ms", 0.0),
                        last_duration_ms=metrics.get("last_duration_ms", 0.0),
                        last_run=metrics.get("last_run"),
                        last_success=metrics.get("last_success"),
                        last_failure=metrics.get("last_failure"),
                        last_error=metrics.get("last_error"),
                    )
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load health data: {e}")

    def _save_health_data(self) -> None:
        """Save health data to disk."""
        data = {
            "sources": {
                name: metrics.to_dict()
                for name, metrics in self.sources.items()
            },
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        try:
            self.health_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.health_file, "w") as f:
                json.dump(data, f, indent=2)
        except IOError as e:
            print(f"Warning: Could not save health data: {e}")

    def _get_or_create_source(self, name: str) -> SourceMetrics:
        """Get existing source metrics or create new one."""
        if name not in self.sources:
            self.sources[name] = SourceMetrics(name=name)
        return self.sources[name]

    def record_success(
        self,
        source_name: str,
        job_count: int,
        duration_ms: float,
    ) -> None:
        """Record a successful scrape run.

        Args:
            source_name: Name of the source
            job_count: Number of jobs found
            duration_ms: Duration of scrape in milliseconds
        """
        metrics = self._get_or_create_source(source_name)
        now = datetime.now(timezone.utc).isoformat()

        metrics.total_runs += 1
        metrics.successful_runs += 1
        metrics.consecutive_failures = 0  # Reset on success
        metrics.total_jobs_found += job_count
        metrics.last_job_count = job_count
        metrics.total_duration_ms += duration_ms
        metrics.last_duration_ms = duration_ms
        metrics.last_run = now
        metrics.last_success = now

        self._save_health_data()

    def record_failure(
        self,
        source_name: str,
        error: str,
        duration_ms: float = 0.0,
    ) -> bool:
        """Record a failed scrape run.

        Args:
            source_name: Name of the source
            error: Error message
            duration_ms: Duration before failure

        Returns:
            True if this failure triggered an alert
        """
        metrics = self._get_or_create_source(source_name)
        now = datetime.now(timezone.utc).isoformat()

        metrics.total_runs += 1
        metrics.failed_runs += 1
        metrics.consecutive_failures += 1
        metrics.last_run = now
        metrics.last_failure = now
        metrics.last_error = error[:500]  # Truncate long errors

        triggered_alert = False
        if metrics.consecutive_failures == self.alert_threshold:
            self._trigger_alert(source_name, metrics)
            triggered_alert = True

        self._save_health_data()
        return triggered_alert

    def _trigger_alert(self, source_name: str, metrics: SourceMetrics) -> None:
        """Trigger an alert for a failing source."""
        alert = {
            "source": source_name,
            "type": "consecutive_failures",
            "failures": metrics.consecutive_failures,
            "last_error": metrics.last_error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._alerts.append(alert)

        # Print alert to console
        print(f"\n{'='*60}")
        print(f"ALERT: Source '{source_name}' has failed {metrics.consecutive_failures} times!")
        print(f"Last error: {metrics.last_error}")
        print(f"{'='*60}\n")

    def get_alerts(self) -> list[dict]:
        """Get list of triggered alerts."""
        return self._alerts.copy()

    def clear_alerts(self) -> None:
        """Clear all alerts."""
        self._alerts.clear()

    def get_source_status(self, source_name: str) -> dict:
        """Get current status of a source."""
        if source_name not in self.sources:
            return {"name": source_name, "status": "unknown"}
        return self.sources[source_name].to_dict()

    def get_all_sources(self) -> list[dict]:
        """Get status of all sources."""
        return [m.to_dict() for m in self.sources.values()]

    def get_unhealthy_sources(self) -> list[dict]:
        """Get list of unhealthy sources."""
        return [
            m.to_dict() for m in self.sources.values()
            if not m.is_healthy
        ]

    def get_summary(self) -> dict:
        """Get overall health summary."""
        total_sources = len(self.sources)
        healthy_count = sum(1 for m in self.sources.values() if m.is_healthy)
        warning_count = sum(
            1 for m in self.sources.values()
            if 3 <= m.consecutive_failures < 5
        )
        critical_count = sum(
            1 for m in self.sources.values()
            if m.consecutive_failures >= 5
        )

        total_jobs = sum(m.total_jobs_found for m in self.sources.values())
        total_runs = sum(m.total_runs for m in self.sources.values())
        total_failures = sum(m.failed_runs for m in self.sources.values())

        return {
            "total_sources": total_sources,
            "healthy": healthy_count,
            "warning": warning_count,
            "critical": critical_count,
            "overall_status": (
                "critical" if critical_count > 0 else
                "warning" if warning_count > 0 else
                "healthy"
            ),
            "total_jobs_scraped": total_jobs,
            "total_runs": total_runs,
            "total_failures": total_failures,
            "overall_success_rate": (
                round((total_runs - total_failures) / total_runs * 100, 2)
                if total_runs > 0 else 0.0
            ),
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }

    def write_dashboard(self) -> None:
        """Write dashboard JSON file."""
        dashboard_data = {
            "summary": self.get_summary(),
            "sources": sorted(
                self.get_all_sources(),
                key=lambda x: (
                    0 if x["status"] == "critical" else
                    1 if x["status"] == "warning" else 2,
                    -x.get("total_runs", 0)
                )
            ),
            "alerts": self._alerts[-10:],  # Last 10 alerts
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            self.dashboard_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.dashboard_file, "w") as f:
                json.dump(dashboard_data, f, indent=2)
        except IOError as e:
            print(f"Warning: Could not write dashboard: {e}")

    def reset_source(self, source_name: str) -> None:
        """Reset metrics for a source (after fixing issues)."""
        if source_name in self.sources:
            self.sources[source_name] = SourceMetrics(name=source_name)
            self._save_health_data()


# Global monitor instance
_monitor: Optional[SourceHealthMonitor] = None


def get_monitor() -> SourceHealthMonitor:
    """Get the global monitor instance."""
    global _monitor
    if _monitor is None:
        _monitor = SourceHealthMonitor()
    return _monitor


def track_source(source_name: str):
    """Decorator to track source health for a fetch function.

    Usage:
        @track_source("simplify")
        def fetch_simplify() -> list[dict]:
            ...
    """
    def decorator(func: Callable[..., list[dict]]) -> Callable[..., list[dict]]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> list[dict]:
            monitor = get_monitor()
            start_time = time.time()

            try:
                jobs = func(*args, **kwargs)
                duration_ms = (time.time() - start_time) * 1000
                monitor.record_success(source_name, len(jobs), duration_ms)
                return jobs
            except Exception as e:
                duration_ms = (time.time() - start_time) * 1000
                monitor.record_failure(source_name, str(e), duration_ms)
                raise

        return wrapper
    return decorator


def track_scrape(
    source_name: str,
    jobs: list[dict],
    duration_ms: float,
    error: Optional[str] = None,
) -> bool:
    """Manually track a scrape result.

    Args:
        source_name: Name of the source
        jobs: List of jobs found (empty if failed)
        duration_ms: Duration of scrape
        error: Error message if failed

    Returns:
        True if an alert was triggered
    """
    monitor = get_monitor()

    if error:
        return monitor.record_failure(source_name, error, duration_ms)
    else:
        monitor.record_success(source_name, len(jobs), duration_ms)
        return False


def print_health_report() -> None:
    """Print a health report to console."""
    monitor = get_monitor()
    summary = monitor.get_summary()

    print("\n" + "=" * 60)
    print("SOURCE HEALTH REPORT")
    print("=" * 60)
    print(f"Overall Status: {summary['overall_status'].upper()}")
    print(f"Sources: {summary['healthy']}/{summary['total_sources']} healthy")
    print(f"Total Jobs Scraped: {summary['total_jobs_scraped']:,}")
    print(f"Success Rate: {summary['overall_success_rate']}%")
    print()

    # Show unhealthy sources
    unhealthy = monitor.get_unhealthy_sources()
    if unhealthy:
        print("UNHEALTHY SOURCES:")
        for src in unhealthy:
            print(f"  - {src['name']}: {src['consecutive_failures']} consecutive failures")
            if src.get('last_error'):
                print(f"    Last error: {src['last_error'][:80]}...")
        print()

    # Show all sources
    print("ALL SOURCES:")
    for src in monitor.get_all_sources():
        status_icon = {
            "healthy": "[OK]",
            "warning": "[!]",
            "critical": "[X]",
            "unknown": "[?]",
        }.get(src["status"], "[?]")

        print(f"  {status_icon} {src['name']}: "
              f"{src['success_rate']}% success, "
              f"{src['total_jobs_found']} jobs, "
              f"avg {src['avg_duration_ms']:.0f}ms")

    print("=" * 60 + "\n")


if __name__ == "__main__":
    # Demo/test
    monitor = SourceHealthMonitor()

    # Simulate some runs
    monitor.record_success("simplify", job_count=150, duration_ms=2500)
    monitor.record_success("greenhouse", job_count=75, duration_ms=1800)
    monitor.record_failure("lever", error="Connection timeout")
    monitor.record_failure("lever", error="Connection timeout")
    monitor.record_failure("lever", error="Connection timeout")  # Should trigger alert

    # Print report
    print_health_report()

    # Write dashboard
    monitor.write_dashboard()
    print(f"Dashboard written to: {monitor.dashboard_file}")
