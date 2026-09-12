# JobCard Component

Component: `/src/components/jobs/JobCard.tsx`

## Overview

The JobCard is the primary display component for job listings. It presents job information in a card format with expandable sections for badges, recruiters, resume matching, and interview prep.

## Component Structure

```
JobCard
├── Early Applicant Ribbon (conditional)
├── Header
│   ├── Company Name (uppercase)
│   ├── Job Title (linked)
│   └── Salary (from DB or API lookup)
├── Badge Row (flex container)
│   ├── Location + icon
│   ├── Work Mode badges (remote/hybrid/onsite/flexible)
│   ├── Tier badge (color-coded)
│   ├── Role Type badges (first 2)
│   ├── [Expanded badges when showAllBadges=true]
│   │   ├── Hidden Gem badge
│   │   ├── Event badges
│   │   ├── Funding Stage badge
│   │   ├── Deadline badge
│   │   ├── Sponsorship badge
│   │   └── Extra role types (3+)
│   └── "+N/Less" toggle button
├── Recruiters Section (expandable)
├── Resume Upload Prompt (conditional)
├── Resume Match Score (conditional)
├── Interview Prep Section
└── Footer
    ├── Posted time + Save count
    └── Action buttons (AutoApply, Save, Apply)
```

## Badge System

### Primary Badges (Always Visible)

| Badge Type | Source | Colors |
|------------|--------|--------|
| Tier | `job.tier` | Defined in `TIER_COLORS` |
| Role Types | `job.role_types[0:2]` | Defined in `ROLE_COLORS` |
| Work Mode | `job.work_modes` | Blue (remote), Purple (hybrid), Gray (onsite), Teal (flexible) |

### Expandable Badges (Hidden by Default)

These badges are shown when the user clicks the "+N" toggle:

| Badge Type | Source | Condition |
|------------|--------|-----------|
| Hidden Gem | `getHiddenGemBadge(job.source)` | Non-major job board sources |
| Event Badges | `getJobEventBadges(job)` | Recent funding, new posting, etc. |
| Funding Stage | Company enrichment API | Cached in localStorage (24h TTL) |
| Deadline | `job.deadline` | Shows urgency (color varies by days remaining) |
| Sponsorship | `job.sponsorship_status` | Not shown if "unknown" |
| Extra Role Types | `job.role_types[2:]` | If more than 2 role types |

### Badge Toggle Logic

```typescript
const extraBadgeCount = 
  (hiddenGemBadge ? 1 : 0) + 
  eventBadges.length + 
  (fundingFilter ? 1 : 0) + 
  (deadlineInfo ? 1 : 0) + 
  (job.sponsorship_status && job.sponsorship_status !== 'unknown' ? 1 : 0) + 
  ((job.role_types?.length || 0) > 2 ? 1 : 0);
```

The toggle button displays:
- `+{count}` with down chevron when collapsed
- `Less` with up chevron when expanded

## Expandable Sections

### 1. Recruiters Section

- Header shows expand chevron, "Recruiters" label, and count badge
- Count badge: indigo when recruiters exist, gray otherwise
- Logged-in users see "+ Add" button
- Expands to show `RecruiterList` component (max 3 visible)

### 2. Resume Upload Prompt

Shown when:
- User is logged in (`isLoggedIn=true`)
- User has no resume (`needsResumeUpload=true`)
- AI parsing is available (`!aiUnavailable`)

Expands to show upload instructions with link to `/settings/profile`.

### 3. Resume Match Score

Shown when:
- User has uploaded a resume (`hasResume=true`)
- Score has been calculated (`resumeScore` exists)

Displays:
- Score percentage badge (color-coded: green >= 80%, amber >= 50%, red < 50%)
- "Optimize" button if score needs improvement
- Top priority skills to add (clickable)
- Nice-to-have skills
- Specific suggestion with action prompt
- Improvement potential indicator

### 4. Interview Prep Section

Always rendered via `InterviewPrepBadge` component with:
- `companySlug`
- `companyName`
- `position` (first role type)

## State Management

| State Variable | Type | Purpose |
|----------------|------|---------|
| `showRecruiters` | boolean | Toggles recruiter list visibility |
| `showAddModal` | boolean | Controls recruiter add modal |
| `showAllBadges` | boolean | Toggles expandable badges |
| `showResumeModal` | boolean | Controls resume tweak modal |
| `showUploadPrompt` | boolean | Toggles resume upload instructions |
| `showLoginModal` | boolean | Controls login prompt modal |
| `userResume` | ResumeData | Parsed resume data |
| `hasResume` | boolean | Whether user has any resume |
| `needsResumeUpload` | boolean | Whether upload prompt should show |
| `aiUnavailable` | boolean | AI parsing failed |
| `resumeScore` | ResumeScore | Calculated match score |
| `scoreLoading` | boolean | Score calculation in progress |
| `fundingFilter` | FundingFilter | Company funding category |
| `salaryData` | object | Salary range and confidence |
| `salaryLoading` | boolean | Salary fetch in progress |
| `eventBadges` | EventBadge[] | Time-sensitive event badges |

## Data Fetching

### Company Enrichment
- Fetches from `/api/enrich-company`
- Cached in localStorage with key `company-enrichment-cache`
- TTL: 24 hours

### Salary Data
- Uses `job.salary_min`/`job.salary_max` if available
- Falls back to `/api/salary-lookup`
- Cached in localStorage with key `salary-data-cache`
- TTL: 7 days

### Resume Score
- Checks `user_profiles` for PDF resume URL
- Parses via `/api/parse-resume`
- Falls back to `user_resumes` table (manual builder)
- Score calculated via `scoreResume()` from `@/lib/resume-scorer`

## Props Interface

```typescript
interface JobCardProps {
  job: Job & { ats_type?: string | null; apply_url?: string | null };
  isSaved?: boolean;
  onSave?: (jobId: string) => void;
  recruiters?: Recruiter[];
  isLoggedIn?: boolean;
  onAddRecruiter?: (data: RecruiterFormData) => Promise<void>;
  onVoteRecruiter?: (recruiterId: string, voteType: 'up' | 'down') => Promise<void>;
  onFindRecruiters?: (companySlug: string, companyName: string, jobId: string) => Promise<void>;
  autoApplyEnabled?: boolean;
  application?: ApplicationLog | null;
  onAutoApply?: (jobId: string) => Promise<void>;
  onCancelApplication?: (jobId: string) => Promise<void>;
  saveCount?: number;
}
```

## Styling Notes

- Card has subtle shadow that enhances on hover
- Dark mode support throughout
- Mobile-responsive with flex-wrap
- 44px minimum touch targets for interactive elements
- Transition animations on hover and expand/collapse
