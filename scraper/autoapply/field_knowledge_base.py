"""Central field knowledge base for all ATSes.

Every possible application field label maps to:
- category: standard category (first_name, email, work_auth, etc.)
- profile_field: which Profile field to use
- resolution: how to fill it (profile, matched, eeo, ai_needed, user_needed, file)

When any adapter encounters an unknown field label, it queries this base to find
a match. This eliminates duplicate pattern definitions across adapters and ensures
consistent behavior.

Usage:
    from field_knowledge_base import lookup_field, get_profile_value, MASTER_PROFILE_FIELDS

    category, profile_field, resolution = lookup_field("Are you authorized to work in the US?")
    # Returns: ("work_auth", "work_authorized", "matched")

    value, source = get_profile_value("first_name", profile)
    # Returns: ("John", "profile")
"""
from __future__ import annotations

import re
from typing import Optional, Any
from dataclasses import dataclass, field


# =============================================================================
# FIELD PATTERNS - All known label variations mapped to categories
# =============================================================================

FIELD_PATTERNS = {
    # -------------------------------------------------------------------------
    # IDENTITY
    # -------------------------------------------------------------------------
    "first_name": {
        "labels": [
            "first name", "firstname", "given name", "forename", "first",
            "legal first name", "preferred first name", "fname",
            "legalnamefirstname", "legalnamesection_firstname",
            "preferrednamesection_firstname",
        ],
        "field_names": [
            "first_name", "firstName", "fname", "givenName", "given_name",
            "legalNameSection_firstName", "preferredNameSection_firstName",
            "_systemfield_name",  # Ashby (contains full name)
        ],
        "profile_field": "first_name",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 100,
    },
    "last_name": {
        "labels": [
            "last name", "lastname", "surname", "family name", "last",
            "legal last name", "lname", "legalnamelastname",
            "legalnamesection_lastname",
        ],
        "field_names": [
            "last_name", "lastName", "lname", "surname", "familyName", "family_name",
            "legalNameSection_lastName",
        ],
        "profile_field": "last_name",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 100,
    },
    "full_name": {
        "labels": [
            "full name", "name", "legal name", "your name", "applicant name",
            "candidate name", "full legal name",
        ],
        "field_names": [
            "name", "fullName", "full_name", "candidateName", "applicantName",
        ],
        "profile_field": "full_name",  # Computed from first_name + last_name
        "resolution": "profile",
        "required_at_signup": False,  # Derived
        "frequency_pct": 30,
    },
    "preferred_name": {
        "labels": [
            "preferred name", "nickname", "goes by", "preferred first name",
            "what should we call you",
        ],
        "field_names": [
            "preferredName", "preferred_name", "nickname",
            "preferredNameSection_firstName",
        ],
        "profile_field": "preferred_name",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 15,
    },

    # -------------------------------------------------------------------------
    # CONTACT
    # -------------------------------------------------------------------------
    "email": {
        "labels": [
            "email", "email address", "e-mail", "e-mail address",
            "work email", "personal email", "contact email",
        ],
        "field_names": [
            "email", "emailAddress", "email_address", "e-mail", "Email",
            "_systemfield_email",
        ],
        "profile_field": "email",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 100,
    },
    "phone": {
        "labels": [
            "phone", "phone number", "telephone", "mobile", "cell",
            "mobile number", "cell phone", "contact number", "phone type",
            "primary phone", "work phone", "home phone",
        ],
        "field_names": [
            "phone", "phoneNumber", "phone_number", "telephone", "mobile",
            "cellPhone", "cell_phone", "phone-number",
            "_systemfield_phone",
        ],
        "profile_field": "phone",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 95,
    },

    # -------------------------------------------------------------------------
    # DOCUMENTS
    # -------------------------------------------------------------------------
    "resume": {
        "labels": [
            "resume", "cv", "curriculum vitae", "resume/cv", "upload resume",
            "attach resume", "your resume", "resume file",
        ],
        "field_names": [
            "resume", "cv", "Resume", "CV", "resumeFile", "resume_file",
            "_systemfield_resume",
        ],
        "profile_field": "resume_url",
        "resolution": "file",
        "required_at_signup": True,
        "frequency_pct": 98,
    },
    "cover_letter": {
        "labels": [
            "cover letter", "covering letter", "letter of motivation",
            "motivation letter", "upload cover letter", "cover letter file",
        ],
        "field_names": [
            "coverLetter", "cover_letter", "coveringLetter", "motivationLetter",
            "_systemfield_coverletter",
        ],
        "profile_field": "cover_letter_url",
        "resolution": "ai_needed",  # AI drafts cover letters
        "required_at_signup": False,
        "frequency_pct": 40,
    },
    "transcript": {
        "labels": [
            "transcript", "academic transcript", "university transcript",
            "college transcript", "grade transcript", "official transcript",
        ],
        "field_names": [
            "transcript", "academicTranscript", "academic_transcript",
        ],
        "profile_field": "transcript_url",
        "resolution": "file",
        "required_at_signup": False,
        "frequency_pct": 10,
    },
    "work_sample": {
        "labels": [
            "work sample", "portfolio piece", "writing sample", "code sample",
            "design sample", "additional document", "other document",
        ],
        "field_names": [
            "workSample", "work_sample", "writingSample", "codeSample",
            "additionalDocument",
        ],
        "profile_field": None,
        "resolution": "user_needed",
        "required_at_signup": False,
        "frequency_pct": 5,
    },

    # -------------------------------------------------------------------------
    # LINKS
    # -------------------------------------------------------------------------
    "linkedin": {
        "labels": [
            "linkedin", "linkedin profile", "linkedin url", "linkedin link",
            "your linkedin", "linkedin profile url",
        ],
        "field_names": [
            "linkedin", "linkedIn", "LinkedIn", "linkedinUrl", "linkedin_url",
            "linkedInProfile", "linkedinprofile",
            "_systemfield_linkedin",
        ],
        "profile_field": "linkedin_url",
        "resolution": "profile",
        "required_at_signup": True,  # Very commonly requested
        "frequency_pct": 75,
    },
    "github": {
        "labels": [
            "github", "github profile", "github url", "github link",
            "github username", "your github",
        ],
        "field_names": [
            "github", "gitHub", "GitHub", "githubUrl", "github_url",
            "githubProfile", "github_profile",
        ],
        "profile_field": "github_url",
        "resolution": "profile",
        "required_at_signup": True,  # Common for tech roles
        "frequency_pct": 40,
    },
    "portfolio": {
        "labels": [
            "portfolio", "portfolio url", "portfolio link", "website",
            "personal website", "personal site", "your website", "web presence",
            "online portfolio",
        ],
        "field_names": [
            "portfolio", "portfolioUrl", "portfolio_url", "website",
            "personalWebsite", "personal_website", "websiteUrl",
        ],
        "profile_field": "portfolio_url",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 35,
    },
    "twitter": {
        "labels": [
            "twitter", "twitter profile", "twitter handle", "x profile",
            "twitter/x",
        ],
        "field_names": [
            "twitter", "twitterHandle", "twitter_handle", "twitterUrl",
        ],
        "profile_field": "twitter_url",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 10,
    },
    "other_link": {
        "labels": [
            "other link", "additional link", "blog", "medium", "dribbble",
            "behance", "stackoverflow", "stack overflow", "kaggle",
        ],
        "field_names": [
            "otherLink", "additionalLink", "blog", "blogUrl",
        ],
        "profile_field": "other_links",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 15,
    },

    # -------------------------------------------------------------------------
    # LOCATION
    # -------------------------------------------------------------------------
    "location": {
        "labels": [
            "location", "current location", "where are you located",
            "city/state", "city, state",
        ],
        "field_names": [
            "location", "currentLocation", "current_location",
            "_systemfield_location",
        ],
        "profile_field": "location",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 60,
    },
    "address": {
        "labels": [
            "address", "street address", "address line 1", "address line 2",
            "street", "mailing address", "home address",
        ],
        "field_names": [
            "address", "streetAddress", "street_address", "addressLine1",
            "address_line_1", "addressSection_addressLine1",
        ],
        "profile_field": "address",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 30,
    },
    "city": {
        "labels": [
            "city", "city name", "town",
        ],
        "field_names": [
            "city", "cityName", "city_name", "addressSection_city",
        ],
        "profile_field": "city",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 40,
    },
    "state": {
        "labels": [
            "state", "state/province", "province", "region",
        ],
        "field_names": [
            "state", "stateProvince", "state_province", "province", "region",
            "addressSection_state",
        ],
        "profile_field": "state",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 40,
    },
    "zip": {
        "labels": [
            "zip", "zip code", "postal code", "postcode", "zip/postal code",
        ],
        "field_names": [
            "zip", "zipCode", "zip_code", "postalCode", "postal_code", "postcode",
            "addressSection_postalCode",
        ],
        "profile_field": "zip_code",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 30,
    },
    "country": {
        "labels": [
            "country", "country/region", "country of residence", "nation",
        ],
        "field_names": [
            "country", "countryRegion", "country_region", "countryOfResidence",
            "addressSection_countryRegion",
        ],
        "profile_field": "country",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 50,
    },

    # -------------------------------------------------------------------------
    # WORK AUTHORIZATION
    # -------------------------------------------------------------------------
    "work_auth": {
        "labels": [
            "are you authorized to work in the united states",
            "are you legally authorized to work in the us",
            "authorized to work", "work authorization",
            "do you have work authorization", "work authorization status",
            "are you eligible to work in the united states",
            "legally authorized to work", "work permit",
            "right to work", "employment eligibility",
            "are you authorized to work in this country",
            "can you legally work in the us",
            "do you have legal authorization to work",
            "are you a us citizen or authorized to work",
            "employment authorization",
        ],
        "field_names": [
            "workAuthorization", "work_authorization", "authorizedToWork",
            "authorized_to_work", "workAuth", "work_auth", "workEligibility",
            "employmentAuthorization", "rightToWork",
        ],
        "profile_field": "work_authorized",
        "resolution": "matched",
        "required_at_signup": True,
        "frequency_pct": 80,
    },
    "sponsorship": {
        "labels": [
            "will you now or in the future require sponsorship",
            "do you require sponsorship", "visa sponsorship",
            "will you require visa sponsorship", "sponsorship required",
            "require sponsorship", "need sponsorship",
            "do you need visa sponsorship",
            "will you require sponsorship for employment visa status",
            "sponsorship for employment",
            "do you or will you require sponsorship",
            "sponsorship to work",
        ],
        "field_names": [
            "sponsorship", "visaSponsorship", "visa_sponsorship",
            "requireSponsorship", "require_sponsorship", "needSponsorship",
            "sponsorshipRequired",
        ],
        "profile_field": "require_sponsorship",
        "resolution": "matched",
        "required_at_signup": True,
        "frequency_pct": 75,
    },

    # -------------------------------------------------------------------------
    # WORK PREFERENCES
    # -------------------------------------------------------------------------
    "relocate": {
        "labels": [
            "relocate", "willing to relocate", "open to relocation",
            "relocation", "would you relocate", "able to relocate",
        ],
        "field_names": [
            "relocate", "willingToRelocate", "willing_to_relocate",
            "relocation", "openToRelocation",
        ],
        "profile_field": "willing_to_relocate",
        "resolution": "matched",
        "required_at_signup": True,
        "frequency_pct": 40,
    },
    "remote_preference": {
        "labels": [
            "remote", "remote work", "work from home", "hybrid",
            "on-site", "onsite", "in-office", "work arrangement",
            "preferred work location", "work mode preference",
        ],
        "field_names": [
            "remote", "remoteWork", "remote_work", "workArrangement",
            "workLocation", "workMode",
        ],
        "profile_field": "remote_preference",
        "resolution": "matched",
        "required_at_signup": False,
        "frequency_pct": 30,
    },
    "start_date": {
        "labels": [
            "start date", "availability", "available to start",
            "when can you start", "earliest start date", "notice period",
            "available start date", "availability date",
        ],
        "field_names": [
            "startDate", "start_date", "availability", "availableDate",
            "earliestStartDate", "noticePeriod",
        ],
        "profile_field": "start_date",
        "resolution": "matched",
        "required_at_signup": False,
        "frequency_pct": 50,
    },
    "salary": {
        "labels": [
            "salary", "salary expectation", "expected salary",
            "desired salary", "compensation", "pay expectation",
            "salary requirement", "expected compensation",
            "desired compensation", "salary range",
        ],
        "field_names": [
            "salary", "salaryExpectation", "salary_expectation",
            "expectedSalary", "desiredSalary", "compensation",
            "salaryRequirement",
        ],
        "profile_field": "salary_expectation",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 35,
    },

    # -------------------------------------------------------------------------
    # EXPERIENCE
    # -------------------------------------------------------------------------
    "experience": {
        "labels": [
            "years of experience", "years experience", "experience",
            "total experience", "relevant experience", "work experience",
            "professional experience", "how many years",
        ],
        "field_names": [
            "experience", "yearsExperience", "years_experience",
            "totalExperience", "workExperience", "yearsOfExperience",
        ],
        "profile_field": "years_experience",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 45,
    },
    "current_company": {
        "labels": [
            "current company", "current employer", "employer",
            "current organization", "company name", "where do you work",
        ],
        "field_names": [
            "currentCompany", "current_company", "employer", "companyName",
        ],
        "profile_field": "current_company",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 20,
    },
    "current_title": {
        "labels": [
            "current title", "job title", "current position",
            "current role", "position title",
        ],
        "field_names": [
            "currentTitle", "current_title", "jobTitle", "position",
            "currentPosition", "currentRole",
        ],
        "profile_field": "current_title",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 20,
    },
    "education": {
        "labels": [
            "education", "highest education", "degree", "school",
            "university", "college", "educational background",
            "highest degree", "education level",
        ],
        "field_names": [
            "education", "highestEducation", "degree", "school",
            "university", "college", "educationLevel",
        ],
        "profile_field": "education",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 50,
    },
    "graduation_year": {
        "labels": [
            "graduation year", "year of graduation", "grad year",
            "expected graduation", "graduation date",
        ],
        "field_names": [
            "graduationYear", "graduation_year", "gradYear", "graduationDate",
        ],
        "profile_field": "graduation_year",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 30,
    },
    "major": {
        "labels": [
            "major", "field of study", "degree major", "area of study",
            "concentration", "specialization",
        ],
        "field_names": [
            "major", "fieldOfStudy", "field_of_study", "degreeMajor",
        ],
        "profile_field": "major",
        "resolution": "profile",
        "required_at_signup": True,
        "frequency_pct": 35,
    },
    "gpa": {
        "labels": [
            "gpa", "grade point average", "cumulative gpa", "overall gpa",
        ],
        "field_names": [
            "gpa", "gradePointAverage", "cumulativeGpa",
        ],
        "profile_field": "gpa",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 15,
    },

    # -------------------------------------------------------------------------
    # EEO (Equal Employment Opportunity)
    # -------------------------------------------------------------------------
    "gender": {
        "labels": [
            "gender", "sex", "gender identity", "what is your gender",
        ],
        "field_names": [
            "gender", "sex", "genderIdentity", "gender_identity",
        ],
        "profile_field": "eeo_gender",
        "resolution": "eeo",  # Default to decline
        "required_at_signup": False,
        "frequency_pct": 65,
    },
    "race": {
        "labels": [
            "race", "ethnicity", "race/ethnicity", "ethnic background",
            "racial background", "race or ethnicity",
            "hispanic or latino", "are you hispanic",
        ],
        "field_names": [
            "race", "ethnicity", "raceEthnicity", "race_ethnicity",
            "ethnicBackground",
        ],
        "profile_field": "eeo_race",
        "resolution": "eeo",
        "required_at_signup": False,
        "frequency_pct": 65,
    },
    "veteran": {
        "labels": [
            "veteran", "veteran status", "protected veteran",
            "are you a veteran", "military service", "military veteran",
        ],
        "field_names": [
            "veteran", "veteranStatus", "veteran_status", "protectedVeteran",
            "militaryService",
        ],
        "profile_field": "eeo_veteran",
        "resolution": "eeo",
        "required_at_signup": False,
        "frequency_pct": 60,
    },
    "disability": {
        "labels": [
            "disability", "disability status", "do you have a disability",
            "disabilities", "accommodation needed",
        ],
        "field_names": [
            "disability", "disabilityStatus", "disability_status",
            "hasDisability",
        ],
        "profile_field": "eeo_disability",
        "resolution": "eeo",
        "required_at_signup": False,
        "frequency_pct": 60,
    },

    # -------------------------------------------------------------------------
    # SOURCE/REFERRAL
    # -------------------------------------------------------------------------
    "source": {
        "labels": [
            "how did you hear about us", "how did you hear about this job",
            "where did you hear about us", "referral source",
            "how did you find us", "job source", "how did you learn about",
            "where did you find this job", "how did you discover",
        ],
        "field_names": [
            "source", "howDidYouHear", "how_did_you_hear", "referralSource",
            "jobSource", "hearAboutUs",
        ],
        "profile_field": "how_heard",
        "resolution": "matched",
        "required_at_signup": False,
        "frequency_pct": 45,
    },
    "referral": {
        "labels": [
            "referral", "referred by", "employee referral", "referral name",
            "who referred you", "referrer name", "referring employee",
        ],
        "field_names": [
            "referral", "referredBy", "referred_by", "referralName",
            "referrerName", "employeeReferral",
        ],
        "profile_field": "referral_name",
        "resolution": "profile",
        "required_at_signup": False,
        "frequency_pct": 25,
    },

    # -------------------------------------------------------------------------
    # CUSTOM/ESSAYS
    # -------------------------------------------------------------------------
    "why_interested": {
        "labels": [
            "why are you interested", "why this role", "why this company",
            "why do you want to work here", "why are you applying",
            "what interests you", "why us", "why this position",
        ],
        "field_names": [
            "whyInterested", "why_interested", "whyUs", "whyThisRole",
        ],
        "profile_field": "story_why_interested",
        "resolution": "ai_needed",
        "required_at_signup": False,
        "frequency_pct": 30,
    },
    "tell_about_yourself": {
        "labels": [
            "tell us about yourself", "about yourself", "introduce yourself",
            "describe yourself", "self introduction",
        ],
        "field_names": [
            "aboutYourself", "about_yourself", "selfIntro", "introduction",
        ],
        "profile_field": "story_about_me",
        "resolution": "ai_needed",
        "required_at_signup": False,
        "frequency_pct": 20,
    },
    "describe_project": {
        "labels": [
            "describe a project", "tell us about a project",
            "recent project", "favorite project", "proud of project",
            "technical project", "past project",
        ],
        "field_names": [
            "describeProject", "describe_project", "project", "recentProject",
        ],
        "profile_field": "story_project",
        "resolution": "ai_needed",
        "required_at_signup": False,
        "frequency_pct": 15,
    },
    "custom": {
        "labels": [],  # Catch-all for unrecognized questions
        "field_names": [],
        "profile_field": "custom_answers",
        "resolution": "ai_needed",
        "required_at_signup": False,
        "frequency_pct": 40,
    },
}


# =============================================================================
# MASTER PROFILE FIELDS - What users should fill at signup
# =============================================================================

MASTER_PROFILE_FIELDS = {
    "required": [
        # Must have for any application
        {"field": "first_name", "label": "First Name", "type": "text"},
        {"field": "last_name", "label": "Last Name", "type": "text"},
        {"field": "email", "label": "Email", "type": "email"},
        {"field": "phone", "label": "Phone Number", "type": "phone"},
        {"field": "resume_url", "label": "Resume", "type": "file"},
        {"field": "linkedin_url", "label": "LinkedIn Profile", "type": "url"},
        {"field": "work_authorized", "label": "Authorized to work in US?", "type": "boolean"},
        {"field": "require_sponsorship", "label": "Require visa sponsorship?", "type": "boolean"},
        {"field": "location", "label": "Current Location (City, State)", "type": "text"},
    ],
    "recommended": [
        # Needed by 50%+ of applications
        {"field": "github_url", "label": "GitHub Profile", "type": "url"},
        {"field": "years_experience", "label": "Years of Experience", "type": "select",
         "options": ["0-1", "1-2", "2-3", "3-5", "5+"]},
        {"field": "education", "label": "Highest Education", "type": "select",
         "options": ["High School", "Associate's", "Bachelor's", "Master's", "PhD"]},
        {"field": "graduation_year", "label": "Graduation Year", "type": "number"},
        {"field": "major", "label": "Major / Field of Study", "type": "text"},
        {"field": "willing_to_relocate", "label": "Willing to Relocate?", "type": "boolean"},
        {"field": "start_date", "label": "Earliest Start Date", "type": "select",
         "options": ["Immediately", "2 weeks", "1 month", "Flexible"]},
    ],
    "optional": [
        # Nice to have, <50% frequency
        {"field": "portfolio_url", "label": "Portfolio / Website", "type": "url"},
        {"field": "address", "label": "Street Address", "type": "text"},
        {"field": "city", "label": "City", "type": "text"},
        {"field": "state", "label": "State", "type": "text"},
        {"field": "zip_code", "label": "Zip Code", "type": "text"},
        {"field": "country", "label": "Country", "type": "text", "default": "United States"},
        {"field": "salary_expectation", "label": "Salary Expectation", "type": "text"},
        {"field": "current_company", "label": "Current Company", "type": "text"},
        {"field": "current_title", "label": "Current Title", "type": "text"},
        {"field": "gpa", "label": "GPA", "type": "text"},
        {"field": "how_heard", "label": "Default 'How did you hear?'", "type": "text",
         "default": "Company website"},
        {"field": "referral_name", "label": "Referral Name (if any)", "type": "text"},
        {"field": "preferred_name", "label": "Preferred Name / Nickname", "type": "text"},
        {"field": "twitter_url", "label": "Twitter/X Profile", "type": "url"},
        {"field": "remote_preference", "label": "Work Preference", "type": "select",
         "options": ["Remote", "Hybrid", "On-site", "Flexible"]},
    ],
    "story_bank": [
        # AI drafting prompts - answers get reused
        {"field": "story_why_interested", "label": "Generic 'Why are you interested?' answer",
         "type": "textarea", "hint": "A template answer that can be personalized per company"},
        {"field": "story_about_me", "label": "Tell us about yourself",
         "type": "textarea", "hint": "Your elevator pitch"},
        {"field": "story_project", "label": "Describe a project you're proud of",
         "type": "textarea", "hint": "A detailed project description"},
        {"field": "resume_text", "label": "Resume as plain text",
         "type": "textarea", "hint": "Extracted text from your resume for AI drafting"},
    ],
    "eeo_preferences": [
        # EEO defaults
        {"field": "eeo_decline_all", "label": "Decline all EEO questions?", "type": "boolean",
         "default": True, "hint": "If true, auto-selects 'Decline to answer' for all EEO questions"},
        {"field": "eeo_gender", "label": "Gender (if answering)", "type": "select",
         "options": ["Male", "Female", "Non-binary", "Decline to self-identify"]},
        {"field": "eeo_race", "label": "Race/Ethnicity (if answering)", "type": "select"},
        {"field": "eeo_veteran", "label": "Veteran Status (if answering)", "type": "select"},
        {"field": "eeo_disability", "label": "Disability Status (if answering)", "type": "select"},
    ],
}


# =============================================================================
# COMPILED PATTERNS for fast lookup
# =============================================================================

# Build regex patterns from labels
_COMPILED_PATTERNS: list[tuple[str, re.Pattern]] = []
for category, info in FIELD_PATTERNS.items():
    if info["labels"]:
        # Create regex that matches any of the labels
        escaped = [re.escape(label) for label in info["labels"]]
        pattern = re.compile(r"\b(" + "|".join(escaped) + r")\b", re.IGNORECASE)
        _COMPILED_PATTERNS.append((category, pattern))

# Build field name lookup
_FIELD_NAME_MAP: dict[str, str] = {}
for category, info in FIELD_PATTERNS.items():
    for field_name in info.get("field_names", []):
        _FIELD_NAME_MAP[field_name.lower()] = category


# =============================================================================
# LOOKUP FUNCTIONS
# =============================================================================

def lookup_field(label: str, field_name: str = "") -> tuple[str, str, str]:
    """Given a field label and/or name, return (category, profile_field, resolution).

    Args:
        label: The field label text (e.g., "First Name", "Are you authorized to work?")
        field_name: Optional field name/id (e.g., "firstName", "workAuthorization")

    Returns:
        (category, profile_field, resolution) tuple
        category: The standard category (e.g., "first_name", "work_auth")
        profile_field: Which Profile field to use (e.g., "first_name", "work_authorized")
        resolution: How to fill it ("profile", "matched", "eeo", "ai_needed", "user_needed", "file")
    """
    # Try field name first (more specific)
    if field_name:
        fn_lower = field_name.lower()
        if fn_lower in _FIELD_NAME_MAP:
            cat = _FIELD_NAME_MAP[fn_lower]
            info = FIELD_PATTERNS[cat]
            return (cat, info["profile_field"], info["resolution"])

    # Try label patterns
    label_lower = (label or "").lower()

    # Precedence: a question that mentions sponsorship is ABOUT sponsorship, even
    # when it also says "work authorization" (e.g. "Will you now or in the future
    # require sponsorship for work authorization?"). It must resolve from
    # require_sponsorship, never from work_authorized — answering the wrong one is
    # dangerous. Skip the shortcut for "without sponsorship" phrasings, which are
    # really work-authorization questions.
    if "sponsor" in label_lower and "without sponsor" not in label_lower:
        info = FIELD_PATTERNS["sponsorship"]
        return ("sponsorship", info["profile_field"], info["resolution"])

    for category, pattern in _COMPILED_PATTERNS:
        if pattern.search(label_lower):
            info = FIELD_PATTERNS[category]
            return (category, info["profile_field"], info["resolution"])

    # Unknown field - determine if it needs AI or user
    return ("custom", "custom_answers", "ai_needed")


def lookup_category(label: str, field_name: str = "") -> str:
    """Convenience function to get just the category."""
    return lookup_field(label, field_name)[0]


def get_profile_value(category: str, profile: Any) -> tuple[Any, str]:
    """Get value from profile for a category.

    Args:
        category: Standard category name
        profile: Profile object with fields

    Returns:
        (value, source) tuple
    """
    info = FIELD_PATTERNS.get(category)
    if not info:
        return (None, "user_needed")

    profile_field = info["profile_field"]
    resolution = info["resolution"]

    # Special handling for computed fields
    if category == "full_name":
        first = getattr(profile, "first_name", "") or ""
        last = getattr(profile, "last_name", "") or ""
        full = f"{first} {last}".strip()
        return (full, "profile") if full else (None, "user_needed")

    # EEO fields - default to decline
    if resolution == "eeo":
        return (None, "eeo")  # Caller should use _decline_option

    # File fields
    if resolution == "file":
        val = getattr(profile, profile_field, None) if profile_field else None
        return (val, "file")

    # AI-needed fields
    if resolution == "ai_needed":
        # Check custom_answers first
        if hasattr(profile, "custom_answers"):
            custom = profile.custom_answers or {}
            if category in custom:
                return (custom[category], "profile")
        return (None, "ai_needed")

    # Standard profile lookup
    if profile_field and hasattr(profile, profile_field):
        val = getattr(profile, profile_field, None)
        if val is not None and val != "":
            return (val, "profile" if resolution == "profile" else "matched")

    return (None, "user_needed" if info.get("required_at_signup") else "unfilled")


def get_all_categories() -> list[str]:
    """Return list of all known categories."""
    return list(FIELD_PATTERNS.keys())


def get_required_profile_fields() -> list[str]:
    """Return list of profile fields required at signup."""
    return [f["field"] for f in MASTER_PROFILE_FIELDS["required"]]


def get_all_profile_fields() -> list[str]:
    """Return list of all profile fields."""
    fields = []
    for section in ["required", "recommended", "optional", "story_bank"]:
        fields.extend(f["field"] for f in MASTER_PROFILE_FIELDS.get(section, []))
    return fields


# =============================================================================
# OPTION MATCHING HELPERS
# =============================================================================

def match_option(values: list[dict], *wanted: str) -> Optional[str]:
    """Pick the option whose label/value contains any wanted substring."""
    for v in values or []:
        label = str(v.get("label", "")).lower()
        for w in wanted:
            if w in label:
                return v.get("value", v.get("label"))
    return None


def decline_option(values: list[dict]) -> Optional[str]:
    """Find the 'decline to answer' option."""
    return match_option(values, "decline", "prefer not", "don't wish", "do not wish",
                       "not to disclose", "not to answer")


def yesno_option(values: list[dict], yes: bool) -> Optional[str]:
    """Find yes or no option."""
    return match_option(values, "yes") if yes else match_option(values, "no")


def authorized_option(values: list[dict], authorized: bool) -> Optional[str]:
    """Match work-authorization options with varied phrasing."""
    for v in values or []:
        lo = str(v.get("label", "")).lower()
        neg = any(k in lo for k in ("not ", "n't", "require sponsor", "will require", "do not"))
        if authorized and (lo.startswith("yes") or ("authorized" in lo and not neg)):
            return v.get("value", v.get("label"))
        if not authorized and (lo.startswith("no") or neg):
            return v.get("value", v.get("label"))
    return yesno_option(values, authorized)


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "FIELD_PATTERNS",
    "MASTER_PROFILE_FIELDS",
    "lookup_field",
    "lookup_category",
    "get_profile_value",
    "get_all_categories",
    "get_required_profile_fields",
    "get_all_profile_fields",
    "match_option",
    "decline_option",
    "yesno_option",
    "authorized_option",
]


if __name__ == "__main__":
    # Demo
    print("=== Field Knowledge Base ===\n")

    # Test lookups
    test_labels = [
        "First Name",
        "Are you legally authorized to work in the US?",
        "Will you require visa sponsorship?",
        "LinkedIn Profile",
        "Tell us about yourself",
        "Gender",
        "Some random question",
    ]

    print("Label Lookups:")
    for label in test_labels:
        cat, field, res = lookup_field(label)
        print(f"  '{label}' -> {cat} | {field} | {res}")

    print("\n" + "=" * 50)
    print("\nMaster Profile Fields:")
    for section, fields in MASTER_PROFILE_FIELDS.items():
        print(f"\n{section.upper()}:")
        for f in fields:
            print(f"  - {f['field']}: {f['label']}")

    print("\n" + "=" * 50)
    print(f"\nTotal categories: {len(FIELD_PATTERNS)}")
    print(f"Total required fields: {len(get_required_profile_fields())}")
    print(f"Total profile fields: {len(get_all_profile_fields())}")
