# Interview Prep Feature

The Interview Prep feature helps users prepare for interviews by providing real interview questions submitted by other candidates. Questions can be browsed by company, role, question type, and time period.

## Overview

The feature consists of three main components:

1. **InterviewPrepBadge** - Badge displayed on job cards when interview questions exist for that company
2. **Interview Prep Page** - Full-page interface for browsing and submitting questions
3. **API Endpoint** - REST API for fetching and submitting interview questions

## Files

| File | Purpose |
|------|---------|
| `/src/components/interview/InterviewPrepBadge.tsx` | Badge component shown on job cards |
| `/src/app/interview-prep/page.tsx` | Main interview prep page with Suspense wrapper |
| `/src/app/api/interview-questions/route.ts` | API endpoint for GET/POST operations |

## InterviewPrepBadge Component

The badge displays on job cards when interview questions exist for a company. It shows the total question count and links to the interview prep page.

### Props

```typescript
interface InterviewPrepBadgeProps {
  companySlug?: string;   // Optional: direct company slug lookup
  companyName: string;    // Company name for search fallback
  position?: string;      // Optional: filter by position (unused currently)
  className?: string;     // Optional: additional CSS classes
}
```

### How It Works

1. On mount, fetches question count from `/api/interview-questions`
2. Uses `company_slug` if provided, otherwise searches by `company_name`
3. Only renders if questions exist (returns `null` when count is 0)
4. Links to `/interview-prep?company=CompanyName`

### Usage Example

```tsx
import { InterviewPrepBadge } from '@/components/interview/InterviewPrepBadge';

// In a job card component
<InterviewPrepBadge 
  companySlug="google"
  companyName="Google"
  className="mt-4"
/>
```

### InterviewQuestionsPanel

An expandable panel component is also exported for showing questions inline:

```tsx
import { InterviewQuestionsPanel } from '@/components/interview/InterviewPrepBadge';

<InterviewQuestionsPanel
  companySlug="meta"
  companyName="Meta"
  isExpanded={expanded}
  onToggle={() => setExpanded(!expanded)}
/>
```

## API Endpoint

### GET /api/interview-questions

Fetches interview questions with optional filters.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `company_slug` | string | - | Filter by exact company slug |
| `search` | string | - | Search company_name using `ilike` (partial match) |
| `position` | string | - | Filter by position (partial match) |
| `question_type` | enum | - | Filter by question type |
| `months_back` | number | 24 | How many months of data to include |
| `limit` | number | 50 | Results per page (max 100) |
| `offset` | number | 0 | Pagination offset |

#### Question Types

- `technical_coding`
- `technical_conceptual`
- `system_design`
- `behavioral`
- `case_study`
- `take_home`
- `oa` (Online Assessment)
- `brain_teaser`
- `other`

#### Response

```json
{
  "questions": [
    {
      "id": "uuid",
      "company_slug": "google",
      "company_name": "Google",
      "position": "Software Engineer",
      "position_level": "new_grad",
      "question_type": "technical_coding",
      "question_text": "Implement a LRU cache...",
      "question_title": "LRU Cache",
      "difficulty": "medium",
      "interview_date": "2026-08-15",
      "interview_round": "Phone Screen",
      "source_name": "leetcode_discuss",
      "source_url": "https://...",
      "upvotes": 42,
      "is_verified": true,
      "scraped_at": "2026-08-20T10:00:00Z"
    }
  ],
  "total": 150,
  "hasMore": true,
  "params": { ... }
}
```

### POST /api/interview-questions

Submit a new interview question.

#### Request Body

```json
{
  "company_name": "Google",
  "company_slug": "google",
  "position": "Software Engineer",
  "position_level": "new_grad",
  "question_type": "technical_coding",
  "question_text": "Given a binary tree, find the maximum path sum...",
  "question_title": "Binary Tree Max Path Sum",
  "difficulty": "hard",
  "interview_date": "2026-08-01",
  "source_url": "https://example.com/source",
  "tags": ["trees", "dynamic_programming"]
}
```

#### Required Fields

- `company_name` - Non-empty string
- `question_type` - Valid enum value
- `question_text` - At least 10 characters

#### Response (201 Created)

```json
{
  "success": true,
  "question": { ... },
  "message": "Interview question submitted successfully"
}
```

## Interview Prep Page

The main page (`/interview-prep`) provides a full browsing experience with filters.

### URL Parameters

- `?company=CompanyName` - Pre-filter by company name

### Features

- **Company Search** - Text input for company name filtering
- **Role Filter** - Dropdown for position filtering (only applies if > 5 chars)
- **Question Type Tabs** - Quick filter by question type
- **Date Range** - Filter by recency (1, 3, 6, 12, or 24 months)
- **Pagination** - Browse through large result sets
- **Submit Modal** - Users can submit new questions

### Suspense Boundary

The page uses React Suspense for loading states:

```tsx
export default function InterviewPrepPage() {
  return (
    <Suspense fallback={<InterviewPrepSkeleton />}>
      <InterviewPrepContent />
    </Suspense>
  );
}
```

## Key Behaviors

### Company Search Logic

The search uses PostgreSQL `ilike` for flexible matching:

```typescript
// In the API route
query = query.ilike('company_name', `%${search}%`);
```

This allows partial matches like "goog" matching "Google".

### Date Filter Default

The date filter defaults to **24 months** ("All Time" in the UI), ensuring users see a comprehensive set of questions by default.

### Position Filter Behavior

Position filtering is only applied when the value is longer than 5 characters:

```typescript
// In the page component
if (selectedRole && selectedRole.length > 5) {
  params.set('position', selectedRole);
}
```

This prevents short codes like "swe" from being used as filters since they may not match database values.

### Badge Visibility

The badge only renders when questions exist:

```typescript
if (loading || questionCount === null || questionCount === 0) {
  return null;
}
```

## Styling

### Color Schemes

**Difficulty Colors:**
- Easy: Green (`bg-green-100 text-green-700`)
- Medium: Yellow (`bg-yellow-100 text-yellow-700`)
- Hard: Red (`bg-red-100 text-red-700`)
- Unknown: Gray (`bg-gray-100 text-gray-700`)

**Question Type Colors:**
- Technical Coding: Blue
- Technical Conceptual: Indigo
- Behavioral: Purple
- System Design: Orange
- Online Assessment: Cyan
- Brain Teaser: Pink

All colors have corresponding dark mode variants.

## Troubleshooting

### Badge Not Showing

1. **No questions exist** - Check if questions exist for the company in the database
2. **Name mismatch** - The API uses `ilike` search, so "Meta" will find "Meta Platforms Inc." but ensure the company name is close enough
3. **API error** - Check browser console for fetch errors

### Questions Not Loading

1. **Check network tab** - Verify the API request is being made
2. **Verify Supabase connection** - Ensure environment variables are set
3. **Check date range** - Questions older than `months_back` won't appear

### Search Not Finding Company

1. **Check spelling** - Search is case-insensitive but requires partial match
2. **Try different variations** - "Google" vs "Google LLC" vs "Alphabet"
3. **Check database** - Verify questions exist for that company in Supabase

### Position Filter Not Working

The position filter is intentionally ignored for short role codes (5 chars or less). Use full role names like "Software Engineer" instead of "swe".

## Database Schema

The feature uses the `interview_questions` table. Key columns:

```sql
CREATE TABLE interview_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug TEXT,
  company_name TEXT NOT NULL,
  position TEXT,
  position_level TEXT,
  question_type question_type_enum NOT NULL,
  question_text TEXT NOT NULL,
  question_title TEXT,
  difficulty difficulty_enum DEFAULT 'unknown',
  interview_date DATE,
  interview_round TEXT,
  source_name TEXT,
  source_url TEXT,
  upvotes INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_duplicate BOOLEAN DEFAULT false,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Related Documentation

- [Database Schema](DATABASE.md) - Full database documentation
- [Frontend Guide](FRONTEND.md) - Component patterns and styling
- [Architecture Overview](ARCHITECTURE.md) - System design
