#!/usr/bin/env python3
"""
Auto-Apply Queue Worker (Parallel Processing)

Continuously polls the job queue and processes applications using the browser-use agent.
Supports parallel processing of multiple jobs simultaneously.

Run with: python worker.py
Run with more parallelism: MAX_CONCURRENT=5 python worker.py

Environment variables:
  SUPABASE_URL - Supabase project URL
  SUPABASE_KEY - Supabase service role key (for queue access)
  POLL_INTERVAL - Seconds between queue checks (default: 5)
  MAX_CONCURRENT - Maximum concurrent jobs to process (default: 3)
"""

import asyncio
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from v2.agent import run_agent, StatusTracker

load_dotenv()

# Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://jmrbyubrrpxxvotsljms.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "3"))  # Max parallel jobs
WORKER_ID = os.getenv("WORKER_ID", f"worker-{os.getpid()}")
PROFILES_DIR = Path(__file__).parent / "profiles"

# Global flag for graceful shutdown
shutdown_requested = False


def handle_shutdown(signum, frame):
    """Handle shutdown signals gracefully."""
    global shutdown_requested
    print(f"\n[Worker] Shutdown signal received, finishing current job...")
    shutdown_requested = True


def get_supabase_client() -> Client:
    """Create Supabase client."""
    if not SUPABASE_KEY:
        raise ValueError("SUPABASE_KEY or SUPABASE_SERVICE_KEY environment variable required")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def claim_next_job(client: Client) -> Optional[dict]:
    """Claim the next pending job from the queue."""
    try:
        result = client.rpc("claim_autoapply_job", {
            "p_worker_id": WORKER_ID,
            "p_lock_duration": "10 minutes"
        }).execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[Worker] Error claiming job: {e}")
        return None


def complete_job(client: Client, queue_id: str, confirmation_id: str = None, result: dict = None):
    """Mark a job as completed."""
    try:
        client.rpc("complete_autoapply_job", {
            "p_queue_id": queue_id,
            "p_confirmation_id": confirmation_id,
            "p_result": result
        }).execute()
        print(f"[Worker] Job {queue_id} completed successfully")
    except Exception as e:
        print(f"[Worker] Error completing job: {e}")


def fail_job(client: Client, queue_id: str, error_message: str, error_type: str = "unknown"):
    """Mark a job as failed with retry logic."""
    try:
        result = client.rpc("fail_autoapply_job", {
            "p_queue_id": queue_id,
            "p_error_message": error_message,
            "p_error_type": error_type
        }).execute()

        if result.data and len(result.data) > 0:
            retry_info = result.data[0]
            if retry_info.get("should_retry"):
                print(f"[Worker] Job {queue_id} failed, will retry at {retry_info.get('next_retry_at')}")
            else:
                print(f"[Worker] Job {queue_id} failed permanently: {error_message}")
        return result.data[0] if result.data else None
    except Exception as e:
        print(f"[Worker] Error failing job: {e}")
        return None


def get_user_profile(client: Client, user_id: str) -> Optional[dict]:
    """Fetch user profile for the application."""
    try:
        result = client.table("user_profiles").select("*").eq("user_id", user_id).single().execute()
        return result.data
    except Exception as e:
        print(f"[Worker] Error fetching user profile: {e}")
        return None


def build_agent_profile(user_profile: dict, job: dict) -> dict:
    """Build the profile dict expected by the agent."""
    return {
        "first_name": user_profile.get("first_name", ""),
        "last_name": user_profile.get("last_name", ""),
        "email": user_profile.get("email", ""),
        "phone": user_profile.get("phone", ""),
        "linkedin": user_profile.get("linkedin_url", ""),
        "github": user_profile.get("github_url", ""),
        "website": user_profile.get("portfolio_url", ""),
        "location": user_profile.get("location", ""),
        "resume_path": user_profile.get("resume_url", ""),
        "work_authorization": user_profile.get("work_authorization", "US Citizen"),
        "requires_sponsorship": user_profile.get("requires_sponsorship", False),
        "willing_to_relocate": user_profile.get("willing_to_relocate", True),
        "earliest_start_date": user_profile.get("earliest_start_date", "Immediately"),
        "education": {
            "school": user_profile.get("school", ""),
            "degree": user_profile.get("degree", "Bachelor's"),
            "major": user_profile.get("major", "Computer Science"),
            "graduation_year": user_profile.get("graduation_year", "2024"),
        },
        "interests": user_profile.get("interests", []),
        "goals": user_profile.get("goals", []),
        "strengths": user_profile.get("strengths", []),
        "highlights": user_profile.get("highlights", []),
        "eeo": user_profile.get("eeo_responses", {}),
        "standard_answers": user_profile.get("standard_answers", {}),
    }


async def process_job(client: Client, job: dict) -> bool:
    """Process a single job application."""
    queue_id = job["id"]
    user_id = str(job["user_id"])
    job_url = job["job_url"]
    company_name = job["company_name"]
    job_title = job["job_title"]

    print(f"\n[Worker] Processing: {job_title} at {company_name}")
    print(f"[Worker] URL: {job_url}")

    # Get user profile
    user_profile = get_user_profile(client, user_id)
    if not user_profile:
        fail_job(client, queue_id, "User profile not found", "validation")
        return False

    # Build agent profile
    profile = build_agent_profile(user_profile, job)

    # Create status tracker for real-time updates
    tracker = StatusTracker(user_id, job["job_id"], job.get("ats_type"))

    try:
        # Run the browser-use agent
        tracker.update_status("filling")

        await run_agent(
            url=job_url,
            profile_path=None,  # We'll pass profile directly
            headless=False,  # Set to True for production
            auto_submit=False,  # Never auto-submit, require review
            tracker=tracker,
        )

        # If we get here without exception, mark as completed
        complete_job(client, queue_id, result={
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "worker_id": WORKER_ID,
        })

        # Update application_logs
        client.table("application_logs").update({
            "status": "review"
        }).eq("user_id", user_id).eq("job_id", job["job_id"]).execute()

        return True

    except Exception as e:
        error_message = str(e)
        error_type = "unknown"

        # Categorize errors
        if "timeout" in error_message.lower():
            error_type = "timeout"
        elif "network" in error_message.lower() or "connection" in error_message.lower():
            error_type = "network"
        elif "captcha" in error_message.lower():
            error_type = "captcha"
        elif "rate" in error_message.lower() or "limit" in error_message.lower():
            error_type = "rate_limit"
        elif "not found" in error_message.lower() or "closed" in error_message.lower():
            error_type = "permanent"

        fail_job(client, queue_id, error_message, error_type)

        # Update application_logs
        client.table("application_logs").update({
            "status": "failed",
            "error_message": error_message[:500]
        }).eq("user_id", user_id).eq("job_id", job["job_id"]).execute()

        return False


class WorkerStats:
    """Track worker statistics."""
    def __init__(self):
        self.processed = 0
        self.failed = 0
        self.active = 0
        self.lock = asyncio.Lock()

    async def job_started(self):
        async with self.lock:
            self.active += 1

    async def job_completed(self, success: bool):
        async with self.lock:
            self.active -= 1
            if success:
                self.processed += 1
            else:
                self.failed += 1

    def __str__(self):
        return f"active={self.active}, completed={self.processed}, failed={self.failed}"


async def process_job_wrapper(client: Client, job: dict, stats: WorkerStats, semaphore: asyncio.Semaphore):
    """Wrapper to process a job with semaphore control."""
    async with semaphore:
        await stats.job_started()
        try:
            success = await process_job(client, job)
            await stats.job_completed(success)
        except Exception as e:
            print(f"[Worker] Job {job['id']} crashed: {e}")
            await stats.job_completed(False)


async def worker_loop():
    """Main worker loop with parallel processing."""
    print(f"[Worker] Starting auto-apply worker: {WORKER_ID}")
    print(f"[Worker] Supabase URL: {SUPABASE_URL}")
    print(f"[Worker] Poll interval: {POLL_INTERVAL}s")
    print(f"[Worker] Max concurrent jobs: {MAX_CONCURRENT}")
    print(f"[Worker] Press Ctrl+C to stop gracefully")
    print("-" * 50)

    client = get_supabase_client()
    stats = WorkerStats()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    active_tasks: set[asyncio.Task] = set()

    while not shutdown_requested:
        try:
            # Clean up completed tasks
            done_tasks = {t for t in active_tasks if t.done()}
            active_tasks -= done_tasks

            # Try to claim jobs up to MAX_CONCURRENT
            while stats.active < MAX_CONCURRENT and not shutdown_requested:
                job = claim_next_job(client)
                if not job:
                    break  # No more pending jobs

                # Start processing in background
                task = asyncio.create_task(
                    process_job_wrapper(client, job, stats, semaphore)
                )
                active_tasks.add(task)
                print(f"[Worker] Started job {job['id'][:8]}... ({stats})")

            # Print status if we have active jobs
            if stats.active > 0:
                print(f"[Worker] Status: {stats}")

            # Wait before next poll
            await asyncio.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Worker] Unexpected error: {e}")
            await asyncio.sleep(POLL_INTERVAL)

    # Wait for active tasks to complete on shutdown
    if active_tasks:
        print(f"[Worker] Waiting for {len(active_tasks)} active jobs to complete...")
        await asyncio.gather(*active_tasks, return_exceptions=True)

    print(f"\n[Worker] Shutdown complete. {stats}")


def main():
    # Set up signal handlers
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    # Run the worker
    asyncio.run(worker_loop())


if __name__ == "__main__":
    main()
