# Open Source Job Auto-Apply Projects

Research on existing open-source job application automation tools and their architectures.

---

## Top Projects Overview

| Project | Stars | Tech Stack | Target Platforms | Status |
|---------|-------|------------|------------------|--------|
| Auto_Jobs_Applier_AIHawk | ~70k+ | Python, Selenium, OpenAI | LinkedIn Easy Apply | Active |
| LinkedIn_AIHawk | ~30k+ | Python, Selenium, LLM | LinkedIn | Active |
| EasyApplyBot | ~3k+ | Python, Selenium | LinkedIn | Maintained |
| JobSpy | ~10k+ | Python, httpx | LinkedIn, Indeed, Glassdoor, ZipRecruiter | Active |
| JobFunnel | ~2k+ | Python, Selenium | Indeed, GlassDoor, Monster | Maintained |
| LinkedInJobsApplier | ~1k+ | Python, Selenium | LinkedIn | Maintained |
| Indeed-Apply-Bot | ~500+ | Python, Selenium | Indeed | Older |
| Greenhouse-Apply | ~200+ | Python, Playwright | Greenhouse ATS | Active |

---

## 1. Auto_Jobs_Applier_AIHawk (LinkedIn Easy Apply)

**Repository:** https://github.com/feder-cr/Auto_Jobs_Applier_AIHawk

**Stars:** ~70,000+ (most popular in this space)

### Tech Stack
- Python 3.10+
- Selenium WebDriver
- OpenAI GPT API (for generating answers)
- YAML configuration
- Chrome/Chromium

### Architecture Approach
```
config/
  ├── config.yaml           # Main settings (job titles, locations, etc.)
  ├── plain_text_resume.yaml # Resume data in structured format
  └── secrets.yaml          # API keys, credentials
src/
  ├── main.py               # Entry point
  ├── linkedIn_easy_applier.py
  ├── linkedIn_job_manager.py
  ├── llm_manager.py        # AI answer generation
  └── utils.py
```

### Key Code Patterns

**LLM-Powered Answer Generation:**
```python
class LLMManager:
    def __init__(self, api_key: str):
        self.client = OpenAI(api_key=api_key)
    
    def generate_answer(self, question: str, context: str) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are filling out job applications..."},
                {"role": "user", "content": f"Question: {question}\nContext: {context}"}
            ]
        )
        return response.choices[0].message.content
```

**Resume YAML Structure:**
```yaml
personal_information:
  name: "John Doe"
  phone: "+1234567890"
  email: "john@example.com"
  
experience:
  - title: "Software Engineer"
    company: "Tech Corp"
    duration: "2020-2023"
    description: "Built scalable systems..."

education:
  - degree: "BS Computer Science"
    university: "State University"
    year: 2020
```

**Selenium Page Interaction:**
```python
def fill_text_field(self, element_id: str, value: str):
    element = WebDriverWait(self.driver, 10).until(
        EC.presence_of_element_located((By.ID, element_id))
    )
    element.clear()
    element.send_keys(value)
```

### Lessons Learned
- YAML config makes the tool user-friendly without coding
- LLM integration solves the "custom question" problem elegantly
- Rate limiting and random delays prevent detection
- Chrome profile persistence maintains login state
- Blacklist tracking prevents re-applying to rejected companies

---

## 2. JobSpy (Multi-Platform Scraper)

**Repository:** https://github.com/Bunsly/JobSpy

**Stars:** ~10,000+

### Tech Stack
- Python 3.10+
- httpx (async HTTP)
- pandas
- No browser automation (API-based)

### Architecture Approach
```
jobspy/
  ├── scrapers/
  │   ├── linkedin.py
  │   ├── indeed.py
  │   ├── glassdoor.py
  │   └── ziprecruiter.py
  ├── jobs.py              # Common job model
  └── __init__.py
```

### Key Code Patterns

**Clean Scraper Interface:**
```python
from jobspy import scrape_jobs
import pandas as pd

jobs: pd.DataFrame = scrape_jobs(
    site_name=["indeed", "linkedin", "glassdoor", "zip_recruiter"],
    search_term="software engineer",
    google_search_term="software engineer jobs near me",
    location="San Francisco, CA",
    results_wanted=50,
    hours_old=72,
    country_indeed="USA"
)

# Export to CSV
jobs.to_csv("jobs.csv", index=False)
```

**Job Data Model:**
```python
@dataclass
class JobPost:
    title: str
    company: str
    location: str
    job_url: str
    description: str
    date_posted: datetime
    salary_min: Optional[int]
    salary_max: Optional[int]
    job_type: Optional[str]  # Full-time, Part-time, Contract
    is_remote: bool
    source: str  # indeed, linkedin, etc.
```

**API-Based Scraping (no Selenium):**
```python
async def scrape_linkedin(self, search_term: str, location: str):
    # LinkedIn has a public jobs API endpoint
    url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    params = {
        "keywords": search_term,
        "location": location,
        "start": 0,
        "count": 25
    }
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        # Parse HTML response
```

### Lessons Learned
- API-based scraping is faster and more reliable than Selenium
- pandas integration makes data export trivial
- Multi-site support increases job coverage significantly
- Async HTTP requests improve performance dramatically
- Public job listing endpoints often don't require auth

---

## 3. EasyApplyBot

**Repository:** https://github.com/nicolomantini/LinkedIn-Easy-Apply-Bot

**Stars:** ~3,000+

### Tech Stack
- Python 3.x
- Selenium WebDriver
- JSON configuration

### Key Code Patterns

**Question Answer Mapping:**
```python
# Pre-defined answers for common questions
ANSWER_MAP = {
    "years of experience": "3",
    "work authorization": "Yes",
    "require sponsorship": "No",
    "willing to relocate": "Yes",
    "salary expectations": "120000",
    "start date": "2 weeks"
}

def answer_question(self, question_text: str) -> str:
    question_lower = question_text.lower()
    for key, answer in ANSWER_MAP.items():
        if key in question_lower:
            return answer
    return ""  # Leave blank if unknown
```

**Application State Tracking:**
```python
class ApplicationTracker:
    def __init__(self, db_path: str):
        self.conn = sqlite3.connect(db_path)
        self._create_tables()
    
    def mark_applied(self, job_id: str, company: str, title: str):
        self.conn.execute("""
            INSERT INTO applications (job_id, company, title, applied_at)
            VALUES (?, ?, ?, datetime('now'))
        """, (job_id, company, title))
        self.conn.commit()
    
    def already_applied(self, job_id: str) -> bool:
        cursor = self.conn.execute(
            "SELECT 1 FROM applications WHERE job_id = ?", (job_id,)
        )
        return cursor.fetchone() is not None
```

### Lessons Learned
- Simple question-answer mapping works for ~80% of cases
- SQLite tracking prevents duplicate applications
- Headless mode reduces resource usage but may trigger detection
- Human-like delays (2-5 seconds) between actions are essential

---

## 4. Greenhouse Automation Tools

**Repository Examples:**
- https://github.com/apify/actor-greenhouse-scraper
- https://github.com/simplify-jobs/Greenhouse-Scraper

### Architecture for ATS Automation

**Greenhouse Form Structure:**
```python
# Greenhouse uses consistent field IDs
GREENHOUSE_FIELDS = {
    "first_name": "#first_name",
    "last_name": "#last_name",
    "email": "#email",
    "phone": "#phone",
    "resume": "input[type='file'][name*='resume']",
    "cover_letter": "textarea[name*='cover_letter']",
    "linkedin": "input[name*='linkedin']",
    "website": "input[name*='website']"
}
```

**Playwright-Based Approach (More Modern):**
```python
from playwright.sync_api import sync_playwright

class GreenhouseApplier:
    def __init__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=False)
        self.page = self.browser.new_page()
    
    def apply(self, job_url: str, resume_path: str, data: dict):
        self.page.goto(job_url)
        
        # Fill standard fields
        self.page.fill("#first_name", data["first_name"])
        self.page.fill("#last_name", data["last_name"])
        self.page.fill("#email", data["email"])
        
        # Upload resume
        self.page.set_input_files("input[type='file']", resume_path)
        
        # Handle custom questions
        custom_questions = self.page.query_selector_all(".custom-question")
        for q in custom_questions:
            self._answer_question(q, data)
        
        # Submit
        self.page.click("button[type='submit']")
```

### Lessons Learned
- Greenhouse has consistent HTML structure across companies
- Lever, Workday, Taleo each need separate implementations
- Resume file upload is the trickiest part (drag-drop vs input)
- Custom questions vary widely between companies

---

## 5. JobFunnel

**Repository:** https://github.com/PaulMcInnis/JobFunnel

**Stars:** ~2,000+

### Tech Stack
- Python 3.8+
- Selenium
- YAML config
- CSV/JSON output

### Key Code Patterns

**Job Filtering System:**
```python
class JobFilter:
    def __init__(self, config: dict):
        self.blocked_companies = config.get("blocked_companies", [])
        self.required_keywords = config.get("required_keywords", [])
        self.blocked_keywords = config.get("blocked_keywords", [])
        self.min_salary = config.get("min_salary", 0)
    
    def passes(self, job: Job) -> bool:
        # Company blacklist
        if job.company.lower() in [c.lower() for c in self.blocked_companies]:
            return False
        
        # Keyword requirements
        desc_lower = job.description.lower()
        for kw in self.required_keywords:
            if kw.lower() not in desc_lower:
                return False
        
        # Blocked keywords
        for kw in self.blocked_keywords:
            if kw.lower() in desc_lower:
                return False
        
        return True
```

**Deduplication Logic:**
```python
def deduplicate_jobs(new_jobs: List[Job], existing_jobs: List[Job]) -> List[Job]:
    existing_ids = {job.id for job in existing_jobs}
    existing_urls = {job.url for job in existing_jobs}
    
    unique = []
    for job in new_jobs:
        if job.id not in existing_ids and job.url not in existing_urls:
            # Also check for similar titles at same company
            is_duplicate = any(
                j.company == job.company and 
                similarity(j.title, job.title) > 0.8
                for j in existing_jobs
            )
            if not is_duplicate:
                unique.append(job)
    
    return unique
```

### Lessons Learned
- Job deduplication is crucial for multi-source aggregation
- Fuzzy matching catches "Software Engineer" vs "Software Engineer I"
- Company blacklists save significant time
- Daily runs with incremental updates work better than full scrapes

---

## 6. SimplifyJobs Browser Extension

**Repository:** https://github.com/SimplifyJobs/Summer2024-Internships

**Approach:** Curated job list + browser extension for one-click apply

### Key Patterns

**Job Data Structure (JSON):**
```json
{
  "company": "Google",
  "title": "Software Engineer, New Grad",
  "url": "https://careers.google.com/jobs/...",
  "locations": ["Mountain View, CA", "New York, NY"],
  "sponsorship": "yes",
  "date_posted": "2024-01-15",
  "active": true,
  "source": "company_website"
}
```

### Lessons Learned
- Community-sourced job lists provide high signal
- Browser extensions can pre-fill forms on any site
- JSON-based job databases are easy to maintain
- "Active" status tracking prevents applying to closed positions

---

## Code Snippets to Adapt

### 1. Rate Limiting Decorator
```python
import time
import random
from functools import wraps

def rate_limit(min_delay: float = 2.0, max_delay: float = 5.0):
    """Add random delays between function calls to avoid detection."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            delay = random.uniform(min_delay, max_delay)
            time.sleep(delay)
            return result
        return wrapper
    return decorator

@rate_limit(2.0, 5.0)
def apply_to_job(job_url: str):
    # Application logic
    pass
```

### 2. Robust Element Finder
```python
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

def find_element_robust(driver, locators: list, timeout: int = 10):
    """Try multiple locator strategies to find an element."""
    for by, value in locators:
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return element
        except TimeoutException:
            continue
    raise Exception(f"Could not find element with any locator: {locators}")

# Usage
email_field = find_element_robust(driver, [
    (By.ID, "email"),
    (By.NAME, "email"),
    (By.CSS_SELECTOR, "input[type='email']"),
    (By.XPATH, "//input[contains(@placeholder, 'email')]")
])
```

### 3. Application Status Tracker
```python
from enum import Enum
from datetime import datetime
from sqlalchemy import create_engine, Column, String, DateTime, Enum as SQLEnum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

class ApplicationStatus(Enum):
    APPLIED = "applied"
    REJECTED = "rejected"
    INTERVIEW = "interview"
    OFFER = "offer"
    NO_RESPONSE = "no_response"

Base = declarative_base()

class Application(Base):
    __tablename__ = "applications"
    
    id = Column(String, primary_key=True)
    job_url = Column(String, unique=True)
    company = Column(String)
    title = Column(String)
    status = Column(SQLEnum(ApplicationStatus), default=ApplicationStatus.APPLIED)
    applied_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)
```

### 4. LLM Question Answerer
```python
from anthropic import Anthropic

class QuestionAnswerer:
    def __init__(self, resume_text: str):
        self.client = Anthropic()
        self.resume = resume_text
        self.cache = {}
    
    def answer(self, question: str) -> str:
        # Check cache first
        cache_key = question.lower().strip()
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        response = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            messages=[{
                "role": "user",
                "content": f"""Based on this resume, answer the job application question concisely.

RESUME:
{self.resume}

QUESTION: {question}

Answer in 1-2 sentences max. Be direct and professional."""
            }]
        )
        
        answer = response.content[0].text
        self.cache[cache_key] = answer
        return answer
```

### 5. Playwright Form Filler
```python
from playwright.async_api import async_playwright, Page

class FormFiller:
    def __init__(self, page: Page, data: dict):
        self.page = page
        self.data = data
    
    async def fill_form(self):
        # Standard fields
        await self._fill_if_exists("input[name*='first']", self.data.get("first_name"))
        await self._fill_if_exists("input[name*='last']", self.data.get("last_name"))
        await self._fill_if_exists("input[type='email']", self.data.get("email"))
        await self._fill_if_exists("input[type='tel']", self.data.get("phone"))
        
        # Resume upload
        resume_input = await self.page.query_selector("input[type='file']")
        if resume_input and self.data.get("resume_path"):
            await resume_input.set_input_files(self.data["resume_path"])
    
    async def _fill_if_exists(self, selector: str, value: str):
        if not value:
            return
        element = await self.page.query_selector(selector)
        if element:
            await element.fill(value)
```

---

## Summary: Key Takeaways for HireRadar

### Architecture Recommendations
1. **Modular scraper design** - Separate scraper per job board (LinkedIn, Indeed, Greenhouse)
2. **YAML/JSON config** - User-friendly configuration without code changes
3. **LLM integration** - Essential for handling custom application questions
4. **SQLite/Postgres tracking** - Prevent duplicate applications, track status
5. **Playwright over Selenium** - Modern, async, better API

### Must-Have Features
1. Application deduplication by URL and fuzzy title matching
2. Company blacklist support
3. Rate limiting with random delays
4. Resume parsing and structured storage
5. Answer caching to reduce LLM costs
6. Headless mode option for server deployment

### Anti-Detection Strategies
1. Random delays (2-5 seconds between actions)
2. Human-like mouse movements
3. Persistent browser profiles
4. Rotating user agents
5. Respect robots.txt and rate limits

### Useful Direct Links
- AIHawk Main Logic: https://github.com/feder-cr/Auto_Jobs_Applier_AIHawk/blob/main/src/linkedIn_easy_applier.py
- JobSpy Scrapers: https://github.com/Bunsly/JobSpy/tree/main/src/jobspy/scrapers
- EasyApplyBot Core: https://github.com/nicolomantini/LinkedIn-Easy-Apply-Bot/blob/master/easyapplybot.py
- SimplifyJobs Data: https://github.com/SimplifyJobs/Summer2024-Internships/blob/dev/.github/scripts/listings.json
