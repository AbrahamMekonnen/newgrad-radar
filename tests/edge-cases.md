# Edge Case Test Suite

Comprehensive test cases for NewGrad Radar job tracker application edge cases.

---

## 1. Authentication Edge Cases

### 1.1 Expired Session Token

**Description:** User's JWT token has expired but they attempt to access protected routes.

**Steps to Reproduce:**
1. Log in successfully and receive a valid session
2. Wait for token expiration (or manually set `exp` claim to past time in local storage)
3. Attempt to navigate to `/my-list`, `/saved`, or `/settings`

**Expected Behavior:**
- Middleware should detect expired token via `supabase.auth.getUser()`
- User should be redirected to `/auth/login?redirect={original_path}`
- No sensitive data should be exposed before redirect
- Original path should be preserved for post-login redirect

**What Could Go Wrong:**
- Race condition: Page renders partially before redirect completes
- Token refresh fails silently, leaving user in limbo state
- `supabaseResponse.cookies.set()` fails, breaking session restoration
- Redirect loop if login page also requires auth check
- Cached React Query data displayed before auth check completes

---

### 1.2 Concurrent Login Sessions

**Description:** User logs in from multiple devices/browsers simultaneously.

**Steps to Reproduce:**
1. Log in from Device A
2. Log in from Device B with same credentials
3. Perform actions on both devices simultaneously (e.g., save a job)

**Expected Behavior:**
- Both sessions should remain valid (Supabase allows multiple sessions)
- Changes should sync via Supabase Realtime subscriptions
- No data corruption from concurrent writes
- Optimistic updates should reconcile properly

**What Could Go Wrong:**
- `useSupabaseRealtime` hook misses update events during network blips
- `useOptimisticJobs` shows stale data after external update
- User sees "phantom" saved jobs that were unsaved from another device
- Session invalidation on Device A when Device B logs in (if single-session mode enabled)
- Realtime subscription reconnect fails after network recovery

---

### 1.3 Invalid/Malformed JWT Token

**Description:** User's token in cookies/localStorage is corrupted or tampered with.

**Steps to Reproduce:**
1. Log in successfully
2. Manually modify JWT in browser storage (change payload, remove signature)
3. Refresh page or make API request

**Expected Behavior:**
- Token validation should fail gracefully
- User should be logged out and redirected to login
- Clear invalid tokens from storage
- No stack trace or sensitive error details exposed to client

**What Could Go Wrong:**
- `createServerClient` throws unhandled exception on malformed token
- Token parsing error crashes middleware, returning 500
- Partial token decode succeeds, returning user with wrong `user_id`
- Invalid token persists in cookies after failed validation

---

### 1.4 OAuth Provider Callback Failure

**Description:** OAuth flow (Google, GitHub) returns with an error or unexpected state.

**Steps to Reproduce:**
1. Initiate OAuth login
2. Deny permissions on provider's consent screen
3. Return to callback URL with error parameters

**Expected Behavior:**
- Parse error from callback query params (`error`, `error_description`)
- Display user-friendly error message
- Provide option to retry or use alternative login method
- No session created for failed OAuth

**What Could Go Wrong:**
- Callback handler assumes success, crashes on missing `code` param
- CSRF state mismatch throws cryptic error
- User stuck on blank callback page after provider error
- OAuth token exchange timeout leaves orphaned session

---

### 1.5 Session Refresh During Critical Operation

**Description:** User's token refreshes while they're submitting an application or saving data.

**Steps to Reproduce:**
1. Start a long operation (e.g., auto-apply submission)
2. Token refresh triggers mid-operation
3. Original request completes with old token

**Expected Behavior:**
- Token refresh should be handled transparently
- In-flight requests should use existing token or retry with new token
- No data loss during refresh
- User should not be logged out during active operations

**What Could Go Wrong:**
- Supabase client uses expired token for critical write
- Concurrent refresh attempts cause race condition
- `setAll()` cookie update fails, breaking subsequent requests
- Application status stuck in `filling` state if auth fails mid-apply

---

## 2. Job Listing Edge Cases

### 2.1 Empty Search Results

**Description:** User search/filter combination returns zero jobs.

**Steps to Reproduce:**
1. Apply multiple filters: role_type = "security", tier = "faang", work_mode = "remote"
2. Add location filter for obscure city
3. Enable "new_grad_only" smart filter

**Expected Behavior:**
- Display friendly "No jobs found" message
- Show which filters are active
- Suggest removing filters or broadening search
- Do not show loading spinner indefinitely

**What Could Go Wrong:**
- Empty array `[]` not handled, shows undefined behavior
- Infinite loading state (filter state never resolves)
- `useJobFilterCounts` shows non-zero counts for filters with no results
- Pagination controls still visible with empty results
- "Load more" button visible when there are no more results

---

### 2.2 Pagination at Boundary Limits

**Description:** User navigates to extreme pagination boundaries.

**Steps to Reproduce:**
1. Load job list with 500+ jobs
2. Navigate to last page
3. Rapidly click "next" multiple times
4. Navigate directly to page 0 or negative page

**Expected Behavior:**
- Last page should disable "next" button
- Page 1 should disable "previous" button
- Invalid page numbers should redirect to page 1
- Count should reflect total jobs, not loaded jobs

**What Could Go Wrong:**
- Page beyond `MAX_ACTIVE_JOBS` (500) returns empty but shows page number
- Negative page index causes Supabase `range()` error
- Off-by-one error shows duplicate jobs at page boundaries
- `useOptimisticJobs` cache inconsistent across page changes
- Rapid pagination causes requests to complete out of order

---

### 2.3 Malformed Job Data from Scraper

**Description:** Scraper inserts job with missing required fields or invalid data types.

**Steps to Reproduce:**
1. Scraper encounters job with null `title`
2. Job has empty string `url`
3. `posted_at` has invalid ISO format
4. `role_types` is string instead of array

**Expected Behavior:**
- Frontend should handle null/undefined fields gracefully
- Display placeholder text for missing data ("Untitled Position")
- Skip malformed jobs or filter them out
- Log error for debugging without crashing UI

**What Could Go Wrong:**
- `job.title.toLowerCase()` throws on null title
- Invalid URL breaks `<a href={job.url}>` navigation
- Date parsing crashes: `new Date(null)` returns "Invalid Date" string
- TypeScript types don't match runtime data, causing subtle bugs
- `job.role_types.map()` fails when field is string

---

### 2.4 Job Becomes Inactive During User Session

**Description:** User is viewing a job that gets marked inactive by scraper cleanup.

**Steps to Reproduce:**
1. User opens job detail modal for a job
2. Background scraper runs `cleanup_jobs()` marking that job inactive
3. User tries to save or apply to the job

**Expected Behavior:**
- Show "This job is no longer available" message
- Prevent save/apply action
- Update job list to remove inactive job
- Preserve any notes user had written

**What Could Go Wrong:**
- Save succeeds but job disappears on refresh, confusing user
- Realtime subscription doesn't detect `is_active` change
- User applies to expired job, wastes auto-apply quota
- Modal shows stale data after job becomes inactive
- "Apply" button visible for inactive jobs

---

### 2.5 Extremely Long Job Title/Description

**Description:** Job has unusually long text fields that break layout.

**Steps to Reproduce:**
1. Job title with 500+ characters
2. Location string with multiple newlines and special characters
3. Description with HTML/Markdown/emojis

**Expected Behavior:**
- Text should truncate with ellipsis in list view
- Full text available in expanded view
- Layout should not break or overflow
- HTML should be sanitized (no XSS)

**What Could Go Wrong:**
- Horizontal scroll appears on job cards
- Title pushes action buttons off-screen on mobile
- Unescaped HTML renders and executes
- Emoji rendering breaks in certain fonts
- Very long single word (no spaces) breaks flexbox layout

---

### 2.6 Duplicate Job IDs

**Description:** Two jobs with same generated ID (hash collision).

**Steps to Reproduce:**
1. Two companies post same job title at same time
2. ID generation produces collision
3. Second job attempts insert

**Expected Behavior:**
- Upsert logic should update existing job
- Merge `discovery_sources` arrays as implemented
- Do not create duplicate entries
- Log collision for investigation

**What Could Go Wrong:**
- `upsert_jobs()` raises constraint violation
- First job's data overwritten by second
- Array merge creates duplicate values in `discovery_sources`
- `updated_at` timestamp doesn't reflect latest scrape

---

## 3. Auto-Apply Edge Cases

### 3.1 Job Expired Mid-Application

**Description:** Job posting closes while auto-apply agent is filling form.

**Steps to Reproduce:**
1. Queue job for auto-apply
2. Agent starts filling form
3. Company closes job posting mid-process
4. Agent tries to submit

**Expected Behavior:**
- Detect "position filled" or 404 page
- Mark job as failed with `error_type: "permanent"`
- Do not retry expired jobs
- Update `application_logs` status to "failed"

**What Could Go Wrong:**
- Agent keeps retrying on expired job (wrong error classification)
- User charged/rate-limited for failed attempt
- Status stuck in "filling" forever if detection fails
- No notification to user that job expired

---

### 3.2 Network Failure During Form Submission

**Description:** Network drops while browser-use agent is mid-submit.

**Steps to Reproduce:**
1. Agent fills all form fields
2. Network disconnects just before/during submit click
3. Connection restores after timeout

**Expected Behavior:**
- Detect timeout/network error
- Classify as `ErrorType.NETWORK` for retry
- Respect exponential backoff (2s -> 4s -> 8s)
- Maximum 3 retry attempts before failing

**What Could Go Wrong:**
- Form submitted but confirmation not received (duplicate application)
- Browser state corrupted, needs full restart
- Retry starts from beginning, not from where it left off
- User profile data missing on retry attempt

---

### 3.3 Rate Limiting by ATS

**Description:** Greenhouse/Lever/Ashby returns 429 Too Many Requests.

**Steps to Reproduce:**
1. Queue 10+ jobs for same company
2. Worker processes in parallel (MAX_CONCURRENT=3)
3. ATS rate limits requests

**Expected Behavior:**
- Detect 429 status code or "rate limit" message
- Classify as `ErrorType.RATE_LIMIT`
- Back off for longer period (60s base, up to 5min)
- Respect per-company rate limits

**What Could Go Wrong:**
- All parallel jobs fail simultaneously
- Worker keeps hammering rate-limited ATS
- User's IP/account flagged for abuse
- Rate limit not detected (non-standard response)
- `RETRY_STRATEGIES[ErrorType.RATE_LIMIT]` jitter causes all retries at once

---

### 3.4 CAPTCHA Encountered

**Description:** ATS presents CAPTCHA challenge during application.

**Steps to Reproduce:**
1. Agent navigates to application form
2. Cloudflare/reCAPTCHA challenge appears
3. Agent cannot solve automatically

**Expected Behavior:**
- Detect CAPTCHA challenge
- Mark as `error_type: "captcha"` (non-retryable)
- Notify user that manual intervention needed
- Preserve filled form data if possible

**What Could Go Wrong:**
- Agent loops forever trying to click submit
- CAPTCHA not detected, counts as success
- User not notified, assumes job was applied
- Manual intervention UI doesn't exist

---

### 3.5 User Profile Incomplete

**Description:** User queues job but profile is missing required fields.

**Steps to Reproduce:**
1. User has no resume uploaded
2. Phone number missing
3. Work authorization not specified
4. Job requires all three

**Expected Behavior:**
- Validate profile before queueing
- `pre-apply-check.ts` should catch missing fields
- Show user which fields are missing
- Block auto-apply until profile complete

**What Could Go Wrong:**
- Job queued but fails at runtime, wasting queue slot
- Partial form submission with empty required fields
- Validation differs between frontend and worker
- `build_agent_profile()` uses empty strings for nulls, causing ATS rejection

---

### 3.6 Concurrent Applications to Same Company

**Description:** User queues multiple jobs at same company simultaneously.

**Steps to Reproduce:**
1. User enables auto-apply for 5 roles at Google
2. All 5 jobs processed in parallel
3. Google's ATS links applications to same candidate

**Expected Behavior:**
- ATS should handle multiple applications gracefully
- Each application tracked separately in `application_logs`
- No duplicate profile creation on ATS side
- User sees all 5 in their "Applications" view

**What Could Go Wrong:**
- ATS blocks second application (one per day limit)
- Profile data conflicts between applications
- Worker claims same job twice (race condition in `claim_autoapply_job`)
- `WORKER_ID` collision if multiple workers running

---

### 3.7 Worker Shutdown Mid-Job

**Description:** Worker receives SIGTERM while processing an application.

**Steps to Reproduce:**
1. Job is in "filling" state
2. `kill -TERM <worker_pid>` sent
3. Worker exits before completing

**Expected Behavior:**
- Handle `shutdown_requested` flag
- Complete in-progress job before exit
- Or: release lock on job, allow another worker to pick up
- No corrupt state left in database

**What Could Go Wrong:**
- Job stuck in "filling" forever (lock not released)
- `active_tasks` not properly awaited
- Partial form submission left on ATS site
- `application_logs` status never updated
- Lock expires but job still actually running

---

## 4. Database Edge Cases

### 4.1 Concurrent Updates to Same Job

**Description:** Two scrapers update same job simultaneously.

**Steps to Reproduce:**
1. Greenhouse scraper fetches job
2. Simplify scraper also has same job
3. Both call `upsert_jobs()` at same instant

**Expected Behavior:**
- Last write wins for scalar fields
- Arrays should merge without duplicates
- No data loss or corruption
- `updated_at` reflects latest update

**What Could Go Wrong:**
- Race condition overwrites array fields
- `merge_arrays()` called with stale `existing_data`
- Transaction isolation not enforced
- Duplicate entries in `discovery_sources` array

---

### 4.2 RLS Policy Bypass Attempt

**Description:** Malicious user tries to access/modify other users' data.

**Steps to Reproduce:**
1. User A copies their JWT
2. Modifies `user_id` in request payload
3. Attempts to read User B's saved jobs

**Expected Behavior:**
- RLS policies should enforce user isolation
- Query should return empty or error
- No data leakage across users
- Audit log of attempted violation

**What Could Go Wrong:**
- Service role key used in client (bypasses RLS)
- `user_id` from payload trusted instead of JWT
- RLS policy has gaps for certain operations
- Error message reveals existence of other user's data

---

### 4.3 Null Values in Required Computed Fields

**Description:** Database trigger or function produces null for required field.

**Steps to Reproduce:**
1. Insert application with null `stage_changed_at`
2. Query for applications sorted by `last_activity`
3. Compute derived fields

**Expected Behavior:**
- Database defaults should fill nulls
- Queries should handle nulls gracefully (COALESCE)
- Frontend should display placeholder for null dates
- No crashes on null arithmetic

**What Could Go Wrong:**
- `stage_changed_at` null causes sort error
- `next_interview_at - NOW()` returns null, breaking countdown
- `offer_base_salary::numeric` fails on null
- `COALESCE` chain produces wrong fallback

---

### 4.4 Foreign Key Constraint Violations

**Description:** Job deleted while user has saved reference.

**Steps to Reproduce:**
1. User saves job to `saved_jobs` table
2. Admin or cleanup deletes job from `jobs` table
3. User loads their saved jobs page

**Expected Behavior:**
- Cascade delete or soft delete should handle
- Or: preserve saved job reference with null join
- User sees "This job no longer exists" message
- No orphaned records

**What Could Go Wrong:**
- Foreign key constraint prevents deletion
- Saved job shows blank card with no data
- `LEFT JOIN` returns nulls, frontend crashes
- Cleanup job fails, leaving inconsistent state

---

### 4.5 Array Column with Massive Size

**Description:** `discovery_sources` array grows unbounded.

**Steps to Reproduce:**
1. Job discovered by 100+ different sources
2. Each scrape run adds to array via `merge_arrays()`
3. Array exceeds PostgreSQL array size limits

**Expected Behavior:**
- Cap array size at reasonable limit (e.g., 50)
- Deduplication should prevent unbounded growth
- Query performance should not degrade
- Display should truncate with "+N more"

**What Could Go Wrong:**
- Array query becomes slow (no GIN index)
- JSON serialization fails for huge arrays
- `merge_arrays()` is O(n^2), slows scraper
- Frontend tries to render 1000 badge components

---

### 4.6 Database Connection Pool Exhaustion

**Description:** Too many concurrent connections overwhelm Supabase free tier.

**Steps to Reproduce:**
1. 10 scrapers running simultaneously
2. Multiple frontend users refreshing
3. Worker pool with MAX_CONCURRENT=5
4. Realtime subscriptions for each user

**Expected Behavior:**
- Connection pooling should manage limits
- Queue requests when pool exhausted
- Graceful degradation (slower, not crashed)
- Alert on pool exhaustion

**What Could Go Wrong:**
- "Too many connections" error cascades
- Scraper loses jobs mid-batch
- Realtime subscriptions silently fail
- User sees stale data with no error message
- Worker can't release job lock due to connection failure

---

## 5. UI Edge Cases

### 5.1 Rapid Button Clicking

**Description:** User clicks save/apply button multiple times quickly.

**Steps to Reproduce:**
1. Click "Save Job" button rapidly 5 times
2. Click "Apply" before previous request completes
3. Double-click form submit button

**Expected Behavior:**
- Button should disable after first click
- Optimistic update prevents duplicate visual feedback
- Server should deduplicate or reject duplicate requests
- Loading spinner shows processing state

**What Could Go Wrong:**
- 5 `saved_jobs` records created for same job
- `useOptimisticJobs` state becomes inconsistent
- Multiple auto-apply queue entries for same job
- UI flickers between saved/unsaved states
- Network requests complete out of order, wrong final state

---

### 5.2 Form Resubmission on Refresh

**Description:** User submits form, then refreshes page.

**Steps to Reproduce:**
1. Submit profile update form
2. Press F5 or browser refresh
3. Browser shows "Resubmit form?" dialog
4. User clicks "Yes"

**Expected Behavior:**
- POST requests should redirect to GET (PRG pattern)
- Or: use SPA navigation that doesn't trigger browser form resubmit
- Idempotent operations should handle gracefully
- Display confirmation that shows current state, not resubmit

**What Could Go Wrong:**
- Duplicate profile update causes confusion
- Application submitted twice
- Credits/quota double-deducted
- Server doesn't expect duplicate, throws error

---

### 5.3 Browser Back Button After Action

**Description:** User navigates back after saving/applying.

**Steps to Reproduce:**
1. Save a job from the job list
2. Navigate to job detail
3. Press browser back button
4. Expect to see updated saved status

**Expected Behavior:**
- React Query cache should reflect saved state
- History navigation should not undo actions
- Back button should work predictably
- No stale cached pages

**What Could Go Wrong:**
- Bfcache serves stale HTML showing job as unsaved
- Back navigation triggers full page reload
- React state reset, loses optimistic updates
- History stack corrupted by client-side routing

---

### 5.4 Very Slow Network Connection

**Description:** User on 2G/slow connection tries to use app.

**Steps to Reproduce:**
1. Throttle network to "Slow 3G" in DevTools
2. Try to load job list
3. Attempt to save a job
4. Navigate between pages

**Expected Behavior:**
- Loading skeletons should show immediately
- Timeout errors should be user-friendly
- Optimistic updates should feel instant
- Large payloads should be paginated/lazy-loaded

**What Could Go Wrong:**
- Blank screen for 30+ seconds
- Timeout not configured, request hangs forever
- Optimistic update reverts after delayed failure
- Images/avatars block page render
- User thinks action failed, tries again (duplication)

---

### 5.5 Offline Mode / Network Disconnect

**Description:** User's network disconnects while using app.

**Steps to Reproduce:**
1. Load app while online
2. Disconnect network (airplane mode)
3. Try to save a job
4. Reconnect and refresh

**Expected Behavior:**
- Detect offline state
- Queue actions for retry when online
- Show "You're offline" banner
- Sync pending actions when reconnected

**What Could Go Wrong:**
- No offline detection, actions silently fail
- React Query retries infinitely
- Service worker caches stale data
- Reconnection doesn't trigger sync
- User loses unsaved work

---

### 5.6 Accessibility Edge Cases

**Description:** User navigates with keyboard/screen reader.

**Steps to Reproduce:**
1. Tab through job list
2. Use Enter to open job details
3. Navigate modal with keyboard
4. Use screen reader to read job info

**Expected Behavior:**
- Focus management should be logical
- Modal should trap focus
- ARIA labels should be descriptive
- Color contrast should meet WCAG AA

**What Could Go Wrong:**
- Tab order skips interactive elements
- Modal doesn't trap focus, user tabs to hidden content
- "Save" button has no accessible label
- Status badges rely only on color
- Focus lost after modal close

---

### 5.7 Mobile-Specific Touch Issues

**Description:** Touch interactions behave unexpectedly on mobile.

**Steps to Reproduce:**
1. Long-press on job card
2. Swipe gestures on list
3. Tap near edge of button
4. Use mobile keyboard with form

**Expected Behavior:**
- Touch targets should be at least 44x44px
- No accidental taps from scroll
- Keyboard should not obscure input
- Pull-to-refresh should work

**What Could Go Wrong:**
- Ghost tap on element behind modal
- Scroll momentum triggers tap on wrong item
- Virtual keyboard covers submit button
- Touch feedback inconsistent with hover styles
- Double-tap zoom interferes with buttons

---

## 6. Scraper Edge Cases

### 6.1 ATS API Down/Unreachable

**Description:** Greenhouse/Lever API returns 5xx or times out.

**Steps to Reproduce:**
1. Greenhouse API has outage
2. Scraper tries to fetch jobs
3. All requests fail with 503

**Expected Behavior:**
- Log error and continue to other sources
- Do not mark all jobs as inactive
- Retry with exponential backoff
- Alert/notify if extended outage

**What Could Go Wrong:**
- `mark_inactive()` called with empty `active_ids`, deactivates all jobs
- Single source failure crashes entire scraper
- No distinction between "no jobs" and "API error"
- Stale jobs remain active indefinitely

---

### 6.2 Malformed API Response

**Description:** ATS returns unexpected JSON structure.

**Steps to Reproduce:**
1. Greenhouse changes API format
2. `data.get("jobs")` returns None instead of list
3. Nested location object structure changes

**Expected Behavior:**
- Graceful handling of missing keys
- Log schema change for investigation
- Continue with partial data
- Do not crash scraper

**What Could Go Wrong:**
- `for job in data.get("jobs", [])` works, but `job["id"]` throws
- Type mismatch: expected dict, got list
- Entire scraper run fails, missing all updates
- Invalid data inserted to database

---

### 6.3 Rate Limiting by Source

**Description:** Job board API rate limits scraper.

**Steps to Reproduce:**
1. Scrape 200+ companies from Greenhouse
2. API returns 429 after 100 requests
3. Rate limit window is 1 hour

**Expected Behavior:**
- Detect rate limit response
- Respect `Retry-After` header if present
- Implement request spacing
- Continue with other sources

**What Could Go Wrong:**
- Scraper IP blocked permanently
- No rate limit detection, keeps retrying
- Jobs from rate-limited companies not updated
- Partial results inserted, inconsistent state

---

### 6.4 HTML Scraping Changes (Non-API Sources)

**Description:** Website layout changes break HTML parser.

**Steps to Reproduce:**
1. HN "Who's Hiring" thread changes format
2. CSS selectors no longer match
3. Scraper extracts wrong data or nothing

**Expected Behavior:**
- Detect unusually low job count
- Log parsing failures
- Alert on significant drop from baseline
- Graceful degradation

**What Could Go Wrong:**
- Wrong data extracted (company name in title field)
- Empty results interpreted as "no jobs this month"
- Scraper runs successfully but inserts garbage
- No monitoring for data quality

---

### 6.5 Infinite Pagination Loop

**Description:** API pagination returns same page repeatedly.

**Steps to Reproduce:**
1. API has bug returning same `next_cursor` value
2. Scraper keeps requesting same page
3. Infinite loop until timeout

**Expected Behavior:**
- Detect duplicate pages
- Maximum page count limit
- Timeout for pagination loop
- Log anomaly

**What Could Go Wrong:**
- Scraper runs for hours, consuming resources
- Duplicate jobs inserted (if no dedup)
- GitHub Actions timeout bill
- Memory exhaustion from accumulating results

---

### 6.6 Timezone/Date Parsing Inconsistencies

**Description:** Different sources return dates in different formats/timezones.

**Steps to Reproduce:**
1. Greenhouse returns ISO UTC
2. Lever returns Unix timestamp
3. Manual entry has no timezone
4. Compare/sort jobs by date

**Expected Behavior:**
- Normalize all dates to UTC
- Handle missing timezone (assume UTC or local)
- Graceful handling of unparseable dates
- Display in user's local timezone

**What Could Go Wrong:**
- Jobs sorted incorrectly by date
- "New Listing" badge wrong due to timezone
- `cleanup_jobs()` deletes wrong jobs
- Deadline reminders fire at wrong time
- `parse_iso()` throws on non-ISO format

---

### 6.7 Unicode/Special Characters in Job Data

**Description:** Job title contains emojis, non-ASCII, or special characters.

**Steps to Reproduce:**
1. Job title: "Software Engineer - We're Hiring! "
2. Company name contains accent: "Cafe"
3. Location has Chinese characters

**Expected Behavior:**
- Store UTF-8 correctly in PostgreSQL
- Display correctly in frontend
- Handle in search/filter
- Generate valid job ID

**What Could Go Wrong:**
- Encoding mismatch corrupts data
- Job ID hash different for same Unicode (normalization)
- Search fails to match Unicode variants
- API JSON serialization fails on certain chars
- URL encoding issues in job links

---

## Test Execution Notes

### Priority Levels

- **P0 (Critical):** Data loss, security issues, complete feature failure
  - 1.3 Invalid JWT Token
  - 3.1 Job Expired Mid-Application
  - 4.2 RLS Policy Bypass
  - 6.1 ATS API Down

- **P1 (High):** Major functionality broken, poor user experience
  - 1.1 Expired Session
  - 3.2 Network Failure During Submission
  - 5.1 Rapid Button Clicking
  - 6.2 Malformed API Response

- **P2 (Medium):** Minor issues, workarounds exist
  - 2.3 Malformed Job Data
  - 5.3 Browser Back Button
  - 6.6 Timezone Inconsistencies

- **P3 (Low):** Edge cases unlikely to occur in normal usage
  - 2.6 Duplicate Job IDs
  - 4.5 Massive Array Size
  - 6.5 Infinite Pagination Loop

### Testing Environment Requirements

- Supabase local emulator for database tests
- Playwright for UI/browser automation tests
- Mock ATS APIs for scraper tests
- Network throttling tools for connectivity tests
- Multiple browser sessions for concurrency tests

### Monitoring Recommendations

1. **Error tracking:** Sentry for frontend/backend errors
2. **Scraper health:** Track job counts per source over time
3. **Queue monitoring:** Alert on stuck jobs in "filling" state
4. **Database metrics:** Connection pool, query latency
5. **Realtime health:** Subscription count, message latency
