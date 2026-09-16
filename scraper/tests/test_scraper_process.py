import asyncio
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRAPER_DIR = Path(__file__).resolve().parents[1]
if str(SCRAPER_DIR) not in sys.path:
    sys.path.insert(0, str(SCRAPER_DIR))

from interview_orchestrator import (  # noqa: E402
    InterviewQuestionOrchestrator,
    ScraperConfig,
)


class ScraperProcessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.orchestrator = InterviewQuestionOrchestrator.__new__(
            InterviewQuestionOrchestrator
        )
        self.orchestrator.end_date = datetime.now(timezone.utc)
        self.orchestrator.months_back = 1
        self.base_config = {
            "name": "fixture",
            "source": "fixture",
            "scraper_type": "python",
            "module_path": "tests.fixtures.timeout_fixture",
            "priority": 1,
            "max_retries": 1,
        }

    async def run_fixture(self, function_name, timeout):
        config = ScraperConfig(
            function_name=function_name,
            timeout=timeout,
            **self.base_config,
        )
        return await self.orchestrator._run_python_scraper(
            config, self.orchestrator.end_date
        )

    async def test_sync_and_async_scrapers_are_serialized(self):
        questions, errors = await self.run_fixture("scrape_ok", 5)
        self.assertEqual([], errors)
        self.assertEqual("datetime", questions[0]["metadata"]["date_type"])

        questions, errors = await self.run_fixture("scrape_async", 5)
        self.assertEqual([], errors)
        self.assertEqual("Explain asyncio", questions[0]["question_text"])

    async def test_timeout_terminates_child_process(self):
        marker = Path(tempfile.gettempdir()) / "newgrad-radar-timeout-marker.txt"
        marker.unlink(missing_ok=True)
        os.environ["SCRAPER_TIMEOUT_MARKER"] = str(marker)
        self.addCleanup(marker.unlink, missing_ok=True)

        questions, errors = await self.run_fixture("scrape_slow", 1)
        self.assertEqual([], questions)
        self.assertEqual(["Scraper timed out after 1s"], errors)

        await asyncio.sleep(2)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
