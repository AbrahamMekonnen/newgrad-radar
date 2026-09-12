# Architecture Overview

NewGrad Radar is a full-stack job tracking and auto-apply application designed for new graduate software engineers. It combines a Next.js frontend, Supabase backend, Python scraper, and an AI-powered auto-apply agent.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Directory Structure](#directory-structure)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [Database Schema](#database-schema)
6. [Authentication Flow](#authentication-flow)
7. [Auto-Apply System](#auto-apply-system)
8. [Scraper System](#scraper-system)
9. [Data Flow Diagrams](#data-flow-diagrams)
10. [Key Libraries](#key-libraries)

---

## High-Level Architecture

```
+-----------------------------------------------------------------------------------+
|                                    USERS                                          |
|            Sign up -> Build "My List" -> Browse jobs -> Auto-Apply                |
+-------------------------------------+---------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|                         FRONTEND (Vercel / Next.js 16)                            |
|                     React 19 + Tailwind + TypeScript + App Router                 |
+-----------------------------------------------------------------------------------+
|  +-------------+  +-----------+  +------------+  +---------+  +----------+        |
|  | Home (Jobs) |  | My List   |  | Saved/     |  | Pipeline|  | Settings |        |
|  | /           |  | /my-list  |  | Applications|  | /pipeline| | /settings|        |
|  +-------------+  +-----------+  +------------+  +---------+  +----------+        |
|                                                                                   |
|  Components: JobCard, JobFilters, Navbar, AutoApply, Profile, Alerts              |
|  Hooks: useStreak, useSupabaseRealtime, useOptimisticJobs, useAutoApplyProgress   |
+-------------------------------------+---------------------------------------------+
                                      |
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
+--------------------------------+          +--------------------------------+
|      NEXT.JS API ROUTES        |          |         SUPABASE               |
|      /api/*                    |          |   PostgreSQL + Auth + RLS      |
+--------------------------------+          +--------------------------------+
|  /api/auto-apply      - Queue  |          |  Tables:                       |
|  /api/answers         - AI Gen |          |    - jobs (scraped positions)  |
|  /api/applications    - Track  |          |    - companies (110+ targets)  |
|  /api/find-recruiters - Enrich |          |    - user_lists (my list)      |
|  /api/parse-resume    - PDF    |          |    - saved_jobs (applications) |
|  /api/tweak-resume    - AI     |          |    - user_profiles (auto-apply)|
|  /api/detect-deadline - AI     |          |    - autoapply_job_queue       |
|  /api/enrich-company  - Data   |          |    - recruiters                |
+--------------------------------+          |    - job_alerts                |
                                            |    - hiring_patterns           |
                                            +--------------------------------+
                                                          ^
                                                          |
                 +----------------------------------------+
                 |
+--------------------------------+          +--------------------------------+
|       PYTHON SCRAPER           |          |      AUTO-APPLY WORKER         |
|   GitHub Actions (Daily Cron)  |          |   Python + browser-use Agent   |
+--------------------------------+          +--------------------------------+
|  Sources:                      |          |  1. Poll autoapply_job_queue   |
|    - Greenhouse, Lever, Ashby  |          |  2. Claim job (atomic lock)    |
|    - Workday (Fortune 500)     |          |  3. Load user profile          |
|    - SimplifyJobs GitHub       |          |  4. browser-use + Gemini       |
|    - HN Hiring, RemoteOK       |          |  5. Fill forms intelligently   |
|    - USAJobs, Adzuna           |          |  6. Submit & record result     |
|    - VC Portfolio boards       |          |  7. Update queue status        |
|    - Conference/Hackathon      |          +--------------------------------+
|    - Newsletters               |
|    - Custom deep crawler       |
+--------------------------------+
                 |
                 v
+-----------------------------------------------------------------------------------+
|                              NOTIFICATIONS                                        |
+-----------------------------------------------------------------------------------+
|  Channels:                                                                        |
|    - ntfy.sh (push to phone - free, instant)                                     |
|    - Email (Resend - daily/weekly digest)                                         |
|  Modes: instant | daily_digest | weekly_digest                                   |
|  Scope: all jobs | my_list only | custom alerts                                   |
+-----------------------------------------------------------------------------------+
```

---

## Directory Structure

```
newgrad-radar/
|
+-- src/                          # Next.js application
|   +-- app/                      # App Router pages and API routes
|   |   +-- page.tsx              # Home page (All Jobs)
|   |   +-- my-list/              # User's tracked companies
|   |   +-- saved/                # Saved/applied jobs
|   |   +-- applications/         # Application tracking board
|   |   +-- pipeline/             # Kanban board view
|   |   +-- analytics/            # Application analytics
|   |   +-- settings/             # User settings
|   |   |   +-- profile/          # Auto-apply profile
|   |   |   +-- resume/           # Resume management
|   |   |   +-- alerts/           # Job alert configuration
|   |   |   +-- answers/          # Pre-filled answer bank
|   |   +-- auth/                 # Authentication pages
|   |   |   +-- login/
|   |   |   +-- signup/
|   |   |   +-- callback/         # OAuth callback handler
|   |   +-- api/                  # API route handlers
|   |       +-- auto-apply/       # Queue job for auto-apply
|   |       +-- answers/          # Answer generation & management
|   |       +-- applications/     # Application CRUD
|   |       +-- find-recruiters/  # Recruiter discovery
|   |       +-- parse-resume/     # PDF parsing with AI
|   |       +-- tweak-resume/     # AI resume optimization
|   |       +-- detect-deadline/  # AI deadline extraction
|   |       +-- detect-sponsorship/
|   |       +-- enrich-company/   # Company data enrichment
|   |       +-- salary-lookup/    # Salary data lookup
|   |       +-- log-application/  # Log manual applications
|   |       +-- send-deadline-reminder/
|   |       +-- verify-company/
|   |       +-- verify-url/
|   |
|   +-- components/               # React components
|   |   +-- ui/                   # Base UI components
|   |   +-- jobs/                 # Job listing components
|   |   +-- autoapply/            # Auto-apply components
|   |   +-- companies/            # Company management
|   |   +-- pipeline/             # Kanban board
|   |   +-- alerts/               # Job alerts
|   |   +-- recruiters/           # Recruiter cards
|   |   +-- dashboard/            # Home page sections
|   |   +-- resume/               # Resume tweaking
|   |   +-- profile/              # Profile wizard
|   |   +-- layout/               # Navbar, mobile nav
|   |   +-- auth/                 # Auth forms
|   |   +-- theme/                # Dark/light mode
|   |
|   +-- hooks/                    # Custom React hooks
|   |   +-- useStreak.ts          # Application streak tracking
|   |   +-- useSupabaseRealtime.ts # Real-time job updates
|   |   +-- useOptimisticJobs.ts  # Optimistic UI updates
|   |   +-- useAutoApplyProgress.ts
|   |   +-- useJobFilterCounts.ts
|   |   +-- useAnswerQueue.ts
|   |   +-- useProfileValidation.ts
|   |   +-- useMilestones.ts
|   |   +-- useRecentlyViewed.ts
|   |   +-- useAnimatedNumber.ts
|   |
|   +-- lib/                      # Utilities and services
|   |   +-- supabase/             # Supabase client setup
|   |   |   +-- client.ts         # Browser client
|   |   |   +-- server.ts         # Server-side client
|   |   +-- types.ts              # TypeScript type definitions
|   |   +-- ats-registry.ts       # ATS detection & field mapping
|   |   +-- autoapply-queue.ts    # Queue retry logic
|   |   +-- autoapply-queue-v2.ts # Enhanced queue management
|   |   +-- autoapply-tracker.ts  # Application status tracking
|   |   +-- answer-scheduler.ts   # Answer generation scheduling
|   |   +-- company-enricher.ts   # Company data enrichment
|   |   +-- deadline-detector.ts  # AI deadline extraction
|   |   +-- sponsorship-detector.ts
|   |   +-- resume-scorer.ts      # Resume-job matching
|   |   +-- resume-templates.ts
|   |   +-- salary-data.ts        # Salary ranges database
|   |   +-- salary-sources.ts
|   |   +-- job-badges.ts         # Badge computation
|   |   +-- profile-validator/    # Profile validation
|   |   +-- time-utils.ts
|   |   +-- utils.ts
|   |
|   +-- middleware.ts             # Auth middleware for protected routes
|
+-- scraper/                      # Python job scraper
|   +-- radar.py                  # Main entry point
|   +-- db.py                     # Supabase client
|   +-- classifier.py             # AI job classification (Gemini)
|   +-- alerts.py                 # Alert processing
|   +-- notify.py                 # Push notifications
|   +-- email_notify.py           # Email notifications
|   +-- companies.py              # Company definitions
|   +-- sources/                  # ATS adapters
|   |   +-- greenhouse.py
|   |   +-- lever.py
|   |   +-- ashby.py
|   |   +-- workday.py
|   |   +-- simplify.py
|   |   +-- hn_hiring.py
|   |   +-- remoteok.py
|   |   +-- usajobs.py
|   |   +-- adzuna.py
|   |   +-- vc_portfolios.py
|   |   +-- conferences.py
|   |   +-- hackathons.py
|   |   +-- bootcamps.py
|   |   +-- github_repos.py
|   |   +-- newsletters.py
|   |   +-- h1b_data.py
|   |   +-- funding_signals.py
|   |   +-- deep_crawler.py
|   |   +-- other_ats.py          # SmartRecruiters, iCIMS, etc.
|   +-- recruiters/               # Recruiter discovery
|   |   +-- enricher.py
|   |   +-- email_patterns.py
|   |   +-- smtp_verify.py
|   +-- events/                   # Career fairs, hackathons
|   +-- monitoring/               # Source health tracking
|   +-- autoapply/                # Legacy auto-apply (deprecated)
|
+-- auto-apply/                   # Auto-apply worker system
|   +-- worker.py                 # Queue worker (polls & processes)
|   +-- v2/                       # Current agent implementation
|   |   +-- agent.py              # browser-use + Gemini agent
|   |   +-- custom-actions.py     # Custom browser actions
|   +-- answers/                  # Answer generation modules
|   +-- fillers/                  # ATS-specific form fillers
|   +-- utils/                    # Shared utilities
|   +-- config.js                 # Configuration
|   +-- batch-apply.js            # Batch application processing
|   +-- profile.json              # User profile template
|   +-- profile.eeo.example.json  # EEO responses template
|
+-- supabase/                     # Database schema
|   +-- migrations/               # 27 migration files
|   +-- seed.sql                  # Initial company data (110 companies)
|
+-- docs/                         # Documentation
|   +-- ARCHITECTURE.md           # This file
|   +-- DATABASE.md               # Schema documentation
|   +-- FRONTEND.md               # Component guide
|   +-- SCRAPER.md                # Scraper documentation
|   +-- COMPANIES.md              # Target company list
|
+-- public/                       # Static assets
+-- .github/workflows/            # GitHub Actions (scraper cron)
```

---

## Frontend Architecture

### App Router Structure

The application uses Next.js 16 App Router with the following page structure:

| Route | Component | Auth Required | Description |
|-------|-----------|---------------|-------------|
| `/` | `page.tsx` | No | Main job board with filters |
| `/my-list` | `my-list/page.tsx` | Yes | User's tracked companies |
| `/saved` | `saved/page.tsx` | Yes | Saved jobs list |
| `/applications` | `applications/page.tsx` | Yes | Application tracker |
| `/pipeline` | `pipeline/page.tsx` | Yes | Kanban board view |
| `/analytics` | `analytics/page.tsx` | Yes | Application analytics |
| `/settings` | `settings/page.tsx` | Yes | Main settings |
| `/settings/profile` | `settings/profile/page.tsx` | Yes | Auto-apply profile |
| `/settings/resume` | `settings/resume/page.tsx` | Yes | Resume management |
| `/settings/alerts` | `settings/alerts/page.tsx` | Yes | Job alerts |
| `/settings/answers` | `settings/answers/page.tsx` | Yes | Answer bank |
| `/auth/login` | `auth/login/page.tsx` | No | Login page |
| `/auth/signup` | `auth/signup/page.tsx` | No | Signup page |

### Component Hierarchy

```
Layout (layout.tsx)
|-- Navbar
|   |-- Logo
|   |-- NavigationLinks
|   |-- ThemeToggle
|   |-- NotificationBell
|   |-- AuthButton
|
+-- Page Content
    |
    +-- HomePage (/)
    |   |-- HeroSection (stats, streak)
    |   |-- TrendingSection (hot companies)
    |   |-- StatsCards
    |   |-- NewJobsBanner (real-time)
    |   |-- JobFilters / SmartFilters
    |   |-- JobList
    |       |-- JobCard (x many)
    |           |-- AutoApplyButton
    |           |-- SaveButton
    |           |-- RecruiterList
    |
    +-- MyListPage (/my-list)
    |   |-- CompanyGrid
    |   |   |-- CompanyCard (x many)
    |   |-- AddCompanyModal
    |   |-- CompanyFilterModal
    |
    +-- SavedPage (/saved)
    |   |-- SavedJobCard (x many)
    |       |-- StatusDropdown
    |       |-- NotesModal
    |
    +-- PipelinePage (/pipeline)
    |   |-- KanbanBoard
    |   |   |-- KanbanColumn (x 5: saved, applied, interviewing, etc.)
    |   |       |-- ApplicationCard (x many)
    |   |-- ApplicationTimeline
    |   |-- PipelineStats
    |
    +-- SettingsPage (/settings/profile)
        |-- ProfileForm
        |-- StoryBankWizard
        |-- ProfileCompleteness
        |-- ProfileGapsAlert
```

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useSupabaseRealtime` | Subscribes to real-time job updates, tracks connection status |
| `useOptimisticJobs` | Provides optimistic UI updates for save/unsave actions |
| `useStreak` | Tracks user's daily application streak |
| `useAutoApplyProgress` | Monitors auto-apply queue progress in real-time |
| `useJobFilterCounts` | Real-time filter counts for UI badges |
| `useMilestones` | Tracks application milestones (10, 50, 100 apps) |
| `useRecentlyViewed` | Tracks recently viewed jobs/searches |
| `useAnswerQueue` | Manages answer generation queue |
| `useProfileValidation` | Validates profile completeness for auto-apply |

### State Management

The application uses React's built-in state management:

- **Local State**: `useState` for component-level state
- **Derived State**: Computed from Supabase queries
- **Real-time State**: Supabase Realtime subscriptions
- **Optimistic Updates**: Custom hook for immediate UI feedback

No external state management library (Redux, Zustand) is used.

---

## Backend Architecture

### API Routes

The Next.js API routes serve as the backend, handling complex operations that require server-side execution:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auto-apply` | POST | Queue a job for auto-apply |
| `/api/auto-apply` | GET | Get user's queue status |
| `/api/answers` | GET/POST | Manage answer bank |
| `/api/answers/generate` | POST | Generate AI answers |
| `/api/answers/queue` | GET | Get answer generation queue |
| `/api/applications` | GET/POST | Application CRUD |
| `/api/applications/[id]/stage` | PATCH | Update application stage |
| `/api/find-recruiters` | POST | Discover recruiters for job |
| `/api/parse-resume` | POST | Extract data from PDF resume |
| `/api/tweak-resume` | POST | AI-optimize resume for job |
| `/api/detect-deadline` | POST | Extract deadline from job posting |
| `/api/detect-sponsorship` | POST | Detect visa sponsorship status |
| `/api/enrich-company` | POST | Enrich company data |
| `/api/salary-lookup` | POST | Lookup salary ranges |
| `/api/log-application` | POST | Log manual application |
| `/api/feedback` | POST | Submit user feedback |
| `/api/history/[company]` | GET | Get company hiring history |
| `/api/verify-company` | POST | Verify company legitimacy |
| `/api/verify-url` | POST | Verify job URL is valid |

### Supabase Integration

```typescript
// Client-side (src/lib/supabase/client.ts)
import { createBrowserClient } from '@supabase/ssr';
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server-side (src/lib/supabase/server.ts)
import { createServerClient } from '@supabase/ssr';
export async function createClient() {
  // Uses cookies for session management
  return createServerClient(...);
}
```

### Row Level Security (RLS)

All user data is protected by Supabase RLS policies:

- **Public tables** (`jobs`, `companies`): Read-only for all
- **User tables** (`user_lists`, `saved_jobs`, `user_profiles`): Users can only access their own data
- **Service role**: Scraper uses service key for write operations

---

## Database Schema

### Core Tables

```
+-------------------+       +-------------------+       +-------------------+
|     companies     |       |       jobs        |       |    user_lists     |
+-------------------+       +-------------------+       +-------------------+
| slug (PK)         |<------| company_slug (FK) |       | id (PK)           |
| name              |       | id (PK)           |<------| job_id (FK)       |
| tier              |       | title             |       | user_id (FK)      |
| ats_type          |       | location          |       | company_slug (FK) |
| ats_token         |       | url               |       | auto_apply        |
| logo_url          |       | apply_url         |       | notify_enabled    |
| careers_url       |       | role_types[]      |       | notify_mode       |
| funding_stage     |       | source            |       | job_filters (JSON)|
| company_size      |       | posted            |       +-------------------+
| industry          |       | deadline          |
| founded_year      |       | is_active         |       +-------------------+
| headquarters      |       | salary_min/max    |       |    saved_jobs     |
| description       |       | sponsorship_status|       +-------------------+
| stock_ticker      |       | discovery_sources |       | id (PK)           |
| enriched_at       |       | diversity_tags[]  |       | user_id (FK)      |
+-------------------+       | work_modes[]      |       | job_id (FK)       |
                            | badges[]          |       | status            |
                            | experience_level  |       | notes             |
                            +-------------------+       | applied_at        |
                                                        +-------------------+
```

### Auto-Apply Tables

```
+------------------------+       +------------------------+
| autoapply_job_queue    |       |   user_profiles        |
+------------------------+       +------------------------+
| id (PK)                |       | user_id (PK, FK)       |
| user_id (FK)           |       | first_name, last_name  |
| job_id (FK)            |       | email, phone           |
| job_title              |       | linkedin_url           |
| company_slug           |       | github_url             |
| job_url                |       | portfolio_url          |
| ats_type               |       | resume_url             |
| priority (1-5)         |       | location               |
| status                 |       | work_authorization     |
| attempts / max_attempts|       | requires_sponsorship   |
| last_error             |       | willing_to_relocate    |
| error_type             |       | education (JSON)       |
| scheduled_at           |       | experience (JSON)      |
| locked_until           |       | skills[]               |
| answers (JSON)         |       | interests[]            |
| confirmation_id        |       | goals[]                |
| result (JSON)          |       | strengths[]            |
+------------------------+       | highlights[]           |
                                 | eeo_responses (JSON)   |
+------------------------+       | standard_answers (JSON)|
|   application_logs     |       +------------------------+
+------------------------+
| id (PK)                |       +------------------------+
| user_id (FK)           |       |      recruiters        |
| job_id (FK)            |       +------------------------+
| status                 |       | id (PK)                |
| ats_type               |       | job_id (FK)            |
| fields_filled (JSON)   |       | company_slug (FK)      |
| fields_failed (JSON)   |       | name                   |
| custom_questions (JSON)|       | title                  |
| duration_ms            |       | email                  |
| error_category         |       | email_verified         |
| screenshot_url         |       | email_variants (JSON)  |
| submitted_at           |       | linkedin_url           |
+------------------------+       | source                 |
                                 | upvotes / downvotes    |
                                 +------------------------+
```

### Additional Tables

| Table | Purpose |
|-------|---------|
| `user_preferences` | Notification settings, role filters |
| `job_alerts` | Custom alert configurations |
| `hiring_patterns` | Historical hiring data for predictions |
| `user_resumes` | Stored resume versions |
| `answer_bank` | Pre-filled answers for common questions |
| `answer_generation_queue` | Queue for AI answer generation |
| `user_story_bank` | STAR stories for behavioral questions |
| `ats_field_stats` | Selector success rates per ATS |
| `failure_patterns` | Common failure patterns for learning |
| `scraper_logs` | Scraper run history |
| `feedback_reports` | User feedback submissions |

---

## Authentication Flow

```
User Browser                 Next.js Middleware            Supabase Auth
     |                              |                           |
     |  1. Visit /my-list           |                           |
     |----------------------------->|                           |
     |                              |                           |
     |                              |  2. Check session cookie  |
     |                              |-------------------------->|
     |                              |                           |
     |                              |  3. No valid session      |
     |                              |<--------------------------|
     |                              |                           |
     |  4. Redirect to /auth/login  |                           |
     |     with ?redirect=/my-list  |                           |
     |<-----------------------------|                           |
     |                              |                           |
     |  5. User submits credentials |                           |
     |----------------------------->|                           |
     |                              |                           |
     |                              |  6. signInWithPassword()  |
     |                              |-------------------------->|
     |                              |                           |
     |                              |  7. Session + JWT         |
     |                              |<--------------------------|
     |                              |                           |
     |  8. Set session cookie       |                           |
     |  9. Redirect to /my-list     |                           |
     |<-----------------------------|                           |
```

### Protected Routes

Defined in `src/middleware.ts`:

```typescript
const protectedRoutes = ['/my-list', '/saved', '/settings'];
// Also: /applications, /pipeline, /analytics
```

### Auth Methods Supported

- Email/password
- Google OAuth
- Magic links (email)

---

## Auto-Apply System

### Architecture Overview

```
+------------------+     +-------------------+     +------------------+
|   Frontend       |     |  Next.js API      |     |   Supabase       |
|   AutoApplyBtn   |---->|  /api/auto-apply  |---->|  autoapply_      |
|                  |     |                   |     |  job_queue       |
+------------------+     +-------------------+     +--------+---------+
                                                           |
                                                           | PostgreSQL
                                                           | Queue
                                                           |
+------------------+     +-------------------+     +--------v---------+
|   browser-use    |<----|  worker.py        |<----|   claim_         |
|   + Gemini AI    |     |  (polls queue)    |     |   autoapply_job  |
+------------------+     +-------------------+     +------------------+
        |                        |
        | Fill forms             | Update status
        | intelligently          |
        v                        v
+------------------+     +-------------------+
|   Job ATS Page   |     |  application_logs |
|   (Greenhouse,   |     |  (tracking)       |
|    Lever, etc.)  |     +-------------------+
+------------------+
```

### Queue States

```
pending -> processing -> completed
              |
              +-------> failed (retry up to 3x)
              |
              +-------> cancelled (user cancelled)
              |
              +-------> expired (job closed)
```

### Worker Process (`auto-apply/worker.py`)

1. **Poll Queue**: Check for pending jobs every 5 seconds
2. **Claim Job**: Atomic claim using `claim_autoapply_job` RPC (prevents duplicate processing)
3. **Load Profile**: Fetch user's `user_profiles` data
4. **Run Agent**: Launch browser-use agent with Gemini
5. **Fill Application**: Agent navigates to job URL and fills form
6. **Update Status**: Mark as completed/failed with details

### Agent Implementation (`auto-apply/v2/agent.py`)

Uses `browser-use` library with Gemini AI to:

- Detect ATS type from URL/DOM
- Navigate application forms
- Fill standard fields (name, email, resume upload)
- Answer custom questions using AI
- Handle multi-page applications
- Retry on transient failures

### Error Types & Retry Strategy

| Error Type | Max Retries | Base Delay | Description |
|------------|-------------|------------|-------------|
| `network` | 3 | 2s | Transient network failures |
| `timeout` | 3 | 5s | Request timeouts |
| `rate_limit` | 3 | 60s | API rate limiting |
| `server_error` | 3 | 10s | 5xx errors |
| `validation` | 0 | - | Form validation (needs user fix) |
| `captcha` | 0 | - | CAPTCHA (manual intervention) |
| `permanent` | 0 | - | Job closed, invalid URL |

---

## Scraper System

### Architecture

```
GitHub Actions (Cron: 7am PT)
         |
         v
+----------------------------------+
|          radar.py                |
|  (orchestrates all sources)      |
+----------------------------------+
         |
         +----------+----------+----------+----------+
         |          |          |          |          |
         v          v          v          v          v
  +----------+ +----------+ +----------+ +----------+ +----------+
  |greenhouse| |  lever   | |  ashby   | | workday  | | simplify |
  +----------+ +----------+ +----------+ +----------+ +----------+
         |          |          |          |          |
         +----------+----------+----------+----------+
                    |
                    v
         +----------------------------------+
         |       classifier.py              |
         |  (Gemini: is_new_grad? roles?)   |
         +----------------------------------+
                    |
                    v
         +----------------------------------+
         |          db.py                   |
         |  (upsert to Supabase)            |
         +----------------------------------+
                    |
         +----------+----------+
         |                     |
         v                     v
  +-------------+       +--------------+
  | alerts.py   |       |  notify.py   |
  | (job alerts)|       | (push/email) |
  +-------------+       +--------------+
```

### Data Sources

| Source | Type | Jobs/Run | Notes |
|--------|------|----------|-------|
| Greenhouse | API | ~2000 | Most tech startups |
| Lever | API | ~500 | Popular with YC |
| Ashby | API | ~200 | Growing popularity |
| Workday | API | ~300 | Enterprise (NVIDIA, Snowflake) |
| SimplifyJobs | GitHub | 20000+ | Aggregator |
| RemoteOK | API | ~100 | Remote jobs |
| Adzuna | API | ~500 | UK/EU jobs |
| USAJobs | API | ~200 | Government |
| HN Hiring | Scrape | ~50 | Who's Hiring thread |
| VC Portfolios | Scrape | ~300 | a16z, Sequoia, etc. |
| Conferences | Static | ~100 | Grace Hopper, NSBE sponsors |
| Hackathons | Scrape | ~100 | MLH partner companies |
| GitHub Repos | API | ~1000 | Community job lists |
| Newsletters | RSS | ~50 | Engineering newsletters |
| Deep Crawler | Puppeteer | ~100 | Custom career pages |

### Job Normalization

All jobs are normalized to this structure:

```python
{
    "id": "md5(company_slug + title + url)",
    "company_slug": "anthropic",
    "company_name": "Anthropic",
    "title": "Software Engineer, New Grad",
    "location": "San Francisco, CA",
    "url": "https://jobs.lever.co/anthropic/...",
    "apply_url": "https://jobs.lever.co/anthropic/.../apply",
    "tier": "ai",
    "role_types": ["swe", "backend"],
    "source": "lever",
    "source_url": "https://jobs.lever.co/anthropic",
    "posted": "2024-01-15",
    "deadline": null,
    "salary_min": 150000,
    "salary_max": 200000,
    "sponsorship_status": "sponsors",
    "discovery_sources": ["lever", "simplify"],
    "diversity_tags": [],
    "work_modes": ["hybrid"],
    "badges": ["new_grad", "visa_sponsor"],
    "experience_level": "entry"
}
```

### ATS Detection

The `ats-registry.ts` provides comprehensive patterns for detecting and interacting with ATS systems:

- **URL patterns**: `jobs.greenhouse.io`, `jobs.lever.co`, etc.
- **DOM signatures**: Specific form structures, data attributes
- **Field mappings**: Standard selectors for each ATS

---

## Data Flow Diagrams

### 1. Job Discovery & Notification

```
[Scraper]                    [Supabase]                   [User]
    |                            |                           |
    | 1. Fetch from sources      |                           |
    |--------------------------->|                           |
    |                            |                           |
    | 2. Upsert jobs             |                           |
    |--------------------------->|                           |
    |                            |                           |
    | 3. Process alerts          |                           |
    |--------------------------->|                           |
    |                            |                           |
    |                            | 4. Real-time event        |
    |                            |-------------------------->|
    |                            |                           |
    | 5. Send push (ntfy.sh)     |                           |
    |------------------------------------------------>----->|
```

### 2. Auto-Apply Flow

```
[User]          [Frontend]        [API]          [Queue]        [Worker]
   |                |               |               |               |
   | Click Apply    |               |               |               |
   |--------------->|               |               |               |
   |                |               |               |               |
   |                | POST /auto-apply              |               |
   |                |-------------->|               |               |
   |                |               |               |               |
   |                |               | Insert queue  |               |
   |                |               |-------------->|               |
   |                |               |               |               |
   |                |               |               | Poll & claim  |
   |                |               |               |<--------------|
   |                |               |               |               |
   |                |               |               | Update status |
   |                |               |               |<--------------|
   |                |               |               |               |
   |                | Real-time     |               |               |
   |                | status update |               |               |
   |<---------------|<--------------|<--------------|               |
```

### 3. Resume Tweak Flow

```
[User]            [Frontend]          [API]              [Gemini]
   |                  |                  |                   |
   | Upload resume    |                  |                   |
   |----------------->|                  |                   |
   |                  |                  |                   |
   |                  | POST /parse-resume                   |
   |                  |----------------->|                   |
   |                  |                  |                   |
   |                  |                  | Extract text/PDF  |
   |                  |                  |------------------>|
   |                  |                  |                   |
   |                  | Profile data     |                   |
   |<-----------------|<-----------------|                   |
   |                  |                  |                   |
   | Click "Optimize" |                  |                   |
   |----------------->|                  |                   |
   |                  |                  |                   |
   |                  | POST /tweak-resume                   |
   |                  | + job description|                   |
   |                  |----------------->|                   |
   |                  |                  |                   |
   |                  |                  | Generate tweaks   |
   |                  |                  |------------------>|
   |                  |                  |                   |
   |                  | Optimized resume |                   |
   |<-----------------|<-----------------|<------------------|
```

---

## Key Libraries

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| `next` | 16.3.4 | React framework with App Router |
| `react` | 19.2.8 | UI library |
| `@supabase/ssr` | 0.12.6 | Supabase client with SSR support |
| `@supabase/supabase-js` | 2.115.0 | Supabase JavaScript client |
| `@dnd-kit/core` | 6.3.1 | Drag-and-drop for Kanban |
| `@dnd-kit/sortable` | 10.0.0 | Sortable drag-and-drop |
| `recharts` | 3.10.1 | Charts for analytics |
| `date-fns` | 4.4.0 | Date manipulation |
| `pdf-parse` | 2.4.5 | PDF text extraction |
| `pdfjs-dist` | 6.3.289 | PDF rendering |
| `tailwindcss` | 4.x | Utility-first CSS |

### Backend (Scraper)

| Library | Purpose |
|---------|---------|
| `supabase-py` | Supabase client for Python |
| `requests` | HTTP client |
| `beautifulsoup4` | HTML parsing |
| `feedparser` | RSS/Atom parsing |
| `google-generativeai` | Gemini AI for classification |

### Auto-Apply Worker

| Library | Purpose |
|---------|---------|
| `browser-use` | AI browser automation |
| `google-generativeai` | Gemini AI for form filling |
| `supabase` | Database client |
| `python-dotenv` | Environment variables |

---

## Environment Variables

### Frontend (.env.local)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### Scraper (GitHub Secrets)

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # Service role key
GEMINI_API_KEY=xxx
```

### Auto-Apply Worker

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...  # Service role or user key
GEMINI_API_KEY=xxx
POLL_INTERVAL=5      # Seconds between polls
MAX_CONCURRENT=3     # Parallel job limit
```

---

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Vercel | Free tier, auto-deploy from GitHub |
| Database | Supabase | Free tier (500MB, 50k MAU) |
| Scraper | GitHub Actions | Daily cron, free minutes |
| Auto-Apply Worker | Local / VPS | Requires browser environment |

---

## Future Considerations

1. **Scaling**: Move auto-apply worker to cloud (AWS Lambda, GCP Cloud Run)
2. **Caching**: Add Redis for hot job data
3. **Analytics**: Enhanced analytics dashboard
4. **ML**: Train custom model for job classification
5. **Mobile**: React Native app for notifications
