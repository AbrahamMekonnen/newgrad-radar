"""Normalize every terminal blocker from a Playwright submission report."""
from __future__ import annotations
import argparse, collections, json, re
from pathlib import Path

def nested_detail(event):
    value = event.get("detail")
    if isinstance(value, dict): value = value.get("detail", value)
    if isinstance(value, str):
        try: return json.loads(value)
        except Exception: return {"message": value}
    return value if isinstance(value, dict) else {}

def question(field_key):
    text = str(field_key or "").split("|")[0]
    return re.sub(r"\s+", " ", text).strip()

def category(q):
    rules = [
        ("otp", r"verification code|security code|confirm you re a human"),
        ("education", r"school|degree|graduat|gpa|sat score|act score|gre score|education"),
        ("work_authorization", r"authorized to work|sponsor|visa|immigration"),
        ("location_schedule", r"relocat|onsite|on site|office|based in|reside|travel requirement|start full time|available to start|season"),
        ("employment_history", r"worked for|worked at|employment history|current company|company name|title|government employee|military|national guard|reserves|family members"),
        ("legal_export_clearance", r"clearance|export license|export compliance|citizen|non compete|non disclosure"),
        ("demographics", r"gender|hispanic|race|ethnic|veteran|disability"),
        ("consent_acknowledgment", r"consent|acknowledge|affirmation|certify|privacy notice|ai policy|recorded"),
        ("source", r"hear about|learn about"),
        ("skills_experience", r"years of|experience|programming language|coding language"),
        ("narrative", r"tell us|describe|example|exceptional work|why|briefly about|cover letter"),
        ("links", r"github|portfolio|website|repo"),
    ]
    for name, pattern in rules:
        if re.search(pattern, q, re.I): return name
    return "other"

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("report"); args=ap.parse_args()
    data=json.loads(Path(args.report).read_text(encoding="utf-8"))
    rows=[]
    for result in data["results"]:
        terminal=next((event for event in reversed(result.get("progressEvents",[])) if event.get("stage") in {"submitted","waiting_for_user","failed"}), {})
        detail=nested_detail(terminal)
        diagnostics=detail.get("diagnostics") or ([detail["diagnostic"]] if detail.get("diagnostic") else [])
        for d in diagnostics:
            q=question(d.get("fieldKey"))
            rows.append({"company":result.get("company"),"title":result.get("title"),"stage":result.get("stage"),
                         "question":q,"category":category(q),"failure":d.get("category"),
                         "control":d.get("controlType"),"answer_source":d.get("answerSource"),
                         "options":d.get("optionCount"),"attempt":d.get("attempt")})
    by_cat=collections.Counter(r["category"] for r in rows)
    by_failure=collections.Counter(r.get("failure") or "unknown" for r in rows)
    by_question=collections.Counter(r["question"] for r in rows)
    output={"applications":len(data["results"]),"outcomes":dict(collections.Counter(r["stage"] for r in data["results"])),
            "diagnostics":len(rows),"by_category":by_cat.most_common(),"by_failure":by_failure.most_common(),
            "repeated_questions":[{"question":q,"count":n,"category":category(q)} for q,n in by_question.most_common()],
            "rows":rows}
    out=Path(args.report).with_name(Path(args.report).stem+"-analysis.json")
    out.write_text(json.dumps(output,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in output.items() if k!="rows"},indent=2)); print(out)
if __name__=="__main__": main()
