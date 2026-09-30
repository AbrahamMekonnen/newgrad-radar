"""Build, authorize and prepare an exact user-approved submission cohort."""
from __future__ import annotations
import argparse, importlib.util, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "scraper"), str(ROOT / "scraper" / "autoapply")]
spec = importlib.util.spec_from_file_location("gate", Path(__file__).with_name("release-autoapply-cohort.py"))
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)

def expanded_match(job):
    title = str(job.get("title") or "")
    if not gate._SWE_TITLE.search(title) or gate._NON_SWE_TITLE.search(title): return False
    if gate._EDUCATION_MISMATCH.search(title): return False
    if re.search(r"\b(senior|staff|principal|manager|director|lead|architect|sr\.?|iii|iv)\b", title, re.I): return False
    location = gate.normalized(job.get("location"))
    hints = ("united states", "remote", " ca", " ny", " tx", " wa", " ma", " il",
             "new york", "san francisco", "seattle", "austin")
    return not location or any(x.strip() in location for x in hints)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--ats",default="greenhouse"); ap.add_argument("--size",type=int,default=50); ap.add_argument("--offset",type=int,default=0); ap.add_argument("--prepare",action="store_true"); a=ap.parse_args()
    gate.load_env()
    from supabase import create_client
    from autoapply.prepare_worker import build_profile, _prepare_with_retries
    from companies import COMPANIES
    c=create_client(os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"],os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"])
    d=(c.table("autoapply_browser_devices").select("user_id,last_seen_at").not_.is_("last_seen_at","null").order("last_seen_at",desc=True).limit(1).execute().data or [])
    if not d: raise SystemExit("No paired browser user")
    uid=d[0]["user_id"]
    p=(c.table("user_profiles").select("auto_apply_filters,auto_apply_enabled,auto_submit").eq("user_id",uid).single().execute().data or {})
    if not p.get("auto_apply_enabled") or not p.get("auto_submit"): raise SystemExit("Auto-Apply and Auto-Submit must be enabled")
    jobs=(c.table("jobs").select("id,title,company_slug,company_name,url,apply_url,ats_type,role_types,experience_level,location,is_active").eq("is_active",True).eq("ats_type",a.ats).limit(5000).execute().data or [])
    receipts=(c.table("autoapply_submission_receipts").select("job_id").eq("user_id",uid).execute().data or []); submitted={x["job_id"] for x in receipts}
    strict=[]; expanded=[]; seen=set()
    for j in jobs:
        key=(gate.normalized(j.get("company_name")),gate.normalized(j.get("title")))
        if j["id"] in submitted or key in seen: continue
        if gate.matches(j,p.get("auto_apply_filters") or {}): strict.append(j); seen.add(key)
    for j in jobs:
        key=(gate.normalized(j.get("company_name")),gate.normalized(j.get("title")))
        if j["id"] in submitted or key in seen or not expanded_match(j): continue
        expanded.append(j); seen.add(key)
    chosen=(strict+expanded)[a.offset:a.offset+a.size]
    if len(chosen)<a.size: raise SystemExit(f"Only {len(chosen)} eligible active unique {a.ats} jobs available")
    rows=(c.table("autoapply_job_queue").select("*").eq("user_id",uid).limit(10000).execute().data or []); by_job={x["job_id"]:x for x in rows}
    cohort=[]
    for j in chosen:
        row=by_job.get(j["id"])
        vals={"user_id":uid,"job_id":j["id"],"job_title":j.get("title"),"company_slug":j.get("company_slug"),"company_name":j.get("company_name"),"job_url":j.get("apply_url") or j.get("url"),"ats_type":a.ats,"priority":0,"status":"pending","execution_channel":"user_browser","authorization_source":"standing_rule","browser_device_id":None,"browser_lease_id":None,"browser_lease_expires_at":None,"browser_stage":"approved_50_test_prepare"}
        if row: row=(c.table("autoapply_job_queue").update(vals).eq("id",row["id"]).execute().data or [row])[0]
        else: row=c.table("autoapply_job_queue").insert(vals).execute().data[0]
        cohort.append({"queue_id":row["id"],"job_id":j["id"],"company":j.get("company_name"),"title":j.get("title"),"level":j.get("experience_level"),"strict_match":j in strict})
    if a.prepare:
        prof=build_profile(c,uid)
        for n,item in enumerate(cohort,1):
            row=c.table("autoapply_job_queue").select("*").eq("id",item["queue_id"]).single().execute().data
            c.table("autoapply_job_queue").update({"status":"processing"}).eq("id",row["id"]).execute()
            ok=_prepare_with_retries(c,COMPANIES,row,prof)
            print(f"[{n}/{len(cohort)}] {item['company']}: {'prepared' if ok else 'failed'}",flush=True)
    ids=[]
    for item in cohort:
        row=c.table("autoapply_job_queue").select("status,prepared_data").eq("id",item["queue_id"]).single().execute().data or {}
        item["prepare_status"]=row.get("status"); item["prepared"]=bool(row.get("prepared_data"))
        if item["prepared"]:
            c.table("autoapply_job_queue").update({"status":"waiting_for_browser","browser_stage":"approved_50_test_released"}).eq("id",item["queue_id"]).execute(); ids.append(item["queue_id"])
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"); base=ROOT/".qa"/f"submission-cohort-{a.ats}-{stamp}"
    Path(str(base)+".json").write_text(json.dumps({"requested":a.size,"selected":len(cohort),"ready":len(ids),"jobs":cohort},indent=2),encoding="utf-8")
    Path(str(base)+".ids.json").write_text(json.dumps(ids,indent=2),encoding="utf-8")
    print(json.dumps({"report":str(base)+".json","ids_file":str(base)+".ids.json","selected":len(cohort),"ready":len(ids)}))
if __name__=="__main__": main()
