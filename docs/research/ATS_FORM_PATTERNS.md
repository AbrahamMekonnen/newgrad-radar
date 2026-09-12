# ATS Form Patterns Research

Comprehensive documentation of form structures, selectors, and patterns for major Applicant Tracking Systems.

## Table of Contents

1. [Greenhouse](#greenhouse)
2. [Lever](#lever)
3. [Workday](#workday)
4. [Ashby](#ashby)
5. [iCIMS](#icims)
6. [Taleo](#taleo)
7. [SmartRecruiters](#smartrecruiters)
8. [Cross-ATS Patterns](#cross-ats-patterns)
9. [Common Pitfalls](#common-pitfalls)
10. [Speed Optimization Tips](#speed-optimization-tips)

---

## Greenhouse

**URL Patterns:**
```regex
/boards\.greenhouse\.io/i
/job-boards\.greenhouse\.io/i
/careers\..*\.com.*greenhouse/i
```

### Form Structure

Greenhouse uses React with custom form components. Forms are typically single-page but may have collapsible sections.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Application form | `form.application-form`, `#application` |
| First name | `input[name="first_name"]`, `label:has-text("First name") input` |
| Last name | `input[name="last_name"]`, `label:has-text("Last name") input` |
| Email | `input[name="email"]`, `input[type="email"]` |
| Phone | `input[name="phone"]`, `input[type="tel"]` |
| Resume upload | `input[type="file"][name*="resume" i]`, `input[accept*="pdf"]` |
| Cover letter | `input[type="file"][name*="cover" i]` |
| LinkedIn | `input[name*="linkedin" i]` |
| GitHub | `input[name*="github" i]` |
| Website | `input[name*="website" i]`, `input[name*="portfolio" i]` |
| Submit button | `button[type="submit"]`, `input[type="submit"]`, `button:has-text("Submit")` |

### Dropdown Handling (React Select)

Greenhouse uses custom React Select dropdowns that require clicking to open:

```javascript
// Strategy for React Select in Greenhouse
async function selectGreenhouseDropdown(page, labelText, value) {
  // 1. Find the dropdown trigger near the label
  const container = await page.locator(`text="${labelText}"`).first();
  const dropdown = await container.locator('xpath=following::*[contains(text(), "Select...")][1]');
  await dropdown.click();
  
  // 2. Wait for options to appear
  await page.waitForTimeout(300);
  
  // 3. Click the matching option
  await page.locator(`[role="option"]:has-text("${value}")`).click();
}
```

### Required vs Optional Field Markers

- **Required:** `*` asterisk in label text, or `required` attribute on input
- **Optional:** No asterisk, may have "(optional)" in label
- **Detection:** `label:has-text("*")` or `input[required]`

### Common Custom Questions

1. Work authorization dropdowns
2. Sponsorship requirements (Yes/No)
3. "How did you hear about us?" source tracking
4. "Why [Company Name]?" textarea
5. Agreement checkboxes (AI policy, arbitration)

### Speed Tips

- Fill basic fields (name, email, phone) in parallel - they're independent
- Use batch size of 4 for optimal performance
- Resume upload must be sequential (file operations)
- Delay 100ms between field batches to avoid React state issues

---

## Lever

**URL Patterns:**
```regex
/jobs\.lever\.co/i
/lever\.co\/.*\/apply/i
```

### Form Structure

Lever has a two-step flow: job listing page, then click "Apply" to reach the form. Forms are typically single-page.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Apply button (listing) | `a.postings-btn`, `button:has-text("Apply for this job")`, `.apply-button` |
| Full name | `input[name="name"]`, `label:has-text("Full name") input` |
| Email | `input[name="email"]` |
| Phone | `input[name="phone"]` |
| Resume | `input[name="resume"]` |
| Current location | `input[name*="location" i]` |
| Current company | `input[name*="company" i]` |
| LinkedIn URL | `input[name*="linkedin" i]` |
| GitHub URL | `input[name*="github" i]` |
| Portfolio | `input[name*="portfolio" i]`, `input[name*="website" i]` |
| Submit button | `button[type="submit"]`, `button.postings-btn:has-text("Submit")` |

### Form Identification

```javascript
// Check if on Lever form vs listing
const isApplicationForm = await page.locator('form.application-form, form[action*="submit"]').count() > 0;
const isListingPage = await page.locator('a.postings-btn').isVisible();
```

### Required vs Optional Field Markers

- **Required:** Bold label text or red asterisk
- **Optional:** Lighter text color, "(Optional)" suffix
- **Detection:** Check for `required` attribute or asterisk in label

### EEO Questions

Lever typically places EEO questions at the bottom in a separate section labeled "Equal Employment Opportunity".

### Speed Tips

- Name field often takes "Full name" - no need to fill first/last separately
- Can fill URL fields (LinkedIn, GitHub, Portfolio) in parallel
- Watch for dynamic validation - some fields trigger AJAX on blur

---

## Workday

**URL Patterns:**
```regex
/.*\.workday\.com/i
/.*\.myworkdayjobs\.com/i
/wd5\.myworkdayjobs\.com/i
```

### Form Structure

Workday is the most complex ATS. Multi-page forms with:
- Account creation/login requirement
- Work history section with dynamic add/remove
- Education section with dynamic add/remove
- Skills/certifications sections
- Extensive EEO section

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Login form | `button[data-automation-id="signInLink"]` |
| Create account | `button[data-automation-id="createAccountLink"]` |
| Email | `input[data-automation-id="email"]` |
| Password | `input[data-automation-id="password"]` |
| First name | `input[data-automation-id="legalNameSection_firstName"]` |
| Last name | `input[data-automation-id="legalNameSection_lastName"]` |
| Phone | `input[data-automation-id="phone-number"]` |
| Address | `input[data-automation-id="addressSection_addressLine1"]` |
| City | `input[data-automation-id="addressSection_city"]` |
| Resume upload | `input[data-automation-id="file-upload-input-ref"]` |
| Next/Continue | `button[data-automation-id="bottom-navigation-next-button"]` |
| Submit | `button[data-automation-id="bottom-navigation-next-button"]` (on final page) |

### Multi-Page Navigation

```javascript
// Check which page/step we're on
const currentStep = await page.locator('[data-automation-id="progressIndicator-step"]').getAttribute('aria-current');

// Navigate to next page
const nextButton = page.locator('button[data-automation-id="bottom-navigation-next-button"]');
await nextButton.click();
await page.waitForLoadState('networkidle');
```

### Work Experience Section

```javascript
// Add work experience entry
await page.locator('button[data-automation-id="Add Work Experience"]').click();

// Fill fields
await page.locator('input[data-automation-id="jobTitle"]').fill('Software Engineer');
await page.locator('input[data-automation-id="company"]').fill('Company Name');
await page.locator('input[data-automation-id="startDate"]').fill('01/2023');
```

### Education Section

```javascript
// Add education entry
await page.locator('button[data-automation-id="Add Education"]').click();

// School name - often autocomplete
await page.locator('input[data-automation-id="school"]').fill('University');
await page.waitForTimeout(500);
await page.locator('[data-automation-id="school"] [role="option"]').first().click();
```

### Required vs Optional Field Markers

- **Required:** Red asterisk (`*`) before field label
- **Optional:** No asterisk
- **Page validation:** Clicking "Next" without required fields shows inline errors

### Common Pitfalls

1. Session timeout - applications can expire
2. Resume parsing may auto-fill fields (may need to clear/overwrite)
3. Country/state dropdowns require exact matches
4. Date formats vary by locale (MM/DD/YYYY vs DD/MM/YYYY)

### Speed Tips

- Use session cookies if logged in previously
- Skip resume parsing wait if filling manually
- Workday is slow - increase timeouts to 60s+
- Cannot parallelize across pages

---

## Ashby

**URL Patterns:**
```regex
/jobs\.ashbyhq\.com/i
/ashbyhq\.com.*apply/i
```

### Form Structure

Ashby is modern and developer-friendly. Single-page forms with clean React components. Often uses drag-and-drop for resume.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Apply button | `button:has-text("Apply")`, `a:has-text("Apply for this job")` |
| Full name | `input[name="name"]`, `label:has-text("Name") input` |
| First name | `label:has-text("First Name") input` |
| Last name | `label:has-text("Last Name") input` |
| Email | `input[name="email"]`, `input[type="email"]` |
| Phone | `input[name="phone"]`, `input[type="tel"]` |
| Location | `input[name*="location" i]` |
| Resume dropzone | `[data-testid="file-upload"]`, `.dropzone`, `[class*="upload"]` |
| Resume input | `input[type="file"]` (within dropzone) |
| LinkedIn | `input[name*="linkedin" i]` |
| GitHub | `input[name*="github" i]` |
| Submit button | `button[type="submit"]`, `button:has-text("Submit Application")` |

### Resume Upload Handling

Ashby often uses drag-and-drop zones:

```javascript
async function uploadAshbyResume(page, resumePath) {
  // Try standard file input first
  const fileInput = await page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(resumePath);
    return true;
  }
  
  // Try dropzone with hidden input
  const dropzone = await page.locator('[data-testid="file-upload"], .dropzone').first();
  if (await dropzone.isVisible()) {
    const hiddenInput = await dropzone.locator('input[type="file"]');
    await hiddenInput.setInputFiles(resumePath);
    return true;
  }
  
  return false;
}
```

### Required vs Optional Field Markers

- **Required:** Asterisk or red dot indicator
- **Optional:** "(Optional)" text suffix
- **Validation:** Inline validation messages appear on blur

### Speed Tips

- Ashby forms are lightweight - can use shorter delays (50-100ms)
- Modern React means parallel filling works well
- Resume upload is fast - no heavy processing

---

## iCIMS

**URL Patterns:**
```regex
/.*\.icims\.com/i
/careers.*icims/i
/icims-page-builder/i
```

### Form Structure

iCIMS is enterprise-focused with complex multi-step forms. May require account creation.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Login/Create | `.btn-primary:has-text("Sign In")`, `.btn-primary:has-text("Create Account")` |
| First name | `input[id*="firstName" i]`, `input[name*="firstName" i]` |
| Last name | `input[id*="lastName" i]`, `input[name*="lastName" i]` |
| Email | `input[id*="email" i]`, `input[type="email"]` |
| Phone | `input[id*="phone" i]`, `input[type="tel"]` |
| Address | `input[id*="address" i]` |
| City | `input[id*="city" i]` |
| State | `select[id*="state" i]` |
| Zip | `input[id*="zip" i]`, `input[id*="postal" i]` |
| Resume | `input[type="file"][id*="resume" i]` |
| Continue/Next | `button.btn-primary:has-text("Continue")`, `button:has-text("Next")` |
| Submit | `button.btn-primary:has-text("Submit")` |

### Multi-Page Detection

```javascript
// iCIMS typically shows step indicators
const stepIndicator = await page.locator('.step-indicator, .progress-steps').textContent();
const currentStep = parseInt(stepIndicator.match(/Step (\d+)/)?.[1] || '1');
```

### Work History (Dynamic)

```javascript
// Add new work experience
await page.locator('button:has-text("Add Experience"), .add-item-btn').click();
await page.waitForTimeout(500);

// Fill the new entry
const lastEntry = await page.locator('.work-experience-item').last();
await lastEntry.locator('input[name*="company"]').fill('Company');
await lastEntry.locator('input[name*="title"]').fill('Title');
```

### Required vs Optional Field Markers

- **Required:** Red asterisk, "required" in field label
- **Optional:** No indicator, or "(optional)" text
- **Validation:** Page-level validation on "Continue" click

### Common Pitfalls

1. Account creation flow can be lengthy
2. Session management - applications can time out
3. Resume parsing may auto-fill incorrectly
4. Some clients heavily customize iCIMS

### Speed Tips

- Login first if you have an account (saves account creation time)
- Resume upload can trigger parsing - wait for completion
- Can't parallelize across pages
- Watch for CAPTCHAs on some implementations

---

## Taleo

**URL Patterns:**
```regex
/.*taleo\.net/i
/.*\.taleo\.com/i
/career\..*\.com.*taleo/i
```

### Form Structure

Taleo (Oracle) is legacy enterprise software. Heavy, slow, often requires account creation. Forms are multi-page with complex navigation.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Register/Login | `a[id*="register" i]`, `input[value="Register"]` |
| Email | `input[id*="email" i]`, `input[name*="email" i]` |
| Password | `input[id*="password" i]`, `input[type="password"]` |
| First name | `input[id*="firstname" i]`, `input[id*="first_name" i]` |
| Last name | `input[id*="lastname" i]`, `input[id*="last_name" i]` |
| Phone | `input[id*="phone" i]` |
| Address | `input[id*="address" i]` |
| Resume | `input[type="file"]`, `input[id*="attach" i]` |
| Next | `input[value="Next"]`, `button:has-text("Next")` |
| Submit | `input[value="Submit"]`, `button:has-text("Submit")` |
| Sections | `.requisitionNavigationPane`, `.navigation-list` |

### Navigation Pattern

```javascript
// Taleo uses numbered sections
const sections = await page.locator('.requisitionNavigationPane a').all();
for (const section of sections) {
  await section.click();
  await page.waitForLoadState('domcontentloaded');
  // Fill section fields...
}
```

### Account Registration

```javascript
// Taleo often requires account creation
await page.locator('a:has-text("Register")').click();
await page.waitForLoadState('domcontentloaded');

// Fill registration form
await page.fill('input[id*="email"]', email);
await page.fill('input[id*="password"]', password);
await page.fill('input[id*="confirmPassword"]', password);
```

### Required vs Optional Field Markers

- **Required:** "(*)" or red asterisk in label
- **Optional:** No marker
- **Validation:** Server-side validation - page reloads with error messages

### Common Pitfalls

1. **Slow performance** - Taleo is notoriously slow
2. **Iframes** - Some elements may be inside iframes
3. **Session expiry** - Sessions time out frequently
4. **JavaScript heavy** - Wait for page to fully load
5. **Non-standard HTML** - Legacy markup patterns

### Speed Tips

- Increase timeouts significantly (90s+)
- Wait for `networkidle` between pages
- Cannot parallelize - too fragile
- Consider maintaining a logged-in session
- Some Taleo instances are faster than others

---

## SmartRecruiters

**URL Patterns:**
```regex
/jobs\.smartrecruiters\.com/i
/.*\.smartrecruiters\.com/i
```

### Form Structure

SmartRecruiters is modern, mobile-friendly. Single-page forms with progressive disclosure.

### Key Selectors

| Element | Selectors |
|---------|-----------|
| Apply button | `button.btn-apply`, `a:has-text("Apply")` |
| First name | `input[name="firstName"]`, `input[id*="firstName" i]` |
| Last name | `input[name="lastName"]`, `input[id*="lastName" i]` |
| Email | `input[name="email"]`, `input[type="email"]` |
| Phone | `input[name="phoneNumber"]`, `input[type="tel"]` |
| Location | `input[name*="location" i]` |
| Resume | `input[type="file"][accept*="pdf"]`, `input[name="resume"]` |
| LinkedIn | `input[name*="linkedin" i]` |
| Submit | `button[type="submit"]`, `button:has-text("Submit Application")` |

### Resume Upload

```javascript
// SmartRecruiters supports multiple upload methods
async function uploadSmartRecruitersResume(page, resumePath) {
  // Method 1: Direct file input
  const fileInput = await page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(resumePath);
    return true;
  }
  
  // Method 2: LinkedIn import (skip if filling manually)
  // Method 3: Cloud storage import (skip)
  
  return false;
}
```

### Custom Questions

SmartRecruiters renders custom questions dynamically:

```javascript
// Find all custom question containers
const customQuestions = await page.locator('[data-automation="custom-question"]').all();

for (const question of customQuestions) {
  const label = await question.locator('label').textContent();
  const inputType = await question.locator('input, select, textarea').first().evaluate(el => el.tagName);
  // Handle based on type...
}
```

### Required vs Optional Field Markers

- **Required:** Red asterisk or "Required" label
- **Optional:** "(Optional)" suffix
- **Validation:** Real-time inline validation

### Speed Tips

- Modern React - parallel filling works well
- Fast resume upload
- Single page - no navigation delays
- Use 50-100ms delays between fields

---

## Cross-ATS Patterns

### Universal Field Detection

```javascript
// Field detection strategies that work across most ATS
const fillByLabel = async (page, labelText, value) => {
  const strategies = [
    // Strategy 1: Label with for attribute
    async () => {
      const label = await page.locator(`label:has-text("${labelText}")`).first();
      const forAttr = await label.getAttribute('for');
      if (forAttr) {
        await page.locator(`#${forAttr}`).fill(value);
        return true;
      }
      throw new Error('No for attr');
    },
    // Strategy 2: Nested input
    async () => {
      const input = await page.locator(`label:has-text("${labelText}") input, label:has-text("${labelText}") textarea`).first();
      await input.fill(value);
      return true;
    },
    // Strategy 3: Placeholder
    async () => {
      const input = await page.locator(`input[placeholder*="${labelText}" i], textarea[placeholder*="${labelText}" i]`).first();
      await input.fill(value);
      return true;
    },
    // Strategy 4: Aria-label
    async () => {
      const input = await page.locator(`input[aria-label*="${labelText}" i]`).first();
      await input.fill(value);
      return true;
    },
    // Strategy 5: Following sibling
    async () => {
      const input = await page.locator(`text="${labelText}" >> xpath=following::input[1]`).first();
      await input.fill(value);
      return true;
    },
  ];
  
  for (const strategy of strategies) {
    try {
      await strategy();
      return true;
    } catch {
      continue;
    }
  }
  return false;
};
```

### Universal Resume Upload

```javascript
const uploadResume = async (page, resumePath) => {
  const selectors = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][accept*="pdf"]',
    'input[type="file"]',
  ];
  
  for (const selector of selectors) {
    try {
      const input = await page.locator(selector).first();
      const name = await input.getAttribute('name') || '';
      // Skip cover letter inputs
      if (name.toLowerCase().includes('cover')) continue;
      
      await input.setInputFiles(resumePath);
      return true;
    } catch {
      continue;
    }
  }
  
  return false;
};
```

### Universal Submit Detection

```javascript
const submitSelectors = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Submit Application")',
  'button:has-text("Submit")',
  'button:has-text("Apply")',
  'input[value="Submit"]',
  'button.btn-primary:has-text("Submit")',
];
```

---

## Common Pitfalls

### 1. Dynamic Form Loading
Many ATS load form fields via JavaScript. Always wait for fields to be visible:
```javascript
await page.waitForSelector('input[name="email"]', { state: 'visible' });
```

### 2. React State Updates
React-based ATS (Greenhouse, Ashby, SmartRecruiters) may have state update delays:
```javascript
// Use fill() not type() for atomic updates
await input.fill(value); // Better
// await input.type(value); // May trigger validation mid-type
```

### 3. File Upload Variations
Some ATS require clicking an upload button before setting files:
```javascript
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 5000 }),
  uploadButton.click(),
]);
await fileChooser.setFiles(resumePath);
```

### 4. Hidden Required Fields
Some required fields may be initially hidden (in collapsed sections):
```javascript
// Expand all sections first
const expandButtons = await page.locator('[aria-expanded="false"]').all();
for (const btn of expandButtons) {
  await btn.click();
}
```

### 5. Country/Location Autocomplete
Many ATS use autocomplete for location fields:
```javascript
await locationInput.fill('San Francisco');
await page.waitForTimeout(500); // Wait for suggestions
await page.locator('[role="option"]:has-text("San Francisco, CA")').click();
```

### 6. Session Timeouts
Enterprise ATS (Workday, Taleo, iCIMS) have aggressive session timeouts:
- Save progress frequently
- Monitor for timeout warnings
- Re-authenticate if needed

### 7. CAPTCHA/Bot Detection
Some ATS implement bot detection:
- Use realistic typing speeds (slowMo)
- Randomize delays between actions
- Consider using real browser profiles

---

## Speed Optimization Tips

### By ATS (Fastest to Slowest)

| ATS | Expected Time | Parallelizable | Notes |
|-----|---------------|----------------|-------|
| Ashby | 3-5s | Yes | Modern, lightweight |
| SmartRecruiters | 4-6s | Yes | Clean React |
| Lever | 5-7s | Partial | May need Apply click first |
| Greenhouse | 5-8s | Yes | React Select can be slow |
| Jobvite | 8-12s | Partial | Moderate complexity |
| iCIMS | 15-30s | No | Multi-page, may need account |
| Workday | 30-60s+ | No | Very complex, account required |
| Taleo | 45-90s+ | No | Legacy, very slow |

### General Speed Tips

1. **Parallel Field Filling**: Fill independent fields concurrently
   ```javascript
   await Promise.all([
     fillByLabel(page, 'First name', firstName),
     fillByLabel(page, 'Last name', lastName),
     fillByLabel(page, 'Email', email),
     fillByLabel(page, 'Phone', phone),
   ]);
   ```

2. **Batch Operations**: Group fields into logical batches
   - Basic info (name, email, phone)
   - URLs (LinkedIn, GitHub, Portfolio)
   - Custom questions (sequential if dependent)

3. **Minimize Waits**: Use targeted waits instead of fixed delays
   ```javascript
   // Better
   await page.waitForSelector('input[name="email"]');
   // Worse
   await page.waitForTimeout(2000);
   ```

4. **Reuse Browser Sessions**: Keep browser open between applications
   ```javascript
   // Don't close browser after each application
   // Reuse context for same-session applications
   ```

5. **Skip Optional Fields**: Fill only required fields for speed
   ```javascript
   const requiredOnly = process.env.FAST_MODE === 'true';
   if (!requiredOnly || isRequired) {
     await fillField(...);
   }
   ```

6. **Pre-fetch Resume**: Load resume file once, reuse across applications
   ```javascript
   const resumeBuffer = await fs.readFile(resumePath);
   ```

7. **ATS-Specific Delays**:
   | ATS | betweenFields | afterUpload | beforeSubmit |
   |-----|---------------|-------------|--------------|
   | Ashby | 50ms | 200ms | 500ms |
   | SmartRecruiters | 75ms | 300ms | 600ms |
   | Lever | 100ms | 300ms | 700ms |
   | Greenhouse | 100ms | 400ms | 800ms |
   | Jobvite | 150ms | 500ms | 1000ms |
   | iCIMS | 300ms | 1000ms | 1500ms |
   | Workday | 500ms | 1500ms | 2000ms |
   | Taleo | 750ms | 2000ms | 3000ms |

---

## ATS Detection

```javascript
const ATS_PATTERNS = {
  greenhouse: [
    /boards\.greenhouse\.io/i,
    /job-boards\.greenhouse\.io/i,
  ],
  lever: [
    /jobs\.lever\.co/i,
    /lever\.co\/.*\/apply/i,
  ],
  ashby: [
    /jobs\.ashbyhq\.com/i,
    /ashbyhq\.com.*apply/i,
  ],
  jobvite: [
    /jobs\.jobvite\.com/i,
    /.*\.jobvite\.com/i,
  ],
  workday: [
    /.*\.workday\.com/i,
    /.*\.myworkdayjobs\.com/i,
  ],
  icims: [
    /.*\.icims\.com/i,
    /careers.*icims/i,
  ],
  taleo: [
    /.*taleo\.net/i,
    /.*\.taleo\.com/i,
  ],
  smartrecruiters: [
    /jobs\.smartrecruiters\.com/i,
    /.*\.smartrecruiters\.com/i,
  ],
};

function detectATS(url) {
  for (const [ats, patterns] of Object.entries(ATS_PATTERNS)) {
    if (patterns.some(p => p.test(url))) {
      return ats;
    }
  }
  return null;
}
```

---

## Summary

| ATS | Complexity | Speed | Key Challenge |
|-----|------------|-------|---------------|
| Greenhouse | Medium | Fast | React Select dropdowns |
| Lever | Low | Fast | Two-step (listing + form) |
| Workday | High | Very Slow | Multi-page, account required |
| Ashby | Low | Very Fast | Modern, easy |
| iCIMS | High | Slow | Multi-page, customizations |
| Taleo | High | Very Slow | Legacy, unstable |
| SmartRecruiters | Low | Fast | Modern, straightforward |

**Recommended implementation priority:**
1. Greenhouse (most common)
2. Lever (clean, popular)
3. Ashby (modern startups)
4. SmartRecruiters (growing adoption)
5. Workday (enterprise, complex)
6. iCIMS (enterprise)
7. Taleo (legacy, declining)
