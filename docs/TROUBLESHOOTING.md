# Troubleshooting Guide

Common issues and solutions discovered during development.

## Table of Contents

- [Interview Prep Page](#interview-prep-page)
- [URL Parameters](#url-parameters)
- [Performance](#performance)
- [Date Filters](#date-filters)

---

## Interview Prep Page

### Questions Not Showing for a Company

**Symptom:** Selecting a company in Interview Prep shows no questions, even though questions exist in the database.

**Causes and Fixes:**

1. **Company name mismatch between tables**
   - The `jobs` table and `interview_questions` table must have matching `company_name` values
   - Check: `SELECT DISTINCT company_name FROM jobs WHERE company_name ILIKE '%google%'`
   - Check: `SELECT DISTINCT company_name FROM interview_questions WHERE company_name ILIKE '%google%'`
   - Fix: Ensure scrapers/seed data use consistent company names

2. **Using company_slug instead of company_name**
   - The interview questions table uses `company_name`, not `company_slug`
   - Use `ilike` for case-insensitive matching: `WHERE company_name ILIKE $1`
   - Do NOT use exact match on slugified values

3. **Position filter too restrictive**
   - Short codes like "swe" won't match "Software Engineer"
   - Fix: Ignore position filters that are too short (< 5 chars) or use fuzzy matching
   - Alternative: Map common abbreviations to full position names

**Debug Query:**
```sql
-- Check if questions exist for a company
SELECT company_name, position, COUNT(*) 
FROM interview_questions 
WHERE company_name ILIKE '%<company>%'
GROUP BY company_name, position;
```

---

## URL Parameters

### Search Params Not Syncing / Hydration Errors

**Symptom:** URL parameters don't reflect in the UI, or you see React hydration mismatch errors.

**Cause:** `useSearchParams()` requires a Suspense boundary in Next.js App Router.

**Fix:** Wrap components using `useSearchParams()` with Suspense:

```tsx
import { Suspense } from 'react';

function MyPageContent() {
  const searchParams = useSearchParams();
  // ... use params
}

export default function MyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyPageContent />
    </Suspense>
  );
}
```

### URL Parameter Not Used in API Fetch

**Symptom:** Selecting a company updates the URL but the API still fetches wrong data.

**Fix:** Use the URL parameter as a fallback in the fetch logic:

```tsx
const urlCompany = searchParams.get('company');
const companyToFetch = selectedCompany || urlCompany;

// Use companyToFetch in your API call
```

---

## Performance

### Slow Page Loads (3-5 seconds)

**Symptom:** Pages take 3-5 seconds to load during development.

**Cause:** This is normal for Next.js development mode. Dev mode includes:
- On-demand compilation
- Hot module replacement overhead
- Unoptimized bundles
- Source maps

**Fix:** Test production performance with:

```bash
npm run build && npm run start
```

Production builds should load in < 1 second.

### Slow Navigation Between Pages

**Fix:** Add `prefetch={true}` to frequently used Links:

```tsx
<Link href="/interview-prep" prefetch={true}>
  Interview Prep
</Link>
```

Note: `prefetch={true}` is the default in production but can help during testing.

---

## Date Filters

### Jobs Not Appearing Despite Being in Database

**Symptom:** Jobs exist in the database but don't appear in the UI with default filters.

**Causes:**

1. **Default date range too restrictive**
   - Original default was 5 months, which may exclude older seed data
   - Fix: Increase default to 24 months for development/demo purposes
   - Location: Check the date filter component's default value

2. **Seed data dates are relative to migration time**
   - Seed data uses relative dates (e.g., `NOW() - INTERVAL '30 days'`)
   - If migrations ran months ago, those jobs may appear "old"
   - Fix: Re-run seed migrations or adjust date calculations

**Debug:**
```sql
-- Check the date range of jobs in the database
SELECT 
  MIN(posted_date) as oldest,
  MAX(posted_date) as newest,
  COUNT(*) as total
FROM jobs;

-- Check how many jobs fall within your filter range
SELECT COUNT(*) 
FROM jobs 
WHERE posted_date > NOW() - INTERVAL '24 months';
```

---

## Quick Checklist

When something isn't working, check these common issues:

- [ ] Are you running in dev mode? Try production build for accurate performance
- [ ] Is the data actually in the database? Check with direct SQL queries
- [ ] Are table column names matching? (company_name vs company_slug)
- [ ] Is the date filter excluding your data?
- [ ] Does the component need a Suspense wrapper?
- [ ] Are URL params being read and used in API calls?
