import asyncio
import os
import time
from pathlib import Path


def scrape_ok(start_date=None, **kwargs):
    return [{
        "question_text": "Explain a hash table",
        "source": "fixture",
        "metadata": {"date_type": type(start_date).__name__},
    }]


async def scrape_async(start_date=None):
    await asyncio.sleep(0.01)
    return [{"question_text": "Explain asyncio", "source": "fixture"}]


def scrape_slow(start_date=None):
    time.sleep(2)
    Path(os.environ["SCRAPER_TIMEOUT_MARKER"]).write_text(
        "worker survived", encoding="utf-8"
    )
    return []
