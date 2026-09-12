# Auto-Apply Performance Audit

**Date**: 2026-09-10  
**Scope**: All auto-apply related code including CLI scripts, React components, and shared libraries

---

## Current Architecture

### Components Overview

```
auto-apply/                          # CLI-based batch application system
  index.js                           # Single job entry point
  batch-apply.js                     # Batch processor with connection pooling
  config.js                          # Timing/delay configuration
  fillers/                           # ATS-specific form fillers
    greenhouse.js                    # Greenhouse ATS handler
    lever.js                         # Lever ATS handler
    ashby.js                         # Ashby ATS handler
    jobvite.js                       # Jobvite ATS handler
  utils/
    fields.js                        # Field filling utilities + parallel fill
    browser.js                       # Browser management
    resume.js                        # Resume/file upload
    eeo.js                           # EEO question handling
    skills.js                        # Skills matching
  v2/
    agent.py                         # AI-powered agent (browser-use + Gemini/Groq)

src/lib/
  autoapply-queue.ts                 # Retry queue with exponential backoff
  autoapply-tracker.ts               # Application attempt analytics
  ats-registry.ts                    # ATS detection and field mapping (1555 lines)

src/components/autoapply/
  AutoApplyButton.tsx                # Main apply button with tracking
  ApplicationStatus.tsx              # Status display component
  ProfileForm.tsx                    # Profile data form
```

### Data Flow

1. User clicks "Auto Apply" button
2. `AutoApplyButton.tsx` starts tracking via `autoapply-tracker.ts`
3. CLI script invoked (or v2 agent for AI mode)
4. ATS detected via `ats-registry.ts`
5. Form filled via appropriate filler + `utils/fields.js`
6. Results logged to API, failures queued via `autoapply-queue.ts`

---

## Performance Bottlenecks Found

### 1. CRITICAL: Unnecessary Fixed Delays

**File: `auto-apply/config.js` (lines 60-67)**
```javascript
delays: {
  betweenFields: 100,      // Applied to EVERY field
  betweenBatches: 50,
  beforeSubmit: 800,       // Always waits, even when form is ready
  afterPageLoad: 400,      // Fixed delay, not wait-for-condition
  afterUpload: 300,
},
```
**Impact**: Adds 100ms per field. A 15-field form = 1.5s minimum wasted time.

**File: `auto-apply/fillers/greenhouse.js`**
- Line 67: `await page.waitForTimeout(300)` after resume upload
- Line 75: `await page.waitForTimeout(300)` after cover letter upload
- Line 135: `await page.waitForTimeout(2000)` after submit click
- Lines 169, 195, 238, 263: `config.delays.betweenFields` in sequential loops

**File: `auto-apply/utils/fields.js`**
- Lines 153, 161, 169, 177: `waitForTimeout(300)` inside `selectByLabel` strategies for React Select dropdowns

**Total estimated waste**: 3-5 seconds per application from fixed delays alone.

---

### 2. HIGH: Sequential Operations That Should Be Parallel

**File: `auto-apply/fillers/greenhouse.js`**

| Function | Lines | Issue |
|----------|-------|-------|
| `handleCustomQuestions` | 157-175 | Sequential loop with `config.delays.betweenFields` after each |
| `handleLongFormQuestions` | 180-197 | Sequential loop with delay after each |
| `handleCommonDropdowns` | 200-239 | Iterates ALL labels sequentially, checks patterns one-by-one |
| `handleWorkAuthorization` | 244-268 | Tries 4 auth questions sequentially |

**File: `auto-apply/utils/fields.js` (lines 265-284)**
```javascript
export async function autoFillForm(page, profile) {
  const labels = await page.locator('label:visible').all();
  
  for (const label of labels) {  // SEQUENTIAL
    // ... fill each one with delay
    await page.waitForTimeout(config.delays.betweenFields);
  }
}
```

**Opportunity**: The code already has `fillFieldsParallel()` but it is not used in these functions.

---

### 3. MEDIUM: Heavy Operations Blocking UI

**File: `src/lib/autoapply-queue.ts`**

**Problem**: Synchronous localStorage operations on every change.

```typescript
// Line 312-335: Synchronous load on instantiation
private loadFromStorage(): void {
  const stored = localStorage.getItem(QUEUE_STORAGE_KEY);  // BLOCKING
  const parsed = JSON.parse(stored);  // BLOCKING
  // ... reschedules all pending retries immediately
}

// Line 339-346: Write on every queue change
private saveToStorage(): void {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));  // BLOCKING
}
```

**Impact**: On a queue with 50+ items, this can freeze the UI for 50-100ms.

**File: `src/components/autoapply/AutoApplyButton.tsx` (lines 79-138)**

Inline tracking and logging during the apply operation blocks the UI:
```typescript
const handleClick = async () => {
  setLoading(true);
  tracker.startAttempt(...);  // Synchronous
  try {
    await onAutoApply(jobId, false);
    tracker.markSubmitted();   // Synchronous
    tracker.markConfirmed();   // Synchronous
    const attempt = tracker.completeAttempt(...);
    await logApplicationAttempt(attempt);  // Network call while user waits
  }
  // ...
}
```

---

### 4. MEDIUM: Inefficient Pattern Matching

**File: `auto-apply/utils/fields.js` - `selectByLabel()` (lines 125-198)**

Tries 6 different strategies **sequentially** for every dropdown:
1. Find label and get associated native select
2. Find native select near text
3. Greenhouse/React Select - find "Select..." button
4. React Select with data-testid or aria
5. Click any dropdown-like element near label
6. Greenhouse specific - find field wrapper

**Issue**: Most Greenhouse forms use strategy #3 or #6, but we always try #1 and #2 first.

**File: `auto-apply/utils/fields.js` - `fillByLabel()` (lines 34-89)**

Same issue - 4 strategies tried sequentially for every field.

**File: `src/lib/ats-registry.ts` - `detectATSFromURL()` (lines 1351-1363)**
```typescript
export function detectATSFromURL(url: string): ATSType {
  for (const [atsType, config] of Object.entries(ATS_REGISTRY)) {
    if (atsType === 'unknown') continue;
    for (const pattern of config.urlPatterns) {
      const regex = new RegExp(pattern, 'i');  // Creates new RegExp EVERY call
      if (regex.test(url)) {
        return atsType as ATSType;  // GOOD: Returns immediately
      }
    }
  }
  return 'unknown';
}
```

**Issue**: Creates `new RegExp()` on every call instead of using pre-compiled patterns.

---

### 5. LOW: Connection/Resource Issues

**File: `auto-apply/index.js`**

Creates a new browser instance for every single application. No connection reuse for sequential applies.

**File: `auto-apply/batch-apply.js` (lines 195-207)**
```javascript
async acquireConnection() {
  // Wait for available connection using polling
  return new Promise((resolve) => {
    const check = setInterval(() => {
      for (const conn of this.contexts) {
        if (!conn.busy) {
          clearInterval(check);
          // ...
        }
      }
    }, 100);  // 100ms polling interval
  });
}
```

**Issue**: Uses polling instead of event-based signaling. Wastes up to 100ms per connection acquire.

---

### 6. LOW: Redundant State Calculations

**File: `src/lib/autoapply-queue.ts` - `useRetryQueue()` (lines 709-725)**
```typescript
return {
  queue: items,
  pending: items.filter(i => i.status === 'pending' || i.status === 'retrying'),  // Filter #1
  failed: items.filter(i => i.status === 'exhausted' || i.status === 'cancelled'),  // Filter #2
  stats: {
    pending: items.filter(i => i.status === 'pending').length,    // Filter #3
    retrying: items.filter(i => i.status === 'retrying').length,  // Filter #4
    exhausted: items.filter(i => i.status === 'exhausted').length, // Filter #5
    success: items.filter(i => i.status === 'success').length,     // Filter #6
    cancelled: items.filter(i => i.status === 'cancelled').length, // Filter #7
    total: items.length,
  },
  // ...
};
```

**Issue**: 7 separate filter operations on the same array. Could be done in a single pass.

---

## Quick Wins for Speed Improvement

### 1. Replace Fixed Delays with Wait-for-Condition (Est. savings: 2-4 seconds/app)

**Before:**
```javascript
await page.waitForTimeout(300);
```

**After:**
```javascript
await page.waitForSelector('selector', { state: 'attached', timeout: 2000 }).catch(() => {});
```

**Files to change:**
- `auto-apply/fillers/greenhouse.js`: Lines 67, 75, 135
- `auto-apply/utils/fields.js`: Lines 153, 161, 169, 177

### 2. Use Parallel Filling for All Field Groups (Est. savings: 1-2 seconds/app)

Convert sequential loops in `greenhouse.js` to use existing `fillFieldsParallel()`:

**Before:**
```javascript
for (const [question, answer] of Object.entries(profile.customAnswers)) {
  await fields.fillByLabel(page, question, answer);
  await page.waitForTimeout(config.delays.betweenFields);
}
```

**After:**
```javascript
const customFields = Object.entries(profile.customAnswers).map(([q, a]) => ({
  label: q, value: a
}));
await fields.fillFieldsParallel(page, customFields);
```

### 3. Pre-compile ATS URL Patterns (Est. savings: ~50ms on detection)

**File: `src/lib/ats-registry.ts`**

```typescript
// At module load time (line 1368-1383)
const COMPILED_URL_PATTERNS = Object.entries(ATS_REGISTRY)
  .filter(([type]) => type !== 'unknown')
  .flatMap(([type, config]) => 
    config.urlPatterns.map(p => ({ atsType: type as ATSType, regex: new RegExp(p, 'i') }))
  );

export function detectATSFromURL(url: string): ATSType {
  for (const { atsType, regex } of COMPILED_URL_PATTERNS) {
    if (regex.test(url)) return atsType;
  }
  return 'unknown';
}
```

### 4. Debounce localStorage Writes (Est. savings: UI freeze reduction)

**File: `src/lib/autoapply-queue.ts`**

```typescript
private saveDebounceTimer: NodeJS.Timeout | null = null;

private saveToStorage(): void {
  if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
  this.saveDebounceTimer = setTimeout(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
  }, 100);
}
```

### 5. Move API Logging to Background (Est. savings: UI responsiveness)

**File: `src/components/autoapply/AutoApplyButton.tsx`**

```typescript
// Fire-and-forget logging
if (attempt) {
  queueMicrotask(() => logApplicationAttempt(attempt).catch(console.warn));
}
```

### 6. Single-Pass Stats Calculation

**File: `src/lib/autoapply-queue.ts`**

```typescript
const stats = items.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  acc.total++;
  return acc;
}, { pending: 0, retrying: 0, exhausted: 0, success: 0, cancelled: 0, total: 0 });
```

### 7. Event-Based Connection Pool (Est. savings: up to 100ms per acquire)

**File: `auto-apply/batch-apply.js`**

Replace polling with Promise resolution:
```javascript
async acquireConnection() {
  const available = this.contexts.find(c => !c.busy);
  if (available) {
    available.busy = true;
    return available;
  }
  
  return new Promise(resolve => {
    this.waitQueue.push(resolve);
  });
}

releaseConnection(conn) {
  conn.busy = false;
  const waiting = this.waitQueue.shift();
  if (waiting) {
    conn.busy = true;
    waiting(conn);
  }
}
```

---

## Priority Matrix

| Fix | Effort | Impact | Priority |
|-----|--------|--------|----------|
| Replace fixed delays with wait-for-condition | Low | High (2-4s) | **P0** |
| Use parallel filling for all groups | Low | Medium (1-2s) | **P0** |
| Pre-compile ATS URL patterns | Low | Low (50ms) | P1 |
| Debounce localStorage writes | Low | Medium (UI) | P1 |
| Move API logging to background | Low | Medium (UI) | P1 |
| Single-pass stats calculation | Low | Low (UI) | P2 |
| Event-based connection pool | Medium | Low (100ms) | P2 |
| ATS-specific strategy ordering | Medium | Medium (strategy hit rate) | P2 |

---

## Estimated Total Improvement

With P0 fixes only: **3-6 seconds per application** saved

With all fixes: **4-8 seconds per application** saved, plus improved UI responsiveness

For batch operations (50 jobs): **2.5-5 minutes total** saved
