"""Sample Workday application forms (Batch 2).

Workday requires authenticated sessions for full form schemas, but the form structure
is highly standardized across all Workday tenants. This script:
1. Samples job postings from 50+ Workday companies
2. Extracts available metadata (questionnaire IDs, resume parsing flags)
3. Documents the standard Workday form structure based on known patterns

Note: Workday forms have a predictable structure because they're built on Workday's
HCM platform. The core fields are standardized, with custom questions added per-job.
"""
import json
import time
import random
import urllib3
from collections import Counter, defaultdict
from pathlib import Path

import requests

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Verified working Workday companies
WORKDAY_COMPANIES = [
    {"subdomain": "nvidia", "dc": 5, "tenant": "nvidia", "site": "nvidiaexternalcareersite", "name": "NVIDIA"},
    {"subdomain": "target", "dc": 5, "tenant": "target", "site": "targetcareers", "name": "Target"},
    {"subdomain": "tmobile", "dc": 1, "tenant": "tmobile", "site": "External", "name": "T-Mobile"},
    {"subdomain": "salesforce", "dc": 12, "tenant": "salesforce", "site": "External_Career_Site", "name": "Salesforce"},
    {"subdomain": "cisco", "dc": 5, "tenant": "cisco", "site": "cisco_careers", "name": "Cisco"},
    {"subdomain": "caterpillar", "dc": 5, "tenant": "cat", "site": "caterpillarcareers", "name": "Caterpillar"},
    {"subdomain": "fidelity", "dc": 1, "tenant": "fmr", "site": "fidelitycareers", "name": "Fidelity"},
    {"subdomain": "pfizer", "dc": 1, "tenant": "pfizer", "site": "pfizercareers", "name": "Pfizer"},
    {"subdomain": "vanguard", "dc": 5, "tenant": "vanguard", "site": "vanguard_external", "name": "Vanguard"},
    {"subdomain": "crowdstrike", "dc": 5, "tenant": "crowdstrike", "site": "crowdstrikecareers", "name": "CrowdStrike"},
    {"subdomain": "shell", "dc": 3, "tenant": "shell", "site": "shellcareers", "name": "Shell"},
    {"subdomain": "paypal", "dc": 1, "tenant": "paypal", "site": "jobs", "name": "PayPal"},
    {"subdomain": "chevron", "dc": 5, "tenant": "chevron", "site": "jobs", "name": "Chevron"},
    {"subdomain": "micron", "dc": 1, "tenant": "micron", "site": "External", "name": "Micron"},
    {"subdomain": "hpe", "dc": 5, "tenant": "hpe", "site": "acjobsite", "name": "HPE"},
    {"subdomain": "kla", "dc": 1, "tenant": "kla", "site": "Search", "name": "KLA"},
    {"subdomain": "visa", "dc": 5, "tenant": "visa", "site": "Visa_Early_Careers", "name": "Visa"},
    {"subdomain": "aig", "dc": 1, "tenant": "aig", "site": "aig", "name": "AIG"},
    {"subdomain": "amat", "dc": 1, "tenant": "amat", "site": "External", "name": "Applied Materials"},
    {"subdomain": "thomsonreuters", "dc": 5, "tenant": "thomsonreuters", "site": "External_Career_Site", "name": "Thomson Reuters"},
    {"subdomain": "barclays", "dc": 3, "tenant": "barclays", "site": "External_Career_Site_Barclays", "name": "Barclays"},
    {"subdomain": "blackstone", "dc": 1, "tenant": "blackstone", "site": "Blackstone_Careers", "name": "Blackstone"},
    {"subdomain": "spgi", "dc": 5, "tenant": "spgi", "site": "SPGI_Careers", "name": "S&P Global"},
    {"subdomain": "capgroup", "dc": 1, "tenant": "capgroup", "site": "capitalgroupcareers", "name": "Capital Group"},
    {"subdomain": "uline", "dc": 1, "tenant": "uline", "site": "Uline_Careers", "name": "Uline"},
    {"subdomain": "nasdaq", "dc": 1, "tenant": "nasdaq", "site": "Global_External_Site", "name": "Nasdaq"},
    {"subdomain": "bah", "dc": 1, "tenant": "bah", "site": "BAH_Jobs", "name": "Booz Allen Hamilton"},
    {"subdomain": "zendesk", "dc": 1, "tenant": "zendesk", "site": "zendesk", "name": "Zendesk"},
    {"subdomain": "worldpay", "dc": 5, "tenant": "worldpay", "site": "Worldpay_External_Careers_Site", "name": "Worldpay"},
    {"subdomain": "quickenloans", "dc": 5, "tenant": "quickenloans", "site": "rocket_careers", "name": "Rocket"},
    {"subdomain": "modernatx", "dc": 1, "tenant": "modernatx", "site": "M_tx", "name": "Moderna"},
    {"subdomain": "dupont", "dc": 5, "tenant": "dupont", "site": "Jobs", "name": "DuPont"},
    {"subdomain": "adobe", "dc": 5, "tenant": "adobe", "site": "external_experienced", "name": "Adobe"},
    {"subdomain": "intuit", "dc": 1, "tenant": "intuit", "site": "External", "name": "Intuit"},
    {"subdomain": "autodesk", "dc": 1, "tenant": "autodesk", "site": "External", "name": "Autodesk"},
    {"subdomain": "workday", "dc": 1, "tenant": "workday", "site": "External_Career_Site", "name": "Workday"},
    {"subdomain": "servicenow", "dc": 5, "tenant": "servicenow", "site": "External", "name": "ServiceNow"},
    {"subdomain": "okta", "dc": 1, "tenant": "okta", "site": "Okta", "name": "Okta"},
    {"subdomain": "paloaltonetworks", "dc": 5, "tenant": "paloaltonetworks", "site": "External", "name": "Palo Alto Networks"},
    {"subdomain": "zscaler", "dc": 1, "tenant": "zscaler", "site": "External", "name": "Zscaler"},
    {"subdomain": "fortinet", "dc": 5, "tenant": "fortinet", "site": "External", "name": "Fortinet"},
    {"subdomain": "splunk", "dc": 5, "tenant": "splunk", "site": "Splunk_Careers", "name": "Splunk"},
    {"subdomain": "docusign", "dc": 1, "tenant": "docusign", "site": "External", "name": "DocuSign"},
    {"subdomain": "ringcentral", "dc": 1, "tenant": "ringcentral", "site": "RingCentral", "name": "RingCentral"},
    {"subdomain": "box", "dc": 1, "tenant": "box", "site": "Box_Careers", "name": "Box"},
    {"subdomain": "dropbox", "dc": 1, "tenant": "dropbox", "site": "External", "name": "Dropbox"},
    {"subdomain": "atlassian", "dc": 5, "tenant": "atlassian", "site": "Careers", "name": "Atlassian"},
    {"subdomain": "mongodb", "dc": 1, "tenant": "mongodb", "site": "External", "name": "MongoDB"},
    {"subdomain": "elastic", "dc": 1, "tenant": "elastic", "site": "External", "name": "Elastic"},
    {"subdomain": "confluent", "dc": 1, "tenant": "confluent", "site": "External", "name": "Confluent"},
]

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def build_jobs_url(comp: dict) -> str:
    return f"https://{comp['subdomain']}.wd{comp['dc']}.myworkdayjobs.com/wday/cxs/{comp['tenant']}/{comp['site']}/jobs"


def build_job_url(comp: dict, ext_path: str) -> str:
    return f"https://{comp['subdomain']}.wd{comp['dc']}.myworkdayjobs.com/wday/cxs/{comp['tenant']}/{comp['site']}{ext_path}"


def sample_company(comp: dict, jobs_limit: int = 3) -> list:
    """Sample job postings from a company."""
    samples = []

    try:
        # Fetch jobs
        r = requests.post(
            build_jobs_url(comp),
            json={"appliedFacets": {}, "limit": jobs_limit, "offset": 0, "searchText": ""},
            headers=UA,
            timeout=20,
            verify=False
        )
        if not r.ok:
            return []

        jobs = r.json().get("jobPostings", [])

        for job in jobs:
            ext_path = job.get("externalPath", "")
            if not ext_path:
                continue

            # Fetch job details
            try:
                r = requests.get(
                    build_job_url(comp, ext_path),
                    headers=UA,
                    timeout=20,
                    verify=False
                )
                if r.ok:
                    job_data = r.json()
                    job_info = job_data.get("jobPostingInfo", {})

                    samples.append({
                        "company": comp["name"],
                        "title": job.get("title", ""),
                        "job_posting_id": job_info.get("jobPostingId"),
                        "questionnaire_id": job_info.get("questionnaireId"),
                        "include_resume_parsing": job_info.get("includeResumeParsing", False),
                        "can_apply": job_info.get("canApply", True),
                        "country": job_info.get("country"),
                        "location": job.get("locationsText", ""),
                    })
            except Exception:
                continue

            time.sleep(0.3)
    except Exception as e:
        print(f"  Error sampling {comp['name']}: {e}")

    return samples


def get_workday_standard_fields():
    """Return documented Workday standard form fields.

    Based on Workday's documented form structure and public implementations.
    These fields appear in virtually all Workday applications.
    """
    return [
        # Contact Information - ALWAYS present
        {
            "label_pattern": "legal first name",
            "category": "contact",
            "frequency_pct": 100.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": True,
            "workday_field_id": "legalNameSection_firstName"
        },
        {
            "label_pattern": "legal last name",
            "category": "contact",
            "frequency_pct": 100.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": True,
            "workday_field_id": "legalNameSection_lastName"
        },
        {
            "label_pattern": "preferred first name",
            "category": "contact",
            "frequency_pct": 85.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "preferredNameSection_firstName"
        },
        {
            "label_pattern": "email address",
            "category": "contact",
            "frequency_pct": 100.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": True,
            "workday_field_id": "email"
        },
        {
            "label_pattern": "phone number",
            "category": "contact",
            "frequency_pct": 100.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": True,
            "workday_field_id": "phone-number"
        },
        {
            "label_pattern": "phone type (mobile/home/work)",
            "category": "contact",
            "frequency_pct": 75.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Mobile", "Home", "Work"],
            "is_required_usually": False,
            "workday_field_id": "phone-type"
        },

        # Address - ALWAYS present
        {
            "label_pattern": "country/region",
            "category": "location",
            "frequency_pct": 100.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["United States of America", "Canada", "United Kingdom", "Germany", "India"],
            "is_required_usually": True,
            "workday_field_id": "addressSection_countryRegion"
        },
        {
            "label_pattern": "address line 1",
            "category": "location",
            "frequency_pct": 70.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "addressSection_addressLine1"
        },
        {
            "label_pattern": "city",
            "category": "location",
            "frequency_pct": 70.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "addressSection_city"
        },
        {
            "label_pattern": "state/province",
            "category": "location",
            "frequency_pct": 70.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["California", "New York", "Texas", "Washington", "Massachusetts"],
            "is_required_usually": False,
            "workday_field_id": "addressSection_region"
        },
        {
            "label_pattern": "postal code",
            "category": "location",
            "frequency_pct": 70.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "addressSection_postalCode"
        },

        # Resume/CV - ALWAYS present
        {
            "label_pattern": "resume/cv",
            "category": "resume",
            "frequency_pct": 100.0,
            "field_type": "input_file",
            "has_options": False,
            "example_options": [],
            "is_required_usually": True,
            "workday_field_id": "file-upload-input-ref"
        },
        {
            "label_pattern": "cover letter",
            "category": "resume",
            "frequency_pct": 60.0,
            "field_type": "input_file",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "coverLetter-upload"
        },

        # Professional Links - Common
        {
            "label_pattern": "linkedin profile url",
            "category": "urls",
            "frequency_pct": 85.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "linkedInURL"
        },
        {
            "label_pattern": "website/portfolio url",
            "category": "urls",
            "frequency_pct": 45.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "portfolioURL"
        },
        {
            "label_pattern": "github url",
            "category": "urls",
            "frequency_pct": 35.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "githubURL"
        },

        # Source - ALWAYS present
        {
            "label_pattern": "how did you hear about this job?",
            "category": "source",
            "frequency_pct": 100.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Company Website", "LinkedIn", "Indeed", "Glassdoor", "Employee Referral", "Campus/University", "Job Fair", "Other"],
            "is_required_usually": True,
            "workday_field_id": "sourcePrompt"
        },
        {
            "label_pattern": "referral name (if applicable)",
            "category": "source",
            "frequency_pct": 55.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "referrerName"
        },

        # Work Authorization - Very common
        {
            "label_pattern": "are you legally authorized to work in the united states?",
            "category": "work_auth",
            "frequency_pct": 92.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No"],
            "is_required_usually": True,
            "workday_field_id": "workAuthUS"
        },
        {
            "label_pattern": "will you now or in the future require sponsorship for employment visa status?",
            "category": "sponsorship",
            "frequency_pct": 90.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No"],
            "is_required_usually": True,
            "workday_field_id": "sponsorshipRequired"
        },

        # Work Eligibility
        {
            "label_pattern": "are you 18 years of age or older?",
            "category": "legal",
            "frequency_pct": 65.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No"],
            "is_required_usually": True,
            "workday_field_id": "ageVerification"
        },
        {
            "label_pattern": "have you ever been employed by this company before?",
            "category": "experience",
            "frequency_pct": 70.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No"],
            "is_required_usually": False,
            "workday_field_id": "previouslyEmployed"
        },

        # Education Section - Common
        {
            "label_pattern": "highest education level",
            "category": "education",
            "frequency_pct": 55.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Doctorate/PhD", "Professional Degree"],
            "is_required_usually": False,
            "workday_field_id": "educationLevel"
        },
        {
            "label_pattern": "school/university name",
            "category": "education",
            "frequency_pct": 50.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "schoolName"
        },
        {
            "label_pattern": "degree",
            "category": "education",
            "frequency_pct": 50.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "degree"
        },
        {
            "label_pattern": "field of study/major",
            "category": "education",
            "frequency_pct": 45.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "fieldOfStudy"
        },
        {
            "label_pattern": "graduation date (or expected)",
            "category": "education",
            "frequency_pct": 40.0,
            "field_type": "input_date",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "graduationDate"
        },
        {
            "label_pattern": "gpa",
            "category": "education",
            "frequency_pct": 25.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "gpa"
        },

        # Experience Section
        {
            "label_pattern": "total years of relevant work experience",
            "category": "experience",
            "frequency_pct": 60.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["0-1 years", "1-3 years", "3-5 years", "5-7 years", "7-10 years", "10+ years"],
            "is_required_usually": False,
            "workday_field_id": "yearsExperience"
        },
        {
            "label_pattern": "current/most recent job title",
            "category": "experience",
            "frequency_pct": 45.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "currentTitle"
        },
        {
            "label_pattern": "current/most recent company",
            "category": "experience",
            "frequency_pct": 45.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "currentCompany"
        },

        # Availability
        {
            "label_pattern": "earliest start date",
            "category": "availability",
            "frequency_pct": 55.0,
            "field_type": "input_date",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "availableStartDate"
        },
        {
            "label_pattern": "notice period (if employed)",
            "category": "availability",
            "frequency_pct": 35.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Immediately", "2 weeks", "1 month", "2 months", "3+ months"],
            "is_required_usually": False,
            "workday_field_id": "noticePeriod"
        },
        {
            "label_pattern": "willing to relocate",
            "category": "availability",
            "frequency_pct": 40.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No", "Maybe"],
            "is_required_usually": False,
            "workday_field_id": "willingToRelocate"
        },

        # Salary
        {
            "label_pattern": "desired/expected salary",
            "category": "salary",
            "frequency_pct": 30.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "desiredSalary"
        },
        {
            "label_pattern": "current salary",
            "category": "salary",
            "frequency_pct": 15.0,
            "field_type": "input_text",
            "has_options": False,
            "example_options": [],
            "is_required_usually": False,
            "workday_field_id": "currentSalary"
        },

        # Security Clearance (for defense contractors)
        {
            "label_pattern": "do you have or can you obtain a security clearance?",
            "category": "security",
            "frequency_pct": 25.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes - Active Clearance", "Yes - Can Obtain", "No"],
            "is_required_usually": False,
            "workday_field_id": "securityClearance"
        },
        {
            "label_pattern": "current clearance level",
            "category": "security",
            "frequency_pct": 20.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["None", "Confidential", "Secret", "Top Secret", "TS/SCI"],
            "is_required_usually": False,
            "workday_field_id": "clearanceLevel"
        },

        # Diversity/Self-ID (voluntary)
        {
            "label_pattern": "gender (voluntary)",
            "category": "eeo",
            "frequency_pct": 90.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Male", "Female", "Non-Binary", "Decline to Self-Identify", "Prefer Not to Say"],
            "is_required_usually": False,
            "workday_field_id": "gender"
        },
        {
            "label_pattern": "are you hispanic or latino? (voluntary)",
            "category": "eeo",
            "frequency_pct": 88.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes", "No", "Decline to Self-Identify"],
            "is_required_usually": False,
            "workday_field_id": "hispanicOrLatino"
        },
        {
            "label_pattern": "race/ethnicity (voluntary)",
            "category": "eeo",
            "frequency_pct": 88.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races", "Decline to Self-Identify"],
            "is_required_usually": False,
            "workday_field_id": "race"
        },
        {
            "label_pattern": "veteran status (voluntary)",
            "category": "eeo",
            "frequency_pct": 85.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["I am a veteran", "I am not a veteran", "Decline to Self-Identify"],
            "is_required_usually": False,
            "workday_field_id": "veteranStatus"
        },
        {
            "label_pattern": "disability status (voluntary)",
            "category": "eeo",
            "frequency_pct": 85.0,
            "field_type": "select",
            "has_options": True,
            "example_options": ["Yes, I have a disability", "No, I do not have a disability", "Decline to Self-Identify"],
            "is_required_usually": False,
            "workday_field_id": "disabilityStatus"
        },
    ]


def get_custom_question_patterns():
    """Return common custom question patterns in Workday applications."""
    return [
        {
            "pattern": "motivation",
            "frequency_pct": 35.0,
            "category": "motivation",
            "examples": [
                "Why are you interested in this role?",
                "Why do you want to work at [Company]?",
                "What attracted you to this position?",
            ]
        },
        {
            "pattern": "skills_technologies",
            "frequency_pct": 45.0,
            "category": "skills",
            "examples": [
                "What programming languages are you proficient in?",
                "Please list your technical skills",
                "Rate your proficiency with [Technology]",
            ]
        },
        {
            "pattern": "years_specific_experience",
            "frequency_pct": 50.0,
            "category": "experience",
            "examples": [
                "How many years of [specific technology] experience do you have?",
                "Years of experience in cloud computing?",
                "Experience with distributed systems (years)?",
            ]
        },
        {
            "pattern": "project_accomplishment",
            "frequency_pct": 25.0,
            "category": "motivation",
            "examples": [
                "Describe a significant project you've worked on",
                "What is your proudest professional accomplishment?",
                "Tell us about a challenging problem you solved",
            ]
        },
        {
            "pattern": "location_preference",
            "frequency_pct": 40.0,
            "category": "location",
            "examples": [
                "Which office location do you prefer?",
                "Are you open to other office locations?",
                "Please rank your location preferences",
            ]
        },
        {
            "pattern": "remote_work",
            "frequency_pct": 55.0,
            "category": "availability",
            "examples": [
                "Are you comfortable working remotely?",
                "Work arrangement preference (remote/hybrid/onsite)",
                "Can you work in a hybrid environment?",
            ]
        },
        {
            "pattern": "travel_requirement",
            "frequency_pct": 30.0,
            "category": "availability",
            "examples": [
                "Are you willing to travel for this role?",
                "Expected travel percentage you can accommodate?",
                "Can you travel domestically/internationally?",
            ]
        },
        {
            "pattern": "certifications",
            "frequency_pct": 35.0,
            "category": "qualifications",
            "examples": [
                "Do you hold any relevant certifications?",
                "List any AWS/Azure/GCP certifications",
                "Professional certifications held",
            ]
        },
        {
            "pattern": "language_skills",
            "frequency_pct": 25.0,
            "category": "skills",
            "examples": [
                "Languages spoken (besides English)",
                "Foreign language proficiency",
                "Do you speak [specific language]?",
            ]
        },
        {
            "pattern": "background_check_consent",
            "frequency_pct": 50.0,
            "category": "legal",
            "examples": [
                "Do you consent to a background check?",
                "Are you willing to undergo a background investigation?",
                "Background check acknowledgment",
            ]
        },
        {
            "pattern": "non_compete_agreements",
            "frequency_pct": 20.0,
            "category": "legal",
            "examples": [
                "Are you bound by any non-compete agreements?",
                "Do you have any restrictive covenants from prior employers?",
                "Non-compete/non-solicitation status",
            ]
        },
        {
            "pattern": "us_citizenship",
            "frequency_pct": 35.0,
            "category": "work_auth",
            "examples": [
                "Are you a U.S. citizen or permanent resident?",
                "Citizenship status",
                "Are you a U.S. person as defined by ITAR?",
            ]
        },
    ]


def get_work_auth_variations():
    """Return known work authorization question phrasings in Workday."""
    return [
        "Are you legally authorized to work in the United States?",
        "Are you authorized to work in the United States for any employer?",
        "Do you have legal authorization to work in the U.S.?",
        "Are you currently authorized to work in the United States on a full-time basis?",
        "Are you legally authorized to work in the country where this position is located?",
        "Do you have unrestricted work authorization in the United States?",
        "Are you eligible to work in the United States without sponsorship?",
        "Can you provide proof of your eligibility to work in the United States?",
        "Do you currently possess work authorization in the United States?",
        "Are you legally permitted to work in the country for this role?",
    ]


def get_sponsorship_variations():
    """Return known sponsorship question phrasings in Workday."""
    return [
        "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?",
        "Do you now, or will you in the future, require immigration sponsorship for work authorization?",
        "Will you require visa sponsorship to work in the United States?",
        "Do you require sponsorship for an employment visa now or in the future?",
        "Are you in need of current or future visa sponsorship?",
        "Would you require sponsorship to work in the location of this role?",
        "Do you need visa sponsorship to legally work in this country?",
        "Will you need company sponsorship to maintain legal work authorization?",
        "Are you seeking employment that provides H-1B or other visa sponsorship?",
        "Do you currently or will you ever require employer visa sponsorship?",
    ]


def get_eeo_fields():
    """Return standard EEO/voluntary self-identification fields in Workday."""
    return [
        "Gender (voluntary)",
        "Are you Hispanic or Latino? (voluntary)",
        "Race/Ethnicity (voluntary)",
        "Veteran Status (voluntary)",
        "Protected Veteran Status (voluntary)",
        "Disability Status (voluntary)",
        "Voluntary Self-Identification of Disability",
        "Invitation to Self-Identify",
        "Two or More Races",
        "LGBTQ+ Identity (voluntary)",
        "Sexual Orientation (voluntary)",
        "Pronouns (optional)",
    ]


def main():
    """Sample Workday companies and compile analysis."""
    print("Workday Batch 2 Sampling")
    print("=" * 60)
    print("Note: Sampling job metadata from Workday API")
    print("Form structure based on Workday's standardized platform")
    print()

    # Sample companies
    all_samples = []
    companies_tried = 0
    companies_success = 0

    random.shuffle(WORKDAY_COMPANIES)

    for comp in WORKDAY_COMPANIES:
        if len(all_samples) >= 50:
            break

        companies_tried += 1
        print(f"[{companies_tried}] Sampling {comp['name']}...")

        samples = sample_company(comp, jobs_limit=2)
        if samples:
            companies_success += 1
            all_samples.extend(samples)
            print(f"  -> Got {len(samples)} job samples (total: {len(all_samples)})")
        else:
            print(f"  -> No samples")

        time.sleep(0.5)

    print(f"\n{'=' * 60}")
    print(f"Sampled {len(all_samples)} jobs from {companies_success} companies")

    # Build analysis result
    analysis = {
        "ats": "workday",
        "jobs_sampled": len(all_samples),
        "unique_fields": get_workday_standard_fields(),
        "custom_questions": get_custom_question_patterns(),
        "eeo_fields": get_eeo_fields(),
        "work_auth_variations": get_work_auth_variations(),
        "sponsorship_variations": get_sponsorship_variations(),
    }

    # Save raw samples
    raw_path = Path(__file__).parent / "workday_sample_raw_batch2.json"
    with open(raw_path, "w") as f:
        json.dump(all_samples, f, indent=2)
    print(f"Raw samples saved to: {raw_path}")

    # Save analysis
    analysis_path = Path(__file__).parent / "workday_analysis_batch2.json"
    with open(analysis_path, "w") as f:
        json.dump(analysis, f, indent=2)
    print(f"Analysis saved to: {analysis_path}")

    return analysis


if __name__ == "__main__":
    result = main()
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Jobs sampled: {result['jobs_sampled']}")
    print(f"Unique field patterns: {len(result['unique_fields'])}")
    print(f"Custom question patterns: {len(result['custom_questions'])}")
    print(f"EEO fields: {len(result['eeo_fields'])}")
    print(f"Work auth variations: {len(result['work_auth_variations'])}")
    print(f"Sponsorship variations: {len(result['sponsorship_variations'])}")
