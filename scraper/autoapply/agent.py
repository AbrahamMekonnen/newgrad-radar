"""Auto-apply agent using browser-use with AI."""

import asyncio
import json
import os
from typing import Optional
from dataclasses import dataclass

try:
    from browser_use import Agent, Browser, BrowserConfig
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_groq import ChatGroq
    from langchain_ollama import ChatOllama
    BROWSER_USE_AVAILABLE = True
except ImportError:
    BROWSER_USE_AVAILABLE = False

from supabase import create_client, Client


@dataclass
class UserProfile:
    """User profile data for auto-apply."""
    user_id: str
    first_name: Optional[str]
    last_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    location: Optional[str]
    linkedin_url: Optional[str]
    portfolio_url: Optional[str]
    github_url: Optional[str]
    resume_url: Optional[str]
    work_authorization: Optional[str]
    require_sponsorship: Optional[bool]
    years_experience: Optional[str]
    start_date: Optional[str]
    salary_expectation: Optional[str]
    willing_to_relocate: Optional[bool]
    custom_answers: dict
    auto_submit: bool


@dataclass
class JobApplication:
    """Job application data."""
    job_id: str
    job_url: str
    company_name: str
    job_title: str
    ats_type: Optional[str]


def get_supabase_client() -> Client:
    """Get Supabase client."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

    return create_client(url, key)


def fetch_user_profile(user_id: str) -> Optional[UserProfile]:
    """Fetch user profile from database."""
    client = get_supabase_client()

    result = client.table("user_profiles").select("*").eq("user_id", user_id).single().execute()

    if not result.data:
        return None

    data = result.data
    return UserProfile(
        user_id=data["user_id"],
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
        email=data.get("email"),
        phone=data.get("phone"),
        location=data.get("location"),
        linkedin_url=data.get("linkedin_url"),
        portfolio_url=data.get("portfolio_url"),
        github_url=data.get("github_url"),
        resume_url=data.get("resume_url"),
        work_authorization=data.get("work_authorization"),
        require_sponsorship=data.get("require_sponsorship"),
        years_experience=data.get("years_experience"),
        start_date=data.get("start_date"),
        salary_expectation=data.get("salary_expectation"),
        willing_to_relocate=data.get("willing_to_relocate"),
        custom_answers=data.get("custom_answers") or {},
        auto_submit=data.get("auto_submit", False),
    )


def fetch_pending_applications(user_id: str) -> list[JobApplication]:
    """Fetch pending applications for a user."""
    client = get_supabase_client()

    result = client.table("application_logs").select(
        "job_id, jobs(url, company_name, title, source)"
    ).eq("user_id", user_id).eq("status", "pending").execute()

    applications = []
    for row in result.data or []:
        job = row.get("jobs", {})
        applications.append(JobApplication(
            job_id=row["job_id"],
            job_url=job.get("url", ""),
            company_name=job.get("company_name", ""),
            job_title=job.get("title", ""),
            ats_type=job.get("source"),
        ))

    return applications


def update_application_status(job_id: str, user_id: str, status: str, error_message: Optional[str] = None):
    """Update application status in database."""
    client = get_supabase_client()

    update_data = {"status": status}
    if error_message:
        update_data["error_message"] = error_message
    if status == "submitted":
        from datetime import datetime
        update_data["submitted_at"] = datetime.utcnow().isoformat()

    client.table("application_logs").update(update_data).eq(
        "job_id", job_id
    ).eq("user_id", user_id).execute()


def get_llm():
    """Get LLM with fallback chain: Ollama -> Groq -> Gemini."""
    # Try Ollama first (local, free)
    ollama_model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    try:
        llm = ChatOllama(model=ollama_model, temperature=0)
        return llm
    except Exception:
        pass

    # Try Groq (fast, free tier)
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            return ChatGroq(
                api_key=groq_key,
                model_name="llama-3.1-70b-versatile",
                temperature=0,
            )
        except Exception:
            pass

    # Fall back to Gemini
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-exp",
            google_api_key=gemini_key,
            temperature=0,
        )

    raise ValueError("No LLM available. Set OLLAMA_MODEL, GROQ_API_KEY, or GEMINI_API_KEY")


def build_apply_prompt(profile: UserProfile, job: JobApplication) -> str:
    """Build the prompt for the auto-apply agent."""
    profile_info = f"""
You are applying for a job. Here is the applicant's information:

Name: {profile.first_name or ''} {profile.last_name or ''}
Email: {profile.email or ''}
Phone: {profile.phone or ''}
Location: {profile.location or ''}
LinkedIn: {profile.linkedin_url or ''}
Portfolio: {profile.portfolio_url or ''}
GitHub: {profile.github_url or ''}
Work Authorization: {profile.work_authorization or 'Authorized to work'}
Requires Sponsorship: {'Yes' if profile.require_sponsorship else 'No'}
Years of Experience: {profile.years_experience or 'Entry level / New grad'}
Earliest Start Date: {profile.start_date or 'Immediately'}
Salary Expectation: {profile.salary_expectation or 'Negotiable'}
Willing to Relocate: {'Yes' if profile.willing_to_relocate else 'No'}

Job Details:
Company: {job.company_name}
Position: {job.job_title}
URL: {job.job_url}
"""

    if profile.custom_answers:
        profile_info += "\nCustom Answers for Common Questions:\n"
        for q, a in profile.custom_answers.items():
            profile_info += f"Q: {q}\nA: {a}\n"

    instructions = """
TASK: Fill out the job application form on this page.

INSTRUCTIONS:
1. Navigate to the job URL
2. Look for an "Apply" button and click it
3. Fill out all required fields using the applicant information above
4. For questions not covered above, use reasonable defaults or skip if optional
5. If there's a resume upload field, note that we need to handle it separately
6. DO NOT click the final submit button - stop at the review step
7. Report what fields you filled and any issues encountered

If you encounter a login wall or CAPTCHA, report it and stop.
"""

    if profile.auto_submit:
        instructions = instructions.replace(
            "DO NOT click the final submit button - stop at the review step",
            "Click the final submit button to complete the application"
        )

    return profile_info + instructions


async def apply_to_job(profile: UserProfile, job: JobApplication, headless: bool = True) -> dict:
    """Apply to a single job using browser-use agent."""
    if not BROWSER_USE_AVAILABLE:
        return {
            "success": False,
            "error": "browser-use library not installed. Run: pip install browser-use",
        }

    browser = None
    try:
        llm = get_llm()
        prompt = build_apply_prompt(profile, job)

        browser = Browser(config=BrowserConfig(headless=headless))

        agent = Agent(
            task=prompt,
            llm=llm,
            browser=browser,
        )

        result = await agent.run()

        return {
            "success": True,
            "result": str(result),
            "auto_submitted": profile.auto_submit,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }
    finally:
        if browser:
            await browser.close()


async def process_pending_applications(user_id: str, headless: bool = True) -> list[dict]:
    """Process all pending applications for a user."""
    profile = fetch_user_profile(user_id)
    if not profile:
        return [{"error": f"No profile found for user {user_id}"}]

    applications = fetch_pending_applications(user_id)
    if not applications:
        return [{"info": "No pending applications"}]

    results = []
    for job in applications:
        update_application_status(job.job_id, user_id, "filling")

        result = await apply_to_job(profile, job, headless=headless)

        if result.get("success"):
            status = "submitted" if result.get("auto_submitted") else "review"
            update_application_status(job.job_id, user_id, status)
        else:
            update_application_status(job.job_id, user_id, "failed", result.get("error"))

        results.append({
            "job_id": job.job_id,
            "company": job.company_name,
            "title": job.job_title,
            **result,
        })

    return results


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python agent.py <user_id> [--visible]")
        sys.exit(1)

    user_id = sys.argv[1]
    headless = "--visible" not in sys.argv

    print(f"Processing applications for user: {user_id}")
    print(f"Headless mode: {headless}")

    results = asyncio.run(process_pending_applications(user_id, headless=headless))
    print(json.dumps(results, indent=2))
