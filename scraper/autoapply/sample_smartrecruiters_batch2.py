#!/usr/bin/env python3
"""Sample 50 SmartRecruiters job forms from different companies (batch 2)."""

import json
import sys
import time
from collections import defaultdict
from typing import Optional

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply/1.0)"}

# Expanded list of companies known to use SmartRecruiters
# Batch 2 - different from batch 1
COMPANIES_BATCH_2 = [
    # Tech companies
    "visa", "sap", "bosch", "siemens", "philips", "ericsson", "nokia", "huawei",
    "dell", "hp", "lenovo", "intel", "amd", "nvidia", "qualcomm", "broadcom",
    "micron", "western-digital", "seagate", "sandisk",
    # Finance
    "mastercard", "americanexpress", "jpmorgan", "goldmansachs", "morganstanley",
    "citibank", "barclays", "hsbc", "ubs", "credit-suisse", "deutsche-bank",
    # Retail / Consumer
    "adidas", "nike", "puma", "underarmour", "newbalance", "converse", "vans",
    "ikea", "h-m", "zara", "uniqlo", "gap", "oldnavy", "bananarepublic",
    "walmart", "target", "costco", "kroger", "albertsons", "publix",
    # Food & Beverage
    "nestle", "pepsi", "cocacola", "mondelez", "kraft-heinz", "general-mills",
    "kelloggs", "mars", "hershey", "ferrero", "danone", "unilever",
    "heineken", "ab-inbev", "carlsberg", "diageo", "pernod-ricard",
    # Consulting/Services
    "deloitte", "pwc", "ey", "kpmg", "accenture", "mckinsey", "bcg", "bain",
    "capgemini", "cognizant", "infosys", "tcs", "wipro", "hcl",
    # Healthcare/Pharma
    "johnson-johnson", "pfizer", "merck", "novartis", "roche", "sanofi",
    "gsk", "astrazeneca", "bayer", "abbvie", "bristol-myers-squibb",
    # Automotive
    "bmw", "mercedes-benz", "audi", "volkswagen", "porsche", "volvo",
    "toyota", "honda", "nissan", "hyundai", "ford", "gm", "tesla", "rivian",
    # Media/Entertainment
    "disney", "warner-bros", "nbcuniversal", "paramount", "sony-pictures",
    "netflix", "spotify", "tencent", "bytedance", "activision",
    # Travel/Hospitality
    "marriott", "hilton", "hyatt", "ihg", "accor", "booking", "expedia",
    "airbnb", "tripadvisor", "united-airlines", "delta", "american-airlines",
    # Industrial
    "3m", "honeywell", "ge", "caterpillar", "deere", "emerson", "parker",
    "eaton", "rockwell", "abb", "schneider-electric", "legrand",
    # Other
    "loreal", "estee-lauder", "pg", "colgate", "unilever-hpc",
]


def discover_companies() -> list[str]:
    """Find companies with active SmartRecruiters postings."""
    working = []

    for company in COMPANIES_BATCH_2:
        url = f"https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=1"
        try:
            r = requests.get(url, headers=UA, timeout=10)
            if r.status_code == 200:
                data = r.json()
                if data.get("content") and len(data["content"]) > 0:
                    working.append(company)
                    print(f"  {company}: {len(data.get('totalFound', len(data['content'])))} jobs", file=sys.stderr)
        except Exception as e:
            pass

        if len(working) >= 60:  # Get more than needed for selection
            break

        time.sleep(0.2)  # Rate limiting

    return working


def fetch_jobs(company_id: str, limit: int = 5) -> list[dict]:
    """Fetch job postings for a company."""
    url = f"https://api.smartrecruiters.com/v1/companies/{company_id}/postings"
    params = {"limit": limit}

    try:
        r = requests.get(url, headers=UA, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data.get("content", [])
    except Exception as e:
        return []


def fetch_form(company_id: str, posting_id: str) -> tuple[list[dict], dict]:
    """Fetch posting detail and extract form fields.

    Returns: (fields, raw_data)
    """
    url = f"https://api.smartrecruiters.com/v1/companies/{company_id}/postings/{posting_id}"

    try:
        r = requests.get(url, headers=UA, timeout=15)
        r.raise_for_status()
        data = r.json()
    except requests.exceptions.HTTPError:
        # Try alternative URL
        alt_url = f"https://jobs.smartrecruiters.com/{company_id}/api/postings/{posting_id}"
        r = requests.get(alt_url, headers=UA, timeout=15)
        r.raise_for_status()
        data = r.json()

    fields = []

    # Standard fields (always present)
    standard_fields = [
        {"label": "First Name", "name": "firstName", "type": "input_text", "required": True},
        {"label": "Last Name", "name": "lastName", "type": "input_text", "required": True},
        {"label": "Email", "name": "email", "type": "input_text", "required": True},
        {"label": "Phone", "name": "phoneNumber", "type": "input_text", "required": False},
        {"label": "Resume", "name": "resume", "type": "input_file", "required": True},
    ]
    fields.extend(standard_fields)

    # Extract screening questions
    questions = data.get("applicationConfiguration", {}).get("screeningQuestions", [])
    if not questions:
        questions = data.get("questions", [])

    for q in questions:
        qtype = q.get("type", "TEXT").upper()
        field_type = "textarea" if qtype == "TEXTAREA" else "input_text"

        if qtype in ("SINGLE_SELECT", "DROPDOWN"):
            field_type = "select"
        elif qtype == "MULTI_SELECT":
            field_type = "multi_select"
        elif qtype == "BOOLEAN":
            field_type = "select"

        values = []
        for opt in q.get("options", []) or q.get("answers", []):
            if isinstance(opt, dict):
                values.append({
                    "label": opt.get("label") or opt.get("value"),
                    "value": opt.get("value") or opt.get("id")
                })
            else:
                values.append({"label": str(opt), "value": str(opt)})

        if qtype == "BOOLEAN" and not values:
            values = [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]

        fields.append({
            "label": q.get("label") or q.get("question", ""),
            "name": q.get("id") or q.get("fieldId") or f"q_{len(fields)}",
            "type": field_type,
            "required": q.get("required", False),
            "values": values,
        })

    # Check for LinkedIn profile
    if data.get("applicationConfiguration", {}).get("linkedInProfile"):
        fields.append({
            "label": "LinkedIn Profile",
            "name": "linkedInProfile",
            "type": "input_text",
            "required": False,
        })

    return fields, data


def categorize_field(label: str) -> str:
    """Categorize a field label into a pattern."""
    label_lower = label.lower()

    # Work authorization
    if any(x in label_lower for x in ["authorized to work", "legally authorized", "work authorization", "right to work", "eligible to work"]):
        return "work_authorization"

    # Sponsorship
    if any(x in label_lower for x in ["sponsor", "visa", "immigration"]):
        return "sponsorship"

    # EEO fields
    if "gender" in label_lower or "sex" in label_lower:
        return "eeo_gender"
    if any(x in label_lower for x in ["race", "ethnic", "heritage"]):
        return "eeo_race"
    if "veteran" in label_lower or "military" in label_lower:
        return "eeo_veteran"
    if "disab" in label_lower:
        return "eeo_disability"

    # Standard fields
    if "first name" in label_lower:
        return "first_name"
    if "last name" in label_lower:
        return "last_name"
    if "email" in label_lower:
        return "email"
    if "phone" in label_lower:
        return "phone"
    if "resume" in label_lower or "cv" in label_lower:
        return "resume"
    if "linkedin" in label_lower:
        return "linkedin"
    if "github" in label_lower:
        return "github"
    if "portfolio" in label_lower or "website" in label_lower:
        return "portfolio"
    if "cover letter" in label_lower:
        return "cover_letter"
    if any(x in label_lower for x in ["experience", "years"]):
        return "experience"
    if any(x in label_lower for x in ["salary", "compensation", "pay"]):
        return "salary"
    if any(x in label_lower for x in ["relocate", "relocation"]):
        return "relocation"
    if any(x in label_lower for x in ["start date", "availability", "when can you start"]):
        return "start_date"
    if any(x in label_lower for x in ["how did you hear", "source", "referral"]):
        return "source"
    if "location" in label_lower or "where are you" in label_lower:
        return "location"
    if "education" in label_lower:
        return "education"
    if "address" in label_lower:
        return "address"
    if "city" in label_lower:
        return "city"
    if "state" in label_lower:
        return "state"
    if "zip" in label_lower or "postal" in label_lower:
        return "zip"
    if "country" in label_lower:
        return "country"

    return "custom"


def main():
    print("Discovering SmartRecruiters companies...", file=sys.stderr)
    companies = discover_companies()
    print(f"Found {len(companies)} companies with active postings", file=sys.stderr)

    if len(companies) < 20:
        print("Not enough companies found, exiting", file=sys.stderr)
        return

    # Sample jobs
    all_fields = []
    field_counts = defaultdict(int)
    custom_questions = []
    work_auth_variations = set()
    sponsorship_variations = set()
    eeo_fields = set()
    samples = []

    jobs_sampled = 0
    target = 50

    for company in companies:
        if jobs_sampled >= target:
            break

        jobs = fetch_jobs(company, limit=3)  # Get multiple jobs per company

        for job in jobs:
            if jobs_sampled >= target:
                break

            posting_id = job.get("id") or job.get("uuid")
            if not posting_id:
                continue

            try:
                fields, raw_data = fetch_form(company, posting_id)
                jobs_sampled += 1

                sample = {
                    "company": company,
                    "job_id": posting_id,
                    "title": job.get("name", ""),
                    "field_count": len(fields),
                    "fields": [],
                }

                for f in fields:
                    label = f.get("label", "")
                    category = categorize_field(label)
                    field_counts[category] += 1

                    field_info = {
                        "label": label,
                        "category": category,
                        "type": f.get("type"),
                        "required": f.get("required"),
                        "has_options": len(f.get("values", [])) > 0,
                    }

                    if f.get("values"):
                        field_info["options"] = [v.get("label") for v in f.get("values", [])[:10]]

                    sample["fields"].append(field_info)

                    # Track variations
                    if category == "work_authorization":
                        work_auth_variations.add(label)
                    elif category == "sponsorship":
                        sponsorship_variations.add(label)
                    elif category.startswith("eeo_"):
                        eeo_fields.add(label)
                    elif category == "custom":
                        custom_questions.append({
                            "label": label,
                            "type": f.get("type"),
                            "company": company,
                        })

                samples.append(sample)
                print(f"  [{jobs_sampled}/{target}] {company}: {job.get('name', '')[:40]} - {len(fields)} fields", file=sys.stderr)

            except Exception as e:
                print(f"  Error fetching {company}/{posting_id}: {e}", file=sys.stderr)

            time.sleep(0.3)  # Rate limiting

    # Compute frequencies
    total = jobs_sampled
    unique_fields = []

    for category, count in sorted(field_counts.items(), key=lambda x: -x[1]):
        freq_pct = round(100 * count / total, 1)
        unique_fields.append({
            "label_pattern": category,
            "category": category,
            "frequency_pct": freq_pct,
        })

    # Custom question patterns
    custom_patterns = defaultdict(int)
    for cq in custom_questions:
        # Normalize the question pattern
        label = cq["label"].lower()
        if "18" in label or "age" in label:
            pattern = "age_verification"
        elif "background" in label and "check" in label:
            pattern = "background_check"
        elif "drug" in label or "test" in label:
            pattern = "drug_test"
        elif "citizen" in label:
            pattern = "citizenship"
        elif "clearance" in label or "security" in label:
            pattern = "security_clearance"
        elif "language" in label:
            pattern = "language"
        elif "travel" in label:
            pattern = "travel"
        elif "shift" in label or "hours" in label or "schedule" in label:
            pattern = "schedule"
        elif "remote" in label or "onsite" in label or "hybrid" in label:
            pattern = "work_mode"
        elif "skill" in label or "proficien" in label:
            pattern = "skills"
        elif "why" in label or "motivation" in label:
            pattern = "motivation"
        elif "describe" in label or "tell us" in label:
            pattern = "open_ended"
        else:
            pattern = "other"
        custom_patterns[pattern] += 1

    custom_question_summary = []
    for pattern, count in sorted(custom_patterns.items(), key=lambda x: -x[1]):
        freq_pct = round(100 * count / total, 1)
        custom_question_summary.append({
            "pattern": pattern,
            "category": "custom_question",
            "frequency_pct": freq_pct,
        })

    # Build result
    result = {
        "ats": "smartrecruiters",
        "jobs_sampled": jobs_sampled,
        "unique_fields": unique_fields,
        "work_auth_variations": sorted(list(work_auth_variations)),
        "sponsorship_variations": sorted(list(sponsorship_variations)),
        "eeo_fields": sorted(list(eeo_fields)),
        "custom_questions": custom_question_summary,
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
