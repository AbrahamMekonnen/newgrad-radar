"""Deterministic Greenhouse application adapter.

Given a Greenhouse job + a user profile, fetch the real form (structured
?questions=true API) and RESOLVE every field to a value, deterministically,
with no LLM for the ~80% that are standard. Returns exactly what's ready, what
still needs an AI draft (free-text customs), and what needs the user (unknown
required fields) — plus a ready % so the UI can show "18/20 filled".

This is the fast replacement for the browser-use agent: no per-field LLM steps,
just a dictionary lookup + option matching. Submission stays human-in-the-loop
(the user clears the final CAPTCHA in their own browser); this prepares the data.

FIELD PATTERNS - Based on analysis of 100 Greenhouse job applications:
- Basic info (99%): first_name, last_name, email, phone
- Resume (99%), Cover Letter (86%), LinkedIn (78%)
- Work Authorization (80%), Sponsorship (75%)
- Preferred Name (47%), Portfolio (35%), Source (22%)
- Location (12%), Previous Employment (12%), Pronouns (8%)
- GitHub (6%), Current Employer (8%), Age Verification (4%)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}


# ---- profile ----------------------------------------------------------------
@dataclass
class Profile:
    """User profile for auto-apply - covers all major ATS systems.

    Field coverage based on analysis of 100+ job applications across:
    Greenhouse, Lever, Ashby, BambooHR, BreezyHR, Recruitee, SmartRecruiters,
    JazzHR, Jobvite, iCIMS, Workday, and Taleo.
    """

    # =========================================================================
    # CORE FIELDS (Required - 99%+ frequency across all ATS)
    # =========================================================================
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    phone_type: str = "Mobile"                # Mobile, Home, Work (Workday)
    resume_url: str = ""                      # file path for upload

    # =========================================================================
    # COMMON FIELDS (Required - 75-86% frequency)
    # =========================================================================
    linkedin_url: str = ""                    # 78-96% frequency
    work_authorized: Optional[bool] = None    # 80%+ - authorized to work in target country
    require_sponsorship: Optional[bool] = None  # 75%+ - will need visa sponsorship
    work_authorization: str = ""               # raw profile choice for citizenship/visa selects
    visa_status: str = ""                     # current visa type if sponsorship needed

    # =========================================================================
    # MODERATE FREQUENCY (Recommended - 20-50%)
    # =========================================================================
    preferred_name: str = ""                  # nickname/preferred first name
    name_pronunciation: str = ""              # how to pronounce name (Lever 10%)
    portfolio_url: str = ""                   # website/portfolio (35-71%)
    how_heard: str = "Company website"        # referral source (16-85%)
    referral_name: str = ""                   # referrer name if any

    # =========================================================================
    # LOCATION FIELDS (varies by ATS, 12-94% frequency)
    # =========================================================================
    location: str = ""                        # current location/city (combined)
    address: str = ""                         # street address (legacy)
    address_line1: str = ""                   # street address line 1 (Workday)
    address_line2: str = ""                   # apt/suite (Workday)
    city: str = ""                            # city
    state: str = ""                           # state/province
    zip_code: str = ""                        # postal code
    country: str = "United States"            # country (94% BambooHR)

    # =========================================================================
    # WORK HISTORY
    # =========================================================================
    previously_employed_here: Optional[bool] = None  # worked at company before
    current_company: str = ""                 # current employer (100% Lever)
    current_title: str = ""                   # current job title
    current_salary: str = ""                  # current compensation (Workday)
    notice_period: str = ""                   # 2 weeks, 1 month, etc. (Workday)
    pronouns: str = ""                        # she/her, he/him, they/them (8-40%)

    # =========================================================================
    # LINKS (varies by role type)
    # =========================================================================
    github_url: str = ""                      # GitHub profile (6-75% for tech)
    twitter_url: str = ""                     # Twitter/X profile (4-39%)

    # =========================================================================
    # EDUCATION (28-61% frequency)
    # =========================================================================
    education: str = ""                       # degree level: "Bachelor's", "Master's"
    education_level: str = ""                 # alternative phrasing (Workday)
    degree: str = ""                          # specific degree name: "BS Computer Science"
    school: str = ""                          # school/university name
    major: str = ""                           # field of study
    graduation_year: str = ""                 # graduation year
    graduation_date: str = ""                 # full date if needed (Workday)
    gpa: str = ""                             # GPA (16%)

    # =========================================================================
    # EXPERIENCE & PREFERENCES
    # =========================================================================
    years_experience: str = ""                # total years of experience
    salary_expectation: str = ""              # expected compensation (12-86%)
    start_date: str = ""                      # "Immediately", "2 weeks", "Flexible"
    willing_to_relocate: Optional[bool] = None  # open to relocation (37-57%)
    remote_preference: str = ""               # "remote", "hybrid", "onsite", "flexible"
    is_adult: bool = True                     # over 18 years old (41%)

    # =========================================================================
    # WORK FLEXIBILITY (iCIMS, SmartRecruiters, Workday)
    # =========================================================================
    willing_to_travel: Optional[bool] = None  # can travel for work (22-36%)
    travel_willingness: str = ""              # percentage: "25%", "50%", "75%"
    flexible_schedule: Optional[bool] = None  # can work overtime/weekends (17%)

    # =========================================================================
    # TRANSPORTATION (iCIMS 12-22%)
    # =========================================================================
    has_drivers_license: Optional[bool] = None  # valid driver's license
    has_reliable_transportation: Optional[bool] = None  # can get to work

    # =========================================================================
    # SECURITY & CLEARANCE (gov/defense roles, 14-35%)
    # =========================================================================
    has_security_clearance: Optional[bool] = None  # holds active clearance
    clearance_level: str = ""                 # Secret, Top Secret, TS/SCI
    is_us_citizen: Optional[bool] = None      # US citizenship (24-35%)
    citizenship: str = ""                     # country of citizenship

    # =========================================================================
    # BACKGROUND & COMPLIANCE
    # =========================================================================
    can_pass_background_check: Optional[bool] = None  # consent to background check (28-54%)
    background_check_consent: bool = True     # explicit consent flag
    is_government_official: bool = False      # rarely true for job seekers
    has_non_compete: bool = False             # existing employment restrictions
    has_felony_conviction: Optional[bool] = None  # criminal history (18-20%)

    # =========================================================================
    # SKILLS & LANGUAGES
    # =========================================================================
    skills_list: list = field(default_factory=list)  # ["Python", "React", "SQL"]
    languages: list = field(default_factory=list)    # [{"lang": "Spanish", "level": "Fluent"}]
    certifications: list = field(default_factory=list)  # ["AWS Solutions Architect"]

    # =========================================================================
    # EEO PREFERENCES (voluntary, default to decline)
    # =========================================================================
    eeo_decline_all: bool = True              # decline all EEO questions
    eeo_gender: str = ""                      # voluntary self-identification
    eeo_race: str = ""
    eeo_veteran: str = ""
    eeo_disability: str = ""

    # =========================================================================
    # STORY BANK (for AI drafting of free-text questions)
    # =========================================================================
    story_bank: dict = field(default_factory=dict)
    # Keys: why_interested, about_me, project, career_goals, challenge,
    #       leaving_reason, strengths, work_style, achievements
    resume_text: str = ""                     # extracted resume text for AI context

    # =========================================================================
    # REFERENCES (8% frequency)
    # =========================================================================
    references: list = field(default_factory=list)
    # Each: {"name": "", "company": "", "title": "", "phone": "", "email": "", "relationship": ""}

    # =========================================================================
    # LEARNED ANSWERS (custom questions the user has answered before)
    # =========================================================================
    custom_answers: dict = field(default_factory=dict)


@dataclass
class ResolvedField:
    label: str
    name: str            # the actual Greenhouse form field name
    type: str
    required: bool
    category: str
    value: Optional[object] = None
    source: str = "unfilled"   # profile | matched | eeo | ai_needed | user_needed | file
    values: list = field(default_factory=list)  # dropdown options [{label,value}]


# ---- form fetch -------------------------------------------------------------
def fetch_form(token: str, job_id) -> list[dict]:
    """Return Greenhouse questions: [{label, required, fields:[{name,type,values}]}]."""
    r = requests.get(
        f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true",
        headers=UA, timeout=20,
    )
    r.raise_for_status()
    return r.json().get("questions", [])


# ---- option matching (for selects/dropdowns) --------------------------------
def _match_option(values: list[dict], *wanted: str) -> Optional[str]:
    """Pick the option whose label/value contains any wanted substring."""
    for v in values or []:
        label = str(v.get("label", "")).lower()
        for w in wanted:
            if w in label:
                return v.get("value", v.get("label"))
    return None


def _decline_option(values: list[dict]) -> Optional[str]:
    """Match EEO decline/prefer-not-to-answer options.

    Common variations found in Greenhouse forms:
    - "Decline to Self-Identify"
    - "I prefer not to say"
    - "I don't wish to answer"
    - "I choose not to disclose"
    - "Prefer not to answer"
    - "Not to disclose"
    """
    return _match_option(values, "decline", "prefer not", "don't wish", "do not wish",
                         "not to disclose", "not to answer", "choose not",
                         "not to say", "not to self-identify", "not specified")


def _yesno(values: list[dict], yes: bool) -> Optional[str]:
    return _match_option(values, "yes") if yes else _match_option(values, "no")


def _normalized_question(text: str) -> str:
    """Normalize labels so previously answered questions survive punctuation and
    whitespace changes between otherwise identical ATS forms."""
    return " ".join(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _saved_answer(custom_answers: dict, label: str, category: str,
                  values: list[dict]) -> Optional[object]:
    """Find a learned answer and remap its human label to this form's option ID."""
    if not custom_answers:
        return None

    normalized = _normalized_question(label)
    answer = custom_answers.get(label) or custom_answers.get(normalized)
    if answer is None and category != "custom":
        answer = custom_answers.get(category)

    if answer is None and normalized:
        wanted = set(normalized.split())
        best_score = 0.0
        for saved_label, saved_answer in custom_answers.items():
            saved_normalized = _normalized_question(str(saved_label))
            if not saved_normalized:
                continue
            saved_tokens = set(saved_normalized.split())
            union = wanted | saved_tokens
            score = len(wanted & saved_tokens) / len(union) if union else 0.0
            if score > best_score and score >= 0.86:
                best_score, answer = score, saved_answer

    if isinstance(answer, dict):
        answer = answer.get("label") or answer.get("value")
    if answer in (None, ""):
        return None

    if values:
        answer_normalized = _normalized_question(str(answer))
        for option in values:
            option_value = option.get("value", option.get("label"))
            if (
                _normalized_question(str(option.get("label", ""))) == answer_normalized
                or _normalized_question(str(option_value)) == answer_normalized
            ):
                return option_value
        matched = _match_option(values, str(answer).lower())
        return matched
    return answer


def _authorized_option(values: list[dict], authorized: bool) -> Optional[str]:
    """Match work-authorization options, which use varied phrasing beyond yes/no.

    Common label variations (80% frequency in Greenhouse forms):
    Positive (authorized=True):
      - "Yes"
      - "I am authorized to work in [country]"
      - "I am legally authorized..."
      - "I do not require sponsorship"
      - "I have the right to work..."

    Negative (authorized=False):
      - "No"
      - "No, I will require sponsorship"
      - "I am not authorized to work..."
      - "I require work authorization"
    """
    for v in values or []:
        lo = str(v.get("label", "")).lower()
        # Detect negative indicators
        neg = any(k in lo for k in (
            "not authorized", "not legally", "n't authorized",
            "require sponsor", "will require", "do not have",
            "need sponsor", "not eligible", "require authorization"
        ))
        # Detect positive indicators
        pos = (
            lo.startswith("yes") or
            ("authorized" in lo and not neg) or
            ("do not require" in lo) or
            ("eligible" in lo and not neg) or
            ("right to work" in lo and "not" not in lo)
        )
        if authorized and (lo.startswith("yes") or pos):
            return v.get("value", v.get("label"))
        if not authorized and (lo.startswith("no") or neg):
            return v.get("value", v.get("label"))
    return _yesno(values, authorized)


# ---- category detection (using central knowledge base) ----------------------
# Import from knowledge base for comprehensive field matching
try:
    from field_knowledge_base import lookup_category as _kb_lookup
    _USE_KNOWLEDGE_BASE = True
except ImportError:
    _USE_KNOWLEDGE_BASE = False

# Fallback patterns if knowledge base not available
# Based on analysis of 100 Greenhouse jobs - patterns ordered by frequency
_CAT = [
    # === CORE FIELDS (99% frequency) ===
    # Label variations: "First Name", "first name", "Legal First Name", "fname"
    ("first_name", r"\b(first\s*name|fname|given\s*name)\b"),
    # Label variations: "Last Name", "last name", "Legal Last Name", "lname"
    ("last_name",  r"\b(last\s*name|lname|surname|family\s*name)\b"),
    ("full_name",  r"\b(full\s*name|^name$|legal\s*name)\b"),
    # Label variations: "Email", "email", "Email Address", "e-mail"
    ("email",      r"\b(e-?mail|email\s*address)\b"),
    # Label variations: "Phone", "phone", "Phone Number", "mobile", "telephone"
    ("phone",      r"\b(phone|mobile|telephone|cell)\b"),
    # Label variations: "Resume/CV", "resume", "Resume", "CV", "Curriculum Vitae"
    ("resume",     r"\b(resume|cv|curriculum\s*vitae)\b"),

    # === HIGH FREQUENCY (75-86%) ===
    # Label variations: "Cover Letter", "cover letter", "Covering Letter"
    ("cover_letter", r"\b(cover\s*letter|covering\s*letter)\b"),
    # Label variations: "LinkedIn Profile", "linkedin profile", "LinkedIn Profile URL", "LinkedIn", "Your LinkedIn"
    ("linkedin",   r"\blinkedin\b"),

    # === WORK AUTHORIZATION (80% frequency) ===
    # Label variations (critical - many phrasings):
    # - "Are you legally authorized to work in the United States?"
    # - "Are you legally authorized to work in the US?"
    # - "Are you authorized to work in the stated location of this role?"
    # - "Are you authorized to work in the country for which you applied?"
    # - "Are you authorized to work in the UK?"
    # - "Are you eligible to work in Germany?"
    # - "Are you legally entitled to work in Canada?"
    # - "Do you have the right to work in the country you are applying to?"
    ("work_auth",  r"\b(authorized?\s*to\s*work|legally\s*(authorized|entitled)|eligible\s*to\s*work|right\s*to\s*work|work\s*permit|legally\s*work)\b"),

    # === SPONSORSHIP (75% frequency) ===
    # Label variations (critical - many phrasings):
    # - "Will you now or in the future require sponsorship for employment visa status?"
    # - "Will you require Visa Sponsorship now, or in the future?"
    # - "Do you now, or in the future, require sponsorship to work?"
    # - "Will you require immigration sponsorship?"
    # - "Do you require visa sponsorship?"
    # - "Are you authorized to work without sponsorship?"
    # - "Will you require [Company] to sponsor you for a work permit?"
    # - "Do you need any immigration related support or sponsorship?"
    ("sponsorship", r"\b(sponsor|visa\s*status|immigration\s*(support|sponsor)|work\s*permit)\b"),

    # === MODERATE FREQUENCY (35-47%) ===
    # Label variations: "Preferred First Name", "Preferred Name", "Nickname", "preferred first name"
    ("preferred_name", r"\b(preferred\s*(first\s*)?name|nickname)\b"),
    # Label variations: "Website", "website", "Personal Website", "Portfolio", "Personal Site", "Online Portfolio"
    ("portfolio",  r"\b(portfolio|website|personal\s*site|online\s*portfolio)\b"),

    # === SOURCE (22% frequency) ===
    # Label variations:
    # - "How did you hear about this job?"
    # - "How did you first hear about [Company]?"
    # - "Where did you hear about us?"
    # - "What was the largest influence on your decision to apply?"
    ("source",     r"\b(how\s*did\s*you\s*(hear|find|learn)|where\s*did\s*you\s*hear|referr|influence.*apply|hear\s*about)\b"),

    # === LOWER FREQUENCY (8-12%) ===
    # Label variations: "Current Location", "current location", "From where do you intend to work?",
    # "Please select the country where you currently reside", "What country are you based in?", "Where are you located?"
    ("location",   r"\b(location|city|current\s*location|address|zip|postal|country.*reside|where.*located|based\s*in)\b"),
    # Label variations: "Have you previously been employed by [Company]?", "Have you previously worked for [Company]?",
    # "Do you currently work or have you previously worked at [Company]?", "Have you ever interviewed at [Company] before?"
    ("previous_employment", r"\b(previously\s*(employed|worked)|ever\s*(worked|interviewed)|former\s*employ)\b"),
    # Label variations: "What are your personal pronouns?", "Pronouns", "What are your preferred gender pronouns?"
    ("pronouns",   r"\b(pronouns?|gender\s*pronouns?)\b"),
    # Label variations: "Who is your current or previous employer?", "Current Company", "Current Employer"
    ("current_employer", r"\b(current\s*(company|employer)|previous\s*employer)\b"),

    # === RARE FIELDS (4-6%) ===
    # Label variations: "Github", "GitHub", "GitHub Profile", "GitHub URL"
    ("github",     r"\bgithub\b"),
    # Label variations: "What is your current or previous job title?", "Current Job Title", "Current Position"
    ("current_title", r"\b(current\s*(job\s*)?title|current\s*position|previous\s*title)\b"),
    # Label variations: "Twitter", "Twitter/X", "X Profile", "Twitter Handle"
    ("twitter",    r"\b(twitter|x\s*profile|x\s*handle)\b"),
    # Label variations: "Education: Last University Attended", "University", "School", "College", "Highest Education"
    ("education",  r"\b(university|school|college|education|degree)\b"),
    ("experience", r"\b(years?\s*(of\s*)?experience|how\s*many\s*years)\b"),
    ("salary",     r"\b(salary|compensation|pay\s*expectation|desired\s*(salary|compensation)|expected\s*comp)\b"),
    # Label variations: "When is the earliest you would want to start working with us?", "Start Date", "Availability"
    ("start_date", r"\b(start\s*date|available|availability|notice\s*period|when\s*can\s*you\s*start|earliest.*start)\b"),
    # Label variations: "Are you at least 18 years of age?", "Are you 18 years or older?", "Are you over 18?"
    ("age_verification", r"\b(18\s*years|over\s*18|at\s*least\s*18|age\s*of\s*majority)\b"),

    # === RELOCATION ===
    ("relocate",   r"\b(relocat|open\s*to\s*moving|willing\s*to\s*move)\b"),

    # === EEO / DEMOGRAPHICS (voluntary, always default to decline) ===
    ("gender",     r"\b(gender|gender\s*identity)\b"),
    ("race",       r"\b(race|ethnic|hispanic|latino)\b"),
    ("veteran",    r"\bveteran\b"),
    ("disability", r"\bdisab\b"),

    # === COMPLIANCE (rare but important) ===
    # Label variations: "Are you a current or former government official?"
    ("government_official", r"\b(government\s*official|public\s*official|political\s*figure)\b"),
    # Label variations: "Are you currently subject to any non-compete or non-solicitation agreement?"
    ("non_compete", r"\b(non-?compete|non-?solicitation|employment\s*restriction)\b"),
    # Label variations: "Do you hold a role or financial interest that could create conflict of interest?"
    ("conflict_of_interest", r"\b(conflict\s*of\s*interest|financial\s*interest)\b"),
    # Label variations: "Do you consent to [Company] processing your personal information?"
    ("data_consent", r"\b(consent.*personal\s*information|privacy\s*consent|data\s*processing)\b"),

    # === WORK ARRANGEMENT ===
    # Label variations: "Are you open to working X days per week from our office?"
    ("in_office", r"\b(in-?office|hybrid|days\s*per\s*week.*office|office\s*requirement)\b"),

    # === SECURITY CLEARANCE (gov/defense roles, 14-35%) ===
    ("security_clearance", r"\b(security\s*clearance|clearance\s*level|hold.*clearance|active\s*clearance)\b"),

    # === BACKGROUND CHECK (28-54%) ===
    ("background_check", r"\b(background\s*check|pass.*background|criminal\s*history|felony|conviction)\b"),

    # === TRAVEL & TRANSPORTATION ===
    ("travel", r"\b(willing\s*to\s*travel|travel\s*%|travel\s*requirement|able\s*to\s*travel)\b"),
    ("drivers_license", r"\b(driver'?s?\s*license|valid\s*license|driving\s*license)\b"),
    ("transportation", r"\b(reliable\s*transportation|own\s*vehicle|able\s*to\s*commute)\b"),

    # === SCHEDULE FLEXIBILITY ===
    ("flexible_schedule", r"\b(overtime|weekend|flexible\s*schedule|shift|work\s*hours|required\s*schedule)\b"),

    # === CITIZENSHIP ===
    ("us_citizen", r"\b(us\s*citizen|united\s*states\s*citizen|american\s*citizen|citizen\s*of\s*the\s*us)\b"),
    ("citizenship", r"\b(citizenship|citizen\s*of|nationality)\b"),

    # === NAME PRONUNCIATION ===
    ("name_pronunciation", r"\b(pronounce\s*your\s*name|name\s*pronunciation|how.*say.*name)\b"),

    # === REFERENCES ===
    ("references", r"\b(reference|professional\s*reference|list.*reference)\b"),
]


def _category(label: str, field_name: str = "") -> str:
    """Detect category from label using central knowledge base.

    Falls back to local patterns if knowledge base unavailable.
    """
    # Use knowledge base if available (more comprehensive patterns)
    if _USE_KNOWLEDGE_BASE:
        return _kb_lookup(label, field_name)

    # Fallback to local patterns
    lo = (label or "").lower()
    for cat, pat in _CAT:
        if re.search(pat, lo):
            return cat
    return "custom"


# ---- resolve ----------------------------------------------------------------
def resolve(questions: list[dict], p: Profile) -> dict:
    """Resolve every form field from the profile. Returns a summary dict."""
    resolved: list[ResolvedField] = []
    for q in questions:
        label = q.get("label", "")
        required = bool(q.get("required"))
        gfields = q.get("fields", []) or [{}]
        # a question can have multiple fields (e.g. resume: file + text). Use the first.
        gf = gfields[0]
        name = gf.get("name", "")
        ftype = gf.get("type", "")
        values = gf.get("values", [])
        cat = _category(label)
        rf = ResolvedField(label=label, name=name, type=ftype, required=required, category=cat,
                           values=values or [])

        val, src = _resolve_one(cat, ftype, values, p, label)
        rf.value, rf.source = val, src
        resolved.append(rf)

    ai_needed = [r for r in resolved if r.source == "ai_needed"]
    user_needed = [r for r in resolved if r.source == "user_needed" and r.required]
    filled = [r for r in resolved if r.source in ("profile", "matched", "eeo", "file")]
    total = len(resolved) or 1
    return {
        "resolved": resolved,
        "ready_count": len(filled),
        "total": len(resolved),
        "ready_pct": round(100 * len(filled) / total),
        "ai_needed": ai_needed,          # free-text customs -> draft with AI
        "user_needed": user_needed,      # required unknowns -> ask the user once
        "auto_ready": len(user_needed) == 0,  # can be prepared with no user input
    }


def _resolve_one(cat, ftype, values, p: Profile, label: str):
    """Return (value, source) for one field.

    Resolution strategies:
    - profile: direct mapping from user profile field
    - matched: option matching for dropdowns/selects (work_auth, sponsorship, etc.)
    - eeo: voluntary demographics, always default to decline
    - file: file upload (resume)
    - ai_needed: free-text that benefits from AI drafting (cover letter, motivation)
    - user_needed: required field we cannot auto-fill
    """
    # === DIRECT PROFILE MAPPINGS ===
    # These map directly from Profile fields to form values
    simple = {
        # Core fields (99% frequency)
        "first_name": p.first_name,
        "last_name": p.last_name,
        "email": p.email,
        "phone": p.phone,
        # URLs
        "linkedin": p.linkedin_url,
        "github": p.github_url,
        "portfolio": p.portfolio_url,
        "twitter": p.twitter_url,
        # Personal info
        "location": p.location or p.city,
        "preferred_name": p.preferred_name,
        "name_pronunciation": p.name_pronunciation,
        "pronouns": p.pronouns,
        "current_employer": p.current_company,
        "current_company": p.current_company,  # knowledge base uses this category name
        "current_title": p.current_title,
        # Education
        "education": p.education or p.education_level,
        "school": p.school,
        "major": p.major,
        "degree": p.degree,
        "gpa": p.gpa,
        "graduation_year": p.graduation_year,
        # Address components
        "city": p.city,
        "state": p.state,
        "zip_code": p.zip_code,
        "address": p.address or p.address_line1,
        "country": p.country,
        # Numbers/text
        "salary": p.salary_expectation,
        "experience": p.years_experience,
        "notice_period": p.notice_period,
        "clearance_level": p.clearance_level,
        "citizenship": p.citizenship,
        "visa_status": p.visa_status,
    }

    # === FULL NAME (combination field) ===
    if cat == "full_name":
        return (f"{p.first_name} {p.last_name}".strip() or None,
                "profile" if p.first_name else "user_needed")

    # === SIMPLE PROFILE FIELDS ===
    if cat in simple:
        v = simple[cat]
        return (v, "profile") if v else ("unfilled", "unfilled" if not _is_required_like(label) else "user_needed")

    # === FILE UPLOADS ===
    if cat == "resume":
        return (p.resume_url or None, "file")

    # === AI-NEEDED FIELDS ===
    if cat == "cover_letter":
        return (None, "ai_needed")  # optional AI draft for cover letters

    # === REFERRAL SOURCE (22% frequency) ===
    if cat == "source":
        if values:
            value = _match_option(
                values, p.how_heard.lower(), "careers site", "company website"
            )
            return (value, "matched") if value is not None else (None, "user_needed")
        return (p.how_heard, "matched")

    # === WORK AUTHORIZATION (80% frequency) ===
    # Handles varied phrasings like:
    # - "Are you legally authorized to work in the United States?"
    # - "Are you authorized to work in the UK?"
    # - "Do you have the right to work in the country?"
    if cat == "work_auth" and p.work_authorized is not None:
        v = _authorized_option(values, p.work_authorized) if values else ("Yes" if p.work_authorized else "No")
        return (v, "matched") if v is not None else (None, "user_needed")

    # === SPONSORSHIP (75% frequency) ===
    # Handles varied phrasings like:
    # - "Will you now or in the future require sponsorship?"
    # - "Do you require visa sponsorship?"
    # - "Will you require [Company] to sponsor you for a work permit?"
    if cat == "sponsorship" and p.require_sponsorship is not None:
        # "will you require sponsorship?" -> Yes iff they require it.
        v = _yesno(values, p.require_sponsorship) if values else ("Yes" if p.require_sponsorship else "No")
        return (v, "matched") if v is not None else (None, "user_needed")

    # === PREVIOUS EMPLOYMENT (12% frequency) ===
    # "Have you previously been employed by [Company]?"
    if cat == "previous_employment" and p.previously_employed_here is not None:
        v = _yesno(values, p.previously_employed_here) if values else ("Yes" if p.previously_employed_here else "No")
        return (v, "matched") if v is not None else (None, "user_needed")

    # === RELOCATION ===
    if cat == "relocate" and p.willing_to_relocate is not None:
        return (_yesno(values, p.willing_to_relocate) if values else ("Yes" if p.willing_to_relocate else "No"), "matched")

    # === START DATE (4% frequency) ===
    if cat == "start_date":
        # Try to match common options: Immediately, Flexible, 2 weeks, 1 month
        return (_match_option(values, "immediat", "flexible", "2 week", "1 month") or p.start_date or "Immediately", "matched")

    # === AGE VERIFICATION (4% frequency) ===
    # "Are you at least 18 years of age?" - job applicants are almost always adults
    if cat == "age_verification":
        v = _yesno(values, p.is_adult) if values else ("Yes" if p.is_adult else "No")
        return (v, "matched") if v is not None else (None, "user_needed")

    # === COMPLIANCE QUESTIONS (4-8% frequency) ===
    # Government official, non-compete, conflict of interest - usually No for most applicants
    if cat == "government_official":
        v = _yesno(values, p.is_government_official) if values else ("Yes" if p.is_government_official else "No")
        return (v, "matched")
    if cat == "non_compete":
        v = _yesno(values, p.has_non_compete) if values else ("Yes" if p.has_non_compete else "No")
        return (v, "matched")
    if cat == "conflict_of_interest":
        # Default to No unless user specifies otherwise
        return (_yesno(values, False) or "No", "matched")

    # === DATA CONSENT ===
    # "Do you consent to [Company] processing your personal information?"
    # Typically must be Yes to proceed with application
    if cat == "data_consent":
        if len(values or []) == 1:
            return (values[0].get("value", values[0].get("label")), "matched")
        value = _match_option(values, "acknowledge", "agree", "accept", "confirm", "yes")
        return ((value if value is not None else "Yes"), "matched")

    # === IN-OFFICE ACKNOWLEDGMENT ===
    # "Are you open to working X days per week from our office?"
    # This varies by user preference - ask user if required
    if cat == "in_office":
        return (None, "user_needed")

    # === SECURITY CLEARANCE (14-35% for gov/defense) ===
    if cat == "security_clearance" and p.has_security_clearance is not None:
        v = _yesno(values, p.has_security_clearance) if values else ("Yes" if p.has_security_clearance else "No")
        return (v, "matched") if v else (p.clearance_level or None, "profile" if p.clearance_level else "user_needed")

    # === BACKGROUND CHECK (28-54%) ===
    if cat == "background_check":
        if len(values or []) == 1 and p.background_check_consent:
            return (values[0].get("value", values[0].get("label")), "matched")
        if p.can_pass_background_check is not None:
            v = _yesno(values, p.can_pass_background_check) if values else ("Yes" if p.can_pass_background_check else "No")
            return (v, "matched")
        value = _match_option(values, "acknowledge", "agree", "accept", "confirm", "yes")
        return ((value if value is not None else "Yes"), "matched")

    # === TRAVEL WILLINGNESS (22-36%) ===
    if cat == "travel":
        if p.willing_to_travel is not None:
            v = _yesno(values, p.willing_to_travel) if values else ("Yes" if p.willing_to_travel else "No")
            return (v, "matched")
        if p.travel_willingness:
            return (_match_option(values, p.travel_willingness) or p.travel_willingness, "profile")
        return (None, "user_needed")

    # === DRIVER'S LICENSE (12%) ===
    if cat == "drivers_license" and p.has_drivers_license is not None:
        v = _yesno(values, p.has_drivers_license) if values else ("Yes" if p.has_drivers_license else "No")
        return (v, "matched")

    # === RELIABLE TRANSPORTATION (22%) ===
    if cat == "transportation" and p.has_reliable_transportation is not None:
        v = _yesno(values, p.has_reliable_transportation) if values else ("Yes" if p.has_reliable_transportation else "No")
        return (v, "matched")

    # === SCHEDULE FLEXIBILITY (17%) ===
    if cat == "flexible_schedule" and p.flexible_schedule is not None:
        v = _yesno(values, p.flexible_schedule) if values else ("Yes" if p.flexible_schedule else "No")
        return (v, "matched")

    # === US CITIZENSHIP (24-35%) ===
    if cat == "us_citizen" and p.is_us_citizen is not None:
        auth = (p.work_authorization or "").lower()
        if auth == "permanent_resident":
            v = _match_option(values, "permanent resident", "green card")
        elif p.is_us_citizen:
            v = _match_option(values, "u.s. citizen", "us citizen", "united states citizen")
        else:
            v = _match_option(values, "none of the above", "no")
        if not values:
            v = "Yes" if p.is_us_citizen else "No"
        return (v, "matched") if v is not None else (None, "user_needed")

    # === CITIZENSHIP (general) ===
    if cat == "citizenship":
        if p.citizenship:
            return (_match_option(values, p.citizenship.lower()) or p.citizenship, "profile")
        return (None, "user_needed")

    # === NAME PRONUNCIATION (10%) ===
    if cat == "name_pronunciation":
        return (p.name_pronunciation, "profile") if p.name_pronunciation else (None, "user_needed")

    # === REFERENCES (8%) ===
    if cat == "references":
        # References require user input - cannot auto-fill
        return (None, "user_needed")

    # === EEO / DEMOGRAPHICS (always decline unless user explicitly opts in) ===
    # These are voluntary self-identification questions. We ALWAYS default to
    # "decline to answer" options to protect user privacy.
    if cat in ("gender", "race", "veteran", "disability"):
        return (_decline_option(values), "eeo")

    # === LEARNED ANSWERS: exact, normalized, category, then high-overlap label ===
    learned = _saved_answer(p.custom_answers, label, cat, values)
    if learned is not None:
        return (learned, "matched" if values else "profile")

    # === UNKNOWN FIELDS ===
    # Free-text fields -> AI can draft; Select/choice fields -> ask user
    t = (ftype or "").lower()
    if "textarea" in t or t in ("input_text", "text"):
        return (None, "ai_needed")
    return (None, "user_needed")


def _is_required_like(label: str) -> bool:
    """Check if a field label suggests it's likely required even if not marked.

    Based on analysis: email, name, phone, resume appear in 99% of applications.
    """
    return bool(re.search(r"\b(email|name|phone|resume|cv)\b", (label or "").lower()))


if __name__ == "__main__":
    import sys, json
    # demo: resolve a real Greenhouse form against a sample profile
    token = sys.argv[1] if len(sys.argv) > 1 else "stripe"
    jobs = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                        headers=UA, timeout=20).json()["jobs"]
    jid = jobs[0]["id"]
    form = fetch_form(token, jid)
    demo = Profile(first_name="Alex", last_name="Doe", email="alex@example.com",
                   phone="+1 555 123 4567", location="San Francisco, CA",
                   linkedin_url="https://linkedin.com/in/alexdoe",
                   github_url="https://github.com/alexdoe", resume_url="resume.pdf",
                   work_authorized=True, require_sponsorship=False,
                   willing_to_relocate=True, years_experience="1")
    res = resolve(form, demo)
    print(f"{token} job {jid}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']}), "
          f"auto_ready={res['auto_ready']}, ai_needed={len(res['ai_needed'])}, "
          f"user_needed={len(res['user_needed'])}")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:34]}")
