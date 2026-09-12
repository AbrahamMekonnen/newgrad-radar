# Handoff: Continue on Personal Machine

Last updated: 2026-09-11

## Quick Start

```bash
cd ~/Personal/newgrad-radar

# Install dependencies
npm install
cd auto-apply && pip install -r requirements.txt && cd ..

# Start dev server
npm run dev
```

---

## Environment Variables (.env.local)

Create/update `.env.local` with these values:

```bash
# Supabase (REQUIRED)
NEXT_PUBLIC_SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcmJ5dWJycnB4eHZvdHNsam1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTY1MzEsImV4cCI6MjEwNDMzMjUzMX0.HYQtMomrHVwbjlIN8XFXlbiJynxTMM4pabx9TSoR9Vg

# Service Role Key (REQUIRED for worker - get from Supabase Dashboard)
# Supabase → Settings → API → service_role (secret) - starts with eyJ...
SUPABASE_SERVICE_KEY=<YOUR_SERVICE_ROLE_KEY_HERE>

# AI (at least one required for auto-apply)
GEMINI_API_KEY=<your_gemini_key>
GROQ_API_KEY=<your_groq_key>       # optional, free tier
OLLAMA_MODEL=llama3                 # optional, local

# Optional features
HUNTER_API_KEY=<for_recruiter_finding>
BREVO_API_KEY=<for_email_notifications>
CRON_SECRET=<random_string_for_cron_auth>
```

### Where to get keys:
- **Supabase service_role**: Dashboard → Settings → API → service_role (under "Project API keys")
- **Gemini**: https://aistudio.google.com/apikey
- **Groq**: https://console.groq.com/keys (free)

---

## Database Migrations

Run this SQL in Supabase SQL Editor (safe to run multiple times):

**File:** `supabase/migrations/000_all_essential.sql`

This creates all tables: companies, jobs, user_lists, saved_jobs, user_profiles, job_alerts, feedback_reports, autoapply_job_queue, etc.

### Already applied:
- [x] 028_global_custom_companies.sql
- [x] 012_job_alerts.sql (partial - re-run 000_all_essential.sql to ensure complete)

---

## Test the Auto-Apply Worker

The worker couldn't connect on corporate network (SSL intercept). Test on personal machine:

```bash
cd auto-apply

# Make sure .env.local has SUPABASE_SERVICE_KEY set
# Then run:
python worker.py
```

**Expected output:**
```
[Worker] Starting auto-apply worker: worker-XXXXX
[Worker] Supabase URL: https://jmrbyubrrpxxvotsljms.supabase.co
[Worker] Poll interval: 5s
[Worker] Max concurrent jobs: 3
--------------------------------------------------
```

If it shows `Error claiming job: SSL certificate verify failed`, you're still on corporate VPN.

### Test the full flow:
1. Open the app in browser
2. Click "Auto Apply" on any job card
3. Check terminal - worker should pick it up
4. Watch browser automation happen

---

## Features to Test

### 1. Auto-Apply Queue
- [ ] Add job to queue (click Auto Apply button)
- [ ] Worker picks up and processes
- [ ] Status updates in UI (pending → processing → completed/failed)

### 2. Smart Alerts
- [ ] Save an alert with filters (working now after migration)
- [ ] Verify it appears in Settings → Alerts

### 3. Feedback Submission
- [ ] Submit a bug report from /feedback page
- [ ] Check it saves without error

### 4. My List Filtering
- [ ] Add company with filters (new modal)
- [ ] Bulk select and apply filters to multiple companies
- [ ] Search for companies (search-first UX)

### 5. Apply URLs
- [ ] Greenhouse jobs should link to `#app` anchor
- [ ] Lever jobs should link to `/apply` page
- [ ] Auto-apply should open correct URL

---

## Known Issues / Pending Fixes

### Security (should fix)
| Issue | File | Priority |
|-------|------|----------|
| SSRF vulnerability | `/api/verify-url/route.ts` | HIGH |
| SSRF vulnerability | `/api/parse-resume/route.ts` | HIGH |
| 10 unauthenticated API routes | Various | MEDIUM |
| No rate limiting | Various API routes | MEDIUM |

### Bugs Fixed (verify they work)
| Fix | File |
|-----|------|
| Alert field names (camelCase → snake_case) | `SaveAlertModal.tsx` |
| Feedback wrong table name | `send-deadline-reminder/route.ts` |
| Dark mode on saved jobs | `SavedJobCard.tsx`, `StatusDropdown.tsx` |
| Resume removal incomplete | `ProfileForm.tsx` |
| TypeScript type issues | Various (5 files) |

---

## New Components Created

| Component | Purpose |
|-----------|---------|
| `AddCompanyWithFiltersModal.tsx` | Add company + filters in one step |
| `BulkFilterModal.tsx` | Apply filters to multiple companies |
| `SearchableCompanyList.tsx` | Search-first company picker |

---

## Documentation Created

| Doc | Location |
|-----|----------|
| Architecture | `docs/ARCHITECTURE.md` (892 lines) |
| Setup Guide | `docs/SETUP.md` |
| Testing Guide | `docs/TESTING.md` |
| AI Cost Analysis | `docs/AI_COST_OPTIMIZATION.md` |
| Edge Case Tests | `tests/edge-cases.md` (38 test cases) |
| Env Example | `.env.example` |

---

## AI Cost Optimizations Added

Files modified in `auto-apply/answers/`:
- `question-classifier.ts` - LRU classification cache
- `generation-service.ts` - Batched generation, response cache
- `prompts.ts` - Token-optimized prompts (40% reduction)
- `cache.ts` - Semantic caching, prefetch manager
- `pregeneration.ts` - NEW: Off-peak bulk generation

**Estimated savings: 60-80% fewer API calls**

---

## Quick Commands

```bash
# Dev server
npm run dev

# Type check
npm run typecheck

# Start auto-apply worker
cd auto-apply && python worker.py

# Run scraper manually
cd scraper && python radar.py

# Check for TypeScript errors
npx tsc --noEmit
```

---

## Summary

1. **Set up `.env.local`** with Supabase service_role key
2. **Run `000_all_essential.sql`** in Supabase SQL Editor
3. **Test auto-apply worker** (`python worker.py`)
4. **Test features**: alerts, feedback, My List filtering
5. **Check security fixes** if deploying to production
