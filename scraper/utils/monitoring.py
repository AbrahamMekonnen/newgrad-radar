"""Scraper Monitoring System.

Comprehensive monitoring for interview question scrapers:
- Success/failure rates per source
- Questions extracted per run
- Duplicate rate tracking
- Latency metrics
- Cost tracking (API calls, proxy usage)
- Anomaly detection and alerting
- Dashboard data export (JSON/Prometheus)
"""

import json
import logging
import os
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger('scraper_monitoring')


class AlertSeverity(Enum):
    INFO = 'info'
    WARNING = 'warning'
    ERROR = 'error'
    CRITICAL = 'critical'


class MetricType(Enum):
    COUNTER = 'counter'
    GAUGE = 'gauge'
    HISTOGRAM = 'histogram'
    SUMMARY = 'summary'


@dataclass
class ScraperMetrics:
    """Metrics for a single scraper run."""
    source: str
    run_id: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: float = 0.0
    success: bool = False
    error_message: Optional[str] = None

    questions_extracted: int = 0
    questions_new: int = 0
    questions_duplicate: int = 0
    questions_invalid: int = 0

    api_calls: int = 0
    api_cost_usd: float = 0.0
    requests_made: int = 0
    requests_failed: int = 0
    bytes_downloaded: int = 0

    proxy_requests: int = 0
    proxy_cost_usd: float = 0.0
    rate_limit_hits: int = 0
    retries: int = 0

    companies_found: int = 0
    roles_found: int = 0
    languages_translated: int = 0


@dataclass
class SourceHealth:
    """Health status for a scraper source."""
    source: str
    last_run: Optional[datetime] = None
    last_success: Optional[datetime] = None
    consecutive_failures: int = 0
    success_rate_7d: float = 0.0
    avg_questions_per_run: float = 0.0
    avg_duration_seconds: float = 0.0
    duplicate_rate: float = 0.0
    total_runs: int = 0
    total_questions: int = 0
    is_healthy: bool = True
    health_score: float = 100.0


@dataclass
class Alert:
    """Alert for anomaly detection."""
    id: str
    severity: AlertSeverity
    source: str
    title: str
    message: str
    metric_name: str
    metric_value: float
    threshold: float
    created_at: datetime
    acknowledged: bool = False


@dataclass
class CostEntry:
    """Cost tracking entry."""
    source: str
    run_id: str
    timestamp: datetime
    cost_type: str  # 'api', 'proxy', 'translation', 'storage'
    service: str  # 'gemini', 'groq', 'deepl', 'supabase'
    units: float  # API calls, requests, tokens, etc.
    cost_usd: float


class MetricsCollector:
    """Collects and stores scraper metrics."""

    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = Path(storage_path or os.environ.get(
            'SCRAPER_METRICS_PATH',
            str(Path(__file__).resolve().parent.parent / 'data' / 'metrics')
        ))
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self.current_runs: dict[str, ScraperMetrics] = {}
        self.metrics_history: list[ScraperMetrics] = []
        self._load_history()

    def _load_history(self):
        """Load historical metrics from storage."""
        history_file = self.storage_path / 'metrics_history.json'
        if history_file.exists():
            try:
                with open(history_file, 'r') as f:
                    data = json.load(f)
                    for entry in data[-1000:]:  # Keep last 1000 entries
                        entry['started_at'] = datetime.fromisoformat(entry['started_at'])
                        if entry.get('finished_at'):
                            entry['finished_at'] = datetime.fromisoformat(entry['finished_at'])
                        self.metrics_history.append(ScraperMetrics(**entry))
            except Exception as e:
                logger.warning(f"Failed to load metrics history: {e}")

    def _save_history(self):
        """Save metrics history to storage."""
        history_file = self.storage_path / 'metrics_history.json'
        try:
            data = []
            for m in self.metrics_history[-1000:]:
                entry = asdict(m)
                entry['started_at'] = m.started_at.isoformat()
                if m.finished_at:
                    entry['finished_at'] = m.finished_at.isoformat()
                data.append(entry)
            with open(history_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save metrics history: {e}")

    def start_run(self, source: str, run_id: str) -> ScraperMetrics:
        """Start tracking a scraper run."""
        metrics = ScraperMetrics(
            source=source,
            run_id=run_id,
            started_at=datetime.now(timezone.utc)
        )
        self.current_runs[run_id] = metrics
        logger.info(f"Started tracking run {run_id} for {source}")
        return metrics

    def end_run(self, run_id: str, success: bool = True, error: Optional[str] = None):
        """End tracking a scraper run."""
        if run_id not in self.current_runs:
            logger.warning(f"Unknown run_id: {run_id}")
            return

        metrics = self.current_runs[run_id]
        metrics.finished_at = datetime.now(timezone.utc)
        metrics.duration_seconds = (metrics.finished_at - metrics.started_at).total_seconds()
        metrics.success = success
        metrics.error_message = error

        self.metrics_history.append(metrics)
        del self.current_runs[run_id]
        self._save_history()

        logger.info(
            f"Finished run {run_id}: success={success}, "
            f"questions={metrics.questions_extracted}, "
            f"duration={metrics.duration_seconds:.1f}s"
        )

    def record_questions(self, run_id: str, extracted: int = 0, new: int = 0,
                        duplicate: int = 0, invalid: int = 0):
        """Record question extraction metrics."""
        if run_id in self.current_runs:
            m = self.current_runs[run_id]
            m.questions_extracted += extracted
            m.questions_new += new
            m.questions_duplicate += duplicate
            m.questions_invalid += invalid

    def record_api_call(self, run_id: str, service: str = 'unknown',
                       cost_usd: float = 0.0, tokens: int = 0):
        """Record an API call."""
        if run_id in self.current_runs:
            m = self.current_runs[run_id]
            m.api_calls += 1
            m.api_cost_usd += cost_usd

    def record_request(self, run_id: str, success: bool = True,
                      bytes_downloaded: int = 0, is_retry: bool = False):
        """Record an HTTP request."""
        if run_id in self.current_runs:
            m = self.current_runs[run_id]
            m.requests_made += 1
            if not success:
                m.requests_failed += 1
            if is_retry:
                m.retries += 1
            m.bytes_downloaded += bytes_downloaded

    def record_rate_limit(self, run_id: str):
        """Record a rate limit hit."""
        if run_id in self.current_runs:
            self.current_runs[run_id].rate_limit_hits += 1

    def record_proxy_request(self, run_id: str, cost_usd: float = 0.0):
        """Record a proxy request."""
        if run_id in self.current_runs:
            m = self.current_runs[run_id]
            m.proxy_requests += 1
            m.proxy_cost_usd += cost_usd

    def record_translation(self, run_id: str, count: int = 1):
        """Record translations performed."""
        if run_id in self.current_runs:
            self.current_runs[run_id].languages_translated += count

    def get_metrics(self, run_id: str) -> Optional[ScraperMetrics]:
        """Get metrics for a run."""
        return self.current_runs.get(run_id)

    def get_source_metrics(self, source: str, days: int = 7) -> list[ScraperMetrics]:
        """Get historical metrics for a source."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        return [
            m for m in self.metrics_history
            if m.source == source and m.started_at >= cutoff
        ]

    def export_prometheus(self) -> str:
        """Export metrics in Prometheus format."""
        lines = []
        lines.append("# HELP scraper_runs_total Total number of scraper runs")
        lines.append("# TYPE scraper_runs_total counter")

        by_source: dict[str, dict] = defaultdict(lambda: {
            'total': 0, 'success': 0, 'questions': 0, 'duration': []
        })

        for m in self.metrics_history:
            by_source[m.source]['total'] += 1
            if m.success:
                by_source[m.source]['success'] += 1
            by_source[m.source]['questions'] += m.questions_extracted
            by_source[m.source]['duration'].append(m.duration_seconds)

        for source, stats in by_source.items():
            lines.append(f'scraper_runs_total{{source="{source}"}} {stats["total"]}')
            lines.append(f'scraper_runs_success{{source="{source}"}} {stats["success"]}')
            lines.append(f'scraper_questions_total{{source="{source}"}} {stats["questions"]}')
            if stats['duration']:
                avg_dur = statistics.mean(stats['duration'])
                lines.append(f'scraper_duration_avg_seconds{{source="{source}"}} {avg_dur:.2f}')

        return '\n'.join(lines)

    def export_json(self) -> dict:
        """Export metrics as JSON."""
        return {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'current_runs': {
                run_id: asdict(m) for run_id, m in self.current_runs.items()
            },
            'history_count': len(self.metrics_history),
            'history_recent': [
                asdict(m) for m in self.metrics_history[-100:]
            ]
        }


class SourceHealthDashboard:
    """Tracks and reports on scraper source health."""

    def __init__(self, metrics_collector: MetricsCollector):
        self.metrics = metrics_collector
        self.health_cache: dict[str, SourceHealth] = {}
        self.health_thresholds = {
            'min_success_rate': 0.7,  # 70% success rate
            'max_consecutive_failures': 3,
            'max_duplicate_rate': 0.8,  # 80% duplicates is concerning
            'max_avg_duration': 600,  # 10 minutes
            'min_questions_per_run': 1,
        }

    def calculate_health(self, source: str) -> SourceHealth:
        """Calculate health metrics for a source."""
        metrics_7d = self.metrics.get_source_metrics(source, days=7)

        health = SourceHealth(source=source)

        if not metrics_7d:
            health.is_healthy = False
            health.health_score = 0.0
            return health

        # Basic stats
        health.total_runs = len(metrics_7d)
        health.total_questions = sum(m.questions_extracted for m in metrics_7d)

        # Last run info
        sorted_runs = sorted(metrics_7d, key=lambda m: m.started_at, reverse=True)
        health.last_run = sorted_runs[0].started_at if sorted_runs else None

        successful_runs = [m for m in sorted_runs if m.success]
        health.last_success = successful_runs[0].started_at if successful_runs else None

        # Consecutive failures
        for m in sorted_runs:
            if m.success:
                break
            health.consecutive_failures += 1

        # Success rate
        success_count = len(successful_runs)
        health.success_rate_7d = success_count / len(metrics_7d) if metrics_7d else 0.0

        # Average questions
        if successful_runs:
            health.avg_questions_per_run = (
                sum(m.questions_extracted for m in successful_runs) / len(successful_runs)
            )

        # Average duration
        completed_runs = [m for m in metrics_7d if m.finished_at]
        if completed_runs:
            health.avg_duration_seconds = (
                sum(m.duration_seconds for m in completed_runs) / len(completed_runs)
            )

        # Duplicate rate
        total_extracted = sum(m.questions_extracted for m in metrics_7d)
        total_duplicate = sum(m.questions_duplicate for m in metrics_7d)
        health.duplicate_rate = total_duplicate / total_extracted if total_extracted > 0 else 0.0

        # Calculate health score (0-100)
        score = 100.0

        # Penalize low success rate
        if health.success_rate_7d < self.health_thresholds['min_success_rate']:
            score -= 30 * (1 - health.success_rate_7d / self.health_thresholds['min_success_rate'])

        # Penalize consecutive failures
        if health.consecutive_failures > 0:
            score -= min(30, health.consecutive_failures * 10)

        # Penalize high duplicate rate
        if health.duplicate_rate > self.health_thresholds['max_duplicate_rate']:
            score -= 20

        # Penalize slow scraping
        if health.avg_duration_seconds > self.health_thresholds['max_avg_duration']:
            score -= 10

        health.health_score = max(0.0, score)
        health.is_healthy = health.health_score >= 50.0

        self.health_cache[source] = health
        return health

    def get_all_health(self) -> dict[str, SourceHealth]:
        """Get health for all known sources."""
        sources = set(m.source for m in self.metrics.metrics_history)
        return {source: self.calculate_health(source) for source in sources}

    def get_unhealthy_sources(self) -> list[SourceHealth]:
        """Get list of unhealthy sources."""
        all_health = self.get_all_health()
        return [h for h in all_health.values() if not h.is_healthy]

    def export_dashboard_json(self) -> dict:
        """Export dashboard data as JSON."""
        all_health = self.get_all_health()

        return {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'summary': {
                'total_sources': len(all_health),
                'healthy_sources': len([h for h in all_health.values() if h.is_healthy]),
                'unhealthy_sources': len([h for h in all_health.values() if not h.is_healthy]),
                'total_questions_7d': sum(h.total_questions for h in all_health.values()),
                'total_runs_7d': sum(h.total_runs for h in all_health.values()),
            },
            'sources': {
                source: {
                    'health_score': h.health_score,
                    'is_healthy': h.is_healthy,
                    'success_rate_7d': h.success_rate_7d,
                    'avg_questions_per_run': h.avg_questions_per_run,
                    'duplicate_rate': h.duplicate_rate,
                    'consecutive_failures': h.consecutive_failures,
                    'total_questions': h.total_questions,
                    'last_run': h.last_run.isoformat() if h.last_run else None,
                    'last_success': h.last_success.isoformat() if h.last_success else None,
                }
                for source, h in sorted(all_health.items(), key=lambda x: x[1].health_score)
            }
        }


class CostTracker:
    """Tracks costs across scraper runs."""

    COST_RATES = {
        'gemini_flash': 0.000075,  # per 1k input tokens
        'gemini_pro': 0.00125,
        'groq_llama70b': 0.00059,
        'groq_llama8b': 0.00005,
        'deepl': 0.00002,  # per character
        'proxy_residential': 0.001,  # per request
        'proxy_datacenter': 0.0001,
        'supabase_storage': 0.000025,  # per MB
    }

    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = Path(storage_path or os.environ.get(
            'SCRAPER_COST_PATH',
            str(Path(__file__).resolve().parent.parent / 'data' / 'costs')
        ))
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self.entries: list[CostEntry] = []
        self.daily_budget_usd = float(os.environ.get('SCRAPER_DAILY_BUDGET', '10.0'))
        self._load_entries()

    def _load_entries(self):
        """Load cost entries from storage."""
        cost_file = self.storage_path / 'costs.json'
        if cost_file.exists():
            try:
                with open(cost_file, 'r') as f:
                    data = json.load(f)
                    for entry in data[-10000:]:  # Keep last 10k entries
                        entry['timestamp'] = datetime.fromisoformat(entry['timestamp'])
                        self.entries.append(CostEntry(**entry))
            except Exception as e:
                logger.warning(f"Failed to load cost entries: {e}")

    def _save_entries(self):
        """Save cost entries to storage."""
        cost_file = self.storage_path / 'costs.json'
        try:
            data = []
            for e in self.entries[-10000:]:
                entry = asdict(e)
                entry['timestamp'] = e.timestamp.isoformat()
                data.append(entry)
            with open(cost_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save cost entries: {e}")

    def record_cost(self, source: str, run_id: str, cost_type: str,
                   service: str, units: float, cost_usd: Optional[float] = None):
        """Record a cost entry."""
        if cost_usd is None:
            rate = self.COST_RATES.get(service, 0.0)
            cost_usd = units * rate

        entry = CostEntry(
            source=source,
            run_id=run_id,
            timestamp=datetime.now(timezone.utc),
            cost_type=cost_type,
            service=service,
            units=units,
            cost_usd=cost_usd
        )
        self.entries.append(entry)
        self._save_entries()

    def get_daily_cost(self, date: Optional[datetime] = None) -> float:
        """Get total cost for a day."""
        if date is None:
            date = datetime.now(timezone.utc)

        start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)

        return sum(
            e.cost_usd for e in self.entries
            if start <= e.timestamp < end
        )

    def get_cost_by_source(self, days: int = 7) -> dict[str, float]:
        """Get costs grouped by source."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        costs: dict[str, float] = defaultdict(float)

        for e in self.entries:
            if e.timestamp >= cutoff:
                costs[e.source] += e.cost_usd

        return dict(costs)

    def get_cost_by_service(self, days: int = 7) -> dict[str, float]:
        """Get costs grouped by service."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        costs: dict[str, float] = defaultdict(float)

        for e in self.entries:
            if e.timestamp >= cutoff:
                costs[e.service] += e.cost_usd

        return dict(costs)

    def is_over_budget(self) -> bool:
        """Check if daily budget is exceeded."""
        return self.get_daily_cost() >= self.daily_budget_usd

    def get_remaining_budget(self) -> float:
        """Get remaining daily budget."""
        return max(0.0, self.daily_budget_usd - self.get_daily_cost())

    def export_json(self) -> dict:
        """Export cost data as JSON."""
        return {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'daily_budget_usd': self.daily_budget_usd,
            'today_cost_usd': self.get_daily_cost(),
            'remaining_budget_usd': self.get_remaining_budget(),
            'is_over_budget': self.is_over_budget(),
            'cost_by_source_7d': self.get_cost_by_source(7),
            'cost_by_service_7d': self.get_cost_by_service(7),
            'total_entries': len(self.entries),
        }


class AnomalyDetector:
    """Detects anomalies in scraper metrics."""

    def __init__(self, metrics_collector: MetricsCollector,
                 health_dashboard: SourceHealthDashboard,
                 cost_tracker: CostTracker):
        self.metrics = metrics_collector
        self.health = health_dashboard
        self.costs = cost_tracker
        self.alerts: list[Alert] = []
        self.alert_callbacks: list[Callable[[Alert], None]] = []

        self.thresholds = {
            'max_duration_multiplier': 3.0,  # 3x average duration
            'min_questions_ratio': 0.3,  # 30% of average
            'max_failure_streak': 3,
            'max_duplicate_rate': 0.9,
            'max_error_rate': 0.5,
            'cost_spike_multiplier': 2.0,
        }

    def add_alert_callback(self, callback: Callable[[Alert], None]):
        """Add a callback for when alerts are raised."""
        self.alert_callbacks.append(callback)

    def _create_alert(self, severity: AlertSeverity, source: str, title: str,
                     message: str, metric_name: str, metric_value: float,
                     threshold: float) -> Alert:
        """Create and store an alert."""
        alert = Alert(
            id=f"{source}_{metric_name}_{int(time.time())}",
            severity=severity,
            source=source,
            title=title,
            message=message,
            metric_name=metric_name,
            metric_value=metric_value,
            threshold=threshold,
            created_at=datetime.now(timezone.utc)
        )
        self.alerts.append(alert)

        for callback in self.alert_callbacks:
            try:
                callback(alert)
            except Exception as e:
                logger.error(f"Alert callback failed: {e}")

        return alert

    def check_run_anomalies(self, run_id: str) -> list[Alert]:
        """Check for anomalies in a specific run."""
        alerts = []
        metrics = self.metrics.get_metrics(run_id)

        if not metrics:
            return alerts

        source = metrics.source
        historical = self.metrics.get_source_metrics(source, days=7)

        if len(historical) < 3:
            return alerts  # Not enough history

        # Check duration anomaly
        avg_duration = statistics.mean(m.duration_seconds for m in historical if m.finished_at)
        if metrics.duration_seconds > avg_duration * self.thresholds['max_duration_multiplier']:
            alerts.append(self._create_alert(
                AlertSeverity.WARNING,
                source,
                f"Slow scraper: {source}",
                f"Duration {metrics.duration_seconds:.0f}s is {metrics.duration_seconds/avg_duration:.1f}x the average",
                'duration_seconds',
                metrics.duration_seconds,
                avg_duration * self.thresholds['max_duration_multiplier']
            ))

        # Check question count anomaly
        avg_questions = statistics.mean(m.questions_extracted for m in historical if m.success)
        if avg_questions > 0 and metrics.questions_extracted < avg_questions * self.thresholds['min_questions_ratio']:
            alerts.append(self._create_alert(
                AlertSeverity.WARNING,
                source,
                f"Low yield: {source}",
                f"Only {metrics.questions_extracted} questions vs {avg_questions:.0f} average",
                'questions_extracted',
                metrics.questions_extracted,
                avg_questions * self.thresholds['min_questions_ratio']
            ))

        # Check duplicate rate
        total = metrics.questions_extracted
        if total > 0:
            dup_rate = metrics.questions_duplicate / total
            if dup_rate > self.thresholds['max_duplicate_rate']:
                alerts.append(self._create_alert(
                    AlertSeverity.INFO,
                    source,
                    f"High duplicate rate: {source}",
                    f"{dup_rate*100:.0f}% duplicates",
                    'duplicate_rate',
                    dup_rate,
                    self.thresholds['max_duplicate_rate']
                ))

        # Check error rate
        if metrics.requests_made > 0:
            error_rate = metrics.requests_failed / metrics.requests_made
            if error_rate > self.thresholds['max_error_rate']:
                alerts.append(self._create_alert(
                    AlertSeverity.ERROR,
                    source,
                    f"High error rate: {source}",
                    f"{error_rate*100:.0f}% of requests failed",
                    'error_rate',
                    error_rate,
                    self.thresholds['max_error_rate']
                ))

        return alerts

    def check_source_health_anomalies(self) -> list[Alert]:
        """Check for health anomalies across all sources."""
        alerts = []

        for source, health in self.health.get_all_health().items():
            # Check consecutive failures
            if health.consecutive_failures >= self.thresholds['max_failure_streak']:
                alerts.append(self._create_alert(
                    AlertSeverity.ERROR,
                    source,
                    f"Failure streak: {source}",
                    f"{health.consecutive_failures} consecutive failures",
                    'consecutive_failures',
                    health.consecutive_failures,
                    self.thresholds['max_failure_streak']
                ))

            # Check critical health score
            if health.health_score < 30:
                alerts.append(self._create_alert(
                    AlertSeverity.CRITICAL,
                    source,
                    f"Critical health: {source}",
                    f"Health score {health.health_score:.0f}/100",
                    'health_score',
                    health.health_score,
                    30.0
                ))

        return alerts

    def check_cost_anomalies(self) -> list[Alert]:
        """Check for cost anomalies."""
        alerts = []

        # Check daily budget
        if self.costs.is_over_budget():
            alerts.append(self._create_alert(
                AlertSeverity.WARNING,
                'global',
                "Daily budget exceeded",
                f"${self.costs.get_daily_cost():.2f} / ${self.costs.daily_budget_usd:.2f}",
                'daily_cost_usd',
                self.costs.get_daily_cost(),
                self.costs.daily_budget_usd
            ))

        # Check cost spikes by source
        cost_by_source = self.costs.get_cost_by_source(7)
        if cost_by_source:
            avg_cost = statistics.mean(cost_by_source.values())
            for source, cost in cost_by_source.items():
                if cost > avg_cost * self.thresholds['cost_spike_multiplier'] and cost > 1.0:
                    alerts.append(self._create_alert(
                        AlertSeverity.WARNING,
                        source,
                        f"Cost spike: {source}",
                        f"${cost:.2f} is {cost/avg_cost:.1f}x the average",
                        'source_cost_7d',
                        cost,
                        avg_cost * self.thresholds['cost_spike_multiplier']
                    ))

        return alerts

    def run_all_checks(self) -> list[Alert]:
        """Run all anomaly checks."""
        alerts = []
        alerts.extend(self.check_source_health_anomalies())
        alerts.extend(self.check_cost_anomalies())
        return alerts

    def get_active_alerts(self, severity: Optional[AlertSeverity] = None) -> list[Alert]:
        """Get active (unacknowledged) alerts."""
        alerts = [a for a in self.alerts if not a.acknowledged]
        if severity:
            alerts = [a for a in alerts if a.severity == severity]
        return sorted(alerts, key=lambda a: a.created_at, reverse=True)

    def acknowledge_alert(self, alert_id: str):
        """Acknowledge an alert."""
        for alert in self.alerts:
            if alert.id == alert_id:
                alert.acknowledged = True
                break

    def export_json(self) -> dict:
        """Export anomaly detection data as JSON."""
        return {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'active_alerts': [
                {
                    'id': a.id,
                    'severity': a.severity.value,
                    'source': a.source,
                    'title': a.title,
                    'message': a.message,
                    'created_at': a.created_at.isoformat(),
                }
                for a in self.get_active_alerts()
            ],
            'alert_counts': {
                'total': len(self.alerts),
                'active': len(self.get_active_alerts()),
                'critical': len(self.get_active_alerts(AlertSeverity.CRITICAL)),
                'error': len(self.get_active_alerts(AlertSeverity.ERROR)),
                'warning': len(self.get_active_alerts(AlertSeverity.WARNING)),
            }
        }


class MonitoringSystem:
    """Unified monitoring system combining all components."""

    def __init__(self, storage_path: Optional[str] = None):
        base_path = storage_path or os.environ.get(
            'SCRAPER_MONITORING_PATH',
            str(Path(__file__).resolve().parent.parent / 'data' / 'monitoring')
        )

        self.metrics = MetricsCollector(f"{base_path}/metrics")
        self.costs = CostTracker(f"{base_path}/costs")
        self.health = SourceHealthDashboard(self.metrics)
        self.anomaly = AnomalyDetector(self.metrics, self.health, self.costs)

    def start_scraper_run(self, source: str, run_id: str) -> ScraperMetrics:
        """Start monitoring a scraper run."""
        return self.metrics.start_run(source, run_id)

    def end_scraper_run(self, run_id: str, success: bool = True, error: Optional[str] = None):
        """End monitoring a scraper run and check for anomalies."""
        self.metrics.end_run(run_id, success, error)

        # Check for anomalies after run
        alerts = self.anomaly.check_run_anomalies(run_id)
        for alert in alerts:
            logger.warning(f"Alert: {alert.title} - {alert.message}")

    def record_api_cost(self, source: str, run_id: str, service: str,
                       units: float, cost_usd: Optional[float] = None):
        """Record an API cost."""
        self.costs.record_cost(source, run_id, 'api', service, units, cost_usd)
        self.metrics.record_api_call(run_id, service, cost_usd or 0.0)

    def export_full_dashboard(self) -> dict:
        """Export complete dashboard data."""
        return {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'health': self.health.export_dashboard_json(),
            'costs': self.costs.export_json(),
            'anomalies': self.anomaly.export_json(),
            'prometheus_metrics': self.metrics.export_prometheus(),
        }

    def save_dashboard(self, path: Optional[str] = None):
        """Save dashboard to JSON file."""
        path = path or str(Path(__file__).resolve().parent.parent / 'data' / 'monitoring' / 'dashboard.json')
        Path(path).parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w') as f:
            json.dump(self.export_full_dashboard(), f, indent=2, default=str)


# Singleton instance for easy import
_monitoring: Optional[MonitoringSystem] = None

def get_monitoring() -> MonitoringSystem:
    """Get the global monitoring system instance."""
    global _monitoring
    if _monitoring is None:
        _monitoring = MonitoringSystem()
    return _monitoring


# Context manager for easy scraper tracking
class ScraperMonitoringContext:
    """Context manager for monitoring a scraper run."""

    def __init__(self, source: str, run_id: Optional[str] = None):
        self.source = source
        self.run_id = run_id or f"{source}_{int(time.time())}"
        self.monitoring = get_monitoring()
        self.metrics: Optional[ScraperMetrics] = None

    def __enter__(self) -> 'ScraperMonitoringContext':
        self.metrics = self.monitoring.start_scraper_run(self.source, self.run_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        success = exc_type is None
        error = str(exc_val) if exc_val else None
        self.monitoring.end_scraper_run(self.run_id, success, error)
        return False  # Don't suppress exceptions

    def record_questions(self, extracted: int = 0, new: int = 0,
                        duplicate: int = 0, invalid: int = 0):
        """Record question metrics."""
        self.monitoring.metrics.record_questions(
            self.run_id, extracted, new, duplicate, invalid
        )

    def record_api_cost(self, service: str, units: float, cost_usd: Optional[float] = None):
        """Record API cost."""
        self.monitoring.record_api_cost(
            self.source, self.run_id, service, units, cost_usd
        )

    def record_request(self, success: bool = True, bytes_downloaded: int = 0):
        """Record HTTP request."""
        self.monitoring.metrics.record_request(self.run_id, success, bytes_downloaded)


# Convenience function for scrapers
def monitor_scraper(source: str, run_id: Optional[str] = None) -> ScraperMonitoringContext:
    """Create a monitoring context for a scraper run.

    Usage:
        with monitor_scraper('devto_interviews') as ctx:
            questions = scrape_devto()
            ctx.record_questions(extracted=len(questions), new=10, duplicate=5)
    """
    return ScraperMonitoringContext(source, run_id)
