# Playwright Form Automation Patterns

This document covers plugins, patterns, and best practices for reliable form automation with Playwright.

## Table of Contents

1. [Recommended Plugins](#recommended-plugins)
2. [Basic Form Filling](#basic-form-filling)
3. [React Select and Custom Dropdowns](#react-select-and-custom-dropdowns)
4. [File Upload Patterns](#file-upload-patterns)
5. [Multi-Page Form Handling](#multi-page-form-handling)
6. [Stealth and Anti-Detection](#stealth-and-anti-detection)
7. [Error Recovery Patterns](#error-recovery-patterns)

---

## Recommended Plugins

### Core Plugins to Install

```bash
# Playwright Extra (plugin framework)
npm install playwright-extra

# Stealth plugin (avoid bot detection)
npm install puppeteer-extra-plugin-stealth

# Additional useful packages
npm install playwright @playwright/test
```

### Package Overview

| Package | Purpose | Notes |
|---------|---------|-------|
| `playwright-extra` | Plugin framework for Playwright | Enables puppeteer-extra style plugins |
| `puppeteer-extra-plugin-stealth` | Bypass bot detection | Works with playwright-extra |
| `playwright` | Core browser automation | Official Microsoft package |

---

## Basic Form Filling

### Standard Input Fields

```typescript
import { chromium, Page } from 'playwright';

async function fillTextInput(page: Page, selector: string, value: string) {
  // Wait for element to be visible and interactable
  await page.waitForSelector(selector, { state: 'visible' });
  
  // Clear existing value and type new one
  await page.fill(selector, value);
}

// Usage with different selector strategies
await page.fill('input[name="email"]', 'user@example.com');
await page.fill('#firstName', 'John');
await page.fill('[data-testid="phone"]', '555-1234');
await page.fill('input[placeholder="Enter your name"]', 'Jane Doe');
```

### Human-Like Typing (Slow Fill)

```typescript
async function humanLikeType(page: Page, selector: string, text: string) {
  await page.waitForSelector(selector, { state: 'visible' });
  await page.click(selector);
  
  // Clear existing content
  await page.fill(selector, '');
  
  // Type with random delays between keystrokes
  for (const char of text) {
    await page.type(selector, char, { delay: Math.random() * 100 + 50 });
  }
}
```

### Checkbox and Radio Buttons

```typescript
// Checkboxes
await page.check('input[type="checkbox"][name="agree"]');
await page.uncheck('input[type="checkbox"][name="newsletter"]');

// Radio buttons
await page.check('input[type="radio"][value="option1"]');

// Verify state
const isChecked = await page.isChecked('input[name="agree"]');
```

### Native Select Dropdowns

```typescript
// By value
await page.selectOption('select#country', 'US');

// By label text
await page.selectOption('select#country', { label: 'United States' });

// By index
await page.selectOption('select#country', { index: 2 });

// Multiple selections
await page.selectOption('select#skills', ['javascript', 'typescript', 'python']);
```

---

## React Select and Custom Dropdowns

React Select and similar custom dropdown libraries don't use native `<select>` elements, requiring different strategies.

### React Select Pattern

```typescript
async function selectReactSelectOption(
  page: Page, 
  containerSelector: string, 
  optionText: string
) {
  // Click the React Select container to open dropdown
  await page.click(`${containerSelector} .react-select__control`);
  
  // Wait for options to appear
  await page.waitForSelector('.react-select__menu', { state: 'visible' });
  
  // Click the option by text
  await page.click(`.react-select__option:has-text("${optionText}")`);
  
  // Wait for menu to close
  await page.waitForSelector('.react-select__menu', { state: 'hidden' });
}

// Alternative: Type to filter then select
async function selectReactSelectByTyping(
  page: Page,
  containerSelector: string,
  searchText: string
) {
  // Click to focus
  await page.click(`${containerSelector} .react-select__control`);
  
  // Type to filter options
  await page.type(`${containerSelector} input`, searchText);
  
  // Wait for filtered results
  await page.waitForTimeout(300);
  
  // Press Enter to select first match
  await page.keyboard.press('Enter');
}
```

### Generic Custom Dropdown Pattern

```typescript
async function selectCustomDropdown(
  page: Page,
  triggerSelector: string,
  optionSelector: string,
  optionText: string
) {
  // Click trigger to open dropdown
  await page.click(triggerSelector);
  
  // Wait for animation
  await page.waitForTimeout(200);
  
  // Find and click option
  const option = page.locator(optionSelector).filter({ hasText: optionText });
  await option.click();
}

// Example usage for various UI libraries
// Material UI
await selectCustomDropdown(page, '[data-testid="select"]', '.MuiMenuItem-root', 'Option 1');

// Ant Design
await selectCustomDropdown(page, '.ant-select', '.ant-select-item-option', 'Option 1');

// Chakra UI
await selectCustomDropdown(page, '[role="combobox"]', '[role="option"]', 'Option 1');
```

### Searchable/Autocomplete Dropdowns

```typescript
async function selectAutocomplete(
  page: Page,
  inputSelector: string,
  searchText: string,
  resultSelector: string = '[role="option"]'
) {
  // Clear and type search text
  await page.fill(inputSelector, '');
  await page.type(inputSelector, searchText, { delay: 100 });
  
  // Wait for results to load (handle API delay)
  await page.waitForSelector(resultSelector, { 
    state: 'visible',
    timeout: 5000 
  });
  
  // Click first matching result
  await page.click(`${resultSelector}:has-text("${searchText}")`);
}
```

---

## File Upload Patterns

### Standard File Input

```typescript
// Direct file input
await page.setInputFiles('input[type="file"]', '/path/to/file.pdf');

// Multiple files
await page.setInputFiles('input[type="file"]', [
  '/path/to/resume.pdf',
  '/path/to/cover-letter.pdf'
]);

// Clear file selection
await page.setInputFiles('input[type="file"]', []);
```

### Hidden File Inputs (Common Pattern)

```typescript
// Many sites hide the actual input and use a styled button
async function uploadFileHidden(page: Page, buttonSelector: string, filePath: string) {
  // Get the hidden input associated with the button
  const fileInput = await page.locator('input[type="file"]');
  
  // Set files directly on the input (no need to click)
  await fileInput.setInputFiles(filePath);
}

// Alternative: Wait for file chooser dialog
async function uploadViaFileChooser(page: Page, buttonSelector: string, filePath: string) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(buttonSelector)
  ]);
  
  await fileChooser.setFiles(filePath);
}
```

### Drag and Drop Upload Zone

```typescript
async function uploadViaDragDrop(page: Page, dropZoneSelector: string, filePath: string) {
  // Read file as buffer
  const fs = require('fs');
  const buffer = fs.readFileSync(filePath);
  
  // Create DataTransfer in browser context
  await page.evaluate(async ({ selector, fileName, mimeType, base64 }) => {
    const dropZone = document.querySelector(selector);
    
    // Convert base64 to ArrayBuffer
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    // Create File object
    const file = new File([bytes], fileName, { type: mimeType });
    
    // Create DataTransfer
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // Dispatch drop event
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      dataTransfer
    });
    dropZone.dispatchEvent(dropEvent);
  }, {
    selector: dropZoneSelector,
    fileName: 'resume.pdf',
    mimeType: 'application/pdf',
    base64: buffer.toString('base64')
  });
}
```

### Wait for Upload Completion

```typescript
async function uploadAndWaitForCompletion(
  page: Page,
  inputSelector: string,
  filePath: string,
  successIndicator: string
) {
  await page.setInputFiles(inputSelector, filePath);
  
  // Wait for upload success indicator
  await page.waitForSelector(successIndicator, {
    state: 'visible',
    timeout: 30000 // 30 seconds for large files
  });
}

// Example: Wait for "Upload complete" text or checkmark icon
await uploadAndWaitForCompletion(
  page,
  'input[type="file"]',
  '/path/to/resume.pdf',
  '.upload-success, [data-testid="upload-complete"]'
);
```

---

## Multi-Page Form Handling

### Page Navigation Pattern

```typescript
interface FormPage {
  url?: string | RegExp;
  fields: Record<string, string>;
  nextButton: string;
}

async function fillMultiPageForm(page: Page, pages: FormPage[]) {
  for (const formPage of pages) {
    // Wait for page to load if URL specified
    if (formPage.url) {
      await page.waitForURL(formPage.url);
    }
    
    // Fill all fields on this page
    for (const [selector, value] of Object.entries(formPage.fields)) {
      await page.fill(selector, value);
    }
    
    // Click next/continue button
    await page.click(formPage.nextButton);
    
    // Wait for navigation or loading
    await page.waitForLoadState('networkidle');
  }
}

// Usage
await fillMultiPageForm(page, [
  {
    url: /\/apply\/step-1/,
    fields: {
      '#firstName': 'John',
      '#lastName': 'Doe',
      '#email': 'john@example.com'
    },
    nextButton: 'button:has-text("Continue")'
  },
  {
    url: /\/apply\/step-2/,
    fields: {
      '#phone': '555-1234',
      '#address': '123 Main St'
    },
    nextButton: 'button:has-text("Continue")'
  }
]);
```

### Single Page Application (SPA) Multi-Step Forms

```typescript
async function fillSPAMultiStepForm(page: Page) {
  // Step 1: Personal Info
  await page.waitForSelector('[data-step="1"]', { state: 'visible' });
  await page.fill('#firstName', 'John');
  await page.fill('#lastName', 'Doe');
  await page.click('button:has-text("Next")');
  
  // Step 2: Wait for transition, then fill
  await page.waitForSelector('[data-step="2"]', { state: 'visible' });
  await page.fill('#experience', '5 years');
  await page.click('button:has-text("Next")');
  
  // Step 3: Upload resume
  await page.waitForSelector('[data-step="3"]', { state: 'visible' });
  await page.setInputFiles('input[type="file"]', '/path/to/resume.pdf');
  await page.click('button:has-text("Submit")');
}
```

### Progress Tracking

```typescript
async function fillFormWithProgress(
  page: Page,
  steps: Array<() => Promise<void>>,
  onProgress: (step: number, total: number) => void
) {
  for (let i = 0; i < steps.length; i++) {
    onProgress(i + 1, steps.length);
    await steps[i]();
  }
}

// Usage
await fillFormWithProgress(
  page,
  [
    async () => { await page.fill('#name', 'John'); },
    async () => { await page.fill('#email', 'john@example.com'); },
    async () => { await page.setInputFiles('input[type="file"]', 'resume.pdf'); }
  ],
  (step, total) => console.log(`Step ${step}/${total}`)
);
```

---

## Stealth and Anti-Detection

### Using playwright-extra with Stealth

```typescript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin
chromium.use(StealthPlugin());

async function launchStealthBrowser() {
  const browser = await chromium.launch({
    headless: false, // Headful mode is less detectable
  });
  
  const context = await browser.newContext({
    // Realistic viewport
    viewport: { width: 1920, height: 1080 },
    
    // User agent (keep updated)
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Locale and timezone
    locale: 'en-US',
    timezoneId: 'America/New_York',
    
    // Permissions
    permissions: ['geolocation'],
    geolocation: { latitude: 40.7128, longitude: -74.0060 },
  });
  
  return { browser, context };
}
```

### Manual Stealth Techniques (Without Plugin)

```typescript
async function applyStealthTechniques(page: Page) {
  // Override webdriver property
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });
  
  // Override plugins and languages
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });
  
  // Add mouse movements to appear human
  await page.mouse.move(100, 100);
  await page.mouse.move(200, 300);
}
```

### Human-Like Behavior Patterns

```typescript
async function humanLikeBehavior(page: Page) {
  // Random mouse movements
  async function randomMouseMove() {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y, { steps: 10 });
  }
  
  // Random scroll
  async function randomScroll() {
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 300 + 100);
    });
  }
  
  // Random delay between actions
  async function randomDelay() {
    await page.waitForTimeout(Math.random() * 2000 + 500);
  }
  
  return { randomMouseMove, randomScroll, randomDelay };
}
```

---

## Error Recovery Patterns

### Retry with Exponential Backoff

```typescript
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Usage
await retryOperation(async () => {
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
});
```

### Form Validation Error Handling

```typescript
async function fillFormWithValidation(page: Page, formData: Record<string, string>) {
  for (const [selector, value] of Object.entries(formData)) {
    await page.fill(selector, value);
    
    // Trigger blur to activate validation
    await page.locator(selector).blur();
    
    // Check for validation errors
    const errorSelector = `${selector} ~ .error, ${selector} + .error`;
    const hasError = await page.locator(errorSelector).isVisible().catch(() => false);
    
    if (hasError) {
      const errorText = await page.textContent(errorSelector);
      console.warn(`Validation error for ${selector}: ${errorText}`);
    }
  }
}
```

### Screenshot on Error

```typescript
async function withScreenshotOnError<T>(
  page: Page,
  operation: () => Promise<T>,
  screenshotPath: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: true 
    });
    console.error(`Error captured in screenshot: ${screenshotPath}`);
    throw error;
  }
}

// Usage
await withScreenshotOnError(
  page,
  async () => {
    await page.fill('#email', 'test@example.com');
    await page.click('button[type="submit"]');
  },
  '/tmp/error-screenshot.png'
);
```

### Graceful Form Field Detection

```typescript
async function smartFill(page: Page, fieldPatterns: Record<string, string[]>, value: string) {
  // Try multiple selectors for the same field
  for (const [fieldName, selectors] of Object.entries(fieldPatterns)) {
    for (const selector of selectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 1000 })) {
          await element.fill(value);
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

// Usage: Try multiple selectors for email field
const emailFilled = await smartFill(page, {
  email: [
    'input[name="email"]',
    'input[type="email"]',
    '#email',
    '[data-testid="email"]',
    'input[placeholder*="email" i]'
  ]
}, 'user@example.com');
```

---

## Complete Example: Job Application Form

```typescript
import { chromium, Page } from 'playwright';

interface ApplicationData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedIn?: string;
  resumePath: string;
  coverLetterPath?: string;
}

async function submitJobApplication(
  page: Page,
  applicationUrl: string,
  data: ApplicationData
) {
  // Navigate to application
  await page.goto(applicationUrl);
  await page.waitForLoadState('networkidle');
  
  // Fill personal information
  await page.fill('input[name="firstName"], #firstName', data.firstName);
  await page.fill('input[name="lastName"], #lastName', data.lastName);
  await page.fill('input[type="email"], input[name="email"]', data.email);
  await page.fill('input[type="tel"], input[name="phone"]', data.phone);
  
  if (data.linkedIn) {
    const linkedInField = page.locator('input[name*="linkedin" i], input[placeholder*="linkedin" i]');
    if (await linkedInField.isVisible()) {
      await linkedInField.fill(data.linkedIn);
    }
  }
  
  // Upload resume
  const resumeInput = page.locator('input[type="file"]').first();
  await resumeInput.setInputFiles(data.resumePath);
  
  // Wait for upload to complete
  await page.waitForTimeout(2000);
  
  // Optional: Upload cover letter if second file input exists
  if (data.coverLetterPath) {
    const coverLetterInput = page.locator('input[type="file"]').nth(1);
    if (await coverLetterInput.isVisible()) {
      await coverLetterInput.setInputFiles(data.coverLetterPath);
    }
  }
  
  // Handle any required checkboxes (terms, etc.)
  const requiredCheckboxes = page.locator('input[type="checkbox"][required]');
  const count = await requiredCheckboxes.count();
  for (let i = 0; i < count; i++) {
    await requiredCheckboxes.nth(i).check();
  }
  
  // Submit
  await page.click('button[type="submit"], input[type="submit"]');
  
  // Wait for confirmation
  await page.waitForSelector('.success, .confirmation, [data-testid="success"]', {
    timeout: 30000
  });
  
  return true;
}
```

---

## Best Practices Summary

1. **Always wait for elements** - Use `waitForSelector` before interacting
2. **Handle loading states** - Use `waitForLoadState('networkidle')` between pages
3. **Use multiple selector strategies** - ID, name, data-testid, placeholder, etc.
4. **Add human-like delays** - Random pauses between actions help avoid detection
5. **Take screenshots on errors** - Invaluable for debugging failed submissions
6. **Implement retries** - Network issues and timing problems are common
7. **Use stealth techniques** - Essential for sites with bot detection
8. **Test with headful mode first** - Debug visually before going headless
9. **Handle validation errors gracefully** - Check for error messages after filling fields
10. **Log progress** - Track which step failed for easier debugging
