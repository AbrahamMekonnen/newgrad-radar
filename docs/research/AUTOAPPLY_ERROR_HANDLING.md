# Auto-Apply Error Handling and Recovery

Research on best practices for handling failures in automated job application systems.

---

## 1. Common Failure Modes

### 1.1 Network and Connectivity Issues

| Error Type | Frequency | Detection Method | Impact |
|------------|-----------|------------------|--------|
| **Network Timeout** | High (15-20%) | `TimeoutError` after navigation | Page fails to load |
| **Connection Reset** | Medium (5-10%) | `net::ERR_CONNECTION_RESET` | Mid-form failure |
| **DNS Resolution** | Low (1-2%) | `net::ERR_NAME_NOT_RESOLVED` | Total failure |
| **SSL/TLS Errors** | Low (1-2%) | `net::ERR_CERT_*` | Cannot access site |
| **Rate Limiting (429)** | Medium (10-15%) | HTTP 429 response | Temporary block |

**Typical Timeout Thresholds:**
- Page navigation: 30 seconds
- Field interaction: 5 seconds
- File upload: 60 seconds
- Form submission: 30 seconds

### 1.2 CAPTCHA and Bot Detection

| Detection Type | Frequency | Indicators |
|----------------|-----------|------------|
| **reCAPTCHA v2** | High (20-30%) | `iframe[src*="recaptcha"]` present |
| **reCAPTCHA v3** | Medium (10-15%) | Silent scoring, unexpected redirects |
| **hCaptcha** | Medium (5-10%) | `iframe[src*="hcaptcha"]` present |
| **Cloudflare Turnstile** | Growing (5-10%) | `cf-turnstile` class |
| **Custom Bot Detection** | Low (5%) | Behavioral analysis, honeypot fields |
| **IP Blocking** | Low (2-5%) | 403 responses, redirect loops |

**Detection Signals:**
```javascript
// Check for common CAPTCHA presence
const hasCaptcha = await page.evaluate(() => {
  return !!(
    document.querySelector('iframe[src*="recaptcha"]') ||
    document.querySelector('iframe[src*="hcaptcha"]') ||
    document.querySelector('.cf-turnstile') ||
    document.querySelector('[data-sitekey]')
  );
});
```

### 1.3 Form Validation Errors

| Error Type | Frequency | Common Causes |
|------------|-----------|---------------|
| **Required Field Missing** | High (25%) | Field not found by selector |
| **Invalid Format** | Medium (15%) | Phone/email format mismatch |
| **Character Limit Exceeded** | Medium (10%) | Long answers truncated |
| **Invalid Selection** | Low (5%) | Dropdown option not available |
| **File Type Rejected** | Low (5%) | Resume format not accepted |
| **File Size Exceeded** | Low (3%) | Resume > 10MB |

**Validation Error Detection:**
```javascript
// Check for validation error indicators
const hasValidationErrors = await page.evaluate(() => {
  return !!(
    document.querySelector('.error-message:visible') ||
    document.querySelector('[aria-invalid="true"]') ||
    document.querySelector('.field-error') ||
    document.querySelector('input:invalid')
  );
});
```

### 1.4 Session and Authentication Issues

| Issue | Frequency | Impact |
|-------|-----------|--------|
| **Session Expiration** | Medium (10%) | Form resets, login required |
| **CSRF Token Invalid** | Low (3%) | Submission fails silently |
| **OAuth Flow Break** | Low (2%) | LinkedIn/Google sign-in fails |
| **Cookie Rejection** | Low (2%) | Form state not preserved |

### 1.5 Dynamic Content Issues

| Issue | Frequency | Cause |
|-------|-----------|-------|
| **Element Not Found** | High (20%) | React/Vue hydration timing |
| **Stale Element Reference** | Medium (15%) | DOM replaced during interaction |
| **Shadow DOM Inaccessible** | Low (5%) | Elements inside shadow roots |
| **Lazy Load Not Triggered** | Medium (10%) | Form sections not visible |
| **Infinite Scroll Trap** | Low (3%) | Cannot reach form bottom |

### 1.6 ATS-Specific Quirks

| ATS | Common Issues |
|-----|---------------|
| **Greenhouse** | Multi-page forms, custom question parsing |
| **Lever** | React Select dropdowns, resume parsing |
| **Ashby** | Dynamic field generation, location autocomplete |
| **Jobvite** | Legacy forms, frame-based sections |
| **Workday** | Heavy JavaScript, slow load times, complex navigation |
| **iCIMS** | Pop-up blockers, session timeouts |
| **Taleo** | Flash-era patterns, poor accessibility |

---

## 2. Recovery Strategies

### 2.1 Retry with Exponential Backoff

**Implementation Pattern:**
```javascript
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    retryOn = [TimeoutError, NetworkError],
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if this error type is retryable
      const isRetryable = retryOn.some(errType => error instanceof errType);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      console.log(`[retry] Attempt ${attempt} failed: ${error.message}`);
      console.log(`[retry] Waiting ${delay}ms before retry...`);
      
      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}
```

**Recommended Retry Configuration by Error Type:**

| Error Type | Max Retries | Initial Delay | Notes |
|------------|-------------|---------------|-------|
| Network Timeout | 3 | 2s | May indicate server load |
| Rate Limit (429) | 5 | 60s | Respect Retry-After header |
| Connection Reset | 2 | 1s | Likely transient |
| Element Not Found | 3 | 500ms | Wait for DOM update |
| Stale Element | 5 | 100ms | Re-query element |

### 2.2 Alternative Selector Strategies

**Selector Fallback Chain:**
```javascript
const SELECTOR_STRATEGIES = {
  firstName: [
    // Strategy 1: Explicit label
    'label:has-text("First name") + input',
    'label:has-text("First Name") + input',
    
    // Strategy 2: ID/name attributes
    'input[id*="first"][id*="name" i]',
    'input[name*="first"][name*="name" i]',
    
    // Strategy 3: Placeholder
    'input[placeholder*="First" i]',
    
    // Strategy 4: Aria labels
    'input[aria-label*="First name" i]',
    
    // Strategy 5: Data attributes
    'input[data-field*="firstName" i]',
    
    // Strategy 6: Position-based (risky, use last)
    'form input[type="text"]:first-of-type',
  ],
};

async function fillWithFallback(page, field, value, strategies) {
  for (const selector of strategies) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible()) {
        await element.fill(value);
        return { success: true, selector };
      }
    } catch {
      continue;
    }
  }
  return { success: false, tried: strategies.length };
}
```

### 2.3 Human Fallback System

**Escalation Flow:**
```
Automatic Fill -> Validation Check -> CAPTCHA Detected? 
                                            |
                                      Yes   |   No
                                       v    v
                              Human Assist  Continue
                                    |
                              Notify User -> Wait for Input -> Resume
```

**Implementation:**
```javascript
class HumanFallbackHandler {
  constructor(options = {}) {
    this.timeout = options.timeout || 300000; // 5 minutes
    this.notificationMethod = options.notificationMethod || 'push';
  }

  async requestHumanAssist(page, reason, context) {
    // Take screenshot for context
    const screenshot = await page.screenshot({ encoding: 'base64' });
    
    // Send notification
    await this.notify({
      type: 'human_assist_required',
      reason,
      context,
      screenshot,
      url: page.url(),
    });

    // Wait for human completion or timeout
    return this.waitForCompletion(page);
  }

  async waitForCompletion(page) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.timeout) {
      // Check if human completed the task
      const completed = await this.checkCompletion(page);
      if (completed) {
        return { success: true, handledBy: 'human' };
      }
      
      // Check if human signaled skip
      const skipped = await this.checkSkipped();
      if (skipped) {
        return { success: false, skipped: true, handledBy: 'human' };
      }

      await sleep(2000);
    }

    return { success: false, timeout: true };
  }

  async notify(data) {
    // Push notification via ntfy
    if (this.notificationMethod === 'push') {
      await sendNtfyNotification({
        title: 'Human Assist Required',
        message: `${data.reason} - ${data.url}`,
        priority: 'high',
        actions: [
          { action: 'view', label: 'Open Browser', url: data.url },
          { action: 'skip', label: 'Skip This Job' },
        ],
      });
    }
  }
}
```

### 2.4 Partial Completion Saving

**State Persistence Schema:**
```typescript
interface ApplicationState {
  jobId: string;
  userId: string;
  status: 'pending' | 'filling' | 'paused' | 'review' | 'submitted' | 'failed';
  
  // Progress tracking
  progress: {
    stage: 'navigation' | 'basic_info' | 'resume' | 'questions' | 'eeo' | 'submit';
    fieldsAttempted: number;
    fieldsFilled: number;
    lastFieldFilled?: string;
    screenshotUrl?: string;
  };
  
  // Error tracking
  errors: Array<{
    type: string;
    message: string;
    field?: string;
    timestamp: string;
    recoverable: boolean;
  }>;
  
  // Resumption data
  resumptionData?: {
    cookies?: string;
    localStorage?: Record<string, string>;
    formData?: Record<string, string>;
    lastSuccessfulStep: number;
  };
  
  // Timing
  startedAt: string;
  lastUpdatedAt: string;
  completedAt?: string;
}
```

**Checkpoint System:**
```javascript
class ApplicationCheckpointer {
  constructor(supabase, jobId, userId) {
    this.supabase = supabase;
    this.jobId = jobId;
    this.userId = userId;
    this.state = null;
  }

  async checkpoint(stage, fieldsData) {
    this.state = {
      ...this.state,
      progress: {
        stage,
        ...fieldsData,
      },
      lastUpdatedAt: new Date().toISOString(),
    };

    await this.supabase
      .table('application_logs')
      .update({ 
        state: this.state,
        status: 'filling',
      })
      .eq('job_id', this.jobId)
      .eq('user_id', this.userId);
  }

  async recordError(error, recoverable = true) {
    const errorEntry = {
      type: error.name || 'UnknownError',
      message: error.message?.substring(0, 500),
      timestamp: new Date().toISOString(),
      recoverable,
    };

    this.state.errors = [...(this.state.errors || []), errorEntry];
    await this.save();
  }

  async canResume() {
    if (!this.state?.resumptionData) return false;
    
    const lastUpdate = new Date(this.state.lastUpdatedAt);
    const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / 3600000;
    
    // Don't resume if more than 1 hour old (session likely expired)
    return hoursSinceUpdate < 1;
  }

  async resume(page) {
    if (!await this.canResume()) {
      return { canResume: false };
    }

    const { cookies, localStorage, lastSuccessfulStep } = this.state.resumptionData;

    // Restore cookies
    if (cookies) {
      await page.context().addCookies(JSON.parse(cookies));
    }

    // Restore localStorage
    if (localStorage) {
      await page.evaluate((storage) => {
        for (const [key, value] of Object.entries(storage)) {
          window.localStorage.setItem(key, value);
        }
      }, localStorage);
    }

    return { canResume: true, resumeFromStep: lastSuccessfulStep };
  }
}
```

---

## 3. User Notification Best Practices

### 3.1 Notification Timing and Frequency

| Event | Notify Immediately | Batch | Priority |
|-------|-------------------|-------|----------|
| CAPTCHA Required | Yes | No | High |
| Application Submitted | Yes | No | Normal |
| Application Failed (retryable) | No | Yes (hourly) | Low |
| Application Failed (permanent) | Yes | No | Normal |
| Batch Complete | Yes | N/A | Normal |
| Rate Limited | No | Yes (daily) | Low |

### 3.2 Notification Content Structure

**Success Notification:**
```
Title: Application Submitted
Body: "{Company} - {Job Title}"
Actions: [View Application, Mark Applied in Tracker]
```

**Failure Notification (Requires Action):**
```
Title: Application Needs Attention
Body: "{Company} - CAPTCHA required"
Actions: [Complete Manually, Skip Job, Retry Later]
Screenshot: Attached
```

**Failure Notification (No Action Needed):**
```
Title: Application Failed
Body: "{Company} - Job posting may have closed"
Actions: [View Details, Remove from Queue]
```

### 3.3 Notification Channels

| Channel | Use Case | Latency |
|---------|----------|---------|
| Push (ntfy.sh) | Immediate action required | Real-time |
| Email | Daily summary, failures | Batched |
| In-App Badge | Pending human assists | Real-time |
| SMS (optional) | Critical only | Real-time |

### 3.4 Message Templates

```javascript
const NOTIFICATION_TEMPLATES = {
  captcha_required: {
    title: 'Manual Action Required',
    body: '{company} application needs CAPTCHA completion',
    priority: 'high',
    tags: ['warning', 'manual'],
    actions: [
      { action: 'view', label: 'Complete Now' },
      { action: 'skip', label: 'Skip' },
    ],
  },
  
  submission_success: {
    title: 'Application Submitted!',
    body: '{company} - {jobTitle}',
    priority: 'default',
    tags: ['white_check_mark'],
  },
  
  submission_failed: {
    title: 'Application Failed',
    body: '{company} - {errorReason}',
    priority: 'default',
    tags: ['x'],
    actions: [
      { action: 'retry', label: 'Retry' },
      { action: 'remove', label: 'Remove' },
    ],
  },
  
  batch_complete: {
    title: 'Batch Applications Complete',
    body: '{succeeded} submitted, {failed} failed, {skipped} need attention',
    priority: 'default',
    tags: ['clipboard'],
  },
};
```

---

## 4. Graceful Degradation

### 4.1 Degradation Levels

```
Level 0: Full Automation
    |
    v (CAPTCHA or complex form detected)
Level 1: Partial Automation + Human Submit
    |
    v (Form structure unrecognized)
Level 2: Form Pre-fill + Human Complete
    |
    v (Site blocked or inaccessible)
Level 3: Copy to Clipboard + Open in Browser
    |
    v (Complete failure)
Level 4: Queue for Manual Application
```

### 4.2 Degradation Implementation

```javascript
async function applyWithDegradation(job, profile) {
  const levels = [
    () => applyFullyAutomatic(job, profile),
    () => applyPartialWithHumanSubmit(job, profile),
    () => applyPrefillOnly(job, profile),
    () => applyViaClipboard(job, profile),
    () => queueForManual(job),
  ];

  let lastError = null;
  let level = 0;

  for (const attemptLevel of levels) {
    try {
      const result = await attemptLevel();
      
      if (result.success) {
        return {
          ...result,
          degradationLevel: level,
        };
      }
      
      // Result indicates should try next level
      if (result.shouldDegrade) {
        level++;
        lastError = result.error;
        continue;
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if error is recoverable at next level
      if (shouldDegradeOnError(error)) {
        level++;
        continue;
      }
      
      throw error;
    }
  }

  return {
    success: false,
    degradationLevel: level,
    error: lastError,
    action: 'queued_for_manual',
  };
}

function shouldDegradeOnError(error) {
  const degradableErrors = [
    'CAPTCHA_DETECTED',
    'FORM_UNRECOGNIZED',
    'SELECTOR_NOT_FOUND',
    'ELEMENT_NOT_INTERACTABLE',
  ];
  
  return degradableErrors.some(type => 
    error.message?.includes(type) || error.code === type
  );
}
```

### 4.3 Clipboard Fallback

```javascript
async function applyViaClipboard(job, profile) {
  // Generate formatted application data
  const clipboardData = formatForClipboard(profile, job);
  
  // Copy to system clipboard
  await clipboard.write(clipboardData);
  
  // Open job URL in default browser
  await open(job.url);
  
  // Notify user
  await notify({
    title: 'Application Data Copied',
    body: `${job.company} - Paste your info into the form`,
    actions: [{ action: 'mark_applied', label: 'Mark as Applied' }],
  });
  
  return {
    success: true,
    method: 'clipboard',
    requiresManualCompletion: true,
  };
}

function formatForClipboard(profile, job) {
  return `
--- Application for ${job.company}: ${job.title} ---

Name: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Phone: ${profile.phone}
Location: ${profile.location}

LinkedIn: ${profile.linkedin}
GitHub: ${profile.github}
Portfolio: ${profile.website}

Work Authorization: ${profile.workAuth}

--- Copy relevant sections above ---
  `.trim();
}
```

---

## 5. Error Classification System

### 5.1 Error Taxonomy

```javascript
const ERROR_CATEGORIES = {
  // Transient - will likely succeed on retry
  TRANSIENT: {
    NETWORK_TIMEOUT: { retryable: true, maxRetries: 3, backoff: 'exponential' },
    RATE_LIMITED: { retryable: true, maxRetries: 5, backoff: 'fixed', delay: 60000 },
    ELEMENT_STALE: { retryable: true, maxRetries: 5, backoff: 'none', delay: 100 },
    SERVER_ERROR: { retryable: true, maxRetries: 2, backoff: 'exponential' },
  },
  
  // Recoverable - needs different approach
  RECOVERABLE: {
    CAPTCHA_REQUIRED: { retryable: false, degrade: true, humanAssist: true },
    FORM_UNRECOGNIZED: { retryable: false, degrade: true, humanAssist: true },
    SELECTOR_FAILED: { retryable: true, alternateSelectorFlow: true },
    SESSION_EXPIRED: { retryable: true, refreshSession: true },
  },
  
  // Permanent - cannot proceed
  PERMANENT: {
    JOB_CLOSED: { retryable: false, degrade: false, removeFromQueue: true },
    DUPLICATE_APPLICATION: { retryable: false, markAsApplied: true },
    LOCATION_RESTRICTED: { retryable: false, degrade: false },
    IP_BLOCKED: { retryable: false, escalate: true },
    AUTH_REQUIRED: { retryable: false, degrade: true },
  },
};

function classifyError(error) {
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';
  
  // Check for permanent errors
  if (message.includes('job has been closed') || 
      message.includes('position filled')) {
    return { category: 'PERMANENT', type: 'JOB_CLOSED' };
  }
  
  if (message.includes('already applied') || 
      message.includes('duplicate application')) {
    return { category: 'PERMANENT', type: 'DUPLICATE_APPLICATION' };
  }
  
  // Check for recoverable
  if (message.includes('captcha') || 
      message.includes('recaptcha') ||
      message.includes('verify you are human')) {
    return { category: 'RECOVERABLE', type: 'CAPTCHA_REQUIRED' };
  }
  
  // Check for transient
  if (code === 'ETIMEDOUT' || message.includes('timeout')) {
    return { category: 'TRANSIENT', type: 'NETWORK_TIMEOUT' };
  }
  
  if (error.status === 429 || message.includes('rate limit')) {
    return { category: 'TRANSIENT', type: 'RATE_LIMITED' };
  }
  
  // Default to transient (retry-friendly)
  return { category: 'TRANSIENT', type: 'UNKNOWN' };
}
```

### 5.2 Error Handling Flow

```
Error Occurs
    |
    v
Classify Error (ERROR_CATEGORIES)
    |
    +-- TRANSIENT --> Check Retry Count
    |                      |
    |                      +-- Under limit --> Retry with Backoff
    |                      +-- Over limit --> Escalate to RECOVERABLE
    |
    +-- RECOVERABLE --> Check Degradation Level
    |                      |
    |                      +-- Can degrade --> Try Next Level
    |                      +-- Human assist available --> Request Assist
    |                      +-- Max degradation --> Mark Failed
    |
    +-- PERMANENT --> Log & Remove from Queue
                          |
                          v
                      Update Application Status
                      Notify User (if needed)
```

---

## 6. Monitoring and Metrics

### 6.1 Key Metrics to Track

```javascript
const METRICS = {
  // Success rates
  overall_success_rate: 'applications_submitted / applications_attempted',
  ats_success_rate: 'by ATS type',
  field_fill_rate: 'fields_filled / fields_attempted',
  
  // Performance
  avg_application_time: 'milliseconds',
  avg_retry_count: 'per successful application',
  degradation_frequency: 'by level',
  
  // Errors
  error_rate_by_type: 'count by error category',
  captcha_encounter_rate: 'captchas / attempts',
  human_assist_frequency: 'assists / attempts',
  
  // Recovery
  retry_success_rate: 'successful retries / total retries',
  degradation_success_rate: 'successes at degraded levels',
};
```

### 6.2 Dashboard Queries

```sql
-- Error frequency by type (last 24 hours)
SELECT 
  error_type,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM application_logs
WHERE 
  created_at > NOW() - INTERVAL '24 hours'
  AND status = 'failed'
GROUP BY error_type
ORDER BY count DESC;

-- Success rate by ATS
SELECT 
  ats_type,
  COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted,
  COUNT(*) as total,
  ROUND(
    COUNT(CASE WHEN status = 'submitted' THEN 1 END) * 100.0 / COUNT(*), 
    1
  ) as success_rate
FROM application_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY ats_type
ORDER BY success_rate DESC;

-- Recovery effectiveness
SELECT 
  retry_count,
  COUNT(CASE WHEN status = 'submitted' THEN 1 END) as succeeded,
  COUNT(*) as total
FROM application_logs
WHERE 
  retry_count > 0
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY retry_count
ORDER BY retry_count;
```

---

## 7. Implementation Recommendations

### 7.1 Current Codebase Improvements

Based on analysis of the existing auto-apply system:

**1. Add Structured Error Classification (Priority: High)**

The current `agent.py` uses generic exception handling. Add:
```python
class ApplicationError(Exception):
    def __init__(self, message, category, type, recoverable=True):
        self.message = message
        self.category = category  # TRANSIENT, RECOVERABLE, PERMANENT
        self.type = type
        self.recoverable = recoverable
```

**2. Implement Retry Logic in Worker (Priority: High)**

Add exponential backoff to `worker.py`:
```python
async def process_with_retry(user_id, job, max_retries=3):
    for attempt in range(max_retries):
        result = await apply_to_job(profile, job)
        if result.get("success"):
            return result
        
        error_class = classify_error(result.get("error"))
        if not error_class.retryable:
            break
            
        delay = min(1000 * (2 ** attempt), 30000)
        await asyncio.sleep(delay / 1000)
    
    return result
```

**3. Add Checkpoint System (Priority: Medium)**

Update `update_application_status` to save progress state.

**4. Enhance Selector Fallbacks (Priority: Medium)**

The `fields.js` already has multiple strategies but should add more ATS-specific selectors.

**5. Add Human Fallback Integration (Priority: Low)**

Integrate ntfy notifications for CAPTCHA detection.

### 7.2 Database Schema Additions

```sql
-- Add columns to application_logs
ALTER TABLE application_logs ADD COLUMN IF NOT EXISTS
  retry_count INTEGER DEFAULT 0,
  degradation_level INTEGER DEFAULT 0,
  error_category TEXT,
  error_details JSONB,
  progress_state JSONB,
  requires_human_assist BOOLEAN DEFAULT FALSE,
  human_assist_requested_at TIMESTAMPTZ,
  human_assist_completed_at TIMESTAMPTZ;

-- Index for finding applications needing attention
CREATE INDEX idx_application_logs_human_assist 
ON application_logs (user_id, requires_human_assist, status)
WHERE requires_human_assist = TRUE;
```

### 7.3 Testing Strategy

| Test Type | Coverage |
|-----------|----------|
| Unit Tests | Error classification, retry logic |
| Integration Tests | Full flow with mock ATS responses |
| Chaos Tests | Random failures, timeouts, CAPTCHAs |
| Load Tests | Batch application performance |
| Manual QA | Real ATS form completion |

---

## 8. References

- [Playwright Best Practices - Auto-waiting](https://playwright.dev/docs/actionability)
- [browser-use Documentation](https://github.com/browser-use/browser-use)
- [Exponential Backoff and Jitter (AWS)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [reCAPTCHA Documentation](https://developers.google.com/recaptcha/docs/v3)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
