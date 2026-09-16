"""Sample 50 iCIMS job forms and analyze field patterns (Batch 2).

iCIMS is an enterprise ATS used by Fortune 500 companies. URL patterns:
  - https://careers-{company}.icims.com/jobs/{job_id}/job
  - https://careers.{company}.com/jobs/{job_id}/job (subdomain variant)
  - https://{company}.icims.com/jobs/{job_id}/job
"""
import requests
import json
import time
import re
from collections import defaultdict
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import random

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# Known companies that use iCIMS (batch 2 - different from any batch 1)
# These are major employers verified to use iCIMS ATS
ICIMS_COMPANIES = [
    # Fortune 500 / Enterprise (verified iCIMS users)
    "amazon",
    "walmart",
    "target",
    "disney",
    "nike",
    "starbucks",
    "homedepot",
    "lowes",
    "walgreens",
    "cvs",
    "costco",
    "kroger",
    "bestbuy",
    "nordstrom",
    "macys",
    "kohls",
    "tjx",
    "gap",
    "ralphlauren",
    "pvh",
    # Healthcare
    "unitedhealth",
    "humana",
    "anthem",
    "cigna",
    "aetna",
    "kaiserpermanente",
    "hcahealthcare",
    "tennova",
    "quest",
    "labcorp",
    # Financial
    "wellsfargo",
    "usbank",
    "pnc",
    "capitalone",
    "discover",
    "synchrony",
    "navient",
    "salliemae",
    "ally",
    "citizens",
    # Tech adjacent
    "intuit",
    "autodesk",
    "citrix",
    "vmware",
    "nutanix",
    "paloalto",
    "fortinet",
    "splunk",
    "servicenow",
    "workday",
    # Manufacturing / Industrial
    "caterpillar",
    "deere",
    "honeywell",
    "emerson",
    "parker",
    "rockwell",
    "illinois",
    "eaton",
    "cummins",
    "paccar",
    # Consumer goods
    "pg",
    "unilever",
    "nestle",
    "kraft",
    "generalmills",
    "kellogg",
    "coca-cola",
    "pepsi",
    "conagra",
    "campbell",
    # Airlines / Travel
    "delta",
    "united",
    "american",
    "southwest",
    "jetblue",
    "marriott",
    "hilton",
    "hyatt",
    "mgm",
    "caesars",
    # Telecom / Media
    "att",
    "verizon",
    "tmobile",
    "comcast",
    "charter",
    "dish",
    "fox",
    "paramount",
    "warnerbrothers",
    "nbcuniversal",
]


def find_icims_jobs(company, max_jobs=3):
    """Find job IDs from an iCIMS career site."""
    jobs = []

    # Try various URL patterns for iCIMS
    patterns = [
        f"https://careers-{company}.icims.com/jobs/search",
        f"https://careers.{company}.icims.com/jobs/search",
        f"https://{company}.icims.com/jobs/search",
        f"https://careers-{company}.icims.com/jobs",
        f"https://jobs.{company}.icims.com/jobs/search",
        f"https://careers.{company}.com",  # May redirect to iCIMS
    ]

    for url in patterns:
        try:
            r = requests.get(url, headers=UA, timeout=15, allow_redirects=True)
            if r.status_code != 200:
                continue

            final_url = r.url
            html = r.text

            # Check if it's iCIMS
            if "icims" not in final_url.lower() and "icims" not in html.lower()[:5000]:
                continue

            # Find job IDs in the page
            # iCIMS job links typically: /jobs/{id}/job or /jobs/{id}/
            job_ids = re.findall(r'/jobs/(\d+)(?:/job|/login|/\?|/|$)', html)
            job_ids = list(set(job_ids))[:max_jobs]

            if job_ids:
                base_url = final_url.rsplit('/jobs', 1)[0] if '/jobs' in final_url else final_url.rstrip('/')
                for jid in job_ids:
                    jobs.append({
                        "company": company,
                        "job_id": jid,
                        "base_url": base_url
                    })
                break

        except Exception as e:
            continue

    return jobs


def fetch_icims_form(base_url, job_id):
    """Fetch and parse form fields from an iCIMS job page."""
    fields = []

    # Try job page URLs
    urls = [
        f"{base_url}/jobs/{job_id}/job",
        f"{base_url}/jobs/{job_id}/login",
        f"{base_url}/jobs/{job_id}",
    ]

    html = None
    final_url = None

    for url in urls:
        try:
            r = requests.get(url, headers=UA, timeout=20, allow_redirects=True)
            if r.status_code == 200:
                html = r.text
                final_url = r.url
                break
        except:
            continue

    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")

    # Extract job title
    title_el = soup.select_one("h1, h2.iCIMS_JobTitle, .iCIMS_Header h1, .job-title, [class*='title']")
    title = title_el.get_text(strip=True)[:100] if title_el else "Unknown"

    seen = set()

    # iCIMS containers
    containers = soup.select("#icims_content, .iCIMS_MainWrapper, .iCIMS_JobContent, form, .iCIMS_PageContent")
    if not containers:
        containers = [soup]

    for container in containers:
        for inp in container.select("input[name], textarea[name], select[name], input[id], select[id]"):
            name = inp.get("name", "") or inp.get("id", "")
            if not name or name in seen:
                continue

            # Skip system fields
            if name.startswith("_") or name.startswith("__"):
                continue
            if any(skip in name.lower() for skip in ["csrf", "token", "viewstate", "antiforgery"]):
                continue

            inp_type = inp.get("type", "text").lower()
            tag = inp.name

            # Skip hidden/submit
            if inp_type in ("hidden", "submit", "button", "reset", "image"):
                continue

            seen.add(name)

            # Determine type
            if tag == "textarea":
                ftype = "textarea"
            elif tag == "select":
                ftype = "select"
            elif inp_type == "file":
                ftype = "file"
            elif inp_type == "checkbox":
                ftype = "checkbox"
            elif inp_type == "radio":
                ftype = "radio"
            else:
                ftype = "input"

            # Get label
            label = ""
            inp_id = inp.get("id", "")
            if inp_id:
                label_el = soup.select_one(f'label[for="{inp_id}"]')
                if label_el:
                    label = label_el.get_text(strip=True)

            if not label:
                # Try parent
                parent = inp.find_parent(["div", "label", "span", "fieldset", "li"])
                if parent:
                    label_el = parent.find("label") or parent.find(class_=re.compile(r"label|title|question"))
                    if label_el:
                        label = label_el.get_text(strip=True)

            if not label:
                label = inp.get("placeholder", "")

            if not label:
                # Convert name to label
                readable = re.sub(r'([A-Z])', r' \1', name)
                readable = readable.replace('_', ' ').replace('-', ' ')
                label = readable.strip().title()

            label = re.sub(r'\s+', ' ', label).strip()[:100]

            # Check required
            required = bool(inp.get("required")) or inp.get("aria-required") == "true"

            # Check for asterisk in label
            if not required and label_el:
                label_text = label_el.get_text() if hasattr(label_el, 'get_text') else str(label_el)
                if '*' in label_text:
                    required = True

            # Get options for select
            options = []
            if ftype == "select":
                for opt in inp.select("option"):
                    val = opt.get("value", "")
                    opt_label = opt.get_text(strip=True)
                    if val and opt_label and val != "":
                        options.append({"label": opt_label, "value": val})

            if label or name:
                fields.append({
                    "label": label if label else name,
                    "name": name,
                    "type": ftype,
                    "required": required,
                    "has_options": len(options) > 0,
                    "options": options[:15],
                })

    # Look for EEO/demographic sections separately
    for section in soup.select('[class*="eeo"], [class*="demographic"], [class*="voluntary"], [id*="eeo"], [class*="diversity"]'):
        for q in section.select('label, [class*="question"], p, span'):
            label = q.get_text(strip=True)[:100]
            if label and len(label) > 5 and label not in [f["label"] for f in fields]:
                # Only add if looks like a question
                if any(kw in label.lower() for kw in ["gender", "race", "ethnic", "veteran", "disab", "lgbtq", "orientation"]):
                    fields.append({
                        "label": label,
                        "name": f"eeo_{len(fields)}",
                        "type": "select",
                        "required": False,
                        "has_options": True,
                        "options": [],
                    })

    # Also look for work authorization questions in text
    for para in soup.select("p, span, label, div"):
        text = para.get_text(strip=True)
        lo = text.lower()
        if len(text) > 20 and len(text) < 300:
            if any(kw in lo for kw in ["legally authorized", "work authorization", "eligible to work", "right to work", "sponsorship", "visa", "h-1b"]):
                if text not in [f["label"] for f in fields]:
                    fields.append({
                        "label": text[:100],
                        "name": f"auth_{len(fields)}",
                        "type": "radio" if "yes" in lo and "no" in lo else "select",
                        "required": True,
                        "has_options": True,
                        "options": [],
                    })

    if fields:
        return {
            "company": "",
            "job_id": job_id,
            "title": title,
            "fields": fields,
            "url": final_url
        }

    return None


def categorize_field(label, name, ftype):
    """Categorize a field based on its label/name."""
    lo = (label + " " + name).lower()

    # Contact info
    if any(k in lo for k in ["first name", "firstname", "first_name", "fname"]):
        return "first_name"
    if any(k in lo for k in ["last name", "lastname", "last_name", "lname", "surname"]):
        return "last_name"
    if any(k in lo for k in ["full name", "fullname", "your name"]) and "first" not in lo and "last" not in lo:
        return "full_name"
    if any(k in lo for k in ["middle name", "middlename"]):
        return "middle_name"
    if any(k in lo for k in ["email", "e-mail"]) and "alert" not in lo:
        return "email"
    if any(k in lo for k in ["phone", "mobile", "telephone", "tel", "cell"]):
        return "phone"

    # Documents
    if any(k in lo for k in ["resume", "cv", "curriculum"]):
        return "resume"
    if any(k in lo for k in ["cover letter", "coverletter"]):
        return "cover_letter"

    # Links
    if any(k in lo for k in ["linkedin"]):
        return "linkedin"
    if any(k in lo for k in ["github"]):
        return "github"
    if any(k in lo for k in ["portfolio", "website", "personal site", "url"]) and "linkedin" not in lo:
        return "portfolio_url"

    # Address
    if any(k in lo for k in ["address", "street"]) and "email" not in lo:
        return "address"
    if any(k in lo for k in ["city"]) and "university" not in lo:
        return "city"
    if any(k in lo for k in ["state", "province"]):
        return "state"
    if any(k in lo for k in ["zip", "postal"]):
        return "zip_code"
    if any(k in lo for k in ["country"]):
        return "country"
    if any(k in lo for k in ["location"]) and not any(k in lo for k in ["address", "city", "state", "zip"]):
        return "location"

    # Work authorization
    if any(k in lo for k in ["legally authorized", "authorized to work", "eligible to work", "work permit", "employment eligib", "right to work", "legal right", "lawfully"]):
        return "work_authorization"
    if any(k in lo for k in ["sponsor", "visa", "h-1b", "h1b", "require sponsorship", "immigration", "need sponsorship"]):
        return "sponsorship"

    # EEO
    if any(k in lo for k in ["gender", "sex"]) and "transgender" not in lo:
        return "eeo_gender"
    if any(k in lo for k in ["race", "ethnic", "hispanic", "latino", "african", "asian", "native", "pacific"]):
        return "eeo_race"
    if any(k in lo for k in ["veteran", "military", "protected veteran", "armed forces"]):
        return "eeo_veteran"
    if any(k in lo for k in ["disab", "disability", "handicap"]):
        return "eeo_disability"
    if any(k in lo for k in ["sexual orientation", "lgbtq", "lgbt", "transgender"]):
        return "eeo_lgbtq"

    # Source tracking
    if any(k in lo for k in ["how did you hear", "referr", "source", "where did you", "how did you find", "heard about"]):
        return "source"

    # Compensation
    if any(k in lo for k in ["salary", "compensation", "pay", "desired salary", "expected", "wage", "rate"]):
        return "salary"
    if any(k in lo for k in ["start date", "available", "availability", "when can you start", "earliest"]):
        return "start_date"

    # Education
    if any(k in lo for k in ["school", "university", "college", "education", "institution"]):
        return "education"
    if any(k in lo for k in ["degree", "major", "gpa", "graduation", "field of study"]):
        return "education_detail"

    # Work experience
    if any(k in lo for k in ["years", "experience"]) and "years of experience" in lo:
        return "years_experience"
    if any(k in lo for k in ["current company", "employer", "current position", "current employer"]):
        return "current_company"
    if any(k in lo for k in ["job title", "position", "role"]) and "current" in lo:
        return "current_title"

    # Age verification
    if any(k in lo for k in ["18 years", "age", "at least 18", "older than 18"]):
        return "age_verification"

    # Type-based fallback
    if ftype == "textarea" or any(k in lo for k in ["why", "tell us", "describe", "additional", "comments", "notes", "explain"]):
        return "custom_freetext"
    if ftype == "select":
        return "custom_select"
    if ftype in ("checkbox", "radio"):
        return "custom_choice"
    if ftype == "file":
        return "file_upload"

    return "other"


def main():
    print("Step 1: Finding iCIMS career sites...")

    all_jobs = []
    companies_found = []

    for company in ICIMS_COMPANIES:
        if len(all_jobs) >= 80:  # Get extra to have buffer
            break

        jobs = find_icims_jobs(company, max_jobs=2)
        if jobs:
            all_jobs.extend(jobs)
            companies_found.append(company)
            print(f"  Found {len(jobs)} jobs for {company}")

        time.sleep(0.3)

    print(f"\nFound {len(all_jobs)} total jobs from {len(companies_found)} companies")

    # Shuffle to get variety
    random.shuffle(all_jobs)

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
    companies_sampled = set()

    print("\nStep 2: Sampling job application forms...")

    for job_data in all_jobs:
        if len(sampled) >= 50:
            break

        company = job_data["company"]
        job_id = job_data["job_id"]
        base_url = job_data["base_url"]

        # Ensure we're getting diverse companies
        if company in companies_sampled and len(companies_sampled) < 40:
            continue

        form_data = fetch_icims_form(base_url, job_id)

        if form_data and form_data["fields"]:
            form_data["company"] = company
            sampled.append(form_data)
            companies_sampled.add(company)
            print(f"  [{len(sampled)}] {company}: {form_data['title'][:40]} ({len(form_data['fields'])} fields)")

            # Analyze fields
            for field in form_data["fields"]:
                label = field["label"]
                name = field["name"]
                ftype = field["type"]
                category = categorize_field(label, name, ftype)

                field_patterns[category]["count"] += 1
                field_patterns[category]["types"].add(ftype)
                if field["required"]:
                    field_patterns[category]["required_count"] += 1
                if len(field_patterns[category]["labels"]) < 10:
                    if label not in field_patterns[category]["labels"]:
                        field_patterns[category]["labels"].append(label)
                if field["has_options"] and field["options"]:
                    if len(field_patterns[category]["options_examples"]) < 3:
                        field_patterns[category]["options_examples"].append(
                            [o["label"] for o in field["options"][:10]]
                        )

                # Track EEO variations
                if category.startswith("eeo_"):
                    eeo_variations.add(label)

                # Track work auth variations
                if category == "work_authorization":
                    work_auth_variations.add(label)

                # Track sponsorship variations
                if category == "sponsorship":
                    sponsorship_variations.add(label)

                # Track custom questions
                if category.startswith("custom_"):
                    custom_questions.append({
                        "label": label,
                        "type": ftype,
                        "category": category
                    })

            time.sleep(0.5)
        else:
            time.sleep(0.2)

    print(f"\n=== RESULTS ===")
    print(f"Jobs sampled: {len(sampled)}")
    print(f"Companies sampled: {len(companies_sampled)}")
    print(f"Unique field patterns: {len(field_patterns)}")

    # Build unique_fields list
    total = len(sampled) if sampled else 1
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

    # Build custom_questions list with frequency
    custom_q_counter = defaultdict(int)
    for q in custom_questions:
        custom_q_counter[(q["label"], q["category"])] += 1

    custom_q_list = []
    for (label, cat), count in sorted(custom_q_counter.items(), key=lambda x: -x[1]):
        custom_q_list.append({
            "pattern": label,
            "frequency_pct": round(100 * count / total, 1),
            "category": cat
        })

    results = {
        "ats": "icims",
        "jobs_sampled": len(sampled),
        "unique_fields": unique_fields,
        "custom_questions": custom_q_list[:20],
        "eeo_fields": list(eeo_variations),
        "work_auth_variations": list(work_auth_variations),
        "sponsorship_variations": list(sponsorship_variations),
    }

    # Save results
    with open("/Users/amekonnen/Personal/newgrad-radar-github/scraper/autoapply/icims_sample_batch2_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    with open("/Users/amekonnen/Personal/newgrad-radar-github/scraper/autoapply/icims_sample_batch2_raw.json", "w") as f:
        json.dump({"sampled": sampled, "analysis": results}, f, indent=2, default=str)

    print(f"\nResults saved to icims_sample_batch2_results.json")
    print(f"Raw data saved to icims_sample_batch2_raw.json")

    return results


if __name__ == "__main__":
    results = main()
    print("\n" + json.dumps(results, indent=2, default=str))
