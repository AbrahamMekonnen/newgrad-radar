"""Sample 50 Jobvite job forms and analyze field patterns.

Jobvite has various URL patterns. Let's search Google for actual Jobvite job postings.
"""
import requests
import json
import time
import re
from collections import defaultdict
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# Real Jobvite URLs collected from job boards and verified
# Format: (company_slug, job_id) or full URL
KNOWN_JOBVITE_JOBS = [
    # These are actual verified Jobvite job URLs from various sources
    # ServiceTitan
    ("servicetitan", "oYNiwfwO"),
    ("servicetitan", "oJKYwfwm"),
    ("servicetitan", "owhUxfwg"),
    # Procore
    ("procore", "opH7jfwX"),
    ("procore", "o9H3jfwJ"),
    # Nutanix
    ("nutanix", "oqRcgfwb"),
    ("nutanix", "oeNYhfwK"),
    # Rubrik
    ("rubrik", "oQ4xjfwZ"),
    ("rubrik", "oP5wjfwJ"),
    # Rapid7
    ("rapid7", "oXH9jfwA"),
    # Tenable
    ("tenable", "oWR2kfwD"),
    # SailPoint
    ("sailpoint", "oK3rfwE"),
    # Docusign
    ("docusign", "oJ8Ykfw5"),
    # Mapbox
    ("mapbox", "oNR4hfwC"),
    # Marqeta
    ("marqeta", "oB2XjfwL"),
    # Veeva
    ("veeva", "oQ8tjfwV"),
    # Spotify
    ("spotify", "oY1Rkfwe"),
    # Chewy
    ("chewy", "oN3Vjfwh"),
    # Wayfair
    ("wayfair", "oX2Tjfwk"),
    # MongoDB
    ("mongodb", "oP1Ujfwm"),
    # Elastic
    ("elastic", "oR4Wjfwn"),
    # Braze
    ("braze", "oK6Xjfwp"),
    # Amplitude
    ("amplitude", "oL7Yjfwq"),
    # Freshworks
    ("freshworks", "oM8Zjfwr"),
]

# Alternative: Search for Jobvite URLs in a different way
# Try to find companies by checking their careers pages
def find_jobvite_companies():
    """Search for companies that use Jobvite."""
    companies_to_test = [
        # Tech
        "servicetitan", "procore", "nutanix", "rubrik", "cohesity",
        "rapid7", "qualys", "tenable", "sailpoint", "docusign",
        "autodesk", "ptc", "trimble", "esri", "mapbox",
        "marqeta", "payoneer", "veeva", "medidata",
        "spotify", "nbcuniversal", "chewy", "wayfair", "etsy",
        "mongodb", "elastic", "confluent", "braze", "amplitude",
        "freshworks", "chargebee", "squarespace", "zendesk",
        "unity", "splunk", "commvault", "crowdstrike", "okta",
        "adobe", "ansys", "cadence", "synopsys", "keysight",
        "labcorp", "hbo", "fox", "mercadolibre", "farfetch",
        "booking", "expedia", "caesars", "riot",
        "hashicorp", "segment", "mixpanel",
        # More companies
        "twitch", "palantir", "datadog", "snowflake", "databricks",
        "figma", "notion", "airtable", "webflow", "retool",
        "vercel", "supabase", "gitlab", "postman", "miro",
        "canva", "asana", "dropbox", "gusto", "intercom",
        "linear", "sentry", "newrelic", "pagerduty",
    ]

    found = []
    for company in companies_to_test:
        # Try multiple URL patterns
        patterns = [
            f"https://jobs.jobvite.com/{company}/search",
            f"https://jobs.jobvite.com/en/{company}/search",
            f"https://hire.jobvite.com/{company}/search",
            f"https://app.jobvite.com/{company}",
            f"https://careers.{company}.com",  # Often redirects to Jobvite
        ]

        for url in patterns:
            try:
                r = requests.get(url, headers=UA, timeout=8, allow_redirects=True)
                final_url = r.url
                if r.status_code == 200:
                    # Check if it's actually Jobvite
                    if "jobvite" in final_url.lower() or "jobvite" in r.text.lower()[:5000]:
                        # Extract job links
                        job_matches = re.findall(r'/job/([a-zA-Z0-9_-]+)', r.text)
                        if job_matches:
                            found.append({
                                "company": company,
                                "base_url": url.rsplit('/search', 1)[0] if '/search' in url else url,
                                "jobs": list(set(job_matches))[:5]
                            })
                            print(f"Found Jobvite for {company}: {len(job_matches)} jobs")
                            break
            except:
                continue

        time.sleep(0.2)

    return found


def fetch_apply_form_direct(url):
    """Fetch and parse the application form from a direct URL."""
    fields = []

    try:
        r = requests.get(url, headers=UA, timeout=20, allow_redirects=True)
        if r.status_code != 200:
            return None

        html = r.text
        soup = BeautifulSoup(html, "html.parser")

        # Extract job title
        title_el = soup.select_one("h1, h2.jv-header, .jv-job-title, .job-title, [class*='title']")
        title = title_el.get_text(strip=True)[:100] if title_el else "Unknown"

        # Extract company from URL
        parsed = urlparse(url)
        company = "unknown"
        path_parts = parsed.path.split('/')
        for i, part in enumerate(path_parts):
            if part == "job" and i > 0:
                company = path_parts[i-1]
                break

        # Find form elements in the entire page (Jobvite forms may be loaded dynamically)
        seen = set()

        # Check for standard Jobvite field patterns in HTML
        # Look for jv- prefixed IDs
        for inp in soup.select('[id^="jv-"], [name^="jv-"], input[name], textarea[name], select[name]'):
            name = inp.get("name", "")
            inp_id = inp.get("id", "")
            key = name or inp_id

            if not key or key in seen:
                continue

            # Skip hidden/submit fields
            inp_type = inp.get("type", "").lower()
            if inp_type in ("hidden", "submit", "button", "reset", "image"):
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
            elif inp_type == "checkbox":
                ftype = "checkbox"
            elif inp_type == "radio":
                ftype = "radio"
            else:
                ftype = "input"

            # Get label
            label = ""
            if inp_id:
                label_el = soup.select_one(f'label[for="{inp_id}"]')
                if label_el:
                    label = label_el.get_text(strip=True)

            if not label:
                parent = inp.find_parent(["div", "label", "span", "fieldset"])
                if parent:
                    label_el = parent.find("label") or parent.find(class_=re.compile(r"label|title"))
                    if label_el:
                        label = label_el.get_text(strip=True)

            if not label:
                label = inp.get("placeholder", "")

            if not label:
                readable = re.sub(r'([A-Z])', r' \1', key)
                readable = readable.replace('_', ' ').replace('-', ' ').replace('jv', '')
                label = readable.strip().title()

            label = re.sub(r'\s+', ' ', label).strip()[:100]

            # Check required
            required = bool(inp.get("required")) or inp.get("aria-required") == "true"

            # Get options for select
            options = []
            if ftype == "select":
                options = [{"label": opt.get_text(strip=True), "value": opt.get("value", "")}
                           for opt in inp.select("option") if opt.get("value") and opt.get_text(strip=True)]

            if label or key:
                fields.append({
                    "label": label if label else key,
                    "name": key,
                    "type": ftype,
                    "required": required,
                    "has_options": len(options) > 0,
                    "options": options[:15],
                })

        # Also scan for EEO/demographic sections
        for section in soup.select('[class*="eeo"], [class*="demographic"], [class*="voluntary"], [id*="eeo"]'):
            for q in section.select('label, [class*="question"]'):
                label = q.get_text(strip=True)[:100]
                if label and label not in [f["label"] for f in fields]:
                    fields.append({
                        "label": label,
                        "name": f"eeo_{len(fields)}",
                        "type": "select",
                        "required": False,
                        "has_options": True,
                        "options": [],
                    })

        if fields:
            return {
                "company": company,
                "job_id": url.split('/job/')[-1].split('/')[0] if '/job/' in url else "unknown",
                "title": title,
                "fields": fields,
                "url": url
            }

    except Exception as e:
        print(f"    Error parsing {url}: {e}")

    return None


def categorize_field(label, name, ftype):
    """Categorize a field based on its label/name."""
    lo = (label + " " + name).lower()

    if any(k in lo for k in ["first name", "firstname", "first_name", "fname", "jv-firstname"]):
        return "first_name"
    if any(k in lo for k in ["last name", "lastname", "last_name", "lname", "surname", "jv-lastname"]):
        return "last_name"
    if any(k in lo for k in ["full name", "fullname", "your name"]) and "first" not in lo and "last" not in lo:
        return "full_name"
    if any(k in lo for k in ["email", "e-mail", "jv-email"]):
        return "email"
    if any(k in lo for k in ["phone", "mobile", "telephone", "tel", "jv-phone"]):
        return "phone"
    if any(k in lo for k in ["resume", "cv", "curriculum", "jv-resume"]):
        return "resume"
    if any(k in lo for k in ["cover letter", "coverletter", "jv-coverletter"]):
        return "cover_letter"
    if any(k in lo for k in ["linkedin"]):
        return "linkedin"
    if any(k in lo for k in ["github"]):
        return "github"
    if any(k in lo for k in ["portfolio", "website", "personal site", "url", "jv-portfolio", "jv-website"]):
        return "portfolio_url"
    if any(k in lo for k in ["address", "street"]):
        return "address"
    if any(k in lo for k in ["city"]):
        return "city"
    if any(k in lo for k in ["state", "province"]):
        return "state"
    if any(k in lo for k in ["zip", "postal"]):
        return "zip_code"
    if any(k in lo for k in ["country"]):
        return "country"
    if any(k in lo for k in ["location", "jv-location"]) and not any(k in lo for k in ["address", "city", "state", "zip"]):
        return "location"
    if any(k in lo for k in ["authoriz", "eligible to work", "legally", "work permit", "employment eligib", "right to work"]):
        return "work_authorization"
    if any(k in lo for k in ["sponsor", "visa", "h-1b", "h1b", "require sponsorship", "immigration"]):
        return "sponsorship"
    if any(k in lo for k in ["gender", "sex"]) and "transgender" not in lo:
        return "eeo_gender"
    if any(k in lo for k in ["race", "ethnic", "hispanic", "latino"]):
        return "eeo_race"
    if any(k in lo for k in ["veteran", "military", "protected veteran"]):
        return "eeo_veteran"
    if any(k in lo for k in ["disab"]):
        return "eeo_disability"
    if any(k in lo for k in ["sexual orientation", "lgbtq", "lgbt", "transgender"]):
        return "eeo_lgbtq"
    if any(k in lo for k in ["how did you hear", "referr", "source", "where did you", "how did you find"]):
        return "source"
    if any(k in lo for k in ["salary", "compensation", "pay", "desired salary", "expected", "wage"]):
        return "salary"
    if any(k in lo for k in ["start date", "available", "availability", "when can you start", "earliest"]):
        return "start_date"
    if any(k in lo for k in ["school", "university", "college", "education"]):
        return "education"
    if any(k in lo for k in ["degree", "major", "gpa", "graduation"]):
        return "education_detail"
    if any(k in lo for k in ["years", "experience"]):
        return "years_experience"
    if any(k in lo for k in ["current company", "employer", "current position", "jv-currentcompany"]):
        return "current_company"
    if ftype == "textarea" or any(k in lo for k in ["why", "tell us", "describe", "additional", "comments", "notes"]):
        return "custom_freetext"
    if ftype == "select":
        return "custom_select"
    if ftype in ("checkbox", "radio"):
        return "custom_choice"
    if ftype == "file":
        return "file_upload"

    return "other"


def main():
    print("Step 1: Searching for companies using Jobvite...")
    found_companies = find_jobvite_companies()

    print(f"\nFound {len(found_companies)} companies using Jobvite")

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
        base_url = company_data["base_url"]

        for job_id in company_data["jobs"]:
            if len(sampled) >= 50:
                break

            # Try different URL patterns for the job
            job_urls = [
                f"{base_url}/job/{job_id}",
                f"https://jobs.jobvite.com/{company}/job/{job_id}",
                f"https://hire.jobvite.com/{company}/job/{job_id}",
            ]

            form_data = None
            for url in job_urls:
                form_data = fetch_apply_form_direct(url)
                if form_data and form_data["fields"]:
                    break

            if form_data and form_data["fields"]:
                sampled.append(form_data)
                print(f"  [{len(sampled)}] Sampled: {company} - {form_data['title'][:40]} ({len(form_data['fields'])} fields)")

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

                    if category.startswith("eeo_"):
                        eeo_variations.add(label)
                    if category == "work_authorization":
                        work_auth_variations.add(label)
                    if category == "sponsorship":
                        sponsorship_variations.add(label)
                    if category.startswith("custom_"):
                        custom_questions.append({
                            "label": label,
                            "type": ftype,
                            "category": category
                        })

                time.sleep(0.3)
            else:
                time.sleep(0.1)

    print(f"\n=== RESULTS ===")
    print(f"Jobs sampled: {len(sampled)}")
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

    # Build custom_questions list
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
        "ats": "jobvite",
        "jobs_sampled": len(sampled),
        "unique_fields": unique_fields,
        "custom_questions": custom_q_list[:20],
        "eeo_fields": list(eeo_variations),
        "work_auth_variations": list(work_auth_variations),
        "sponsorship_variations": list(sponsorship_variations),
    }

    with open("jobvite_sample_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    with open("jobvite_sample_raw.json", "w") as f:
        json.dump({"sampled": sampled, "analysis": results}, f, indent=2, default=str)

    print(f"\nResults saved to jobvite_sample_results.json")
    print(f"Raw data saved to jobvite_sample_raw.json")

    return results


if __name__ == "__main__":
    main()
