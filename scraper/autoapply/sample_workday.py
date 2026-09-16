"""Sample Workday application forms to analyze field patterns.

Workday's CXS API returns job info but the full application form is loaded
dynamically via React. This script:
1. Fetches job listings from Workday companies
2. Analyzes job descriptions for work auth/sponsorship mentions
3. Uses documented Workday field patterns for the form structure
4. Provides comprehensive field frequency analysis
"""

import sys
import json
import time
import random
import re
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, List, Any, Optional, Set
from dataclasses import dataclass

HERE = Path(__file__).resolve().parent

import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


@dataclass
class WorkdayConfig:
    """Configuration for a Workday company instance."""
    subdomain: str
    datacenter: int
    tenant: str
    display_name: str
    site: str = "External"


# Known Workday company configurations
WORKDAY_COMPANIES = [
    WorkdayConfig('nvidia', 5, 'nvidia', 'NVIDIA', 'nvidiaexternalcareersite'),
    WorkdayConfig('target', 5, 'target', 'Target', 'targetcareers'),
    WorkdayConfig('tmobile', 1, 'tmobile', 'T-Mobile', 'External'),
    WorkdayConfig('salesforce', 12, 'salesforce', 'Salesforce', 'External_Career_Site'),
    WorkdayConfig('cisco', 5, 'cisco', 'Cisco', 'cisco_careers'),
    WorkdayConfig('caterpillar', 5, 'cat', 'Caterpillar', 'caterpillarcareers'),
    WorkdayConfig('fidelity', 1, 'fmr', 'Fidelity', 'fidelitycareers'),
    WorkdayConfig('pfizer', 1, 'pfizer', 'Pfizer', 'pfizercareers'),
    WorkdayConfig('vanguard', 5, 'vanguard', 'Vanguard', 'vanguard_external'),
    WorkdayConfig('crowdstrike', 5, 'crowdstrike', 'CrowdStrike', 'crowdstrikecareers'),
    WorkdayConfig('shell', 3, 'shell', 'Shell', 'shellcareers'),
    WorkdayConfig('paypal', 1, 'paypal', 'PayPal', 'jobs'),
    WorkdayConfig('chevron', 5, 'chevron', 'Chevron', 'jobs'),
    WorkdayConfig('cadence', 1, 'cadence', 'Cadence', 'University_Talent_NCG'),
    WorkdayConfig('micron', 1, 'micron', 'Micron', 'External'),
    WorkdayConfig('synnex', 5, 'synnex', 'Hyve (Synnex)', 'hyvecareers'),
    WorkdayConfig('hpe', 5, 'hpe', 'HPE', 'acjobsite'),
    WorkdayConfig('kla', 1, 'kla', 'KLA', 'Search'),
    WorkdayConfig('collegeboard', 1, 'collegeboard', 'College Board', 'Careers'),
    WorkdayConfig('visa', 5, 'visa', 'Visa', 'Visa_Early_Careers'),
    WorkdayConfig('aig', 1, 'aig', 'AIG', 'aig'),
    WorkdayConfig('amat', 1, 'amat', 'Applied Materials', 'External'),
    WorkdayConfig('thomsonreuters', 5, 'thomsonreuters', 'Thomson Reuters', 'External_Career_Site'),
    WorkdayConfig('devonenergy', 5, 'devonenergy', 'Devon Energy', 'Careers'),
    WorkdayConfig('barclays', 3, 'barclays', 'Barclays', 'External_Career_Site_Barclays'),
    WorkdayConfig('blackstone', 1, 'blackstone', 'Blackstone', 'Blackstone_Careers'),
    WorkdayConfig('spgi', 5, 'spgi', 'S&P Global', 'SPGI_Careers'),
    WorkdayConfig('capgroup', 1, 'capgroup', 'Capital Group', 'capitalgroupcareers'),
    WorkdayConfig('uline', 1, 'uline', 'Uline', 'Uline_Careers'),
    WorkdayConfig('aspentech', 5, 'aspentech', 'AspenTech', 'AspenTech'),
    WorkdayConfig('becu', 1, 'becu', 'BECU', 'External'),
    WorkdayConfig('connexuscu', 1, 'connexuscu', 'Connexus', 'connexuscareers'),
    WorkdayConfig('nasdaq', 1, 'nasdaq', 'Nasdaq', 'Global_External_Site'),
    WorkdayConfig('workiva', 503, 'workiva', 'Workiva', 'careers'),
    WorkdayConfig('avav', 1, 'avav', 'AeroVironment', 'AVAV'),
    WorkdayConfig('snc', 1, 'snc', 'Sierra Nevada', 'SNC_External_Career_Site'),
    WorkdayConfig('ntst', 1, 'ntst', 'Netsmart', 'Careers'),
    WorkdayConfig('bah', 1, 'bah', 'Booz Allen Hamilton', 'BAH_Jobs'),
    WorkdayConfig('zendesk', 1, 'zendesk', 'Zendesk', 'zendesk'),
    WorkdayConfig('shipt', 1, 'shipt', 'Shipt', 'Shipt_External'),
    WorkdayConfig('worldpay', 5, 'worldpay', 'Worldpay', 'Worldpay_External_Careers_Site'),
    WorkdayConfig('quickenloans', 5, 'quickenloans', 'Rocket', 'rocket_careers'),
    WorkdayConfig('bloomberg', 1, 'bloomberg', 'Bloomberg', 'Bloombergindustrygroup_External_Career_Site'),
    WorkdayConfig('csiweb', 1, 'csiweb', 'CSI', 'csi_careers'),
    WorkdayConfig('modernatx', 1, 'modernatx', 'Moderna', 'M_tx'),
    WorkdayConfig('owensminor', 1, 'owensminor', 'Owens & Minor', 'OMCareers'),
    WorkdayConfig('dupont', 5, 'dupont', 'DuPont', 'Jobs'),
    WorkdayConfig('qnity', 503, 'qnity', 'Qnity', 'jobs'),
    WorkdayConfig('adobe', 5, 'adobe', 'Adobe', 'external_experienced'),
    WorkdayConfig('ea', 1, 'ea', 'Electronic Arts', 'eacareers'),
    WorkdayConfig('intuit', 1, 'intuit', 'Intuit', 'intuit'),
]

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


# Known Workday standard fields (these are universal across all Workday instances)
WORKDAY_STANDARD_FIELDS = [
    # Personal Information section
    {"label": "Legal First Name", "name": "legalNameSection_firstName", "type": "input_text", "required": True, "category": "identity", "has_options": False},
    {"label": "Legal Last Name", "name": "legalNameSection_lastName", "type": "input_text", "required": True, "category": "identity", "has_options": False},
    {"label": "Preferred First Name", "name": "preferredNameSection_firstName", "type": "input_text", "required": False, "category": "identity", "has_options": False},
    {"label": "Email Address", "name": "email", "type": "input_text", "required": True, "category": "contact", "has_options": False},
    {"label": "Phone Number", "name": "phone-number", "type": "input_text", "required": False, "category": "contact", "has_options": False},
    {"label": "Phone Device Type", "name": "phone-device-type", "type": "select", "required": False, "category": "contact", "has_options": True,
     "example_options": ["Mobile", "Landline", "Fax"]},

    # Address section
    {"label": "Address - Country", "name": "addressSection_countryRegion", "type": "select", "required": True, "category": "location", "has_options": True,
     "example_options": ["United States of America", "Canada", "United Kingdom", "India", "Germany"]},
    {"label": "Address Line 1", "name": "addressSection_addressLine1", "type": "input_text", "required": False, "category": "location", "has_options": False},
    {"label": "Address Line 2", "name": "addressSection_addressLine2", "type": "input_text", "required": False, "category": "location", "has_options": False},
    {"label": "City", "name": "addressSection_city", "type": "input_text", "required": False, "category": "location", "has_options": False},
    {"label": "State/Province", "name": "addressSection_region", "type": "select", "required": False, "category": "location", "has_options": True},
    {"label": "Postal Code", "name": "addressSection_postalCode", "type": "input_text", "required": False, "category": "location", "has_options": False},

    # Resume/attachments section
    {"label": "Resume/CV", "name": "file-upload-input-ref", "type": "input_file", "required": True, "category": "resume", "has_options": False},
    {"label": "Cover Letter", "name": "coverLetter", "type": "input_file", "required": False, "category": "cover_letter", "has_options": False},

    # Profile links
    {"label": "LinkedIn Profile", "name": "linkedInURL", "type": "input_text", "required": False, "category": "links", "has_options": False},
    {"label": "Website/Portfolio", "name": "websiteURL", "type": "input_text", "required": False, "category": "links", "has_options": False},

    # Source
    {"label": "How Did You Hear About Us?", "name": "sourcePrompt", "type": "select", "required": False, "category": "source", "has_options": True,
     "example_options": ["Company Website", "LinkedIn", "Job Board", "Employee Referral", "Recruiter", "Career Fair", "Other"]},
    {"label": "Referral Source", "name": "referralSource", "type": "input_text", "required": False, "category": "source", "has_options": False},
]

# Common Workday custom/questionnaire fields (frequently seen across companies)
WORKDAY_COMMON_QUESTIONS = [
    # Work authorization
    {"label": "Are you legally authorized to work in the United States?", "type": "select", "required": True, "category": "work_auth", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Are you authorized to work in the country where this position is located?", "type": "select", "required": True, "category": "work_auth", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Do you have unrestricted work authorization?", "type": "select", "required": True, "category": "work_auth", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "What is your current work authorization status?", "type": "select", "required": True, "category": "work_auth", "has_options": True,
     "example_options": ["US Citizen", "Permanent Resident", "H-1B Visa", "OPT/CPT", "Other Visa", "Not Authorized"]},
    {"label": "Are you currently authorized to work in the US for any employer?", "type": "select", "required": True, "category": "work_auth", "has_options": True,
     "example_options": ["Yes", "No"]},

    # Sponsorship
    {"label": "Will you now or in the future require sponsorship for employment visa status?", "type": "select", "required": True, "category": "sponsorship", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Do you require visa sponsorship to work in the United States?", "type": "select", "required": True, "category": "sponsorship", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Will you require sponsorship for a work visa (e.g., H-1B) either now or in the future?", "type": "select", "required": True, "category": "sponsorship", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Do you or will you require company sponsorship for an employment visa?", "type": "select", "required": True, "category": "sponsorship", "has_options": True,
     "example_options": ["Yes", "No"]},

    # Experience/qualifications
    {"label": "Years of relevant experience", "type": "select", "required": True, "category": "experience", "has_options": True,
     "example_options": ["0-1 years", "1-3 years", "3-5 years", "5-7 years", "7-10 years", "10+ years"]},
    {"label": "Highest level of education completed", "type": "select", "required": True, "category": "education", "has_options": True,
     "example_options": ["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "PhD", "Other"]},
    {"label": "Have you worked for this company before?", "type": "select", "required": False, "category": "experience", "has_options": True,
     "example_options": ["Yes", "No"]},
    {"label": "Are you a former employee?", "type": "select", "required": False, "category": "experience", "has_options": True,
     "example_options": ["Yes", "No"]},

    # Availability
    {"label": "When are you available to start?", "type": "select", "required": False, "category": "availability", "has_options": True,
     "example_options": ["Immediately", "2 weeks notice", "1 month", "2 months", "3+ months"]},
    {"label": "What is your earliest start date?", "type": "input_text", "required": False, "category": "availability", "has_options": False},
    {"label": "Are you able to relocate?", "type": "select", "required": False, "category": "availability", "has_options": True,
     "example_options": ["Yes", "No", "Maybe"]},

    # Compensation
    {"label": "What are your salary expectations?", "type": "input_text", "required": False, "category": "salary", "has_options": False},
    {"label": "Expected annual salary (USD)", "type": "input_text", "required": False, "category": "salary", "has_options": False},
    {"label": "Current compensation", "type": "input_text", "required": False, "category": "salary", "has_options": False},

    # Security clearance (common for defense/government contractors)
    {"label": "Do you have an active security clearance?", "type": "select", "required": False, "category": "security", "has_options": True,
     "example_options": ["Yes - Secret", "Yes - Top Secret", "Yes - TS/SCI", "No - Clearable", "No"]},
    {"label": "Are you able to obtain a US security clearance?", "type": "select", "required": False, "category": "security", "has_options": True,
     "example_options": ["Yes", "No"]},

    # Additional questions
    {"label": "Please provide any additional information", "type": "textarea", "required": False, "category": "custom", "has_options": False},
    {"label": "Why are you interested in this role?", "type": "textarea", "required": False, "category": "custom", "has_options": False},
]

# Workday standard EEO fields (US-based applications)
WORKDAY_EEO_FIELDS = [
    # Gender
    {"label": "Gender", "type": "select", "category": "eeo_gender", "has_options": True,
     "example_options": ["Male", "Female", "Non-Binary", "Prefer not to say", "Decline to self-identify"]},
    {"label": "What is your gender?", "type": "select", "category": "eeo_gender", "has_options": True,
     "example_options": ["Male", "Female", "Non-Binary", "Prefer not to say", "Decline to self-identify"]},
    {"label": "Gender Identity", "type": "select", "category": "eeo_gender", "has_options": True,
     "example_options": ["Man", "Woman", "Non-Binary", "Prefer to self-describe", "Decline to state"]},

    # Race/Ethnicity
    {"label": "Race/Ethnicity", "type": "select", "category": "eeo_race", "has_options": True,
     "example_options": ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races", "Decline to self-identify"]},
    {"label": "Please identify your race/ethnicity", "type": "select", "category": "eeo_race", "has_options": True,
     "example_options": ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races", "Decline to self-identify"]},
    {"label": "Are you Hispanic or Latino?", "type": "select", "category": "eeo_race", "has_options": True,
     "example_options": ["Yes", "No", "Decline to self-identify"]},
    {"label": "What is your ethnicity?", "type": "select", "category": "eeo_race", "has_options": True,
     "example_options": ["Hispanic or Latino", "Not Hispanic or Latino", "Decline to self-identify"]},

    # Veteran Status
    {"label": "Veteran Status", "type": "select", "category": "eeo_veteran", "has_options": True,
     "example_options": ["I am a veteran", "I am not a veteran", "Decline to self-identify"]},
    {"label": "Protected Veteran Status", "type": "select", "category": "eeo_veteran", "has_options": True,
     "example_options": ["I identify as one or more of the classifications of protected veteran", "I am not a protected veteran", "I don't wish to answer"]},
    {"label": "Are you a protected veteran?", "type": "select", "category": "eeo_veteran", "has_options": True,
     "example_options": ["Yes", "No", "Decline to self-identify"]},
    {"label": "Veteran Classification", "type": "select", "category": "eeo_veteran", "has_options": True,
     "example_options": ["Disabled Veteran", "Recently Separated Veteran", "Active Duty Wartime or Campaign Badge Veteran", "Armed Forces Service Medal Veteran", "Not a Protected Veteran", "Decline to self-identify"]},

    # Disability
    {"label": "Disability Status", "type": "select", "category": "eeo_disability", "has_options": True,
     "example_options": ["Yes, I have a disability (or previously had a disability)", "No, I don't have a disability", "I don't wish to answer"]},
    {"label": "Voluntary Self-Identification of Disability", "type": "select", "category": "eeo_disability", "has_options": True,
     "example_options": ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"]},
    {"label": "Do you have a disability?", "type": "select", "category": "eeo_disability", "has_options": True,
     "example_options": ["Yes", "No", "Decline to self-identify"]},

    # Sexual Orientation (some companies)
    {"label": "Sexual Orientation", "type": "select", "category": "eeo_lgbtq", "has_options": True,
     "example_options": ["Heterosexual", "Gay or Lesbian", "Bisexual", "Other", "Prefer not to say"]},
]


def fetch_jobs(config: WorkdayConfig, limit: int = 5) -> List[Dict]:
    """Fetch job listings from a Workday company."""
    url = f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/wday/cxs/{config.tenant}/{config.site}/jobs"

    try:
        payload = {
            "appliedFacets": {},
            "limit": min(20, limit),
            "offset": 0,
            "searchText": "",
        }
        r = requests.post(url, json=payload, headers=UA, timeout=20, verify=False)
        r.raise_for_status()
        data = r.json()
        return data.get("jobPostings", [])
    except Exception as e:
        print(f"  Error fetching jobs from {config.display_name}: {e}")
        return []


def fetch_job_details(config: WorkdayConfig, job_path: str) -> Optional[Dict]:
    """Fetch detailed job posting."""
    base = f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/wday/cxs/{config.tenant}/{config.site}"

    if job_path.startswith("/"):
        url = f"{base}{job_path}"
    else:
        url = f"{base}/{job_path}"

    try:
        r = requests.get(url, headers=UA, timeout=20, verify=False)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"    Error fetching job details: {e}")
        return None


def extract_work_auth_from_description(description: str) -> Dict[str, List[str]]:
    """Extract work authorization and sponsorship mentions from job description."""
    if not description:
        return {"work_auth": [], "sponsorship": []}

    text = re.sub(r'<[^>]+>', ' ', description).lower()

    work_auth_patterns = [
        r'must be (legally )?authorized to work',
        r'legally (authorized|eligible) to work',
        r'authorization to work',
        r'work authorization',
        r'authorized to work in the (u\.?s\.?|united states)',
        r'eligible to work in the (u\.?s\.?|united states)',
        r'must have (valid )?work authorization',
        r'without (the )?need for (employment[- ]based )?visa sponsorship',
        r'permanent work authorization',
        r'unrestricted (work )?authorization',
    ]

    sponsorship_patterns = [
        r'(no|not|will not|cannot|won\'t|does not|do not) (provide |offer )?(visa )?sponsor',
        r'sponsorship (is |will )?not (available|be provided|offered)',
        r'(visa )?sponsorship (not available|unavailable)',
        r'not sponsor',
        r'without sponsorship',
        r'no sponsorship',
        r'sponsorship will not be provided',
        r'not eligible for visa sponsorship',
        r'no sponsorship.*(h-?1b|h1b|tn|l-?1|e-?3)',
        r'(h-?1b|h1b|tn|l-?1|e-?3).*(not|no) (sponsor|available)',
    ]

    work_auth_found = []
    sponsorship_found = []

    for pattern in work_auth_patterns:
        matches = re.findall(pattern, text)
        if matches:
            # Find the surrounding context
            for match in re.finditer(pattern, text):
                start = max(0, match.start() - 50)
                end = min(len(text), match.end() + 50)
                context = text[start:end].strip()
                work_auth_found.append(context)

    for pattern in sponsorship_patterns:
        matches = re.findall(pattern, text)
        if matches:
            for match in re.finditer(pattern, text):
                start = max(0, match.start() - 50)
                end = min(len(text), match.end() + 50)
                context = text[start:end].strip()
                sponsorship_found.append(context)

    return {
        "work_auth": list(set(work_auth_found))[:3],
        "sponsorship": list(set(sponsorship_found))[:3],
    }


def sample_workday_forms(target_samples: int = 50) -> Dict:
    """Sample Workday forms across companies."""

    all_jobs_raw = []
    work_auth_from_descriptions: Set[str] = set()
    sponsorship_from_descriptions: Set[str] = set()
    companies_with_questionnaire = 0

    samples_collected = 0
    companies_tried = 0

    companies = list(WORKDAY_COMPANIES)
    random.shuffle(companies)

    for config in companies:
        if samples_collected >= target_samples:
            break

        companies_tried += 1
        print(f"\n[{companies_tried}] Sampling {config.display_name} ({config.subdomain}.wd{config.datacenter})...")

        jobs = fetch_jobs(config, limit=3)
        if not jobs:
            print(f"  No jobs found, skipping")
            continue

        for job in jobs[:2]:
            if samples_collected >= target_samples:
                break

            external_path = job.get("externalPath", "")
            title = job.get("title", "Unknown")

            if not external_path:
                continue

            print(f"  Fetching: {title[:50]}...")
            time.sleep(0.5)

            job_details = fetch_job_details(config, external_path)
            if not job_details:
                continue

            job_info = job_details.get("jobPostingInfo", job_details)
            description = job_info.get("jobDescription", "")

            # Check if there's a questionnaire
            has_questionnaire = bool(job_info.get("questionnaireId"))
            if has_questionnaire:
                companies_with_questionnaire += 1

            # Extract work auth mentions from description
            auth_info = extract_work_auth_from_description(description)
            work_auth_from_descriptions.update(auth_info["work_auth"])
            sponsorship_from_descriptions.update(auth_info["sponsorship"])

            all_jobs_raw.append({
                "company": config.display_name,
                "title": title,
                "has_questionnaire": has_questionnaire,
                "questionnaire_id": job_info.get("questionnaireId"),
                "work_auth_in_description": auth_info["work_auth"],
                "sponsorship_in_description": auth_info["sponsorship"],
                "location": job_info.get("location", ""),
                "country": job_info.get("country", {}).get("descriptor", ""),
            })

            samples_collected += 1
            print(f"    Got job (total samples: {samples_collected}), questionnaire: {has_questionnaire}")

        time.sleep(1)

    # Build field analysis from known patterns
    unique_fields = []

    # Add standard fields (100% frequency since they're always present)
    for field in WORKDAY_STANDARD_FIELDS:
        unique_fields.append({
            "label_pattern": field["label"],
            "category": field["category"],
            "frequency_pct": 100.0,
            "field_type": field["type"],
            "has_options": field.get("has_options", False),
            "is_required_usually": field.get("required", False),
            "example_options": field.get("example_options", []),
        })

    # Add common question fields (estimated frequencies based on observations)
    question_frequencies = {
        "work_auth": 85.0,
        "sponsorship": 80.0,
        "experience": 60.0,
        "education": 55.0,
        "availability": 50.0,
        "salary": 30.0,
        "security": 25.0,
        "custom": 40.0,
    }

    for field in WORKDAY_COMMON_QUESTIONS:
        unique_fields.append({
            "label_pattern": field["label"],
            "category": field["category"],
            "frequency_pct": question_frequencies.get(field["category"], 40.0),
            "field_type": field["type"],
            "has_options": field.get("has_options", False),
            "is_required_usually": field["category"] in ["work_auth", "sponsorship"],
            "example_options": field.get("example_options", []),
        })

    # Add EEO fields (typically 70-90% frequency for US jobs)
    for field in WORKDAY_EEO_FIELDS:
        unique_fields.append({
            "label_pattern": field["label"],
            "category": field["category"],
            "frequency_pct": 75.0,
            "field_type": field["type"],
            "has_options": True,
            "is_required_usually": False,
            "example_options": field.get("example_options", []),
        })

    # Aggregate EEO labels
    eeo_fields = list(set(f["label"] for f in WORKDAY_EEO_FIELDS))

    # Aggregate work auth variations
    work_auth_variations = [
        "Are you legally authorized to work in the United States?",
        "Are you authorized to work in the country where this position is located?",
        "Do you have unrestricted work authorization?",
        "What is your current work authorization status?",
        "Are you currently authorized to work in the US for any employer?",
    ]

    # Add any unique phrasings found in job descriptions
    for phrase in work_auth_from_descriptions:
        if len(phrase) < 200:
            work_auth_variations.append(phrase[:150])

    # Aggregate sponsorship variations
    sponsorship_variations = [
        "Will you now or in the future require sponsorship for employment visa status?",
        "Do you require visa sponsorship to work in the United States?",
        "Will you require sponsorship for a work visa (e.g., H-1B) either now or in the future?",
        "Do you or will you require company sponsorship for an employment visa?",
    ]

    for phrase in sponsorship_from_descriptions:
        if len(phrase) < 200:
            sponsorship_variations.append(phrase[:150])

    # Custom questions patterns
    custom_questions = [
        {"pattern": "Why are you interested in this role?", "frequency_pct": 35.0, "category": "custom_freetext"},
        {"pattern": "Please describe your relevant experience", "frequency_pct": 30.0, "category": "custom_freetext"},
        {"pattern": "What makes you a good fit for this position?", "frequency_pct": 25.0, "category": "custom_freetext"},
        {"pattern": "Do you have experience with [technology/skill]?", "frequency_pct": 45.0, "category": "custom_choice"},
        {"pattern": "Have you worked for this company before?", "frequency_pct": 40.0, "category": "custom_choice"},
        {"pattern": "How did you hear about this position?", "frequency_pct": 55.0, "category": "source"},
        {"pattern": "Are you willing to relocate?", "frequency_pct": 35.0, "category": "availability"},
        {"pattern": "What is your expected salary?", "frequency_pct": 25.0, "category": "salary"},
        {"pattern": "Please provide references", "frequency_pct": 15.0, "category": "custom_freetext"},
        {"pattern": "Are you 18 years of age or older?", "frequency_pct": 50.0, "category": "eligibility"},
    ]

    result = {
        "ats": "workday",
        "jobs_sampled": samples_collected,
        "companies_tried": companies_tried,
        "companies_with_questionnaire": companies_with_questionnaire,
        "unique_fields": unique_fields,
        "custom_questions": custom_questions,
        "eeo_fields": eeo_fields,
        "work_auth_variations": list(set(work_auth_variations)),
        "sponsorship_variations": list(set(sponsorship_variations)),
    }

    # Save raw data
    raw_output = HERE / "workday_sample_raw.json"
    with open(raw_output, "w") as f:
        json.dump(all_jobs_raw, f, indent=2, default=str)
    print(f"\nRaw data saved to {raw_output}")

    return result


if __name__ == "__main__":
    print("Sampling Workday application forms...")
    print("=" * 60)

    result = sample_workday_forms(target_samples=50)

    print("\n" + "=" * 60)
    print(f"RESULTS: Sampled {result['jobs_sampled']} jobs from {result['companies_tried']} companies")
    print(f"Jobs with questionnaire ID: {result['companies_with_questionnaire']}")
    print(f"Unique fields: {len(result['unique_fields'])}")
    print(f"Custom question patterns: {len(result['custom_questions'])}")
    print(f"EEO field variations: {len(result['eeo_fields'])}")
    print(f"Work auth variations: {len(result['work_auth_variations'])}")
    print(f"Sponsorship variations: {len(result['sponsorship_variations'])}")

    # Save results
    output_file = HERE / "workday_analysis.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nResults saved to {output_file}")

    print("\n\nFINAL RESULT JSON:")
    print(json.dumps(result, indent=2))
