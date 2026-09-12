# Pending Database Migrations

This document provides an audit of all database migrations in `/supabase/migrations/` and guidance on running them.

## Migration Summary

| # | File | Status | Description |
|---|------|--------|-------------|
| 1 | `001_initial.sql` | Base | Core schema: companies, jobs, user_lists, saved_jobs, user_preferences |
| 2 | `002_recruiters.sql` | Depends on 001 | Recruiter contacts with crowdsourced verification |
| 3 | `003_user_profiles.sql` | Depends on 001 | User profiles and application logs for auto-apply |
| 4 | `004_auto_apply_enhancements.sql` | Depends on 001, 003 | Per-company auto-apply toggle, user custom companies |
| 5 | `005_email_variants.sql` | Depends on 002 | Adds email_variants JSONB column to recruiters |
| 6 | `006_analytics_resume_tracking.sql` | Depends on 003 | Resume versions, application analytics, performance tracking |
| 7 | `007_application_tracking.sql` | Depends on 003 | Detailed field tracking, ATS success rates, failure patterns |
| 8 | `008_create_user_resumes.sql` | Standalone | Simplified user_resumes table (may conflict with 006) |
| 9 | `009_job_source.sql` | Depends on 001 | Adds source and source_url columns to jobs |
| 10 | `010_scraper_logs.sql` | Standalone | Scraper run logs and health monitoring view |
| 11 | `011_multi_dimensional_tags.sql` | Depends on 001 | Tag registry, diversity tags, work modes, badges on jobs |
| 12 | `012_job_alerts.sql` | Depends on 001 | Smart job alerts with filters and digest scheduling |
| 13 | `013_recommendations.sql` | Depends on 001, 003 | User preferences, behavior tracking, collaborative filtering |
| 14 | `014_application_pipeline.sql` | Depends on 001 | Full Kanban pipeline tracking, application events, company insights |
| 15 | `015_hiring_patterns.sql` | Depends on 001, 010 | Job lifecycle events, hiring seasons, predictions |
| 16 | `016_experience_level.sql` | Depends on 001 | Experience level tracking for jobs |
| 17 | `017_job_alerts_extended_filters.sql` | Depends on 012 | Extended job alert filters |
| 18 | `018_user_lists_notifications.sql` | Depends on 001 | User list notification settings |
| 19 | `019_user_lists_filters.sql` | Depends on 001 | User list filter options |
| 20 | `020_feedback_reports.sql` | Standalone | User feedback and reporting |
| 21 | `021_user_education.sql` | Depends on 003 | User education history for auto-apply (multi-degree support) |
| 22 | `022_salary_availability.sql` | Depends on 003 | Enhanced salary and availability preferences for auto-apply |

---

## Migration Details

### 001_initial.sql
**Purpose:** Creates the foundational schema for the application.

**Tables Created:**
- `companies` - Master list of tracked companies with ATS info
- `jobs` - All scraped job postings (shared across users)
- `user_lists` - User's tracked companies ("My List")
- `saved_jobs` - Jobs saved/applied to by users
- `user_preferences` - Notification and filter settings

**Dependencies:** None (base migration)

---

### 002_recruiters.sql
**Purpose:** Adds recruiter contact management with crowdsourced verification.

**Tables Created:**
- `recruiters` - Recruiter contacts linked to jobs/companies
- `recruiter_votes` - User votes for verification

**Functions/Triggers:**
- `update_recruiter_vote_counts()` - Syncs upvote/downvote counts

**Dependencies:** 001 (jobs, companies, auth.users)

---

### 003_user_profiles.sql
**Purpose:** User application profiles for auto-apply feature.

**Tables Created:**
- `user_profiles` - Personal info, resume URL, work authorization, custom answers
- `application_logs` - Tracks auto-apply attempts and status

**Functions/Triggers:**
- `update_updated_at_column()` - Auto-updates timestamps

**Dependencies:** 001 (jobs, auth.users)

**Note:** Requires manual creation of "resumes" storage bucket in Supabase Dashboard.

---

### 004_auto_apply_enhancements.sql
**Purpose:** Per-company auto-apply toggles and user-added custom companies.

**Schema Changes:**
- Adds `auto_apply` column to `user_lists`
- Adds `auto_apply_all_jobs` column to `user_profiles`

**Tables Created:**
- `user_companies` - Custom companies added by users

**Dependencies:** 001 (user_lists), 003 (user_profiles)

---

### 005_email_variants.sql
**Purpose:** Stores multiple email possibilities for recruiters with confidence scores.

**Schema Changes:**
- Adds `email_variants` JSONB column to `recruiters`

**Dependencies:** 002 (recruiters)

---

### 006_analytics_resume_tracking.sql
**Purpose:** Resume version tracking and application analytics.

**Tables Created:**
- `user_resumes` - Multiple resume versions with AI tweaks
- `application_analytics` - Aggregated application stats by period
- `resume_performance` - Per-resume success metrics

**Schema Changes:**
- Adds columns to `application_logs`: resume_id, resume_version, company_tier, role_types, response_received_at, response_type

**Dependencies:** 003 (application_logs, auth.users)

---

### 007_application_tracking.sql
**Purpose:** Detailed field tracking for auto-apply learning and optimization.

**Schema Changes:**
- Adds columns to `application_logs`: fields_filled, fields_failed, fields_missing, custom_questions, duration_ms, error_category, application_url, automation_method, screenshot_url

**Tables Created:**
- `ats_field_stats` - Best selectors per ATS/field
- `failure_patterns` - Common failure patterns
- `ats_success_rates` - Overall success rate per ATS

**Functions/Triggers:**
- `update_ats_stats()` - Updates ATS stats on new application
- `refresh_field_stats()` - Periodic selector stats refresh

**Views:**
- `application_tracking_summary` - ATS success rate overview

**Dependencies:** 003 (application_logs)

---

### 008_create_user_resumes.sql
**Purpose:** Simplified user_resumes table with JSONB resume_data storage.

**Tables Created:**
- `user_resumes` - Resume data with base resume flag

**Note:** This may conflict with 006_analytics_resume_tracking.sql which also creates `user_resumes`. If running both, run 006 first and skip this one, OR run this one only if you don't need the analytics columns.

**Dependencies:** Standalone (auth.users)

---

### 009_job_source.sql
**Purpose:** Track where each job listing was discovered.

**Schema Changes:**
- Adds `source` VARCHAR(50) column to jobs (default: 'direct')
- Adds `source_url` TEXT column to jobs

**Dependencies:** 001 (jobs)

**Note:** The jobs table in 001 already has a `source` column, so this migration may error. Check if column exists first.

---

### 010_scraper_logs.sql
**Purpose:** Scraper run monitoring and error tracking.

**Tables Created:**
- `scraper_logs` - Detailed logs per scraper run

**Views:**
- `scraper_health` - Quick health check for last 24 hours

**Dependencies:** Standalone

---

### 011_multi_dimensional_tags.sql
**Purpose:** Rich tagging system for jobs with discovery sources, diversity tags, work modes, and badges.

**Tables Created:**
- `tag_registry` - Central registry for all tag types

**Schema Changes:**
- Adds to `jobs`: discovery_sources TEXT[], diversity_tags TEXT[], work_modes TEXT[], badges TEXT[]

**Functions:**
- `get_tags_by_category()` - Retrieve tags by category
- `get_jobs_by_tags()` - Filter jobs by tag arrays

**Seed Data:** Pre-populates tags for discovery sources, diversity programs, work modes, and special badges.

**Dependencies:** 001 (jobs)

---

### 012_job_alerts.sql
**Purpose:** Smart job alerts with customizable filters and delivery modes.

**Tables Created:**
- `job_alerts` - User alert configurations with JSONB filters
- `alert_filter_index` - Denormalized index for fast matching
- `alert_matches` - Queue of matched jobs pending delivery
- `alert_digest_schedule` - Digest delivery tracking

**Functions/Triggers:**
- `populate_alert_filter_index()` - Auto-populates filter index on alert changes
- `match_job_to_alerts()` - Finds all alerts matching a job
- `process_new_job_alerts()` - Queues matches when new jobs inserted
- `get_pending_instant_alerts()` - Gets alerts ready for delivery
- `mark_alerts_delivered()` - Updates delivery status
- `get_digest_summary()` - Aggregates jobs for digest emails

**Dependencies:** 001 (jobs, auth.users)

---

### 013_recommendations.sql
**Purpose:** User preferences, behavior tracking, and collaborative filtering for recommendations.

**Tables Created:**
- `user_match_preferences` - Explicit and implicit user preferences
- `user_behavior_events` - User interaction tracking
- `job_similarities` - Pre-computed similarity scores

**Materialized Views:**
- `job_cosaves` - Jobs frequently saved together (collaborative filtering)

**Functions:**
- `refresh_job_cosaves()` - Refresh materialized view

**Dependencies:** 001 (jobs, saved_jobs), 003 (auth.users)

---

### 014_application_pipeline.sql
**Purpose:** Full Kanban-style application tracking with timeline events.

**Types Created:**
- `pipeline_stage` ENUM - All possible application stages

**Tables Created:**
- `applications` - Enhanced saved_jobs with full pipeline tracking
- `application_events` - Timeline events for each application
- `company_insights` - Aggregated company statistics

**Views:**
- `pipeline_summary` - Aggregated counts per stage

**Functions:**
- `record_stage_change()` - Trigger function for stage transitions
- `refresh_company_insights()` - Recalculates company statistics
- `migrate_saved_jobs_to_applications()` - One-time migration helper

**Dependencies:** 001 (jobs, companies, auth.users)

---

### 015_hiring_patterns.sql
**Purpose:** Historical hiring pattern analysis and predictions.

**Tables Created:**
- `job_lifecycle_events` - Every job state change
- `hiring_seasons` - Monthly hiring aggregates per company
- `company_hiring_stats` - Annual summaries and predictions
- `hiring_predictions` - Forward-looking predictions

**Schema Changes:**
- Adds to `jobs`: first_seen_at, last_seen_at, times_reactivated

**Views:**
- `companies_actively_hiring` - Companies with recent activity
- `monthly_hiring_summary` - Cross-company trends

**Functions:**
- `record_job_event()` - Records job lifecycle events

**Dependencies:** 001 (jobs, companies), 010 (scraper_logs)

---

### 021_user_education.sql
**Purpose:** User education history storage for auto-apply, supporting multiple degrees.

**Tables Created:**
- `user_education` - Full education records with GPA, honors, coursework

**Fields Supported:**
- School info: name, location, country
- Degree info: type, name, major, minor, concentration
- Dates: start_date, end_date, graduation_status
- GPA: gpa, gpa_scale (4.0/5.0/10.0/100), major_gpa, show_gpa
- Honors: honors, deans_list, deans_list_semesters
- Additional: relevant_coursework[], thesis_title, awards[]

**Functions:**
- `ensure_single_primary_education()` - Enforces one primary education per user
- `get_primary_education()` - Retrieves primary education for auto-apply

**Degree Types Supported:**
- high_school, associates, bachelors, masters, doctorate, bootcamp, certificate, other

**Dependencies:** 003 (auth.users, update_updated_at_column function)

**Related Documentation:** See `/docs/research/EDUCATION_GUIDE.md` for comprehensive education field research.

---

### 022_salary_availability.sql
**Purpose:** Enhanced salary expectations and availability preferences for auto-apply.

**Schema Changes to `user_profiles`:**

*Salary Preferences:*
- `salary_type` TEXT DEFAULT 'range' - How to handle salary fields: 'range', 'specific', 'negotiable', 'market_rate'
- `salary_min` INTEGER - Minimum acceptable salary
- `salary_max` INTEGER - Maximum/target salary
- `salary_target` INTEGER - Single target number (for specific type)
- `salary_flexibility` TEXT DEFAULT 'somewhat_flexible' - 'firm', 'somewhat_flexible', 'very_flexible'
- `salary_includes` TEXT[] DEFAULT '{"base"}' - What's included: base, bonus, equity, benefits
- `salary_display_strategy` TEXT DEFAULT 'show_range' - How to fill salary fields
- `hourly_rate_min` NUMERIC(10,2) - For part-time/contract roles
- `hourly_rate_max` NUMERIC(10,2) - For part-time/contract roles
- `salary_location_adjusted` BOOLEAN DEFAULT false - Auto-adjust for job location
- `salary_base_location` TEXT - Location salary is based on

*Availability Preferences:*
- `start_date_type` TEXT DEFAULT 'flexible' - 'specific', 'immediate', 'flexible', 'after_graduation'
- `start_date_earliest` DATE - Earliest possible start
- `start_date_preferred` DATE - Preferred start date
- `graduation_date` DATE - For students
- `notice_period_weeks` INTEGER - Current job notice period
- `hours_per_week_min` INTEGER DEFAULT 40 - Minimum hours available
- `hours_per_week_max` INTEGER DEFAULT 40 - Maximum hours available
- `preferred_work_schedule` TEXT DEFAULT 'standard' - 'standard', 'flexible', 'shift', 'any'
- `work_mode_preference` TEXT DEFAULT 'any' - 'remote', 'hybrid', 'onsite', 'any'
- `hybrid_days_in_office` INTEGER - If hybrid, preferred days
- `available_for_oncall` BOOLEAN - On-call availability
- `willing_to_travel` BOOLEAN - Travel willingness
- `travel_percentage_max` INTEGER - Max travel percentage
- `relocation_requires_package` BOOLEAN DEFAULT false - Only relocate with package
- `relocation_preferred_locations` TEXT[] DEFAULT '{}' - Preferred relocation cities
- `relocation_excluded_locations` TEXT[] DEFAULT '{}' - Cities to avoid

**Dependencies:** 003 (user_profiles, update_updated_at_column function)

**Related Documentation:** See `/docs/research/SALARY_AVAILABILITY_GUIDE.md` for research on salary negotiation, market rates, and availability strategies.

---

## Type Mismatches

The following columns exist in migrations but are **NOT** in the TypeScript `Job` type (`/src/lib/types.ts`):

| Column | Added in Migration | Description |
|--------|-------------------|-------------|
| `discovery_sources` | 011 | Array of source tags |
| `diversity_tags` | 011 | DEI-related tags |
| `work_modes` | 011 | Remote/hybrid/onsite |
| `badges` | 011 | Special badges |
| `first_seen_at` | 015 | When job was first scraped |
| `last_seen_at` | 015 | When job was last seen |
| `times_reactivated` | 015 | Reactivation count |

The following properties exist in TypeScript `Job` type but are **NOT** in migrations:

| Property | Expected Type | Notes |
|----------|---------------|-------|
| `deadline` | `string \| null` | Application deadline |
| `salary_min` | `number \| null` | Minimum salary |
| `salary_max` | `number \| null` | Maximum salary |
| `sponsorship_status` | `SponsorshipStatus` | Visa sponsorship |
| `description` | `string` | Job description |

**Action Required:** Create a new migration to add missing columns, or update `types.ts` to match actual schema.

---

## Potential Conflicts

1. **006 vs 008:** Both create `user_resumes` table with different schemas. Run 006 OR 008, not both.

2. **009 source column:** The `jobs` table in 001 already has a `source` column. Migration 009 may fail if run after 001.

---

## Execution Order

Run migrations in numerical order (001 through 015). If conflicts arise:

1. Run 001-005 first
2. Choose 006 OR 008 (006 recommended for analytics features)
3. Run 007 (if you ran 006)
4. Run 009-015

---

## How to Run Migrations

### Option 1: Supabase CLI (Recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project (requires login)
supabase login
supabase link --project-ref jmrbyubrrpxxvotsljms

# Push all migrations
supabase db push

# Or run a specific migration
supabase db push --include-all  # Runs all pending migrations
```

### Option 2: Supabase SQL Editor

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/jmrbyubrrpxxvotsljms)
2. Navigate to **SQL Editor**
3. Copy/paste each migration file content
4. Run in order (001, 002, 003, etc.)

### Option 3: Direct psql Connection

```bash
# Get connection string from Supabase Dashboard > Settings > Database
psql "postgresql://postgres:[PASSWORD]@db.jmrbyubrrpxxvotsljms.supabase.co:5432/postgres"

# Run migration file
\i /path/to/supabase/migrations/001_initial.sql
```

---

## Post-Migration Tasks

1. **Create "resumes" storage bucket** (required by 003):
   - Go to Supabase Dashboard > Storage
   - Create bucket named "resumes" (private)
   - Add RLS policies as documented in 003_user_profiles.sql

2. **Run data migration** (if upgrading from saved_jobs to applications):
   ```sql
   SELECT migrate_saved_jobs_to_applications();
   ```

3. **Schedule periodic jobs**:
   - `refresh_job_cosaves()` - Daily (for recommendations)
   - `refresh_company_insights()` - Daily (for company stats)
   - `refresh_field_stats()` - Daily (for ATS learning)

4. **Update TypeScript types** to include new columns from migrations 011 and 015.

---

*Last updated: 2026-09-10*

---

## Latest Addition: Education History (021)

Migration 021 adds comprehensive education storage for the auto-apply feature:

- **Multiple degrees**: Users can store undergraduate, graduate, bootcamp, certificates
- **GPA handling**: Supports different scales (4.0, 10.0, percentage), major vs cumulative
- **International support**: Country field for international degrees
- **Honors & achievements**: Dean's list, Latin honors, awards
- **Coursework**: Relevant courses array for matching to job requirements
- **Primary flag**: Designates which education to use by default

See `/docs/research/EDUCATION_GUIDE.md` for field research and implementation guidance.

---

## Latest Addition: Salary & Availability Preferences (022)

Migration 022 adds enhanced salary and availability preferences for the auto-apply feature:

**Salary Features:**
- **Structured salary data**: Min/max/target instead of just a text field
- **Display strategies**: Control how salary is filled (range, specific, negotiable, leave blank)
- **Location adjustment**: Option to auto-adjust salary based on job location
- **Hourly rates**: Support for part-time/contract positions
- **Flexibility indicator**: Tell the system how firm your requirements are

**Availability Features:**
- **Start date types**: Immediate, specific date, after graduation, flexible
- **Graduation tracking**: Link start date to expected graduation
- **Work mode preferences**: Remote, hybrid, onsite, or open to any
- **Hours flexibility**: Min/max hours for part-time roles
- **Relocation preferences**: Preferred/excluded locations, package requirements

See `/docs/research/SALARY_AVAILABILITY_GUIDE.md` for research on:
- How to research market rates (H1B data, levels.fyi)
- When to give a range vs specific number
- Handling salary history questions (legal considerations)
- Start date strategies for different situations
- Relocation decision framework
