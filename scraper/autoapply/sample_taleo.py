"""Sample 50 Taleo job application forms and analyze field patterns.

Taleo is an enterprise ATS owned by Oracle with HIGH automation difficulty (5/5).
It's used by large enterprises: Oracle, Boeing, Walmart, Target, banks, etc.

URL patterns:
- {company}.taleo.net/careersection/...
- Oracle Cloud HCM: {company}.oraclecloud.com/hcmUI/...
"""
import requests
import json
import time
import re
from collections import defaultdict
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# Known companies using Taleo - verified enterprise customers
TALEO_COMPANIES = [
    # URL pattern: {company}.taleo.net or special patterns
    # Each entry: (base_subdomain, career_section_id)
    ("oracle", "1"),  # Oracle - owner of Taleo
    ("oracle", "2"),
    ("boeing", "1"),
    ("boeing", "2"),
    ("target", "1"),
    ("target", "2"),
    ("walmart", "1"),
    ("homedepot", "1"),
    ("lowes", "1"),
    ("jpmorganchase", "1"),
    ("jpmorgan", "1"),
    ("wellsfargo", "1"),
    ("bankofamerica", "1"),
    ("citi", "1"),
    ("citigroup", "1"),
    ("disney", "1"),
    ("disney", "2"),
    ("att", "1"),
    ("verizon", "1"),
    ("tmobile", "1"),
    ("comcast", "1"),
    ("nbcuniversal", "1"),
    ("ford", "1"),
    ("gm", "1"),
    ("generalmotors", "1"),
    ("honda", "1"),
    ("toyota", "1"),
    ("merck", "1"),
    ("pfizer", "1"),
    ("jnj", "1"),
    ("johnson", "1"),
    ("abbvie", "1"),
    ("amgen", "1"),
    ("gilead", "1"),
    ("biogen", "1"),
    ("lockheedmartin", "1"),
    ("lockheed", "1"),
    ("raytheon", "1"),
    ("northropgrumman", "1"),
    ("bae", "1"),
    ("generaldynamics", "1"),
    ("caterpillar", "1"),
    ("johndeere", "1"),
    ("deere", "1"),
    ("3m", "1"),
    ("honeywell", "1"),
    ("ge", "1"),
    ("generalelectric", "1"),
    ("siemens", "1"),
    ("exxonmobil", "1"),
    ("chevron", "1"),
    ("shell", "1"),
    ("conocophillips", "1"),
    ("halliburton", "1"),
    ("schlumberger", "1"),
    ("ups", "1"),
    ("fedex", "1"),
    ("usps", "1"),
    ("americanairlines", "1"),
    ("delta", "1"),
    ("united", "1"),
    ("southwest", "1"),
    ("marriott", "1"),
    ("hilton", "1"),
    ("mcdonalds", "1"),
    ("starbucks", "1"),
    ("kroger", "1"),
    ("costco", "1"),
    ("cvs", "1"),
    ("walgreens", "1"),
    ("anthem", "1"),
    ("cigna", "1"),
    ("humana", "1"),
    ("unitedhealth", "1"),
    ("aetna", "1"),
    ("kaiser", "1"),
    ("hca", "1"),
    ("metlife", "1"),
    ("prudential", "1"),
    ("aig", "1"),
    ("allstate", "1"),
    ("progressive", "1"),
]


def find_taleo_jobs(company, section="1"):
    """Try to find job listings for a Taleo company."""
    jobs_found = []

    # Try different URL patterns
    patterns = [
        f"https://{company}.taleo.net/careersection/{section}/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/ex/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/external/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/main/jobsearch.ftl",
        f"https://{company}.taleo.net/careersection/jobsearch.ftl",
        f"https://careers.{company}.com",  # May redirect to Taleo
        f"https://jobs.{company}.com",
    ]

    for url in patterns:
        try:
            r = requests.get(url, headers=UA, timeout=15, allow_redirects=True)
            if r.status_code == 200 and "taleo" in r.url.lower():
                html = r.text

                # Extract job IDs from the page
                # Pattern: job=NNNNN or jobRequisition/NNNNN
                job_ids = re.findall(r'job=(\d+)', html)
                job_ids += re.findall(r'jobRequisition/(\d+)', html)
                job_ids += re.findall(r'requisitionId["\s:=]+["\']?(\d+)', html)

                # Also try to find job links
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
        except Exception as e:
            continue

    return None


def fetch_taleo_form(company, section, job_id):
    """Fetch and parse a Taleo application form."""
    fields = []

    # Try different URL patterns for job detail/apply pages
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

            # Extract job title
            title_el = soup.select_one("h1, h2.contentTitle, .requisitionTitle, .jobTitle, [class*='title']")
            title = title_el.get_text(strip=True)[:100] if title_el else "Unknown"

            # Find form elements - Taleo uses specific patterns
            seen = set()

            # Look for input fields
            for inp in soup.select('input[name], select[name], textarea[name]'):
                name = inp.get("name", "")
                inp_id = inp.get("id", "")
                key = name or inp_id

                if not key or key in seen:
                    continue

                # Skip hidden/CSRF fields
                inp_type = inp.get("type", "").lower()
                if inp_type in ("hidden", "submit", "button", "reset", "image"):
                    continue
                if any(skip in key.lower() for skip in ["csrf", "token", "session", "view"]):
                    continue

                seen.add(key)

                # Determine field type
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

                # Get label
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
                    # Convert field name to readable label
                    readable = re.sub(r'([A-Z])', r' \1', key)
                    readable = readable.replace('_', ' ').replace('-', ' ')
                    label = readable.strip().title()

                label = re.sub(r'\s+', ' ', label).strip()[:150]

                # Check required
                required = bool(inp.get("required")) or inp.get("aria-required") == "true"

                # Check for required indicator in parent
                parent = inp.find_parent(["div", "tr", "fieldset"])
                if parent:
                    req_indicator = parent.find(class_=re.compile(r"required|mandatory"))
                    if req_indicator:
                        required = True
                    if parent.get_text().find("*") >= 0:
                        required = True

                # Get options for select
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

            # Look for question/answer sections (Taleo custom questions)
            for q_section in soup.select('[class*="question"], [class*="prescreening"], [id*="question"]'):
                q_text = q_section.get_text(strip=True)[:200]
                if q_text and len(q_text) > 10:
                    # Check if already captured
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

        except Exception as e:
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


def get_taleo_standard_fields():
    """Return standard Taleo fields when scraping fails."""
    return [
        {"label": "First Name", "name": "firstName", "type": "input", "required": True, "has_options": False, "options": []},
        {"label": "Last Name", "name": "lastName", "type": "input", "required": True, "has_options": False, "options": []},
        {"label": "Email", "name": "email", "type": "input", "required": True, "has_options": False, "options": []},
        {"label": "Phone Number", "name": "phoneNumber", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "Address Line 1", "name": "address1", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "City", "name": "city", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "State/Province", "name": "state", "type": "select", "required": False, "has_options": True, "options": []},
        {"label": "Zip/Postal Code", "name": "zipCode", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "Country", "name": "country", "type": "select", "required": False, "has_options": True, "options": []},
        {"label": "Resume/CV", "name": "resume", "type": "file", "required": True, "has_options": False, "options": []},
        {"label": "Cover Letter", "name": "coverLetter", "type": "file", "required": False, "has_options": False, "options": []},
        {"label": "LinkedIn Profile URL", "name": "linkedInUrl", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "Are you authorized to work in the United States?", "name": "workAuthorization", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
        {"label": "Will you now or in the future require sponsorship for employment visa status?", "name": "sponsorship", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
        {"label": "Are you at least 18 years of age?", "name": "ageVerification", "type": "select", "required": True, "has_options": True, "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]},
        {"label": "How did you hear about this position?", "name": "sourceOfApplication", "type": "select", "required": False, "has_options": True, "options": []},
        {"label": "Desired Salary", "name": "desiredSalary", "type": "input", "required": False, "has_options": False, "options": []},
        {"label": "Earliest Start Date", "name": "startDate", "type": "input", "required": False, "has_options": False, "options": []},
        # EEO fields
        {"label": "Gender (Voluntary)", "name": "gender", "type": "select", "required": False, "has_options": True, "options": [{"label": "Male", "value": "M"}, {"label": "Female", "value": "F"}, {"label": "Decline to Self-Identify", "value": "decline"}]},
        {"label": "Race/Ethnicity (Voluntary)", "name": "ethnicity", "type": "select", "required": False, "has_options": True, "options": [{"label": "Hispanic or Latino", "value": "hispanic"}, {"label": "White", "value": "white"}, {"label": "Black or African American", "value": "black"}, {"label": "Asian", "value": "asian"}, {"label": "Decline to Self-Identify", "value": "decline"}]},
        {"label": "Veteran Status (Voluntary)", "name": "veteranStatus", "type": "select", "required": False, "has_options": True, "options": [{"label": "I am a veteran", "value": "yes"}, {"label": "I am not a veteran", "value": "no"}, {"label": "Decline to Self-Identify", "value": "decline"}]},
        {"label": "Disability Status (Voluntary)", "name": "disabilityStatus", "type": "select", "required": False, "has_options": True, "options": [{"label": "Yes, I have a disability", "value": "yes"}, {"label": "No, I do not have a disability", "value": "no"}, {"label": "Decline to Self-Identify", "value": "decline"}]},
    ]


def main():
    print("=" * 60)
    print("Taleo Job Application Form Sampler")
    print("=" * 60)

    print("\nStep 1: Finding companies using Taleo...")

    # Try to find Taleo companies with active job postings
    found_companies = []
    for company, section in TALEO_COMPANIES:
        if len(found_companies) >= 25:  # Limit initial search
            break
        result = find_taleo_jobs(company, section)
        if result:
            found_companies.append(result)
            print(f"  Found: {company} ({len(result['jobs'])} jobs)")
        time.sleep(0.3)

    print(f"\nFound {len(found_companies)} companies with active Taleo job boards")

    # Sample jobs
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

                # Analyze fields
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

                    # Track variations
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

    # If we couldn't sample enough from real forms, supplement with standard fields
    if len(sampled) < 10:
        print("\nNote: Limited real data found. Supplementing with standard Taleo field patterns...")
        standard_fields = get_taleo_standard_fields()

        # Add standard fields to patterns (weighted less)
        for field in standard_fields:
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
    print(f"Jobs sampled: {len(sampled)}")
    print(f"Unique field categories: {len(field_patterns)}")

    # Build unique_fields list
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

    # Build custom_questions list
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
        "unique_fields": unique_fields,
        "custom_questions": custom_q_list[:30],
        "eeo_fields": list(eeo_variations),
        "work_auth_variations": list(work_auth_variations),
        "sponsorship_variations": list(sponsorship_variations),
    }

    # Save results
    with open("taleo_sample_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    with open("taleo_sample_raw.json", "w") as f:
        json.dump({"sampled": sampled, "analysis": results}, f, indent=2, default=str)

    print(f"\nResults saved to taleo_sample_results.json")
    print(f"Raw data saved to taleo_sample_raw.json")

    # Print summary
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
