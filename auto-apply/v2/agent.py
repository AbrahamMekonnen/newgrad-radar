#!/usr/bin/env python3
"""
NewGrad Radar Auto-Apply Agent
Uses browser-use + Gemini to intelligently fill job applications
"""

import asyncio
import argparse
import os
import yaml
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

from browser_use import Agent, Browser, ChatGoogle, ChatGroq
from browser_use.agent.views import MessageCompactionSettings

load_dotenv()

# Supabase defaults (can be overridden via .env)
DEFAULT_SUPABASE_URL = "https://jmrbyubrrpxxvotsljms.supabase.co"
DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcmJ5dWJycnB4eHZvdHNsam1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTY1MzEsImV4cCI6MjEwNDMzMjUzMX0.HYQtMomrHVwbjlIN8XFXlbiJynxTMM4pabx9TSoR9Vg"


class StatusTracker:
    """
    Tracks application status in Supabase.
    Updates the application_logs table in real-time as the agent fills forms.
    """

    def __init__(self, user_id: str, job_id: str, ats_type: Optional[str] = None):
        """
        Initialize the status tracker with Supabase connection.

        Args:
            user_id: The user's UUID
            job_id: The job ID being applied to
            ats_type: The ATS type (e.g., 'greenhouse', 'lever', 'workday')
        """
        from supabase import create_client, Client

        self.user_id = user_id
        self.job_id = job_id
        self.ats_type = ats_type

        # Get Supabase credentials from env or use defaults
        supabase_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL)
        supabase_key = os.environ.get("SUPABASE_KEY", DEFAULT_SUPABASE_KEY)

        self.client: Client = create_client(supabase_url, supabase_key)
        self._initialized = False

    def _ensure_row_exists(self):
        """Ensure the application_logs row exists, create if not."""
        if self._initialized:
            return

        # Check if row exists
        result = self.client.table("application_logs").select("id").eq(
            "user_id", self.user_id
        ).eq("job_id", self.job_id).execute()

        if not result.data:
            # Create the row with initial 'pending' status
            self.client.table("application_logs").insert({
                "user_id": self.user_id,
                "job_id": self.job_id,
                "status": "pending",
                "ats_type": self.ats_type,
            }).execute()

        self._initialized = True

    def update_status(self, status: str) -> None:
        """
        Update the application status.

        Args:
            status: One of 'pending', 'filling', 'review', 'submitted', 'failed'
        """
        self._ensure_row_exists()

        self.client.table("application_logs").update({
            "status": status
        }).eq("user_id", self.user_id).eq("job_id", self.job_id).execute()

        print(f"[StatusTracker] Status updated to: {status}")

    def set_error(self, message: str) -> None:
        """
        Set error message and mark status as failed.

        Args:
            message: The error message to record
        """
        self._ensure_row_exists()

        self.client.table("application_logs").update({
            "status": "failed",
            "error_message": message
        }).eq("user_id", self.user_id).eq("job_id", self.job_id).execute()

        print(f"[StatusTracker] Error recorded: {message}")

    def mark_submitted(self) -> None:
        """Mark the application as submitted with timestamp."""
        self._ensure_row_exists()

        self.client.table("application_logs").update({
            "status": "submitted",
            "submitted_at": datetime.now(timezone.utc).isoformat()
        }).eq("user_id", self.user_id).eq("job_id", self.job_id).execute()

        print("[StatusTracker] Application marked as submitted")

    def set_ats_type(self, ats_type: str) -> None:
        """Update the ATS type after detection."""
        self._ensure_row_exists()

        self.ats_type = ats_type
        self.client.table("application_logs").update({
            "ats_type": ats_type
        }).eq("user_id", self.user_id).eq("job_id", self.job_id).execute()

        print(f"[StatusTracker] ATS type set to: {ats_type}")


def load_profile(profile_path: str) -> dict:
    """Load user profile from YAML file"""
    with open(profile_path, 'r') as f:
        return yaml.safe_load(f)


def build_system_prompt(profile: dict, company_name: str = None) -> str:
    """Build the system prompt with user context for personalized answers"""

    # Check for company-specific notes
    company_note = ""
    if company_name:
        company_key = company_name.lower().replace(" ", "_")
        if company_key in profile.get('company_notes', {}):
            note = profile['company_notes'][company_key]
            company_note = f"""
COMPANY-SPECIFIC NOTES FOR {company_name.upper()}:
- Why interested: {note.get('why', 'N/A')}
- Personal connection: {note.get('connection', 'N/A')}
"""

    return f"""You are an AI assistant helping {profile['first_name']} {profile['last_name']} apply for jobs.

CANDIDATE PROFILE:
- Name: {profile['first_name']} {profile['last_name']}
- Education: {profile['education']['degree']} in {profile['education']['major']} from {profile['education']['school']} ({profile['education']['graduation_year']})
- Location: {profile['location']}
- Work Authorization: {profile['work_authorization']}
- Requires Sponsorship: {'Yes' if profile['requires_sponsorship'] else 'No'}
- Willing to Relocate: {'Yes' if profile['willing_to_relocate'] else 'No'}
- Earliest Start: {profile['earliest_start_date']}

INTERESTS & MOTIVATIONS:
{chr(10).join('- ' + i for i in profile.get('interests', []))}

CAREER GOALS:
{chr(10).join('- ' + g for g in profile.get('goals', []))}

TECHNICAL STRENGTHS:
{chr(10).join('- ' + s for s in profile.get('strengths', []))}

KEY HIGHLIGHTS/EXPERIENCES:
{chr(10).join('- ' + h for h in profile.get('highlights', []))}
{company_note}

INSTRUCTIONS FOR FILLING APPLICATIONS:
1. Fill all form fields accurately using the profile information above
2. For "Why do you want to work here?" questions:
   - First, read the job description and company mission on the page
   - Connect the candidate's specific interests/goals to the company's mission
   - Reference relevant highlights/experiences that match job requirements
   - Write 200-400 words, be genuine and specific, avoid generic statements
   - DO NOT copy-paste; generate unique, tailored content

3. For technical questions, draw from the strengths and highlights above
4. For EEO/demographic questions, use: {profile.get('eeo', {})}
5. For standard questions, use: {profile.get('standard_answers', {})}

6. Upload resume from: {profile['resume_path']}
7. DO NOT submit the application - stop before clicking Submit and wait for review

Be professional, genuine, and specific. Avoid buzzwords and generic phrases.
"""


async def analyze_error_with_ai(llm, error: str, url: str, profile: dict) -> str:
    """
    Use AI to analyze the error and suggest recovery strategies.
    Returns a recovery prompt to guide the next attempt.
    """
    try:
        # Common error patterns and their solutions
        error_lower = error.lower()

        # Check for common patterns first (fast path)
        if "rate limit" in error_lower or "quota" in error_lower or "429" in error:
            return "Previous attempt hit API rate limits. Wait a moment between actions and proceed more slowly."

        if "element not found" in error_lower or "no such element" in error_lower:
            return "Some form elements were not found. Try scrolling the page first to load all elements, then look for alternative selectors or field labels."

        if "timeout" in error_lower:
            return "Page loading was slow. Wait longer for page loads and try clicking buttons more carefully."

        if "captcha" in error_lower or "recaptcha" in error_lower:
            return "A CAPTCHA was detected. This may require human intervention. Try proceeding with other fields first."

        if "file" in error_lower and ("not found" in error_lower or "upload" in error_lower):
            return "Resume file upload failed. Check if the file path is correct and try the upload again with a different method."

        if "connection" in error_lower or "network" in error_lower:
            return "Network connection issue. Retry the navigation and form filling steps."

        # For complex errors, use AI to analyze (if LLM is available and working)
        analysis_prompt = f"""Analyze this job application error and provide a brief recovery strategy:

ERROR: {error[:500]}

JOB URL: {url}

What likely went wrong and what specific steps should be taken to fix it?
Respond in 1-2 sentences with actionable instructions."""

        # Try to get AI analysis
        from langchain_core.messages import HumanMessage
        response = await llm.ainvoke([HumanMessage(content=analysis_prompt)])

        if response and hasattr(response, 'content'):
            return response.content[:300]  # Truncate long responses

    except Exception as e:
        print(f"[AI Analysis] Could not analyze error: {e}")

    # Default recovery suggestion
    return "Previous attempt failed. Try a different approach: scroll to find elements, wait for page loads, and fill fields one at a time."


def build_task_prompt(url: str, profile: dict) -> str:
    """Build the task prompt for the agent"""
    return f"""Go to this job application page and fill out the entire application form:
{url}

Steps:
1. Navigate to the URL
2. If there's an "Apply" button, click it to open the application form
3. Read the job title and company name from the page
4. Fill in ALL form fields using the candidate's profile:
   - First Name: {profile['first_name']}
   - Last Name: {profile['last_name']}
   - Email: {profile['email']}
   - Phone: {profile['phone']}
   - LinkedIn: {profile['linkedin']}
   - GitHub: {profile.get('github', '')}
   - Website: {profile.get('website', '')}

5. Upload the resume from: {profile['resume_path']}

6. For any "Why" questions (Why this company? Why this role?):
   - Read the job description and company info on the page
   - Write a personalized 200-400 word answer connecting the candidate's interests to this specific company/role
   - Be genuine and specific, not generic

7. Fill all dropdown menus with appropriate values
8. Answer all other questions using the profile context

9. STOP before clicking Submit - do not submit the application
10. Report what fields were filled and if any questions need human review

Important: Take your time, read each question carefully, and provide thoughtful answers.
"""


async def run_agent(
    url: str,
    profile_path: str,
    headless: bool = False,
    auto_submit: bool = False,
    tracker: Optional[StatusTracker] = None,
    browser: Optional[Browser] = None,
):
    """
    Run the auto-apply agent.

    Args:
        url: The job application URL
        profile_path: Path to the profile YAML file
        headless: Whether to run the browser in headless mode
        auto_submit: Whether to automatically submit the application
        tracker: Optional StatusTracker for database updates
        browser: Optional Browser instance to reuse across applications
                 (if not provided, a new browser will be created and closed)
    """

    print("=" * 60)
    print("NewGrad Radar Auto-Apply Agent (v2 - browser-use)")
    print("=" * 60)

    # Load profile
    print(f"\nLoading profile from: {profile_path}")
    profile = load_profile(profile_path)
    print(f"Profile loaded for: {profile['first_name']} {profile['last_name']}")

    # Extract company name from URL if possible
    company_name = None
    if "greenhouse.io" in url:
        parts = url.split("/")
        for i, part in enumerate(parts):
            if part == "greenhouse.io" and i + 1 < len(parts):
                company_name = parts[i + 1]
                break
    elif "lever.co" in url:
        parts = url.split("/")
        for i, part in enumerate(parts):
            if part == "lever.co" and i + 1 < len(parts):
                company_name = parts[i + 1]
                break

    if company_name:
        print(f"Detected company: {company_name}")

    # Detect ATS type from URL and update tracker
    ats_type = None
    if "greenhouse.io" in url:
        ats_type = "greenhouse"
    elif "lever.co" in url:
        ats_type = "lever"
    elif "workday" in url.lower():
        ats_type = "workday"
    elif "icims" in url.lower():
        ats_type = "icims"
    elif "taleo" in url.lower():
        ats_type = "taleo"
    elif "jobvite" in url.lower():
        ats_type = "jobvite"
    elif "smartrecruiters" in url.lower():
        ats_type = "smartrecruiters"
    elif "ashbyhq" in url.lower():
        ats_type = "ashby"

    if tracker:
        if ats_type:
            tracker.set_ats_type(ats_type)
        # Mark as filling - agent is starting
        tracker.update_status("filling")

    # Determine if this is a simple ATS (use flash mode) or complex (needs full reasoning)
    simple_ats_types = ["greenhouse", "lever", "ashby", "jobvite"]
    is_simple_ats = ats_type in simple_ats_types
    if is_simple_ats:
        print(f"[Optimization] Simple ATS detected ({ats_type}) - enabling flash mode")
    else:
        print(f"[Optimization] Complex ATS ({ats_type or 'unknown'}) - using full reasoning mode")

    # Initialize LLM using SmartRouter
    # Priority: Ollama (local) > Smart routing between Gemini Free / Groq Free > Groq Paid
    import subprocess
    import httpx

    llm = None
    llm_provider = None

    # 1. Try Ollama first (local, free, unlimited)
    try:
        result = subprocess.run(['ollama', 'list'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and 'llama' in result.stdout.lower():
            print("\n[1/2] Testing Ollama (local, free, no rate limits)...")
            from browser_use import ChatOllama
            llm = ChatOllama(model="llama3.2")
            llm_provider = "ollama"
            print("✓ Ollama available - using local model")
    except Exception as e:
        print(f"[1/2] Ollama not available: {e}")

    # 2. Use SmartRouter for cloud providers
    if llm is None:
        print("\n[2/2] Using SmartRouter for cloud providers...")
        try:
            from utils.smart_router import get_router, create_llm_for_provider, ProviderType

            router = get_router()

            # Pre-calculate: ~40 calls per application
            expected_calls = 40
            provider_type = router.pre_calculate_provider(expected_calls)

            # Check availability
            status = router.check_providers_available()
            print(f"Provider status: {status}")

            # Test connection for selected provider
            if provider_type in (ProviderType.GROQ_FREE, ProviderType.GROQ_PAID):
                groq_key = os.environ.get('GROQ_API_KEY')
                if groq_key:
                    try:
                        with httpx.Client(timeout=10) as client:
                            resp = client.get("https://api.groq.com/openai/v1/models",
                                              headers={"Authorization": f"Bearer {groq_key}"})
                            if resp.status_code == 200:
                                llm = create_llm_for_provider(provider_type)
                                llm_provider = provider_type.value
                                print(f"✓ Using {router.providers[provider_type].config.name}")
                            else:
                                print(f"✗ Groq returned status {resp.status_code}, falling back to Gemini")
                                provider_type = ProviderType.GEMINI_FREE
                    except Exception as e:
                        print(f"✗ Groq connection failed: {e}, falling back to Gemini")
                        provider_type = ProviderType.GEMINI_FREE

            if llm is None:
                # Use Gemini
                llm = create_llm_for_provider(ProviderType.GEMINI_FREE)
                llm_provider = "gemini_free"
                print(f"✓ Using Gemini Flash (Free)")

        except ImportError:
            # Fallback if SmartRouter not available
            print("SmartRouter not available, using direct Gemini")
            llm = ChatGoogle(model="gemini-2.0-flash")
            llm_provider = "gemini"

    print(f"\n>>> Using LLM provider: {llm_provider.upper()}")

    # Build prompts
    system_prompt = build_system_prompt(profile, company_name)
    task_prompt = build_task_prompt(url, profile)

    print(f"\nTarget URL: {url}")
    print(f"Headless: {headless}")
    print("\n" + "-" * 60)
    print("Starting browser agent...")
    print("-" * 60 + "\n")

    # Create browser if not provided (for session reuse across applications)
    owns_browser = browser is None
    if owns_browser:
        browser = Browser(headless=headless)
        print("[Browser] Created new browser session")
    else:
        print("[Browser] Reusing existing browser session")

    # Collect file paths for upload (resume, cover letter, etc.)
    available_files = []
    if profile.get('resume_path'):
        available_files.append(profile['resume_path'])
    if profile.get('cover_letter_path'):
        available_files.append(profile['cover_letter_path'])

    # Configure message compaction to reduce token usage (40-60% savings)
    message_compaction = MessageCompactionSettings(
        enabled=True,
        compact_every_n_steps=15,
        trigger_char_count=30000,  # ~7.5k tokens
        keep_last_items=4,
        summary_max_chars=4000,
    )

    agent = Agent(
        task=task_prompt,
        llm=llm,
        browser=browser,
        additional_context=system_prompt,  # Inject our profile context
        available_file_paths=available_files,  # Allow resume upload
        # Performance optimizations
        flash_mode=is_simple_ats,
        max_actions_per_step=3,  # Reduce from default 5 for better reliability
        # Token reduction
        message_compaction=message_compaction,
        vision_detail_level='low',  # Reduce vision token usage
        # Disable unnecessary features for form filling
        enable_planning=False,
        use_judge=False,
        generate_gif=False,
        # Cost tracking
        calculate_cost=True,
    )

    # Retry configuration
    max_retries = 3
    retry_count = 0
    last_error = None

    try:
        while retry_count <= max_retries:
            try:
                if retry_count > 0:
                    print(f"\n{'=' * 60}")
                    print(f"RETRY ATTEMPT {retry_count}/{max_retries}")
                    print(f"{'=' * 60}")

                    # Analyze the error with AI and get recovery suggestions
                    recovery_prompt = await analyze_error_with_ai(llm, last_error, url, profile)
                    if recovery_prompt:
                        print(f"\n[AI Recovery] {recovery_prompt}")
                        # Update task prompt with recovery instructions
                        task_prompt = f"{task_prompt}\n\nPREVIOUS ATTEMPT FAILED. RECOVERY INSTRUCTIONS:\n{recovery_prompt}"

                        # Recreate agent with updated prompt (keep same optimizations)
                        agent = Agent(
                            task=task_prompt,
                            llm=llm,
                            browser=browser,
                            additional_context=system_prompt,
                            available_file_paths=available_files,
                            # Performance optimizations
                            flash_mode=is_simple_ats,
                            max_actions_per_step=3,
                            # Token reduction
                            message_compaction=message_compaction,
                            vision_detail_level='low',
                            # Disable unnecessary features
                            enable_planning=False,
                            use_judge=False,
                            generate_gif=False,
                            # Cost tracking
                            calculate_cost=True,
                        )

                result = await agent.run()

                print("\n" + "=" * 60)
                print("AGENT COMPLETED")
                print("=" * 60)
                print("\nResult:")
                print(result)

                # Print cost tracking info if available
                if hasattr(agent, 'token_cost_service') and agent.token_cost_service:
                    try:
                        usage = await agent.token_cost_service.get_usage_summary()
                        print(f"\n[Cost Tracking]")
                        print(f"  Total tokens: {usage.total_tokens}")
                        print(f"  Total cost: ${usage.total_cost:.4f}")
                    except Exception as e:
                        print(f"\n[Cost Tracking] Could not retrieve usage: {e}")

                # Check if the result indicates success or failure
                if hasattr(result, 'all_results') and result.all_results:
                    last_result = result.all_results[-1]
                    if hasattr(last_result, 'is_done') and last_result.is_done:
                        if hasattr(last_result, 'success') and last_result.success is False:
                            # Agent completed but reported failure - may want to retry
                            error_msg = getattr(last_result, 'error', None) or "Agent reported failure"
                            if retry_count < max_retries:
                                print(f"\n[Retry] Agent reported failure: {error_msg}")
                                last_error = error_msg
                                retry_count += 1
                                continue

                # Update status based on completion
                if tracker:
                    if auto_submit:
                        tracker.mark_submitted()
                    else:
                        tracker.update_status("review")

                return result

            except Exception as e:
                last_error = str(e)
                print(f"\nError (attempt {retry_count + 1}): {e}")

                if retry_count < max_retries:
                    retry_count += 1
                    print(f"\n[Retry] Will attempt recovery...")
                    continue
                else:
                    # Max retries exceeded - record final error
                    if tracker:
                        error_msg = f"Failed after {max_retries + 1} attempts. Last error: {str(e)[:400]}"
                        tracker.set_error(error_msg)
                    raise

        # Should not reach here, but just in case
        if tracker:
            tracker.set_error(f"Unexpected exit after {retry_count} retries")
        return None

    finally:
        # Only close the browser if we created it (allows session reuse)
        if owns_browser:
            await browser.close()
            print("[Browser] Session closed")


def main():
    parser = argparse.ArgumentParser(description="Auto-apply to jobs using AI")
    parser.add_argument("--url", "-u", required=True, help="Job application URL")
    parser.add_argument("--profile", "-p", default="profile.yaml", help="Path to profile YAML")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    parser.add_argument("--auto-submit", action="store_true", help="Automatically submit (skip review)")
    parser.add_argument("--job-id", help="Job ID for database tracking")
    parser.add_argument("--user-id", help="User ID for database tracking")

    args = parser.parse_args()

    # Create status tracker if both job-id and user-id are provided
    tracker = None
    if args.job_id and args.user_id:
        print(f"\n[Database] Tracking enabled for job_id={args.job_id}, user_id={args.user_id}")
        tracker = StatusTracker(user_id=args.user_id, job_id=args.job_id)
    elif args.job_id or args.user_id:
        print("\n[Warning] Both --job-id and --user-id required for database tracking. Running in standalone mode.")
    else:
        print("\n[Info] Running in standalone mode (no database tracking)")

    asyncio.run(run_agent(
        url=args.url,
        profile_path=args.profile,
        headless=args.headless,
        auto_submit=args.auto_submit,
        tracker=tracker
    ))


if __name__ == "__main__":
    main()
