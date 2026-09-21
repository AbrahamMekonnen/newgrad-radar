"""AI classification for job postings using Gemini."""

import json
import os
import re
from typing import Optional

try:
    import google.generativeai as genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

from config import GEMINI_API_KEY


# Experience level patterns with confidence scores
EXPERIENCE_PATTERNS = {
    "new_grad": {
        "patterns": [
            r"\bnew\s*grad\b",
            r"\bentry\s*level\b",
            r"\b0\s*years?\b",
            r"\brecent\s*graduate\b",
            r"\buniversity\s*grad\b",
            r"\bcollege\s*grad\b",
            r"\b202[4-6]\s*grad\b",
        ],
        "confidence": 0.95,
    },
    "entry_level": {
        "patterns": [
            r"\b0-1\s*years?\b",
            r"\b0-2\s*years?\b",
            r"\b1\s*year\b(?!\s*s)",
            r"\bentry-level\b",
            r"\bjunior\b",
        ],
        "confidence": 0.85,
    },
    "junior": {
        "patterns": [
            r"\b1-2\s*years?\b",
            r"\b2\s*years?\b",
            r"\bassociate\b",
        ],
        "confidence": 0.80,
    },
    "mid": {
        "patterns": [
            r"\b3-5\s*years?\b",
            r"\bmid-level\b",
            r"\bintermediate\b",
        ],
        "confidence": 0.75,
    },
    "senior": {
        "patterns": [
            r"\bsenior\b",
            r"\b5\+\s*years?\b",
            r"\b5-7\s*years?\b",
        ],
        "confidence": 0.85,
    },
    "staff": {
        "patterns": [
            r"\bstaff\b",
            r"\bprincipal\b",
            r"\blead\b",
            r"\b7\+\s*years?\b",
        ],
        "confidence": 0.90,
    },
}


def detect_experience_level(
    title: str,
    description: str = "",
) -> dict:
    """Detect experience level from job title and description.

    Checks title first (highest weight), then description.
    Returns None if signals are conflicting or unclear.

    Args:
        title: Job title
        description: Job description (optional)

    Returns:
        Dict with experience_level, confidence, and matched_patterns.
        experience_level is None if unclear or conflicting.
    """
    result = {
        "experience_level": None,
        "confidence": 0.0,
        "matched_patterns": [],
    }

    title_lower = title.lower()
    desc_lower = description.lower() if description else ""

    # Track matches by level
    title_matches: dict[str, list[str]] = {}
    desc_matches: dict[str, list[str]] = {}

    # Check title patterns first (highest priority)
    for level, config in EXPERIENCE_PATTERNS.items():
        for pattern in config["patterns"]:
            regex = re.compile(pattern, re.IGNORECASE)
            if regex.search(title_lower):
                if level not in title_matches:
                    title_matches[level] = []
                title_matches[level].append(pattern)

    # Check description patterns
    for level, config in EXPERIENCE_PATTERNS.items():
        for pattern in config["patterns"]:
            regex = re.compile(pattern, re.IGNORECASE)
            if regex.search(desc_lower):
                if level not in desc_matches:
                    desc_matches[level] = []
                desc_matches[level].append(pattern)

    # Determine experience level
    all_matches = set(title_matches.keys()) | set(desc_matches.keys())

    if not all_matches:
        # No signals found
        return result

    # Define level hierarchy for conflict detection
    level_ranks = {
        "new_grad": 0,
        "entry_level": 1,
        "junior": 2,
        "mid": 3,
        "senior": 4,
        "staff": 5,
    }

    # Check for conflicting signals
    if len(all_matches) > 1:
        ranks = [level_ranks.get(lvl, 0) for lvl in all_matches]
        # If we have both entry-level (0-2) and senior/staff (4+), that's a conflict
        if max(ranks) - min(ranks) >= 3:
            result["matched_patterns"] = list(all_matches)
            return result  # Return None level due to conflict

    # Title matches take precedence
    if title_matches:
        # Pick highest confidence level from title matches
        best_level = None
        best_confidence = 0.0
        for level in title_matches:
            conf = EXPERIENCE_PATTERNS[level]["confidence"]
            if conf > best_confidence:
                best_confidence = conf
                best_level = level

        if best_level:
            result["experience_level"] = best_level
            result["confidence"] = best_confidence
            result["matched_patterns"] = title_matches[best_level]
            return result

    # Fall back to description matches
    if desc_matches:
        best_level = None
        best_confidence = 0.0
        for level in desc_matches:
            conf = EXPERIENCE_PATTERNS[level]["confidence"]
            # Reduce confidence for description-only matches
            effective_conf = conf * 0.9
            if effective_conf > best_confidence:
                best_confidence = effective_conf
                best_level = level

        if best_level:
            result["experience_level"] = best_level
            result["confidence"] = best_confidence
            result["matched_patterns"] = desc_matches[best_level]
            return result

    return result


CLASSIFICATION_PROMPT = """
You are classifying job postings for NEW GRAD candidates (0-2 years experience).

For each job, determine:
1. is_new_grad: true if entry-level / new grad / junior / 0-2 years
2. role_types: list of applicable types from [swe, ml, backend, frontend, fullstack, infra, data, security, mobile]

Return a JSON array with the same order as input. Each element should have:
{{"is_new_grad": true/false, "role_types": ["swe", ...]}}

JOBS:
{jobs}

Return ONLY valid JSON, no markdown or explanation.
"""


def configure_genai() -> bool:
    """Configure the Gemini API. Returns True if successful."""
    if not HAS_GENAI:
        print("google-generativeai not installed, using heuristics")
        return False

    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY not set, using heuristics")
        return False

    genai.configure(api_key=GEMINI_API_KEY)
    return True


def call_gemini(prompt: str) -> Optional[str]:
    """Call Gemini API and return response text."""
    try:
        model = genai.GenerativeModel(os.environ.get("GEMINI_MODEL", "gemini-flash-latest"))
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        print(f"Gemini API error: {e}")
        return None


def detect_role_types(title: str) -> list[str]:
    """Detect role types from job title using pattern matching."""
    title_lower = title.lower()
    roles = []

    patterns = {
        "ml": ["machine learning", "ml ", "ai ", "deep learning", "research scientist", "research engineer"],
        "backend": ["backend", "back-end", "back end", "server", "api developer", "distributed systems"],
        "frontend": ["frontend", "front-end", "front end", "react", "ui engineer", "ui developer", "web developer"],
        "fullstack": ["full stack", "fullstack", "full-stack"],
        "infra": ["infrastructure", "platform engineer", "sre", "site reliability", "devops", "cloud engineer"],
        "data": ["data engineer", "data platform", "etl", "data pipeline", "analytics engineer"],
        "security": ["security engineer", "appsec", "infosec", "cybersecurity"],
        "mobile": ["ios engineer", "ios developer", "android engineer", "android developer", "mobile engineer", "mobile developer"],
    }

    for role, keywords in patterns.items():
        if any(kw in title_lower for kw in keywords):
            roles.append(role)

    # Default to "swe" if no specific role detected
    if not roles:
        roles = ["swe"]

    return roles


def is_likely_new_grad(title: str) -> bool:
    """Heuristic fallback for new grad detection."""
    title_lower = title.lower()

    # Strong positive signals
    positive_keywords = [
        "new grad", "newgrad", "new-grad",
        "entry level", "entry-level", "entrylevel",
        "junior", "associate",
        "university grad", "recent grad",
        "graduate program", "rotational",
        "early career", "early-career",
        "0-2 years", "0-1 year",
    ]
    if any(kw in title_lower for kw in positive_keywords):
        return True

    # Strong negative signals
    negative_keywords = [
        "senior", "staff", "principal", "lead",
        "manager", "director", "head of",
        "vp", "vice president", "chief",
        "5+ years", "7+ years", "10+ years",
        "experienced", "expert",
    ]
    if any(kw in title_lower for kw in negative_keywords):
        return False

    # Uncertain - include by default (SimplifyJobs already filters for new grad)
    return True


# Keywords that mark a posting as a software / engineering / technical role.
# Used to keep the board tech-focused while allowing ALL experience levels
# (users filter by experience level in the UI).
_TECH_ROLE_KEYWORDS = [
    "engineer", "engineering", "developer", "software", "swe", "programmer",
    "sde", "data scientist", "machine learning", "ml engineer", " ai ",
    "ai/ml", "deep learning", "research scientist", "research engineer",
    "devops", "sre", "site reliability", "security engineer", "appsec",
    "infosec", "cybersecurity", "infrastructure", "platform", "backend",
    "back-end", "frontend", "front-end", "full stack", "fullstack",
    "full-stack", "mobile", "ios", "android", "cloud", "systems",
    "architect", "qa engineer", "test engineer", "sdet", "robotics",
    "firmware", "embedded", "computer vision", "nlp", "data engineer",
    "analytics engineer", "web developer", "ui engineer",
    # Common enterprise / federal tech titles (banks, government, defense) that
    # don't say "engineer" — kept in scope now that any employer is ingestable.
    "computer scientist", "information technology", "it specialist",
    "data analyst", "database", "network engineer", "systems administrator",
    "cloud architect", "solutions architect", "applications developer",
]


def is_technical_role(title: str) -> bool:
    """True if the title looks like a software/engineering/technical role.

    Keeps the board SWE-focused (filters out sales, recruiting, finance,
    marketing, etc.) without restricting by experience level."""
    if not title:
        return False
    t = title.lower()
    return any(kw in t for kw in _TECH_ROLE_KEYWORDS)


def classify_jobs(jobs: list[dict]) -> list[dict]:
    """Classify jobs using Gemini AI or heuristics fallback.

    Args:
        jobs: List of normalized job dicts

    Returns:
        Filtered list of jobs that are likely new grad positions
    """
    if not jobs:
        return []

    # Try to use Gemini
    if configure_genai():
        return _classify_with_gemini(jobs)

    # Fallback to heuristics
    return _classify_with_heuristics(jobs)


def _classify_with_gemini(jobs: list[dict]) -> list[dict]:
    """Classify jobs using Gemini AI."""
    # Process in batches to avoid token limits
    BATCH_SIZE = 50
    result = []

    for i in range(0, len(jobs), BATCH_SIZE):
        batch = jobs[i:i + BATCH_SIZE]

        # Format jobs for prompt
        job_texts = [
            f"{idx}. {j['company_name']} - {j['title']}"
            for idx, j in enumerate(batch)
        ]

        prompt = CLASSIFICATION_PROMPT.format(jobs="\n".join(job_texts))
        response = call_gemini(prompt)

        if response:
            try:
                # Clean up response - remove markdown code blocks if present
                response = response.strip()
                if response.startswith("```"):
                    response = response.split("```")[1]
                    if response.startswith("json"):
                        response = response[4:]
                response = response.strip()

                classifications = json.loads(response)

                # Keep ALL technical roles across every experience level; the
                # UI lets users filter by experience level themselves.
                for idx, job in enumerate(batch):
                    if not is_technical_role(job["title"]):
                        continue

                    # Update role types if the model provided any
                    if idx < len(classifications):
                        ai_roles = classifications[idx].get("role_types", [])
                        if ai_roles:
                            job["role_types"] = ai_roles

                    # Tag experience level (used by the UI filter)
                    exp_result = detect_experience_level(
                        job["title"],
                        job.get("description", ""),
                    )
                    job["experience_level"] = exp_result["experience_level"]
                    job["experience_confidence"] = exp_result["confidence"]
                    job["experience_matched_patterns"] = exp_result["matched_patterns"]

                    result.append(job)

            except (json.JSONDecodeError, IndexError) as e:
                print(f"Error parsing Gemini response: {e}")
                # Fall back to heuristics for this batch
                result.extend(_classify_with_heuristics(batch))
        else:
            # API call failed, use heuristics
            result.extend(_classify_with_heuristics(batch))

    return result


def _classify_with_heuristics(jobs: list[dict]) -> list[dict]:
    """Tag jobs by role + experience level using title-based heuristics.

    Keeps ALL technical roles across every experience level (new grad through
    principal); the UI lets users filter by experience level themselves."""
    result = []

    for job in jobs:
        if not is_technical_role(job["title"]):
            continue  # skip non-technical roles (sales, recruiting, etc.)

        # Use existing role_types or detect from title
        if not job.get("role_types"):
            job["role_types"] = detect_role_types(job["title"])

        # Tag experience level (used by the UI filter)
        exp_result = detect_experience_level(
            job["title"],
            job.get("description", ""),
        )
        job["experience_level"] = exp_result["experience_level"]
        job["experience_confidence"] = exp_result["confidence"]
        job["experience_matched_patterns"] = exp_result["matched_patterns"]

        result.append(job)

    return result
