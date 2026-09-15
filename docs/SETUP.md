# HireRadar - Setup Guide

Complete setup guide for running the HireRadar job tracking application locally.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Supabase Setup](#supabase-setup)
4. [Database Setup (Migrations)](#database-setup-migrations)
5. [Frontend Setup (Next.js)](#frontend-setup-nextjs)
6. [Auto-Apply Worker Setup](#auto-apply-worker-setup)
7. [Scraper Setup (Optional)](#scraper-setup-optional)
8. [Common Issues & Troubleshooting](#common-issues--troubleshooting)
9. [Testing Checklist](#testing-checklist)

---

## Prerequisites

### Required Software

| Software | Version | Purpose | Install Command |
|----------|---------|---------|-----------------|
| Node.js | >= 18.0.0 | Frontend & auto-apply JS tools | [nodejs.org](https://nodejs.org) or `brew install node` |
| npm | >= 9.0.0 | Package management | Comes with Node.js |
| Python | >= 3.10 | Scraper & auto-apply worker | `brew install python@3.12` |
| Git | >= 2.0 | Version control | `brew install git` |

### Optional Software

| Software | Purpose | Install Command |
|----------|---------|-----------------|
| Supabase CLI | Local database & migrations | `npm install -g supabase` |
| Playwright | Browser automation (auto-apply) | `pip install playwright && playwright install chromium` |

### Verify Installations

```bash
node --version   # Should be >= 18.0.0
npm --version    # Should be >= 9.0.0
python3 --version # Should be >= 3.10
git --version
```

---

## Environment Variables

Create a `.env.local` file in the project root:

```bash
# /newgrad-radar/.env.local

# Required: Supabase Connection
NEXT_PUBLIC_SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# Required for scraper & auto-apply worker (service role has elevated permissions)
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Required for AI features (job classification, auto-apply answers)
GEMINI_API_KEY=your_gemini_api_key_here
```

### Where to Get These Values

| Variable | Where to Find It |
|----------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard > Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API > anon/public key |
| `SUPABASE_SERVICE_KEY` | Supabase Dashboard > Settings > API > service_role key (keep secret!) |
| `GEMINI_API_KEY` | [Google AI Studio](https://makersuite.google.com/app/apikey) > Create API Key |

### Security Notes

- Never commit `.env.local` to git (it's already in `.gitignore`)
- The `service_role` key bypasses RLS - only use it server-side
- The `anon` key is safe to expose in the browser (RLS protects data)

---

## Supabase Setup

### Option A: Use Existing Supabase Project

The project is already configured with a Supabase instance:
- **Project URL**: `https://jmrbyubrrpxxvotsljms.supabase.co`

Get credentials from the project owner and add them to `.env.local`.

### Option B: Create Your Own Supabase Project

1. **Create Account**: Go to [supabase.com](https://supabase.com) and sign up (free tier available)

2. **Create New Project**:
   - Click "New Project"
   - Choose organization
   - Name: `newgrad-radar` (or your preference)
   - Database password: (save this somewhere secure)
   - Region: Choose closest to your users

3. **Get API Keys**:
   - Go to Settings > API
   - Copy the Project URL, anon key, and service_role key
   - Add them to your `.env.local`

4. **Enable Auth Providers** (optional):
   - Go to Authentication > Providers
   - Enable Google OAuth if desired
   - Email auth is enabled by default

---

## Database Setup (Migrations)

The database schema is defined in SQL migration files located in `/supabase/migrations/`.

### Option 1: Supabase CLI (Recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref jmrbyubrrpxxvotsljms

# Push all migrations
supabase db push
```

### Option 2: SQL Editor (Manual)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Run each migration file in order:

```
001_initial.sql          # Core tables: companies, jobs, user_lists, saved_jobs
002_recruiters.sql       # Recruiter contact management
003_user_profiles.sql    # User profiles for auto-apply
004_auto_apply_enhancements.sql
005_email_variants.sql
006_analytics_resume_tracking.sql
007_application_tracking.sql
008_create_user_resumes.sql
009_job_source.sql
010_scraper_logs.sql
011_multi_dimensional_tags.sql
012_job_alerts.sql
013_recommendations.sql
014_application_pipeline.sql
015_hiring_patterns.sql
016_experience_level.sql
017_job_alerts_extended_filters.sql
018_user_lists_notifications.sql
019_user_lists_filters.sql
020_feedback_reports.sql
021_user_education.sql
022_salary_availability.sql
023_answer_generation.sql
024_answer_usage_tracking.sql
025_autoapply_job_queue.sql
026_answer_generation_queue.sql
027_add_apply_url.sql
```

### Post-Migration: Seed Data

After running migrations, seed the companies table:

```bash
# Via Supabase CLI
supabase db push --include-seed

# Or manually in SQL Editor
# Copy/paste contents of /supabase/seed.sql
```

This adds 110 target companies (FAANG, AI, Unicorns, YC, Fintech, Infra).

### Post-Migration: Storage Bucket

Create a "resumes" storage bucket for user resume uploads:

1. Go to Supabase Dashboard > Storage
2. Click "New Bucket"
3. Name: `resumes`
4. Public: No (private)
5. Add these RLS policies in SQL Editor:

```sql
-- Allow users to upload their own resumes
CREATE POLICY "Users upload own resumes"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to read their own resumes
CREATE POLICY "Users read own resumes"
ON storage.objects FOR SELECT
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## Frontend Setup (Next.js)

### Install Dependencies

```bash
cd /path/to/newgrad-radar

# Install Node.js dependencies
npm install
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (hot reload) |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

### Project Structure

```
src/
  app/                    # Next.js pages (App Router)
    page.tsx              # All Jobs (main page)
    my-list/page.tsx      # User's tracked companies
    saved/page.tsx        # Saved/applied jobs
    settings/page.tsx     # Notification preferences
    auth/                 # Login, signup, callback
    api/                  # API routes (answers, auto-apply, etc.)
  components/             # React components
  hooks/                  # Custom React hooks
  lib/                    # Supabase client, types, utilities
```

---

## Auto-Apply Worker Setup

The auto-apply system has two components:
1. **JavaScript tools** in `/auto-apply/` - Form fillers and batch processing
2. **Python worker** in `/auto-apply/v2/` - Browser automation agent

### JavaScript Auto-Apply Tools

```bash
cd auto-apply

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Run tests
npm test
```

### Python Auto-Apply Worker (browser-use agent)

```bash
cd auto-apply/v2

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Configure Worker Environment

Create `/auto-apply/v2/.env`:

```bash
# Required for the browser-use agent
GOOGLE_API_KEY=your_gemini_api_key_here

# Optional: Supabase connection for queue mode
SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
SUPABASE_KEY=your_service_role_key_here
```

### Create Your Profile

Copy the example profile and fill in your information:

```bash
cd auto-apply
cp profile.example.json profile.json
```

Edit `profile.json` with your:
- Personal information (name, email, phone)
- Education details
- Work authorization status
- Skills and experience
- Custom answers for common questions
- EEO responses (optional)

**Important**: `profile.json` is gitignored to protect your personal data.

### Run the Worker

```bash
# From auto-apply directory
./start-worker.sh

# Or manually
cd v2
source venv/bin/activate
python worker.py
```

### Worker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL` | 5 | Seconds between queue checks |
| `MAX_CONCURRENT` | 3 | Maximum parallel job applications |
| `WORKER_ID` | auto | Unique worker identifier |

---

## Scraper Setup (Optional)

The job scraper runs on GitHub Actions by default, but you can run it locally.

### Install Dependencies

```bash
cd scraper

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Environment Variables

Add to your `.env.local` or export in shell:

```bash
export SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
export SUPABASE_SERVICE_KEY=your_service_role_key
export GEMINI_API_KEY=your_gemini_key
```

### Run Scraper

```bash
cd scraper
source venv/bin/activate
python radar.py
```

---

## Common Issues & Troubleshooting

### "NEXT_PUBLIC_SUPABASE_URL is not defined"

Make sure `.env.local` exists in the project root (not in `src/`) and contains the required variables. Restart the dev server after creating it.

### "Invalid API key" from Supabase

1. Verify the key in Supabase Dashboard > Settings > API
2. Make sure there are no extra spaces or newlines in the key
3. Check you're using the right key (`anon` for frontend, `service_role` for backend)

### Migrations fail with "relation already exists"

Some migrations may conflict. Check `/docs/PENDING_MIGRATIONS.md` for known conflicts:
- 006 vs 008: Both create `user_resumes` - run one or the other
- 009 `source` column: May already exist from 001

### Playwright browser not found

```bash
# Install Playwright browsers
npx playwright install chromium

# Or for Python
playwright install chromium
```

### Python import errors in worker

Make sure you're in the virtual environment:

```bash
cd auto-apply/v2
source venv/bin/activate
python worker.py
```

### "User profile not found" in worker

The auto-apply worker requires users to have a profile in the `user_profiles` table. Create one through the UI at `/settings` or manually in the database.

### RLS policy blocks insert

The `service_role` key bypasses RLS. Make sure you're using `SUPABASE_SERVICE_KEY` (not the anon key) for scraper and worker operations.

### Port 3000 already in use

```bash
# Find and kill the process
lsof -i :3000
kill -9 <PID>

# Or use a different port
npm run dev -- -p 3001
```

---

## Testing Checklist

After completing setup, verify everything works:

### Database

- [ ] Tables exist: `companies`, `jobs`, `user_lists`, `saved_jobs`, `user_preferences`
- [ ] Companies seeded (should be ~110 companies)
- [ ] RLS policies active (check Dashboard > Authentication > Policies)
- [ ] Storage bucket `resumes` exists

### Frontend

- [ ] Homepage loads at [localhost:3000](http://localhost:3000)
- [ ] Jobs display (may be empty if no scraper run yet)
- [ ] Sign up / login works
- [ ] Logged-in pages accessible: My List, Saved, Settings

### Authentication

- [ ] Email/password signup sends confirmation email
- [ ] Login works after email confirmation
- [ ] Session persists on page refresh
- [ ] Logout clears session

### Auto-Apply (if using)

- [ ] Profile created: `auto-apply/profile.json`
- [ ] Worker starts without errors: `./start-worker.sh`
- [ ] Browser opens when processing a job

### Quick Test Commands

```bash
# Test frontend
npm run dev

# Test auto-apply JS
cd auto-apply && npm test

# Test Python worker (should say "No pending jobs" if queue is empty)
cd auto-apply/v2 && source venv/bin/activate && python worker.py
```

---

## Next Steps

1. **Browse Jobs**: Visit [localhost:3000](http://localhost:3000) to see all jobs
2. **Create Account**: Sign up to save jobs and track companies
3. **Build My List**: Add companies you're interested in
4. **Set Up Auto-Apply**: Configure your profile for automated applications
5. **Run Scraper**: Populate jobs by running the scraper or waiting for the daily cron

For more details, see:
- [Architecture Overview](ARCHITECTURE.md)
- [Database Schema](DATABASE.md)
- [Frontend Guide](FRONTEND.md)
- [Scraper Design](SCRAPER.md)
- [Migration Reference](PENDING_MIGRATIONS.md)

---

*Last updated: 2026-09-11*
