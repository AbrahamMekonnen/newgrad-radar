"""AmbitionBox India interview questions scraper.

Scrapes interview experiences from ambitionbox.com, which covers:
- FAANG India offices (Google, Amazon, Microsoft, Meta, Apple)
- Indian tech unicorns (Flipkart, Swiggy, Zomato, Razorpay, PhonePe, CRED)
- Indian IT services (TCS, Infosys, Wipro, HCL, Tech Mahindra)
- Startups and other tech companies

Filters to last 4-5 months of interview data by default.

Uses production infrastructure:
- ResponseCache for HTTP response caching
- AdaptiveRateLimiter for intelligent rate limiting
- ValidationPipeline for data quality
- Monitoring for metrics tracking
"""

import re
import hashlib
import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape
from urllib.parse import urljoin, quote
import urllib3
import sys
import os

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import production infrastructure
try:
    from utils import (
        ResponseCache,
        AdaptiveRateLimiter,
        ValidationPipeline,
        validate_questions,
        monitor_scraper,
        ScraperErrorHandler,
        get_stealth_headers,
    )
    from utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False
    print("[AmbitionBox] Warning: Infrastructure modules not available, using fallback")

REQUEST_TIMEOUT = 30
VERIFY_SSL = False
BASE_URL = "https://www.ambitionbox.com"
DEFAULT_TTL = 3600  # 1 hour cache

# Infrastructure components
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_checkpoint: Optional['CheckpointManager'] = None


def _get_checkpoint() -> Optional['CheckpointManager']:
    """Get or create checkpoint manager."""
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("ambitionbox")
        except Exception:
            pass
    return _checkpoint


def _get_cache() -> Optional['ResponseCache']:
    """Get or create response cache."""
    global _cache
    if _cache is None and INFRA_AVAILABLE:
        try:
            _cache = ResponseCache(name='ambitionbox', ttl=DEFAULT_TTL)
        except Exception:
            pass
    return _cache


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter."""
    global _rate_limiter
    if _rate_limiter is None and INFRA_AVAILABLE:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                min_delay=1.0,
                max_delay=4.0,
                initial_delay=1.5,
            )
        except Exception:
            pass
    return _rate_limiter

# Major companies to scrape (company slug -> display name)
TARGET_COMPANIES = {
    # FAANG India
    "google": "Google",
    "amazon": "Amazon",
    "microsoft": "Microsoft",
    "meta": "Meta",
    "apple": "Apple",
    "netflix": "Netflix",
    # Indian Tech Unicorns
    "flipkart": "Flipkart",
    "swiggy": "Swiggy",
    "zomato": "Zomato",
    "razorpay": "Razorpay",
    "phonepe": "PhonePe",
    "paytm": "Paytm",
    "cred": "CRED",
    "meesho": "Meesho",
    "byju-s": "Byju's",
    "ola": "Ola",
    "uber-india": "Uber",
    "myntra": "Myntra",
    "dream11": "Dream11",
    "groww": "Groww",
    "zerodha": "Zerodha",
    "nykaa": "Nykaa",
    "freshworks": "Freshworks",
    "zoho-corporation": "Zoho",
    "browserstack": "BrowserStack",
    "postman": "Postman",
    "chargebee": "Chargebee",
    "druva": "Druva",
    "hashedin-by-deloitte": "HashedIn",
    "atlassian": "Atlassian",
    # IT Services
    "tata-consultancy-services": "TCS",
    "infosys": "Infosys",
    "wipro": "Wipro",
    "hcl-technologies": "HCL",
    "tech-mahindra": "Tech Mahindra",
    "cognizant": "Cognizant",
    "capgemini": "Capgemini",
    "accenture": "Accenture",
    # Finance/Fintech
    "goldman-sachs": "Goldman Sachs",
    "morgan-stanley": "Morgan Stanley",
    "jpmorgan-chase-co": "JPMorgan",
    "deutsche-bank": "Deutsche Bank",
    "barclays": "Barclays",
    # Other Tech
    "adobe": "Adobe",
    "oracle": "Oracle",
    "salesforce": "Salesforce",
    "intuit": "Intuit",
    "vmware": "VMware",
    "nvidia": "NVIDIA",
    "qualcomm": "Qualcomm",
    "samsung-india": "Samsung",
    "ibm": "IBM",
    "cisco": "Cisco",
    "dell": "Dell",
    "linkedin": "LinkedIn",
    "uber": "Uber",
    "airbnb": "Airbnb",
    "stripe": "Stripe",
    "shopify": "Shopify",
    "twitter": "Twitter",
    "snap-inc": "Snap",
    "spotify": "Spotify",
    "booking-com": "Booking.com",
    "expedia": "Expedia",
}

# Role type patterns
ROLE_PATTERNS = {
    "swe": [r"software\s*engineer", r"sde", r"developer", r"programmer", r"swe\b"],
    "backend": [r"backend", r"back\s*end", r"server\s*side"],
    "frontend": [r"frontend", r"front\s*end", r"ui\s*developer", r"react", r"angular"],
    "fullstack": [r"full\s*stack", r"fullstack", r"mern", r"mean"],
    "ml": [r"machine\s*learning", r"ml\s*engineer", r"data\s*scientist", r"ai\s*engineer", r"deep\s*learning"],
    "data": [r"data\s*engineer", r"data\s*analyst", r"analytics", r"etl"],
    "devops": [r"devops", r"sre", r"site\s*reliability", r"platform\s*engineer", r"infrastructure"],
    "mobile": [r"android", r"ios", r"mobile\s*developer", r"react\s*native", r"flutter"],
    "qa": [r"qa\s*engineer", r"test\s*engineer", r"sdet", r"quality\s*assurance", r"automation"],
    "intern": [r"intern", r"internship"],
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "technical": [
        r"data\s*structure", r"algorithm", r"code", r"implement", r"leetcode",
        r"array", r"linked\s*list", r"tree", r"graph", r"dynamic\s*programming",
        r"hash", r"sorting", r"searching", r"recursion", r"string",
        r"time\s*complexity", r"space\s*complexity", r"optimize",
    ],
    "system_design": [
        r"system\s*design", r"design\s*a", r"scalability", r"distributed",
        r"architecture", r"database\s*design", r"api\s*design", r"microservice",
        r"load\s*balancer", r"cache", r"cdn", r"message\s*queue",
    ],
    "behavioral": [
        r"tell\s*me\s*about", r"describe\s*a\s*time", r"situation", r"challenge",
        r"weakness", r"strength", r"why\s*do\s*you\s*want", r"conflict",
        r"leadership", r"teamwork", r"failure", r"success\s*story",
        r"career", r"goals", r"yourself", r"experience",
    ],
    "hr": [
        r"salary", r"ctc", r"notice\s*period", r"relocation", r"joining",
        r"expected\s*ctc", r"current\s*ctc", r"offer", r"negotiate",
    ],
    "online_assessment": [
        r"online\s*assessment", r"oa\b", r"hackerrank", r"codility",
        r"coding\s*round", r"aptitude", r"mcq",
    ],
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": [r"\beasy\b", r"\bsimple\b", r"\bbasic\b", r"\bstraightforward\b"],
    "medium": [r"\bmedium\b", r"\bmoderate\b", r"\bintermediate\b", r"\baverage\b"],
    "hard": [r"\bhard\b", r"\bdifficult\b", r"\bchallenging\b", r"\btricky\b", r"\bcomplex\b"],
}


@dataclass
class InterviewQuestion:
    """Represents a single interview question from AmbitionBox."""
    id: str
    company: str
    position: str
    question_type: str
    difficulty: str
    question_text: str
    source: str
    source_url: str
    posted_date: Optional[str]
    interview_round: Optional[str]
    tags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def generate_id(company: str, question: str) -> str:
    """Generate unique ID from company and question text."""
    content = f"{company.lower()}:{question.lower()}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def clean_text(text: str) -> str:
    """Clean HTML and normalize whitespace."""
    if not text:
        return ""
    # Remove HTML tags
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_relative_date(date_str: str) -> Optional[datetime]:
    """Parse relative date strings like '2 months ago', '3 days ago'."""
    if not date_str:
        return None

    date_str = date_str.lower().strip()
    now = datetime.now()

    # Handle "X days ago"
    days_match = re.search(r"(\d+)\s*days?\s*ago", date_str)
    if days_match:
        days = int(days_match.group(1))
        return now - timedelta(days=days)

    # Handle "X weeks ago"
    weeks_match = re.search(r"(\d+)\s*weeks?\s*ago", date_str)
    if weeks_match:
        weeks = int(weeks_match.group(1))
        return now - timedelta(weeks=weeks)

    # Handle "X months ago"
    months_match = re.search(r"(\d+)\s*months?\s*ago", date_str)
    if months_match:
        months = int(months_match.group(1))
        return now - timedelta(days=months * 30)

    # Handle "X years ago"
    years_match = re.search(r"(\d+)\s*years?\s*ago", date_str)
    if years_match:
        years = int(years_match.group(1))
        return now - timedelta(days=years * 365)

    # Handle "yesterday", "today"
    if "yesterday" in date_str:
        return now - timedelta(days=1)
    if "today" in date_str:
        return now

    # Try parsing absolute date
    for fmt in ["%d %b %Y", "%b %d, %Y", "%Y-%m-%d", "%d/%m/%Y"]:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    return None


def is_within_months(date: Optional[datetime], months: int = 5) -> bool:
    """Check if date is within the last N months."""
    if not date:
        return True  # Include if no date available
    cutoff = datetime.now() - timedelta(days=months * 30)
    return date >= cutoff


def detect_role(text: str) -> str:
    """Detect role type from text."""
    text_lower = text.lower()

    for role, patterns in ROLE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return role

    return "swe"  # Default to SWE


def detect_question_type(text: str) -> str:
    """Detect question type based on content."""
    text_lower = text.lower()

    type_scores = {}
    for qtype, patterns in QUESTION_TYPE_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, text_lower):
                score += 1
        if score > 0:
            type_scores[qtype] = score

    if type_scores:
        return max(type_scores, key=type_scores.get)

    return "technical"  # Default


def detect_difficulty(text: str) -> str:
    """Detect difficulty from text content."""
    text_lower = text.lower()

    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return difficulty

    return "medium"  # Default


def extract_tags(text: str) -> List[str]:
    """Extract topic tags from question text."""
    tags = set()
    text_lower = text.lower()

    tag_patterns = {
        "arrays": r"\barray", "strings": r"\bstring", "linked-list": r"linked\s*list",
        "trees": r"\btree", "graphs": r"\bgraph", "dynamic-programming": r"(dp|dynamic\s*programming)",
        "sorting": r"\bsort", "searching": r"\bsearch", "hashing": r"\bhash",
        "recursion": r"\brecurs", "stack": r"\bstack", "queue": r"\bqueue",
        "heap": r"\bheap", "binary-search": r"binary\s*search", "two-pointers": r"two\s*pointer",
        "sliding-window": r"sliding\s*window", "greedy": r"\bgreedy", "backtracking": r"\bbacktrack",
        "sql": r"\bsql", "database": r"\bdatabase", "api": r"\bapi\b",
        "oops": r"\b(oop|object\s*oriented)", "system-design": r"system\s*design",
        "java": r"\bjava\b", "python": r"\bpython", "javascript": r"\bjavascript",
        "react": r"\breact", "nodejs": r"\bnode", "spring": r"\bspring",
    }

    for tag, pattern in tag_patterns.items():
        if re.search(pattern, text_lower):
            tags.add(tag)

    return list(tags)


def extract_questions_from_text(text: str) -> List[str]:
    """Extract individual questions from interview experience text."""
    questions = []

    # Clean the text first
    text = clean_text(text)
    if not text:
        return questions

    # Look for question patterns
    patterns = [
        # Direct questions ending with ?
        r"([A-Z][^.!?\n]{15,200}\?)",
        # "Asked me to..." patterns
        r"(?:asked\s+(?:me\s+)?to|asked\s+about|asked\s+regarding)\s+([^.!?\n]{10,200})",
        # "Question was..." patterns
        r"(?:question\s+was|the\s+question|questions?\s*:)\s*([^.!?\n]{10,200})",
        # "Write a..." patterns (coding questions)
        r"(write\s+(?:a\s+)?(?:code|function|program|algorithm)[^.!?\n]{10,200})",
        # "Design..." patterns (system design)
        r"(design\s+(?:a\s+)?[^.!?\n]{10,200})",
        # "Implement..." patterns
        r"(implement\s+[^.!?\n]{10,200})",
        # "Explain..." patterns
        r"(explain\s+[^.!?\n]{10,150})",
        # "Find..." patterns
        r"(find\s+(?:the\s+)?[^.!?\n]{10,150})",
        # Numbered questions
        r"(?:\d+[\.\)]\s*)([A-Z][^.!?\n]{15,200})",
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            q = clean_text(match)
            if len(q) > 15 and q not in questions:
                # Filter out non-questions
                if not any(skip in q.lower() for skip in [
                    "i was", "they were", "interview was", "process was",
                    "company is", "salary is", "ctc is", "hr called",
                ]):
                    questions.append(q)

    return questions[:20]  # Limit to 20 questions per experience


def fetch_interview_page(company_slug: str, page: int = 1) -> Optional[Dict]:
    """Fetch interview experiences page for a company with caching and rate limiting."""
    url = f"{BASE_URL}/interviews/{company_slug}-interview-questions"

    if page > 1:
        url += f"?page={page}"

    # Check cache first
    cache = _get_cache()
    if cache:
        cached = cache.get(url)
        if cached:
            return {"html": cached.content, "url": url, "cached": True}

    # Apply rate limiting
    rate_limiter = _get_rate_limiter()
    if rate_limiter:
        rate_limiter.wait()
    else:
        import time
        time.sleep(1.5)  # Fallback

    # Use stealth headers if available
    if INFRA_AVAILABLE:
        headers = get_stealth_headers()
    else:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        }

    try:
        resp = requests.get(
            url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            verify=VERIFY_SSL,
        )

        # Update rate limiter with response status
        if rate_limiter:
            rate_limiter.record_request(success=resp.ok)

        if resp.status_code == 200:
            # Cache successful response
            if cache:
                cache.set(url, resp.text)
            return {"html": resp.text, "url": url}
        elif resp.status_code == 404:
            return None
        else:
            print(f"[AmbitionBox] Warning: {company_slug} returned {resp.status_code}")
            return None

    except Exception as e:
        if rate_limiter:
            rate_limiter.record_request(success=False)
        print(f"[AmbitionBox] Error fetching {company_slug}: {e}")
        return None


def parse_interview_experiences(html: str, company: str, source_url: str) -> List[Dict]:
    """Parse interview experiences from HTML page."""
    experiences = []

    # Extract interview experience blocks
    # AmbitionBox uses various patterns for interview cards

    # Pattern 1: Look for interview-card or similar structures
    experience_patterns = [
        # Interview question blocks
        r'class="[^"]*interview[^"]*"[^>]*>([^<]{50,2000})',
        # Question text in specific divs
        r'class="[^"]*question[^"]*"[^>]*>([^<]{30,1000})',
        # Experience descriptions
        r'<p[^>]*>([^<]{100,2000})</p>',
    ]

    text_blocks = []
    for pattern in experience_patterns:
        matches = re.findall(pattern, html, re.IGNORECASE | re.DOTALL)
        text_blocks.extend(matches)

    # Extract date information
    date_pattern = r'(\d+\s*(?:days?|weeks?|months?|years?)\s*ago|yesterday|today|\d{1,2}\s+\w+\s+\d{4})'
    date_matches = re.findall(date_pattern, html, re.IGNORECASE)

    # Extract role information
    role_pattern = r'(?:position|role|designation)[^>]*>\s*([^<]{5,100})'
    role_matches = re.findall(role_pattern, html, re.IGNORECASE)

    # Process each text block
    for i, text in enumerate(text_blocks):
        text = clean_text(text)
        if len(text) < 50:
            continue

        # Get associated date
        date_str = date_matches[i] if i < len(date_matches) else None
        posted_date = parse_relative_date(date_str)

        # Get associated role
        role_str = role_matches[i] if i < len(role_matches) else ""
        role = detect_role(role_str or text)

        # Extract questions from this experience
        questions = extract_questions_from_text(text)

        for q in questions:
            experiences.append({
                "company": company,
                "position": role,
                "question_text": q,
                "posted_date": posted_date.strftime("%Y-%m-%d") if posted_date else None,
                "source_url": source_url,
                "context": text[:200] if len(text) > 200 else text,
            })

    # If no structured questions found, try to extract from raw HTML
    if not experiences:
        # Look for any substantial text that might contain questions
        all_text = clean_text(html)
        questions = extract_questions_from_text(all_text)

        for q in questions[:10]:  # Limit
            experiences.append({
                "company": company,
                "position": "swe",
                "question_text": q,
                "posted_date": None,
                "source_url": source_url,
                "context": "",
            })

    return experiences


def scrape_company(company_slug: str, company_name: str, months: int = 5, max_pages: int = 3) -> List[InterviewQuestion]:
    """Scrape interview questions for a single company."""
    questions = []
    seen_questions = set()

    for page in range(1, max_pages + 1):
        print(f"[AmbitionBox] Scraping {company_name} page {page}...")

        result = fetch_interview_page(company_slug, page)
        if not result:
            break

        experiences = parse_interview_experiences(
            result["html"],
            company_name,
            result["url"]
        )

        for exp in experiences:
            # Check date filter
            if exp["posted_date"]:
                try:
                    date = datetime.strptime(exp["posted_date"], "%Y-%m-%d")
                    if not is_within_months(date, months):
                        continue
                except ValueError:
                    pass

            # Deduplicate
            q_lower = exp["question_text"].lower()
            if q_lower in seen_questions:
                continue
            seen_questions.add(q_lower)

            # Build InterviewQuestion
            question = InterviewQuestion(
                id=generate_id(company_name, exp["question_text"]),
                company=company_name,
                position=exp["position"],
                question_type=detect_question_type(exp["question_text"]),
                difficulty=detect_difficulty(exp.get("context", "") + exp["question_text"]),
                question_text=exp["question_text"],
                source="ambitionbox",
                source_url=exp["source_url"],
                posted_date=exp["posted_date"],
                interview_round=None,
                tags=extract_tags(exp["question_text"]),
            )
            questions.append(question)

        # Rate limiting is now handled by fetch_interview_page

        # Stop if we got few results (likely end of data)
        if len(experiences) < 5:
            break

    return questions


def scrape_ambitionbox(
    companies: Optional[List[str]] = None,
    months: int = 5,
    max_pages_per_company: int = 3,
    resume: bool = True,
) -> List[Dict[str, Any]]:
    """
    Scrape interview questions from AmbitionBox.

    Args:
        companies: List of company slugs to scrape. If None, scrapes all target companies.
        months: Only include questions from the last N months (default: 5)
        max_pages_per_company: Maximum pages to scrape per company (default: 3)
        resume: If True, resume from last checkpoint

    Returns:
        List of InterviewQuestion dicts
    """
    all_questions = []
    completed_slugs = set()

    # Use monitoring context if available
    monitoring_ctx = None
    if INFRA_AVAILABLE:
        try:
            monitoring_ctx = monitor_scraper('ambitionbox')
            monitoring_ctx.__enter__()
        except Exception:
            pass

    # Determine which companies to scrape
    if companies:
        company_map = {slug: TARGET_COMPANIES.get(slug, slug.title())
                       for slug in companies if slug in TARGET_COMPANIES}
    else:
        company_map = TARGET_COMPANIES

    # Load checkpoint if resuming
    checkpoint = _get_checkpoint()
    if resume and checkpoint:
        checkpoint_data = checkpoint.load()
        if checkpoint_data:
            completed_slugs = set(checkpoint_data.get("completed_slugs", []))
            all_questions = [InterviewQuestion(**q) for q in checkpoint_data.get("questions", [])]
            print(f"[AmbitionBox] Resuming from checkpoint ({len(completed_slugs)} companies done, {len(all_questions)} questions)")

    print(f"[AmbitionBox] Starting scrape for {len(company_map)} companies (last {months} months)")

    for slug, name in company_map.items():
        # Skip already completed companies
        if slug in completed_slugs:
            continue

        try:
            questions = scrape_company(slug, name, months, max_pages_per_company)
            all_questions.extend(questions)
            completed_slugs.add(slug)
            print(f"[AmbitionBox] {name}: {len(questions)} questions")

            # Save checkpoint after each company
            if checkpoint:
                checkpoint.save({
                    "completed_slugs": list(completed_slugs),
                    "questions": [q.to_dict() for q in all_questions],
                })

        except Exception as e:
            print(f"[AmbitionBox] Error scraping {name}: {e}")
            continue

    # Convert to dicts
    result = [q.to_dict() for q in all_questions]

    # Apply validation pipeline if available
    validated_result = result
    if INFRA_AVAILABLE:
        try:
            validation_output = validate_questions(result)
            validated_result = validation_output.get('valid', result)
            rejected_count = len(validation_output.get('rejected', []))
            if rejected_count > 0:
                print(f"[AmbitionBox] Validation rejected {rejected_count} low-quality questions")
        except Exception as e:
            print(f"[AmbitionBox] Validation skipped: {e}")

    # Record metrics and close monitoring
    if monitoring_ctx:
        try:
            monitoring_ctx.record_questions(
                extracted=len(result),
                new=len(validated_result),
                duplicate=0,
            )
            monitoring_ctx.__exit__(None, None, None)
        except Exception:
            pass

    # Clear checkpoint on successful completion
    if checkpoint:
        checkpoint.clear()

    print(f"[AmbitionBox] Total: {len(validated_result)} questions from {len(company_map)} companies")
    return validated_result


def scrape_ambitionbox_by_company(company_slug: str, months: int = 5) -> List[Dict[str, Any]]:
    """Scrape interview questions for a specific company."""
    return scrape_ambitionbox(companies=[company_slug], months=months)


# Alias for consistent naming with other scrapers
def fetch_ambitionbox_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_ambitionbox for consistency."""
    return scrape_ambitionbox(months=months)


if __name__ == "__main__":
    import json
    import argparse

    parser = argparse.ArgumentParser(description="Scrape AmbitionBox interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months of data to fetch")
    parser.add_argument("--company", type=str, help="Specific company slug to scrape")
    parser.add_argument("--output", type=str, help="Output JSON file")
    parser.add_argument("--limit", type=int, default=10, help="Limit number of companies")

    args = parser.parse_args()

    if args.company:
        questions = scrape_ambitionbox_by_company(args.company, args.months)
    else:
        # Scrape first N companies
        companies = list(TARGET_COMPANIES.keys())[:args.limit]
        questions = scrape_ambitionbox(companies=companies, months=args.months)

    print(f"\nScraped {len(questions)} interview questions")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(questions, f, indent=2)
        print(f"Saved to {args.output}")
    else:
        # Print sample
        for q in questions[:5]:
            print(f"\n[{q['company']}] ({q['question_type']})")
            print(f"  {q['question_text'][:100]}...")
