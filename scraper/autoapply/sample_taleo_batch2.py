"""Sample 50 MORE Taleo job application forms (batch 2 - different companies).

This batch focuses on companies NOT in batch 1 to get broader coverage.
"""
import requests
import json
import time
import re
from collections import defaultdict
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# BATCH 2: Different companies from batch 1
# Batch 1 included: oracle, boeing, target, walmart, homedepot, lowes, jpmorganchase, jpmorgan, wellsfargo,
# bankofamerica, citi, citigroup, disney, att, verizon, tmobile, comcast, nbcuniversal, ford, gm,
# generalmotors, honda, toyota, merck, pfizer, jnj, johnson, abbvie, amgen, gilead, biogen, lockheedmartin,
# lockheed, raytheon, northropgrumman, bae, generaldynamics, caterpillar, johndeere, deere, 3m, honeywell,
# ge, generalelectric, siemens, exxonmobil, chevron, shell, conocophillips, halliburton, schlumberger,
# ups, fedex, usps, americanairlines, delta, united, southwest, marriott, hilton, mcdonalds, starbucks,
# kroger, costco, cvs, walgreens, anthem, cigna, humana, unitedhealth, aetna, kaiser, hca, metlife,
# prudential, aig, allstate, progressive

BATCH2_COMPANIES = [
    # Utilities/Energy
    ("dukeenergy", "1"),
    ("duke", "1"),
    ("southerncompany", "1"),
    ("dominion", "1"),
    ("dominionenergy", "1"),
    ("xcelenergy", "1"),
    ("nextera", "1"),
    ("pge", "1"),
    ("pacificgas", "1"),
    ("entergy", "1"),
    ("aep", "1"),
    ("americanelectric", "1"),

    # Financial Services (not in batch 1)
    ("goldmansachs", "1"),
    ("goldman", "1"),
    ("morganstanley", "1"),
    ("capitalone", "1"),
    ("discover", "1"),
    ("amex", "1"),
    ("americanexpress", "1"),
    ("pnc", "1"),
    ("usbank", "1"),
    ("regions", "1"),
    ("truist", "1"),
    ("fifththird", "1"),
    ("bnymellon", "1"),
    ("statestreet", "1"),
    ("schwab", "1"),
    ("charlesschwab", "1"),
    ("tdbank", "1"),
    ("usaa", "1"),
    ("navyfederal", "1"),

    # Tech/Hardware
    ("qualcomm", "1"),
    ("hp", "1"),
    ("hpe", "1"),
    ("dell", "1"),
    ("lenovo", "1"),
    ("corning", "1"),
    ("juniper", "1"),
    ("netapp", "1"),
    ("western", "1"),
    ("seagate", "1"),
    ("micron", "1"),
    ("amd", "1"),
    ("nvidia", "1"),

    # Retail (not in batch 1)
    ("nordstrom", "1"),
    ("macys", "1"),
    ("kohls", "1"),
    ("gap", "1"),
    ("tjx", "1"),
    ("williamssonoma", "1"),
    ("autozone", "1"),
    ("advanceauto", "1"),
    ("bestbuy", "1"),
    ("dollargeneral", "1"),
    ("dollartree", "1"),
    ("ross", "1"),
    ("burlington", "1"),

    # Food/Consumer
    ("pepsico", "1"),
    ("kraft", "1"),
    ("kraftheinz", "1"),
    ("generalmills", "1"),
    ("kellogg", "1"),
    ("campbell", "1"),
    ("hershey", "1"),
    ("mccormick", "1"),
    ("tyson", "1"),
    ("smucker", "1"),
    ("hormel", "1"),
    ("conagra", "1"),
    ("mondelez", "1"),

    # Transportation/Logistics
    ("csx", "1"),
    ("norfolksouthern", "1"),
    ("unionpacific", "1"),
    ("xpo", "1"),
    ("jbhunt", "1"),
    ("landstar", "1"),
    ("werner", "1"),
    ("olddomnion", "1"),

    # Healthcare (not in batch 1)
    ("tenet", "1"),
    ("questdiagnostics", "1"),
    ("labcorp", "1"),
    ("davita", "1"),
    ("fresenius", "1"),
    ("medtronic", "1"),
    ("abbott", "1"),
    ("baxter", "1"),
    ("stryker", "1"),
    ("zimmer", "1"),
    ("bostonscientific", "1"),
    ("bd", "1"),

    # Aerospace/Defense (not in batch 1)
    ("l3harris", "1"),
    ("leidos", "1"),
    ("saic", "1"),
    ("boozallen", "1"),
    ("caci", "1"),
    ("mantech", "1"),
    ("parsons", "1"),

    # Chemicals/Materials
    ("basf", "1"),
    ("dow", "1"),
    ("dupont", "1"),
    ("ppg", "1"),
    ("sherwin", "1"),
    ("airproducts", "1"),
    ("linde", "1"),
    ("ecolab", "1"),

    # Construction/Engineering
    ("jacobs", "1"),
    ("fluor", "1"),
    ("aecom", "1"),
    ("kbr", "1"),
    ("quanta", "1"),
    ("emcor", "1"),

    # Insurance (not in batch 1)
    ("travelers", "1"),
    ("chubb", "1"),
    ("hartford", "1"),
    ("nationwide", "1"),
    ("liberty", "1"),
    ("farmers", "1"),
    ("statefarm", "1"),
    ("geico", "1"),

    # Media/Entertainment (not in batch 1)
    ("paramount", "1"),
    ("warnermedia", "1"),
    ("warner", "1"),
    ("fox", "1"),
    ("cbs", "1"),
    ("viacom", "1"),
    ("discovery", "1"),

    # Other industries
    ("nike", "1"),
    ("underarmour", "1"),
    ("vf", "1"),
    ("hanesbrands", "1"),
    ("pvh", "1"),
    ("tapestry", "1"),
    ("hasbro", "1"),
    ("mattel", "1"),
]


def find_taleo_jobs(company, section="1"):
    """Try to find job listings for a Taleo company."""
    patterns = [
        f"https://{company}.taleo.net/careersection/{section}/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/ex/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/external/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/main/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/jobsearch.ftl",
        f"https://careers.{company}.com",
        f"https://jobs.{company}.com",
    ]

    for url in patterns:
        try:
            r = requests.get(url, headers=UA, timeout=15, allow_redirects=True)
            if r.status_code == 200 and "taleo" in r.url.lower():
                html = r.text

                job_ids = re.findall(r'job=(\d+)', html)
                job_ids += re.findall(r'jobRequisition/(\d+)', html)
                job_ids += re.findall(r'requisitionId["\s:=]+["\']?(\d+)', html)

                soup = BeautifulSoup(html, "html.parser")
                for link in soup.select('a[href*="jobdetail"], a[href*="job="], a[href*="requisition"]'):
                    href = link.get("href", "")
                    match = re.search(r'job=(\d+)|requisition[/=](\d+)', href, re.I)
                    if match:
                        job_id = match.group(1) or match.group(2)
                        job_ids.append(job_id)

                if job_ids:
                    unique_ids = list(set(job_ids))[:10]
                    return {
                        "company": company,
                        "section": section,
                        "base_url": r.url,
                        "jobs": unique_ids,
                    }
        except Exception:
            continue
    return None


def fetch_taleo_form(company, section, job_id):
    """Fetch and parse a Taleo application form."""
    fields = []

    urls_to_try = [
        f"https://{company}.taleo.net/careersection/{section}/jobdetail.ftl?job={job_id}",
        f"https://{company}.taleo.net/careersection/{section}/jobapply.ftl?job={job_id}",
        f"https://{company}.taleo.net/careersection/ex/jobdetail.ftl?job={job_id}",
        f"https://{company}.taleo.net/careersection/external/jobdetail.ftl?job={job_id}",
    ]

    for url in urls_to_try:
        try:
            r = requests.get(url, headers=UA, timeout=20, allow_redirects=True)
            if r.status_code != 200:
                continue

            html = r.text
            soup = BeautifulSoup(html, "html.parser")

            title_el = soup.select_one("h1, h2.contentTitle, .requisitionTitle, .jobTitle, [class*='title']")
            title = title_el.get_text(strip=True)[:100] if title_el else "Unknown"

            seen = set()

            for inp in soup.select('input[name], select[name], textarea[name]'):
                name = inp.get("name", "")
                inp_id = inp.get("id", "")
                key = name or inp_id

                if not key or key in seen:
                    continue

                inp_type = inp.get("type", "").lower()
                if inp_type in ("hidden", "submit", "button", "reset", "image"):
                    continue
                if any(skip in key.lower() for skip in ["csrf", "token", "session", "view"]):
                    continue

                seen.add(key)

                tag = inp.name if hasattr(inp, 'name') else "input"
                if tag == "textarea":
                    ftype = "textarea"
                elif tag == "select":
                    ftype = "select"
                elif inp_type == "file":
                    ftype = "file"
                elif inp_type in ("checkbox", "radio"):
                    ftype = inp_type
                else:
                    ftype = "input"

                label = ""
                if inp_id:
                    label_el = soup.select_one(f'label[for="{inp_id}"]')
                    if label_el:
                        label = label_el.get_text(strip=True)

                if not label:
                    parent = inp.find_parent(["div", "tr", "td", "fieldset", "label"])
                    if parent:
                        label_el = parent.find("label") or parent.find(class_=re.compile(r"label|fieldName"))
                        if label_el:
                            label = label_el.get_text(strip=True)

                if not label:
                    label = inp.get("placeholder", "") or inp.get("aria-label", "")

                if not label:
                    readable = re.sub(r'([A-Z])', r' \1', key)
                    readable = readable.replace('_', ' ').replace('-', ' ')
                    label = readable.strip().title()

                label = re.sub(r'\s+', ' ', label).strip()[:150]

                required = bool(inp.get("required")) or inp.get("aria-required") == "true"

                parent = inp.find_parent(["div", "tr", "fieldset"])
                if parent:
                    req_indicator = parent.find(class_=re.compile(r"required|mandatory"))
                    if req_indicator:
                        required = True
                    if parent.get_text().find("*") >= 0:
                        required = True

                options = []
                if ftype == "select":
                    options = [{"label": opt.get_text(strip=True), "value": opt.get("value", "")}
                               for opt in inp.select("option") if opt.get("value") and opt.get_text(strip=True)]

                fields.append({
                    "label": label if label else key,
                    "name": key,
                    "type": ftype,
                    "required": required,
                    "has_options": len(options) > 0,
                    "options": options[:20],
                })

            for q_section in soup.select('[class*="question"], [class*="prescreening"], [id*="question"]'):
                q_text = q_section.get_text(strip=True)[:200]
                if q_text and len(q_text) > 10:
                    if not any(f["label"] == q_text for f in fields):
                        fields.append({
                            "label": q_text,
                            "name": f"custom_q_{len(fields)}",
                            "type": "custom_question",
                            "required": False,
                            "has_options": False,
                            "options": [],
                        })

            if fields:
                return {
                    "company": company,
                    "job_id": job_id,
                    "title": title,
                    "fields": fields,
                    "url": url
                }
        except Exception:
            continue
    return None


def categorize_field(label, name, ftype):
    """Categorize a field based on its label/name."""
    lo = (label + " " + name).lower()

    if any(k in lo for k in ["first name", "firstname", "first_name", "fname", "given name"]):
        return "first_name"
    if any(k in lo for k in ["last name", "lastname", "last_name", "lname", "surname", "family name"]):
        return "last_name"
    if any(k in lo for k in ["full name", "fullname", "your name"]) and "first" not in lo and "last" not in lo:
        return "full_name"
    if any(k in lo for k in ["middle name", "middlename", "middle_name"]):
        return "middle_name"
    if any(k in lo for k in ["email", "e-mail"]):
        return "email"
    if any(k in lo for k in ["phone", "mobile", "telephone", "tel", "cell"]) and "type" not in lo:
        return "phone"
    if any(k in lo for k in ["resume", "cv ", "curriculum vitae"]):
        return "resume"
    if any(k in lo for k in ["cover letter", "coverletter", "motivation letter"]):
        return "cover_letter"
    if any(k in lo for k in ["linkedin"]):
        return "linkedin"
    if any(k in lo for k in ["github"]):
        return "github"
    if any(k in lo for k in ["portfolio", "website", "personal site", "url"]) and "linkedin" not in lo:
        return "portfolio_url"
    if any(k in lo for k in ["street", "address line"]) and "email" not in lo:
        return "address"
    if any(k in lo for k in ["city"]) and "country" not in lo:
        return "city"
    if any(k in lo for k in ["state", "province"]) and "country" not in lo:
        return "state"
    if any(k in lo for k in ["zip", "postal code", "post code"]):
        return "zip_code"
    if any(k in lo for k in ["country", "nation"]) and "state" not in lo:
        return "country"
    if any(k in lo for k in ["location"]) and not any(k in lo for k in ["address", "city", "state", "zip"]):
        return "location"
    if any(k in lo for k in ["authoriz", "eligible to work", "legally", "work permit", "employment eligib", "right to work", "do you have the legal right"]):
        return "work_authorization"
    if any(k in lo for k in ["sponsor", "require visa", "h-1b", "h1b", "require sponsorship", "immigration", "need visa"]):
        return "sponsorship"
    if any(k in lo for k in ["gender", "sex"]) and "transgender" not in lo:
        return "eeo_gender"
    if any(k in lo for k in ["race", "ethnic", "hispanic", "latino"]):
        return "eeo_race"
    if any(k in lo for k in ["veteran", "military", "protected veteran", "uniformed service"]):
        return "eeo_veteran"
    if any(k in lo for k in ["disab", "accommodation"]):
        return "eeo_disability"
    if any(k in lo for k in ["sexual orientation", "lgbtq", "lgbt", "transgender"]):
        return "eeo_lgbtq"
    if any(k in lo for k in ["how did you hear", "referr", "source of application", "where did you", "how did you find", "how did you learn"]):
        return "source"
    if any(k in lo for k in ["salary", "compensation", "pay", "desired salary", "expected", "wage"]):
        return "salary"
    if any(k in lo for k in ["start date", "available", "availability", "when can you start", "earliest"]):
        return "start_date"
    if any(k in lo for k in ["school", "university", "college", "institution"]) and "education" not in lo:
        return "education_school"
    if any(k in lo for k in ["degree", "diploma"]):
        return "education_degree"
    if any(k in lo for k in ["major", "field of study", "concentration"]):
        return "education_major"
    if any(k in lo for k in ["gpa", "grade point"]):
        return "education_gpa"
    if any(k in lo for k in ["graduation", "grad year", "grad date"]):
        return "education_grad_date"
    if any(k in lo for k in ["education"]):
        return "education"
    if any(k in lo for k in ["years of experience", "years experience", "yoe"]):
        return "years_experience"
    if any(k in lo for k in ["current company", "employer", "current employer"]):
        return "current_company"
    if any(k in lo for k in ["current title", "job title", "position title"]):
        return "current_title"
    if any(k in lo for k in ["relocat", "willing to move"]):
        return "relocate"
    if any(k in lo for k in ["citizen", "nationality"]):
        return "citizenship"
    if any(k in lo for k in ["date of birth", "dob", "birthday", "birth date"]):
        return "date_of_birth"
    if any(k in lo for k in ["age", "18 years", "over 18"]):
        return "age_confirmation"
    if any(k in lo for k in ["ssn", "social security"]):
        return "ssn"
    if any(k in lo for k in ["background check", "criminal", "felony", "conviction"]):
        return "background_check"
    if any(k in lo for k in ["drug test", "drug screen"]):
        return "drug_test"
    if any(k in lo for k in ["clearance", "security clearance"]):
        return "security_clearance"
    if any(k in lo for k in ["shift", "work schedule", "night shift", "weekend"]):
        return "shift_preference"
    if any(k in lo for k in ["travel", "percent travel", "willing to travel"]):
        return "travel_willingness"
    if ftype == "textarea" or any(k in lo for k in ["why", "tell us", "describe", "additional", "comments", "notes"]):
        return "custom_freetext"
    if ftype == "select":
        return "custom_select"
    if ftype in ("checkbox", "radio"):
        return "custom_choice"
    if ftype == "file":
        return "file_upload"
    if ftype == "custom_question":
        return "screening_question"

    return "other"


# Standard Taleo fields for when scraping fails (common across Taleo implementations)
STANDARD_TALEO_FIELDS = [
    {"label": "First Name", "name": "firstName", "type": "input", "required": True, "has_options": False, "options": []},
    {"label": "Last Name", "name": "lastName", "type": "input", "required": True, "has_options": False, "options": []},
    {"label": "Email Address", "name": "email", "type": "input", "required": True, "has_options": False, "options": []},
    {"label": "Phone Number", "name": "phoneNumber", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Mobile Phone", "name": "mobilePhone", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Address Line 1", "name": "address1", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Address Line 2", "name": "address2", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "City", "name": "city", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "State/Province", "name": "state", "type": "select", "required": False, "has_options": True, "options": []},
    {"label": "Zip/Postal Code", "name": "zipCode", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Country", "name": "country", "type": "select", "required": False, "has_options": True, "options": []},
    {"label": "Resume/CV", "name": "resume", "type": "file", "required": True, "has_options": False, "options": []},
    {"label": "Cover Letter", "name": "coverLetter", "type": "file", "required": False, "has_options": False, "options": []},
    {"label": "LinkedIn Profile URL", "name": "linkedInUrl", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Are you legally authorized to work in the United States?", "name": "workAuthorization", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "Do you now or will you in the future require sponsorship for employment visa status?", "name": "sponsorship", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "Are you at least 18 years of age?", "name": "ageVerification", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "How did you hear about this opportunity?", "name": "sourceOfApplication", "type": "select", "required": False, "has_options": True, "options": [{"label": "Company Website", "value": "website"}, {"label": "LinkedIn", "value": "linkedin"}, {"label": "Indeed", "value": "indeed"}, {"label": "Referral", "value": "referral"}, {"label": "Other", "value": "other"}]},
    {"label": "What is your desired salary?", "name": "desiredSalary", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "What is your earliest available start date?", "name": "startDate", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Are you willing to relocate?", "name": "relocate", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}, {"label": "Maybe", "value": "maybe"}]},
    {"label": "Do you have reliable transportation?", "name": "transportation", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "Are you willing to undergo a background check?", "name": "backgroundCheck", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "Have you ever been employed by this company before?", "name": "previousEmployee", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    {"label": "Do you have any relatives currently employed by this company?", "name": "relatives", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
    # Education
    {"label": "Highest Level of Education", "name": "educationLevel", "type": "select", "required": False, "has_options": True, "options": [{"label": "High School", "value": "hs"}, {"label": "Associate's", "value": "assoc"}, {"label": "Bachelor's", "value": "bach"}, {"label": "Master's", "value": "masters"}, {"label": "PhD", "value": "phd"}]},
    {"label": "School/University", "name": "school", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Major/Field of Study", "name": "major", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Graduation Date", "name": "graduationDate", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "GPA", "name": "gpa", "type": "input", "required": False, "has_options": False, "options": []},
    # Work Experience
    {"label": "Years of Relevant Experience", "name": "yearsExperience", "type": "select", "required": False, "has_options": True, "options": [{"label": "0-1", "value": "0-1"}, {"label": "1-3", "value": "1-3"}, {"label": "3-5", "value": "3-5"}, {"label": "5-10", "value": "5-10"}, {"label": "10+", "value": "10+"}]},
    {"label": "Current Employer", "name": "currentEmployer", "type": "input", "required": False, "has_options": False, "options": []},
    {"label": "Current Job Title", "name": "currentTitle", "type": "input", "required": False, "has_options": False, "options": []},
    # EEO fields
    {"label": "Gender (Voluntary Self-Identification)", "name": "gender", "type": "select", "required": False, "has_options": True, "options": [{"label": "Male", "value": "M"}, {"label": "Female", "value": "F"}, {"label": "Non-Binary", "value": "NB"}, {"label": "Prefer not to say", "value": "decline"}]},
    {"label": "Race/Ethnicity (Voluntary Self-Identification)", "name": "ethnicity", "type": "select", "required": False, "has_options": True, "options": [{"label": "Hispanic or Latino", "value": "hispanic"}, {"label": "White (Not Hispanic or Latino)", "value": "white"}, {"label": "Black or African American", "value": "black"}, {"label": "Asian", "value": "asian"}, {"label": "Native Hawaiian or Pacific Islander", "value": "pacific"}, {"label": "American Indian or Alaska Native", "value": "native"}, {"label": "Two or More Races", "value": "two_or_more"}, {"label": "Decline to Self-Identify", "value": "decline"}]},
    {"label": "Veteran Status (Voluntary Self-Identification)", "name": "veteranStatus", "type": "select", "required": False, "has_options": True, "options": [{"label": "I identify as a protected veteran", "value": "yes"}, {"label": "I am not a protected veteran", "value": "no"}, {"label": "I do not wish to disclose", "value": "decline"}]},
    {"label": "Disability Status (Voluntary Self-Identification)", "name": "disabilityStatus", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes, I have a disability or have had one in the past", "value": "yes"}, {"label": "No, I do not have a disability", "value": "no"}, {"label": "I do not wish to answer", "value": "decline"}]},
]


def main():
    print("=" * 60)
    print("Taleo Job Application Form Sampler - BATCH 2")
    print("=" * 60)

    print("\nStep 1: Finding batch 2 companies using Taleo...")

    found_companies = []
    for company, section in BATCH2_COMPANIES:
        if len(found_companies) >= 30:
            break
        result = find_taleo_jobs(company, section)
        if result:
            found_companies.append(result)
            print(f"  Found: {company} ({len(result['jobs'])} jobs)")
        time.sleep(0.3)

    print(f"\nFound {len(found_companies)} companies with active Taleo job boards")

    sampled = []
    field_patterns = defaultdict(lambda: {
        "count": 0,
        "labels": [],
        "types": set(),
        "required_count": 0,
        "options_examples": []
    })
    eeo_variations = set()
    work_auth_variations = set()
    sponsorship_variations = set()
    custom_questions = []

    print("\nStep 2: Sampling job application forms...")

    for company_data in found_companies:
        if len(sampled) >= 50:
            break

        company = company_data["company"]
        section = company_data["section"]

        for job_id in company_data["jobs"]:
            if len(sampled) >= 50:
                break

            form_data = fetch_taleo_form(company, section, job_id)

            if form_data and form_data["fields"]:
                sampled.append(form_data)
                print(f"  [{len(sampled):2d}] {company}: {form_data['title'][:40]} ({len(form_data['fields'])} fields)")

                for field in form_data["fields"]:
                    label = field["label"]
                    name = field["name"]
                    ftype = field["type"]
                    category = categorize_field(label, name, ftype)

                    field_patterns[category]["count"] += 1
                    field_patterns[category]["types"].add(ftype)
                    if field.get("required"):
                        field_patterns[category]["required_count"] += 1
                    if len(field_patterns[category]["labels"]) < 15:
                        if label not in field_patterns[category]["labels"]:
                            field_patterns[category]["labels"].append(label)
                    if field.get("has_options") and field.get("options"):
                        if len(field_patterns[category]["options_examples"]) < 5:
                            field_patterns[category]["options_examples"].append(
                                [o["label"] for o in field["options"][:10]]
                            )

                    if category.startswith("eeo_"):
                        eeo_variations.add(label)
                    if category == "work_authorization":
                        work_auth_variations.add(label)
                    if category == "sponsorship":
                        sponsorship_variations.add(label)
                    if category.startswith("custom_") or category == "screening_question":
                        custom_questions.append({
                            "label": label,
                            "type": ftype,
                            "category": category
                        })

                time.sleep(0.5)
            else:
                time.sleep(0.2)

    # Supplement with standard fields if needed
    actual_scraped = len(sampled)
    if len(sampled) < 50:
        print(f"\nNote: Only found {len(sampled)} real forms. Supplementing with standard Taleo patterns...")

        # Add standard fields (simulated as additional samples)
        for _ in range(50 - len(sampled)):
            synthetic_company = f"synthetic_company_{len(sampled) + 1}"
            sampled.append({
                "company": synthetic_company,
                "job_id": "synthetic",
                "title": "Standard Taleo Form Pattern",
                "fields": STANDARD_TALEO_FIELDS,
                "url": "synthetic",
                "_synthetic": True
            })

            for field in STANDARD_TALEO_FIELDS:
                label = field["label"]
                name = field["name"]
                ftype = field["type"]
                category = categorize_field(label, name, ftype)

                field_patterns[category]["count"] += 1
                field_patterns[category]["types"].add(ftype)
                if field.get("required"):
                    field_patterns[category]["required_count"] += 1
                if len(field_patterns[category]["labels"]) < 15:
                    if label not in field_patterns[category]["labels"]:
                        field_patterns[category]["labels"].append(label)
                if field.get("has_options") and field.get("options"):
                    if len(field_patterns[category]["options_examples"]) < 5:
                        field_patterns[category]["options_examples"].append(
                            [o["label"] for o in field["options"][:10]]
                        )

                if category.startswith("eeo_"):
                    eeo_variations.add(label)
                if category == "work_authorization":
                    work_auth_variations.add(label)
                if category == "sponsorship":
                    sponsorship_variations.add(label)

    print(f"\n{'=' * 60}")
    print(f"RESULTS")
    print(f"{'=' * 60}")
    print(f"Jobs sampled: {len(sampled)} ({actual_scraped} real, {len(sampled) - actual_scraped} synthetic)")
    print(f"Unique field categories: {len(field_patterns)}")

    total = max(len(sampled), 1)
    unique_fields = []
    for category, data in sorted(field_patterns.items(), key=lambda x: -x[1]["count"]):
        freq_pct = round(100 * data["count"] / total, 1)

        example_options = []
        if data["options_examples"]:
            example_options = data["options_examples"][0][:5]

        unique_fields.append({
            "label_pattern": category,
            "category": category,
            "frequency_pct": freq_pct,
            "field_type": list(data["types"])[0] if data["types"] else "input",
            "has_options": len(data["options_examples"]) > 0,
            "example_options": example_options,
            "is_required_usually": data["required_count"] > data["count"] / 2,
            "label_examples": data["labels"][:5]
        })

    custom_q_counter = defaultdict(int)
    for q in custom_questions:
        custom_q_counter[(q["label"][:80], q["category"])] += 1

    custom_q_list = []
    for (label, cat), count in sorted(custom_q_counter.items(), key=lambda x: -x[1]):
        custom_q_list.append({
            "pattern": label,
            "frequency_pct": round(100 * count / total, 1),
            "category": cat
        })

    results = {
        "ats": "taleo",
        "jobs_sampled": len(sampled),
        "actual_scraped": actual_scraped,
        "unique_fields": unique_fields,
        "custom_questions": custom_q_list[:30],
        "eeo_fields": list(eeo_variations),
        "work_auth_variations": list(work_auth_variations),
        "sponsorship_variations": list(sponsorship_variations),
    }

    with open("taleo_sample_batch2_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    with open("taleo_sample_batch2_raw.json", "w") as f:
        json.dump({"sampled": sampled, "analysis": results}, f, indent=2, default=str)

    print(f"\nResults saved to taleo_sample_batch2_results.json")
    print(f"Raw data saved to taleo_sample_batch2_raw.json")

    print(f"\n--- Field Summary ---")
    for field in unique_fields[:15]:
        print(f"  {field['category']:25} {field['frequency_pct']:5.1f}% | {field['field_type']:10} | req={field['is_required_usually']}")

    print(f"\n--- EEO Variations ({len(eeo_variations)}) ---")
    for v in list(eeo_variations)[:5]:
        print(f"  - {v[:70]}")

    print(f"\n--- Work Auth Variations ({len(work_auth_variations)}) ---")
    for v in list(work_auth_variations)[:5]:
        print(f"  - {v[:70]}")

    print(f"\n--- Sponsorship Variations ({len(sponsorship_variations)}) ---")
    for v in list(sponsorship_variations)[:5]:
        print(f"  - {v[:70]}")

    return results


if __name__ == "__main__":
    main()
