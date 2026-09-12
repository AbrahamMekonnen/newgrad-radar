# Auto-Apply Feature

Automatically apply to job postings using your saved profile information. Auto-Apply detects the Applicant Tracking System (ATS) used by each company and fills in application forms with your pre-configured details.

## Overview

| Setting | Default | Description |
|---------|---------|-------------|
| `auto_apply_enabled` | `true` | Feature is enabled for new users by default |
| `auto_submit` | `false` | When false, reviews form before submitting |
| `auto_apply_all_jobs` | `false` | Apply only to saved jobs by default |

## Quick Start

1. **Configure your profile** at `/settings/profile`
2. **Upload your resume** (PDF recommended, max 5MB)
3. **Fill in common answers** (work authorization, sponsorship, etc.)
4. **Click "Auto Apply"** on any supported job listing

## Supported ATS Systems

Auto-Apply supports 12 major Applicant Tracking Systems with varying automation difficulty:

| ATS | Difficulty | Notes |
|-----|------------|-------|
| Lever | Easy (1-2) | Fast load, simple forms, uses full name |
| Greenhouse | Easy (2) | Most common for tech, has API |
| Ashby | Easy (2) | Modern React forms, uses `_systemfield_` prefix |
| BambooHR | Easy (2) | Simple SMB-focused forms |
| BreezyHR | Easy (2) | Clean React-based forms |
| Recruitee | Easy (2) | European ATS, good API |
| SmartRecruiters | Medium (3) | REST API available |
| JazzHR | Medium (3) | Uses `applytojob.com` subdomain |
| Jobvite | Medium (3) | Uses `jv-` prefix for fields |
| iCIMS | Hard (4) | Heavy iframe usage, often requires login |
| Workday | Hard (5) | Multi-step wizard, requires account creation |
| Taleo | Hard (5) | Legacy system, very slow |

Only ATS systems with difficulty 3 or lower are fully supported for auto-apply.

## File Structure

```
src/
├── components/autoapply/
│   ├── AutoApplyButton.tsx      # Main apply button component
│   ├── ApplicationStatus.tsx    # Status badge display
│   ├── ProfileForm.tsx          # Profile configuration form
│   ├── ProfileCompleteness.tsx  # Profile completion tracker
│   ├── ProfileGapsAlert.tsx     # Missing fields warning
│   ├── ProfileFieldStatus.tsx   # Individual field validation
│   ├── ProfileSectionProgress.tsx
│   ├── ProgressPanel.tsx        # Application progress UI
│   ├── StoryBankSection.tsx     # Behavioral answer storage
│   ├── StoryBankWizard.tsx      # Story creation wizard
│   └── index.ts                 # Component exports
├── lib/
│   ├── ats-registry.ts          # ATS detection & field mappings
│   └── autoapply-tracker.ts     # Application attempt logging
└── app/settings/profile/page.tsx # Profile settings page
```

## Configuration

### User Profile Fields

Configure these in your profile at `/settings/profile`:

**Basic Information:**
- `first_name`, `last_name` - Your legal name
- `email` - Contact email
- `phone` - Phone number
- `location` - Current city/location

**Links:**
- `linkedin_url` - LinkedIn profile URL
- `portfolio_url` - Personal website/portfolio
- `github_url` - GitHub profile URL

**Resume:**
- `resume_url` - Supabase storage URL for uploaded resume
- `resume_filename` - Original filename

**Application Defaults:**
- `work_authorization` - Options: `us_citizen`, `green_card`, `visa`, `need_sponsorship`
- `require_sponsorship` - Boolean
- `years_experience` - Years of relevant experience
- `start_date` - Options: `immediately`, `2_weeks`, `1_month`, `other`
- `salary_expectation` - Expected compensation
- `willing_to_relocate` - Boolean

**Custom Answers:**
- `custom_answers` - JSON object for company-specific question answers

### Auto-Apply Settings

| Setting | Type | Description |
|---------|------|-------------|
| `auto_apply_enabled` | boolean | Master toggle for the feature |
| `auto_submit` | boolean | `false` = review first, `true` = full auto |
| `auto_apply_all_jobs` | boolean | Apply to all jobs or only saved jobs |

## AutoApplyButton Component

### Props

```typescript
interface AutoApplyButtonProps {
  jobId: string;                              // Required: Job identifier
  atsType: string | null;                     // ATS type from job data
  application?: ApplicationLog | null;        // Existing application state
  onAutoApply: (jobId: string, optimizedResume?: boolean) => Promise<void>;
  onOptimizeFirst?: () => void;               // Callback for resume optimization
  onCancelApplication?: (jobId: string) => Promise<void>;
  resumeScore?: ResumeScore | null;           // Resume match score
  disabled?: boolean;                         // Disable button
  applicationUrl?: string;                    // Direct application URL
  hideStatus?: boolean;                       // Hide status badges in job lists
}
```

### Usage

```tsx
import { AutoApplyButton } from '@/components/autoapply';

<AutoApplyButton
  jobId={job.id}
  atsType={job.ats_type}
  application={userApplication}
  onAutoApply={handleAutoApply}
  hideStatus={true}  // Use in job list views
/>
```

### Button States

1. **Not Supported** - ATS not in supported list (disabled)
2. **Optimize & Apply** - Resume score is low (shows score badge)
3. **Auto Apply** - Ready to apply (default state)
4. **Starting...** - Application in progress (loading spinner)
5. **Status Badge** - Shows application status when `hideStatus={false}`

## ATS Registry

The ATS registry (`/src/lib/ats-registry.ts`) provides:

### ATS Detection

```typescript
import { detectATSFromURL, getSupportedATSTypes } from '@/lib/ats-registry';

// Detect ATS from job URL
const atsType = detectATSFromURL('https://jobs.lever.co/company/abc123');
// Returns: 'lever'

// Get all supported ATS types
const supported = getSupportedATSTypes();
// Returns: ['greenhouse', 'lever', 'ashby', 'bamboohr', 'breezyhr', 'recruitee', 'smartrecruiters', 'jazzhr', 'jobvite']
```

### Field Mappings

Each ATS has specific field mappings for:
- First/last name
- Email
- Phone
- Resume upload
- LinkedIn URL
- Cover letter
- Work authorization questions

### Detection Methods

1. **URL patterns** - Primary detection (95% confidence)
2. **Meta tags** - Secondary (85% confidence)
3. **DOM fingerprinting** - Fallback (90% confidence)
4. **Script/asset analysis** - Comprehensive (88% confidence)
5. **Global variables** - Browser context (92% confidence)

## Application Tracking

### Status Flow

```
pending -> filling -> review -> submitted
                         |
                         v
                       failed
```

### Database Sync

Application logs sync with `saved_jobs` via database triggers:

| saved_jobs.status | application_logs.status |
|-------------------|-------------------------|
| `saved` | (no entry) |
| `applied` | `submitted` |
| `in_review` | `in_review` |
| `interviewing` | `interview_scheduled` |
| `rejected` | `rejected` |
| `offer` | `offer` |

### Error Categories

The tracker categorizes failures for pattern analysis:

- `network_error` - Connection/timeout issues
- `captcha_blocked` - CAPTCHA detection
- `login_required` - Account creation needed
- `field_not_found` - Missing expected field
- `field_validation` - Input rejected
- `file_upload_failed` - Resume upload issues
- `form_submit_error` - Submit button problems
- `confirmation_timeout` - Success verification failed
- `rate_limited` - Too many requests
- `page_load_error` - Page load issues

## Database Schema

### user_profiles

```sql
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  github_url TEXT,
  resume_url TEXT,
  resume_filename TEXT,
  auto_apply_enabled BOOLEAN DEFAULT true,
  auto_submit BOOLEAN DEFAULT false,
  auto_apply_all_jobs BOOLEAN DEFAULT false,
  work_authorization TEXT,
  require_sponsorship BOOLEAN,
  years_experience TEXT,
  start_date TEXT,
  salary_expectation TEXT,
  willing_to_relocate BOOLEAN,
  custom_answers JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### application_logs

```sql
CREATE TABLE application_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  job_id TEXT REFERENCES jobs(id),
  status TEXT NOT NULL,
  ats_type TEXT,
  error_message TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);
```

## Resume Storage

Resumes are stored in Supabase Storage:

- **Bucket**: `resumes` (private)
- **Path convention**: `{user_id}/resume.pdf`
- **Supported formats**: PDF (recommended), DOC, DOCX
- **Max size**: 5MB

### Storage Policies (configure in Supabase Dashboard)

```sql
-- INSERT: Users can upload their own resumes
(bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])

-- SELECT: Users can read their own resumes
(bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])

-- DELETE: Users can delete their own resumes
(bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])
```

## Common Question Patterns

The system recognizes and auto-fills these question types:

| Question Type | Profile Field | Answer Type |
|--------------|---------------|-------------|
| Work Authorization | `work_authorization` | yes/no |
| Sponsorship Required | `require_sponsorship` | yes/no |
| Willing to Relocate | `willing_to_relocate` | yes/no |
| Years of Experience | `years_experience` | number |
| Start Date | `start_date` | date/select |
| Salary Expectation | `salary_expectation` | text |
| Referral Source | `custom_answers` | text |
| EEOC Questions | `custom_answers` | select |

## Troubleshooting

### "Not Supported" Button

The job uses an ATS with automation difficulty > 3. Options:
1. Apply manually via the job URL
2. Check if the ATS URL pattern is missing from the registry

### Resume Upload Fails

```
Storage bucket "resumes" not configured
```

Solution: Create the `resumes` bucket in Supabase Dashboard under Storage.

### Application Stuck in "Pending"

1. Check browser console for errors
2. Verify profile is complete
3. Check if ATS requires login (Workday, Taleo, iCIMS)

### CAPTCHA Blocked

Some ATS systems (especially Workday) use CAPTCHA protection. Manual application is required.

## Extending ATS Support

To add a new ATS to the registry:

1. Add URL patterns for detection
2. Define DOM signatures
3. Map field selectors
4. Set form submission patterns
5. Assign automation difficulty (1-5)
6. Document any quirks

See `/src/lib/ats-registry.ts` for the complete `ATSConfig` interface.
