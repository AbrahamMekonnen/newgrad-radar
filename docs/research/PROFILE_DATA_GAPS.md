# User Profile Data Gap Analysis

This document analyzes the current user profile data collected vs. what is commonly required for job applications.

## Current Profile Data

### Database Schema (003_user_profiles.sql)

| Field | Type | Description |
|-------|------|-------------|
| `first_name` | TEXT | First name |
| `last_name` | TEXT | Last name |
| `email` | TEXT | Contact email |
| `phone` | TEXT | Phone number |
| `location` | TEXT | General location (e.g., "San Francisco, CA") |
| `linkedin_url` | TEXT | LinkedIn profile URL |
| `portfolio_url` | TEXT | Personal website/portfolio |
| `github_url` | TEXT | GitHub profile URL |
| `resume_url` | TEXT | Uploaded resume (Supabase storage) |
| `resume_filename` | TEXT | Original resume filename |
| `work_authorization` | TEXT | us_citizen, permanent_resident, visa_holder, student_visa, other |
| `require_sponsorship` | BOOLEAN | Needs visa sponsorship |
| `years_experience` | TEXT | 0, 1, 2, 3-5, 5+ |
| `start_date` | TEXT | Earliest availability |
| `salary_expectation` | TEXT | Free text salary range |
| `willing_to_relocate` | BOOLEAN | Open to relocation |
| `custom_answers` | JSONB | Flexible key-value storage |
| `auto_apply_enabled` | BOOLEAN | Feature toggle |
| `auto_submit` | BOOLEAN | Auto-submit vs review |
| `auto_apply_all_jobs` | BOOLEAN | Apply to all jobs |

### Current UI Collection (ProfileForm.tsx)

The form currently collects all database fields in these sections:
- Personal Information (name, email, phone, location)
- Links (LinkedIn, GitHub, Portfolio)
- Resume (PDF upload)
- Auto-Apply Settings (toggles)
- Pre-filled Answers (work auth, experience, availability, salary, relocation)

---

## Gap Analysis: Missing Fields

### CRITICAL - Required for Most Applications

| Missing Field | Purpose | Common ATS Fields | Priority |
|--------------|---------|-------------------|----------|
| **Full Address** | Required by most ATS | street_address, city, state, zip_code, country | Critical |
| **University/School** | Education verification | school_name, institution | Critical |
| **Degree Type** | Education level | degree (BS, MS, PhD, etc.) | Critical |
| **Major/Field of Study** | Role fit assessment | field_of_study, major | Critical |
| **Graduation Date** | New grad eligibility | graduation_date, expected_graduation | Critical |

### IMPORTANT - Frequently Required

| Missing Field | Purpose | Common ATS Fields | Priority |
|--------------|---------|-------------------|----------|
| **GPA** | Academic performance (optional but common) | gpa, cumulative_gpa | Important |
| **Preferred Locations** | Job matching (multiple) | preferred_locations[], remote_preference | Important |
| **Current/Most Recent Job Title** | Experience level | current_title, job_title | Important |
| **Current/Most Recent Employer** | Work history | current_employer, company_name | Important |
| **Gender** | EEOC reporting (voluntary) | gender, gender_identity | Important |
| **Race/Ethnicity** | EEOC reporting (voluntary) | race, ethnicity | Important |
| **Veteran Status** | EEOC reporting (voluntary) | veteran_status | Important |
| **Disability Status** | EEOC reporting (voluntary) | disability_status | Important |
| **How Did You Hear About Us** | Referral tracking | source, referral_source | Important |
| **Referrer Name/Email** | Referral bonus tracking | referrer_name, referrer_email | Important |

### NICE-TO-HAVE - Situational Requirements

| Missing Field | Purpose | Common ATS Fields | Priority |
|--------------|---------|-------------------|----------|
| **Cover Letter Template** | Auto-generate cover letters | cover_letter | Nice-to-have |
| **Languages Spoken** | International roles | languages[], language_proficiency | Nice-to-have |
| **Certifications** | Technical roles | certifications[], credentials | Nice-to-have |
| **Security Clearance** | Defense/Gov roles | clearance_level, clearance_eligible | Nice-to-have |
| **Age Verification (18+)** | Legal compliance | age_verified, over_18 | Nice-to-have |
| **Felony Disclosure** | Background check | criminal_history | Nice-to-have |
| **Work Schedule Preference** | Flexibility | schedule_preference (full-time, part-time) | Nice-to-have |
| **Pronouns** | Inclusive hiring | pronouns | Nice-to-have |

---

## Detailed Gap Specifications

### 1. Education Details (Critical)

**Current State:** No education fields exist.

**Proposed Schema Addition:**
```sql
-- Add to user_profiles table
education_school TEXT,              -- "Stanford University"
education_degree TEXT,              -- "Bachelor of Science"
education_major TEXT,               -- "Computer Science"
education_graduation_date DATE,     -- 2025-05-15
education_gpa TEXT,                 -- "3.8" (optional)
education_minor TEXT,               -- "Mathematics" (optional)
```

**Alternative: Separate Table for Multiple Degrees:**
```sql
CREATE TABLE user_education (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  degree_type TEXT NOT NULL,        -- 'bachelors', 'masters', 'phd', 'associate', 'bootcamp'
  field_of_study TEXT NOT NULL,
  graduation_date DATE,
  gpa TEXT,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**UI Suggestion:**
- Single education section for new grads (most only have one degree)
- Autocomplete for school names (use common university list)
- Degree type dropdown: Bachelor's, Master's, PhD, Associate, Bootcamp, High School
- Graduation date with month/year picker
- Optional GPA field with hint "Leave blank if < 3.0"

---

### 2. Full Address (Critical)

**Current State:** Only `location` field (free text like "San Francisco, CA")

**Proposed Schema Addition:**
```sql
-- Add to user_profiles table
address_street TEXT,
address_city TEXT,
address_state TEXT,
address_zip TEXT,
address_country TEXT DEFAULT 'United States',
```

**UI Suggestion:**
- Expandable "Full Address" section (collapsed by default)
- Show hint: "Required for most job applications"
- Use Google Places Autocomplete or similar for address validation
- Auto-populate `location` from city/state for display

---

### 3. Work Experience (Important)

**Current State:** Only `years_experience` field (0, 1, 2, etc.)

**Proposed Schema Addition (Simple):**
```sql
-- Add to user_profiles for most recent role
current_employer TEXT,
current_title TEXT,
current_start_date DATE,
is_currently_employed BOOLEAN DEFAULT false,
```

**Alternative: Separate Table for Multiple Roles:**
```sql
CREATE TABLE user_work_experience (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,                    -- NULL if current
  is_current BOOLEAN DEFAULT false,
  description TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**UI Suggestion:**
- For new grads: Focus on internships/part-time work
- "Add Work Experience" button with simple form
- Fields: Company, Title, Start Date, End Date (or "Current"), Description
- Show most recent 3 experiences in compact list

---

### 4. EEOC/Demographics (Important)

**Current State:** None

**Context:** Required by US companies for EEOC reporting. Always optional/voluntary.

**Proposed Schema Addition:**
```sql
-- Add to user_profiles (all nullable, voluntary)
eeoc_gender TEXT,                   -- 'male', 'female', 'non_binary', 'prefer_not_to_say'
eeoc_race TEXT,                     -- Standard EEOC categories
eeoc_veteran_status TEXT,           -- 'veteran', 'not_veteran', 'prefer_not_to_say'
eeoc_disability_status TEXT,        -- 'yes', 'no', 'prefer_not_to_say'
```

**UI Suggestion:**
- Separate "Voluntary Self-Identification" section
- Clear explanation: "This information is voluntary and will not affect your candidacy"
- Always include "Prefer not to say" / "Decline to self-identify" option
- Collapse by default with expand button

---

### 5. Referral/Source Tracking (Important)

**Current State:** None

**Proposed Schema Addition:**
```sql
-- Add to user_profiles
default_referral_source TEXT,       -- "LinkedIn", "Career Fair", "Friend", etc.
referrer_name TEXT,
referrer_email TEXT,
```

**UI Suggestion:**
- "How do you usually hear about jobs?" dropdown
- Optional referrer name/email fields
- Can be overridden per-application in custom_answers

---

### 6. Preferred Locations (Important)

**Current State:** Single `location` field, `willing_to_relocate` boolean

**Proposed Schema Addition:**
```sql
-- Add to user_profiles
preferred_locations TEXT[],         -- Array: ["San Francisco, CA", "New York, NY", "Remote"]
remote_preference TEXT,             -- 'remote_only', 'hybrid', 'onsite', 'flexible'
```

**UI Suggestion:**
- Multi-select location picker with common tech hubs
- "Add custom location" option
- Remote work preference dropdown
- Integrate with existing `willing_to_relocate`

---

## Implementation Priority

### Phase 1: Critical (Week 1)
1. Education details (school, degree, major, graduation date)
2. Full address fields
3. Migration + UI updates

### Phase 2: Important (Week 2)
4. EEOC voluntary fields
5. Preferred locations array + remote preference
6. Current employer/title fields
7. Referral source defaults

### Phase 3: Nice-to-Have (Future)
8. Work experience table (multiple entries)
9. Education table (multiple degrees)
10. Cover letter templates
11. Language proficiency
12. Certifications

---

## Proposed UI Changes

### Updated ProfileForm.tsx Sections

```
1. Personal Information
   - First Name, Last Name
   - Email, Phone
   - Full Address (expandable)
     - Street Address
     - City, State, ZIP
     - Country

2. Education
   - School/University (autocomplete)
   - Degree Type (dropdown)
   - Major/Field of Study
   - Graduation Date (month/year picker)
   - GPA (optional)

3. Work Experience (collapsible)
   - Current Employer (if employed)
   - Current Title
   - Start Date
   - [+ Add more experiences]

4. Links
   - LinkedIn, GitHub, Portfolio

5. Resume
   - Upload PDF

6. Pre-filled Answers
   - Work Authorization
   - Sponsorship Required
   - Years of Experience
   - Earliest Start Date
   - Salary Expectation
   - Willing to Relocate
   - Preferred Locations (multi-select)
   - Remote Preference

7. Voluntary Self-Identification (collapsed)
   - Gender
   - Race/Ethnicity
   - Veteran Status
   - Disability Status

8. Auto-Apply Settings
   - Enable Auto-Apply
   - Auto-Submit
   - Apply to All Jobs
```

---

## Notes

- The `custom_answers` JSONB field can serve as a temporary catch-all for fields not yet in schema
- Consider using a progressive disclosure UI - show basic fields first, expand for details
- Education fields are most critical for new grad applications
- EEOC fields should be clearly marked as voluntary and never required
