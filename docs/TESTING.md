# Testing Guide

Manual testing checklist for the HireRadar job tracking application.

## Prerequisites

Before testing, ensure:
- Local dev server running: `npm run dev`
- Supabase connection working (check `.env.local` has correct keys)
- Browser devtools open for debugging

---

## 1. Manual Testing Checklist

### Core Pages Load Test

| Page | URL | Expected Behavior |
|------|-----|-------------------|
| Home | `/` | Job listings load, filters visible |
| Saved Jobs | `/saved` | Requires login redirect or shows jobs |
| My List | `/my-list` | Requires login redirect or shows companies |
| Applications | `/applications` | Requires login redirect or shows queue |
| Settings | `/settings` | Shows preferences form |
| Login | `/auth/login` | Shows login form |
| Signup | `/auth/signup` | Shows signup form |
| Pipeline | `/pipeline` | Shows application pipeline board |
| Analytics | `/analytics` | Shows job search analytics |

### Quick Smoke Test (2 minutes)

1. Open `/` - verify jobs appear
2. Search for "software" - verify results filter
3. Click a tier filter (e.g., "AI") - verify jobs filter
4. Click a job card - verify details expand or link works
5. Click "Save" on a job (should redirect to login if not authenticated)

---

## 2. Auth Flow Testing

### Sign Up Flow

1. Navigate to `/auth/signup`
2. Enter email: `test+{timestamp}@example.com`
3. Enter password (min 6 characters)
4. Click "Sign Up"
5. **Expected**: Redirect to email confirmation page or auto-login

**Edge Cases:**
- [ ] Invalid email format shows error
- [ ] Password too short shows error
- [ ] Duplicate email shows error
- [ ] Empty fields show validation errors

### Login Flow

1. Navigate to `/auth/login`
2. Enter valid credentials
3. Click "Sign In"
4. **Expected**: Redirect to home page, user email visible in nav

**Edge Cases:**
- [ ] Wrong password shows error (not "user not found")
- [ ] Non-existent email shows appropriate error
- [ ] Session persists on page refresh
- [ ] Session persists across tabs

### Logout Flow

1. While logged in, click profile/logout
2. **Expected**: Redirect to home, protected pages redirect to login

### Auth Callback Testing

1. After email verification, `/auth/callback` should handle redirect
2. **Expected**: User session established, redirect to home or intended page

### Protected Routes

Test these pages while logged out - all should redirect to `/auth/login`:
- `/saved`
- `/my-list`
- `/applications`
- `/settings`
- `/settings/profile`
- `/settings/resume`
- `/pipeline`

---

## 3. Job Listing and Filtering Test Cases

### Basic Filtering

| Filter | Test | Expected Result |
|--------|------|-----------------|
| Search | Type "engineer" | Only jobs with "engineer" in title/company show |
| Tier: FAANG | Click FAANG filter | Only Meta, Apple, Amazon, Netflix, Google, Microsoft, Nvidia jobs |
| Tier: AI | Click AI filter | Only AI companies (Anthropic, OpenAI, etc.) |
| Role: SWE | Click SWE filter | Only software engineer roles |
| Role: ML | Click ML filter | Only ML/AI roles |
| Sponsorship | Click "Sponsors Visa" | Only jobs that sponsor |
| Remote | Click "Remote" | Only remote-eligible jobs |

### Smart Filters

| Filter | Test | Expected |
|--------|------|----------|
| Hidden Gems | Enable | Jobs not from LinkedIn/Indeed |
| Hot Now | Enable | Jobs posted in last 3 days |
| New Grad Only | Enable | Jobs with new_grad experience level |
| Closing Soon | Enable | Jobs with deadlines within 7 days |
| High Paying | Enable | Jobs with salary >= $150k |

### Filter Combinations

1. Select FAANG tier + SWE role
2. **Expected**: Only SWE jobs at FAANG companies
3. Add "Remote" filter
4. **Expected**: Further filtered to remote only

### Clear Filters

1. Apply multiple filters
2. Click "Clear" or "Clear All"
3. **Expected**: All jobs reappear, filter states reset

### Pagination

1. Scroll to bottom of job list
2. Click "Load More"
3. **Expected**: More jobs append to list
4. Verify no duplicates appear

---

## 4. Auto-Apply Queue Testing

### Prerequisites
- User must be logged in
- User profile must be configured at `/settings/profile`

### Queue an Application

1. Find a job card with "Auto Apply" button
2. Click "Auto Apply"
3. **Expected**:
   - Toast: "Auto-apply started for [Company]"
   - Job URL opens in new tab
   - Application appears in `/applications` page

### Check Queue Status

1. Navigate to `/applications`
2. **Expected statuses**:
   - `pending` - Waiting in queue
   - `filling` - Agent is filling form
   - `review` - Ready for manual review
   - `submitted` - Successfully submitted
   - `failed` - Error occurred

### Cancel Pending Application

1. In `/applications`, find a pending application
2. Click the X/cancel button
3. **Expected**: Application removed from queue

### Retry Failed Application

1. Find a failed application
2. Click "Retry" or view error details
3. Click "Add to retry queue"
4. **Expected**: Application moves to "Retrying" tab

### Retry Tab

1. Navigate to `/applications`
2. Click "Retrying" tab
3. **Expected**:
   - Shows pending retries with countdown
   - Shows retry count (e.g., "2/3 retries")
   - Error type badge (network, timeout, captcha, etc.)
4. Click "Retry Now" for manual immediate retry
5. Click "Cancel" to stop retry attempts

---

## 5. My List Functionality Testing

### Add Company to List

1. Navigate to `/my-list`
2. Click "Add Companies" tab
3. Search for a company (e.g., "Stripe")
4. Click the + button to add
5. **Expected**: Company moves to "My Companies" tab

### Remove Company from List

1. In "My Companies" tab, find a tracked company
2. Click the - or remove button
3. **Expected**: Company removed, moves back to "Add Companies"

### Add Custom Company

1. Click "+ Add Custom" button
2. Enter company name, careers URL, tier
3. Click Submit
4. **Expected**:
   - URL validation runs
   - Company name verification runs
   - Company added to list

### Enable Auto-Apply per Company

1. In "My Companies", find a company card
2. Toggle "Auto-Apply" switch
3. **Expected**: Switch enables, persists on refresh

### Enable Notifications per Company

1. Toggle "Notify" switch on a company card
2. **Expected**: Notifications enabled for that company

### Enable All Auto-Apply/Notifications

1. Click "Enable All" for auto-apply
2. **Expected**: All companies have auto-apply enabled
3. Click "Enable All" for notifications
4. **Expected**: All companies have notifications enabled

### Company Job Filters

1. Click filter icon on a company card
2. Set role filters (e.g., only SWE roles)
3. Save
4. **Expected**: Filters saved, notification badge shows filter active

---

## 6. Saved Jobs Testing

### Save a Job

1. On home page, click bookmark/save icon on any job
2. **Expected**: Icon fills/highlights
3. Navigate to `/saved`
4. **Expected**: Job appears in list

### Unsave a Job

1. On home page or `/saved`, click bookmark icon on saved job
2. **Expected**: Icon unfills, job removed from saved

### Change Job Status

1. In `/saved`, find a saved job
2. Click status dropdown
3. Select "Applied"
4. **Expected**: Status badge changes, applied_at timestamp set

Test all statuses:
- [ ] Saved -> Applied
- [ ] Applied -> Interviewing
- [ ] Interviewing -> Offer
- [ ] Interviewing -> Rejected

### Add Notes to Job

1. In `/saved`, click to expand job details
2. Add notes in text field
3. Click save/blur
4. **Expected**: Notes persist on refresh

### Remove Saved Job

1. Click remove/trash icon on saved job
2. **Expected**: Job removed from list

### Filter by Status

1. Click status tabs (All, Applied, Interviewing, etc.)
2. **Expected**: List filters to show only jobs with that status

### Deadline Tab

1. Click "Deadlines" tab
2. **Expected**: Shows jobs with deadlines, sorted soonest first
3. Jobs closing soon (< 7 days) should have warning indicator

---

## 7. Edge Cases to Watch

### Network & Loading

- [ ] Slow network: Loading spinners appear
- [ ] Network error: Error message displays
- [ ] Offline: Appropriate error handling

### Empty States

- [ ] No jobs match filter: "No results" message shows
- [ ] No saved jobs: Empty state with CTA
- [ ] No tracked companies: Empty state with CTA
- [ ] No applications: Empty state with instructions

### Concurrent Updates

- [ ] Save job in two tabs: Both update correctly
- [ ] Real-time job updates appear without refresh

### Data Validation

- [ ] Long job titles truncate properly
- [ ] Missing company logos show fallback
- [ ] Invalid URLs don't crash the app
- [ ] Null salary values display as "Not specified"

### Authentication Edge Cases

- [ ] Token expiry: Auto-refresh or redirect to login
- [ ] Corrupted session: Handle gracefully
- [ ] Multiple tabs with different users: Handle correctly

### Mobile Responsiveness

- [ ] Filter panel becomes modal/drawer on mobile
- [ ] Job cards stack vertically
- [ ] Touch targets are appropriately sized
- [ ] Swipe gestures work (if implemented)

---

## 8. How to Test the Scraper

### Local Scraper Test (Dry Run)

```bash
cd scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Dry run - no database writes
python radar.py --dry-run
```

**Expected Output:**
- List of jobs found from each source
- Classification results
- No actual database writes

### Test Individual Sources

```python
# In Python REPL or test script
from sources import greenhouse, lever, ashby

# Test Greenhouse
jobs = greenhouse.fetch_greenhouse_jobs("anthropic")
print(f"Found {len(jobs)} jobs from Anthropic")

# Test Lever
jobs = lever.fetch_lever_jobs("netflix")
print(f"Found {len(jobs)} jobs from Netflix")

# Test Ashby
jobs = ashby.fetch_ashby_jobs("supabase")
print(f"Found {len(jobs)} jobs from Supabase")
```

### Test Simplify API

```python
from sources import simplify
jobs = simplify.fetch_simplify_jobs()
print(f"Found {len(jobs)} jobs from Simplify")
```

### Test Job Classification

```python
from classifier import classify_jobs, detect_role_types

test_jobs = [
    {"title": "Software Engineer - New Grad", "company_name": "Stripe"},
    {"title": "Machine Learning Engineer", "company_name": "OpenAI"},
    {"title": "Senior Backend Engineer", "company_name": "Meta"},
]

# Detect role types
for job in test_jobs:
    roles = detect_role_types(job["title"])
    print(f"{job['title']}: {roles}")
```

### Full Scraper Run (Development)

```bash
# With database writes (use dev database)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python radar.py
```

### Scraper Monitoring

Check scraper logs for:
- Jobs fetched per source
- Classification accuracy
- Database upsert counts
- Error rates by source
- Rate limit warnings

---

## 9. Database Verification Queries

Run these in Supabase SQL Editor or via CLI.

### Check Job Counts by Tier

```sql
SELECT tier, COUNT(*) as count
FROM jobs
WHERE is_active = true
GROUP BY tier
ORDER BY count DESC;
```

### Check Recent Jobs

```sql
SELECT title, company_name, tier, source, posted
FROM jobs
WHERE is_active = true
ORDER BY posted DESC NULLS LAST
LIMIT 20;
```

### Check Jobs by Source

```sql
SELECT source, COUNT(*) as count
FROM jobs
WHERE is_active = true
GROUP BY source
ORDER BY count DESC;
```

### Verify User Data

```sql
-- Check user's saved jobs
SELECT j.title, j.company_name, sj.status, sj.created_at
FROM saved_jobs sj
JOIN jobs j ON sj.job_id = j.id
WHERE sj.user_id = 'YOUR_USER_ID'
ORDER BY sj.created_at DESC;

-- Check user's tracked companies
SELECT c.name, c.tier, ul.auto_apply, ul.notify_enabled
FROM user_lists ul
JOIN companies c ON ul.company_slug = c.slug
WHERE ul.user_id = 'YOUR_USER_ID';

-- Check application queue
SELECT q.*, j.title, j.company_name
FROM autoapply_job_queue q
JOIN jobs j ON q.job_id = j.id
WHERE q.user_id = 'YOUR_USER_ID'
ORDER BY q.created_at DESC;
```

### Check Application Logs

```sql
SELECT al.status, al.ats_type, al.error_message, j.title, j.company_name
FROM application_logs al
JOIN jobs j ON al.job_id = j.id
WHERE al.user_id = 'YOUR_USER_ID'
ORDER BY al.created_at DESC;
```

### Check Stale Jobs (Inactive)

```sql
SELECT title, company_name, posted, updated_at
FROM jobs
WHERE is_active = false
ORDER BY updated_at DESC
LIMIT 20;
```

### Verify Company Data

```sql
SELECT name, tier, ats_type, funding_stage
FROM companies
ORDER BY tier, name
LIMIT 50;
```

---

## 10. Common Failure Modes and Diagnosis

### Frontend Issues

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| Blank page | JS error | Check browser console |
| Jobs not loading | API error or auth issue | Check Network tab, look for 401/500 |
| Filters not working | State management bug | Check React DevTools state |
| Infinite loading | Supabase timeout | Check Supabase dashboard for errors |
| Save not persisting | Auth token expired | Check for 401 in Network tab |

### Auth Issues

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| Can't log in | Wrong credentials or Supabase issue | Check Supabase Auth logs |
| Session disappears | Token expiry not handled | Check localStorage for `sb-*` keys |
| Redirect loop | Auth callback misconfigured | Check `/auth/callback` route |
| "Unauthorized" errors | Missing or invalid token | Check request headers in Network tab |

### Scraper Issues

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| No jobs fetched | Rate limiting or API change | Check response status codes |
| Duplicate jobs | ID generation issue | Check job_id uniqueness logic |
| Wrong classification | ML model drift | Review classification samples |
| Database timeout | Too many concurrent writes | Check batch sizes |
| Missing companies | Seed data not run | Run `seed.sql` |

### Auto-Apply Issues

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| Queue stuck on "pending" | Worker not running | Check `worker.py` process |
| "Profile not found" | Missing user_profiles record | Check `/settings/profile` |
| Application fails immediately | Invalid job URL | Verify job.apply_url is valid |
| Captcha errors | Anti-bot detection | Check error_type in logs |
| Network errors | Transient failure | Should auto-retry |

### Database Issues

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| Missing tables | Migration not run | Check Supabase migrations |
| RLS errors | Policy misconfiguration | Check Supabase RLS policies |
| Constraint violations | Invalid data | Check specific constraint name |
| Slow queries | Missing indexes | Check query plan with EXPLAIN |

---

## Debugging Commands

### Check Server Logs

```bash
# Next.js dev server
npm run dev 2>&1 | tee /tmp/nextjs.log

# Scraper logs
python radar.py 2>&1 | tee /tmp/scraper.log

# Auto-apply worker
python worker.py 2>&1 | tee /tmp/worker.log
```

### Check Supabase Connection

```bash
# From scraper directory
python -c "from db import get_client; c = get_client(); print(c.table('jobs').select('id').limit(1).execute())"
```

### Verify Environment Variables

```bash
# Check frontend env
cat .env.local | grep SUPABASE

# Check scraper env
env | grep SUPABASE
```

### Reset Local State

```bash
# Clear Next.js cache
rm -rf .next

# Clear node modules (if weird issues)
rm -rf node_modules && npm install
```

---

## Test Data Setup

### Create Test User

1. Sign up with `test@example.com`
2. Verify email (check Supabase Auth dashboard)
3. Note the user ID for query testing

### Seed Test Jobs (if database empty)

```bash
cd supabase
psql $DATABASE_URL -f seed.sql
```

### Create Test Application

1. Log in as test user
2. Save a job from the home page
3. Click "Auto Apply" on that job
4. Verify it appears in `/applications`

---

## Performance Checklist

- [ ] Home page loads in < 2 seconds
- [ ] Filters apply in < 500ms
- [ ] Pagination loads in < 1 second
- [ ] Real-time updates arrive within 2 seconds
- [ ] No memory leaks on long sessions (check devtools Memory tab)
