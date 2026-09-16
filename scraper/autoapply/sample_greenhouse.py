"""Sample 50 Greenhouse job forms and analyze field patterns."""
import requests
import json
import time
from collections import defaultdict
import re

UA = {"User-Agent": "Mozilla/5.0 (compatible; research-scraper)"}

# Known companies using Greenhouse boards
GREENHOUSE_COMPANIES = [
    "stripe", "airbnb", "coinbase", "notion", "figma", "plaid", "databricks",
    "discord", "instacart", "doordash", "reddit", "ramp", "brex", "flexport",
    "airtable", "cloudflare", "scale", "anthropic", "openai", "asana",
    "dropbox", "gusto", "intercom", "webflow", "miro", "canva", "retool",
    "vercel", "linear", "postman", "supabase", "hashicorp", "gitlab",
    "twilio", "sendgrid", "segment", "amplitude", "mixpanel", "heap",
    "datadog", "pagerduty", "sentry", "newrelic", "splunk", "elastic",
    "confluent", "snowflake", "dbt-labs", "fivetran", "stitch", "looker",
    "tableau", "metabase", "lightdash", "preset", "hex", "mode",
    "palantir", "c3ai", "databricks", "anduril", "relativity", "space-x",
    "bytedance", "tiktok", "shopify", "squarespace", "wix", "webflow",
    "hubspot", "salesforce", "zendesk", "freshworks", "servicenow",
    "toast", "lightspeed", "square", "affirm", "klarna", "afterpay",
    "chime", "sofi", "robinhood", "wealthfront", "betterment", "acorns",
    "nerdwallet", "creditkarma", "mint", "plaid", "finicity", "yodlee",
    "carta", "pilot", "ramp", "divvy", "bill", "expensify", "emburse"
]

def fetch_jobs(token):
    """Get first few jobs from a Greenhouse board."""
    try:
        r = requests.get(
            f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
            headers=UA, timeout=10
        )
        if r.status_code == 200:
            return r.json().get("jobs", [])[:3]  # First 3 jobs per company
    except:
        pass
    return []

def fetch_form(token, job_id):
    """Get form questions for a job."""
    try:
        r = requests.get(
            f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true",
            headers=UA, timeout=10
        )
        if r.status_code == 200:
            return r.json().get("questions", [])
    except:
        pass
    return []

def analyze_field(q):
    """Analyze a single question/field."""
    label = q.get("label", "")
    required = q.get("required", False)
    fields = q.get("fields", [])
    
    field_info = {
        "label": label,
        "required": required,
        "field_count": len(fields)
    }
    
    if fields:
        f = fields[0]
        field_info["type"] = f.get("type", "")
        values = f.get("values", [])
        field_info["has_options"] = len(values) > 0
        field_info["options"] = [v.get("label", "") for v in values[:10]]  # First 10 options
    
    return field_info

# Run sampling
sampled = []
field_patterns = defaultdict(lambda: {"count": 0, "examples": [], "types": set(), "options_examples": []})
eeo_variations = set()
work_auth_variations = set()
sponsorship_variations = set()
custom_questions = []

print("Sampling Greenhouse jobs...")

for company in GREENHOUSE_COMPANIES:
    if len(sampled) >= 50:
        break
    
    jobs = fetch_jobs(company)
    for job in jobs:
        if len(sampled) >= 50:
            break
        
        job_id = job.get("id")
        title = job.get("title", "")
        
        questions = fetch_form(company, job_id)
        if not questions:
            continue
        
        sampled.append({
            "company": company,
            "job_id": job_id,
            "title": title,
            "questions": questions
        })
        
        for q in questions:
            info = analyze_field(q)
            label = info["label"]
            label_lower = label.lower()
            
            # Normalize label for pattern matching
            normalized = re.sub(r'\s+', ' ', label.lower().strip())
            
            # Track patterns
            field_patterns[normalized]["count"] += 1
            field_patterns[normalized]["types"].add(info.get("type", "unknown"))
            if info.get("has_options") and info.get("options"):
                field_patterns[normalized]["options_examples"].append(info["options"])
            if len(field_patterns[normalized]["examples"]) < 5:
                field_patterns[normalized]["examples"].append(label)
            
            # Track EEO variations
            if any(k in label_lower for k in ["gender", "race", "ethnic", "veteran", "disability", "hispanic", "latino"]):
                eeo_variations.add(label)
            
            # Track work auth variations
            if any(k in label_lower for k in ["authorized", "authorised", "eligible", "legally", "work permit", "employment eligib"]):
                work_auth_variations.add(label)
            
            # Track sponsorship variations
            if any(k in label_lower for k in ["sponsor", "visa", "h-1b", "h1b"]):
                sponsorship_variations.add(label)
        
        print(f"  Sampled {len(sampled)}: {company} - {title[:40]}")
        time.sleep(0.2)  # Rate limiting

print(f"\nSampled {len(sampled)} jobs from Greenhouse")
print(f"Found {len(field_patterns)} unique field patterns")

# Output results as JSON
results = {
    "jobs_sampled": len(sampled),
    "field_patterns": {k: {"count": v["count"], "types": list(v["types"]), "options_examples": v["options_examples"][:2]} 
                       for k, v in sorted(field_patterns.items(), key=lambda x: -x[1]["count"])},
    "eeo_variations": list(eeo_variations),
    "work_auth_variations": list(work_auth_variations),
    "sponsorship_variations": list(sponsorship_variations),
    "sampled_jobs": [{k: v for k, v in s.items() if k != "questions"} for s in sampled]
}

# Write raw data for analysis
with open("greenhouse_sample_raw.json", "w") as f:
    json.dump({"sampled": sampled, "analysis": results}, f, indent=2)

print("\nRaw data saved to greenhouse_sample_raw.json")
