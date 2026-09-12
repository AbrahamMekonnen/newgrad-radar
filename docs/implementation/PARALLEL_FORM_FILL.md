# Parallel Form Filling with React/Vue Compatibility

This document covers the implementation patterns for filling multiple form fields in parallel while properly triggering React and Vue reactivity systems.

## Table of Contents

1. [React Controlled Input Handling](#react-controlled-input-handling)
2. [Vue v-model Triggering](#vue-v-model-triggering)
3. [Event Dispatching Sequence](#event-dispatching-sequence)
4. [Parallel vs Sequential Decision Logic](#parallel-vs-sequential-decision-logic)
5. [MutationObserver for Dynamic Forms](#mutationobserver-for-dynamic-forms)
6. [ATS-Specific Patterns](#ats-specific-patterns)
7. [Implementation Code](#implementation-code)

---

## React Controlled Input Handling

React controlled inputs store their value in component state and update via `onChange` handlers. Simply setting `element.value` does NOT trigger React's state update.

### The Problem

```javascript
// THIS DOES NOT WORK with React
input.value = 'John';  // Sets native DOM value
// React's state is still empty - form won't submit correctly
```

### The Solution

React listens for native DOM events. You must:
1. Set the native value using React's internal value setter
2. Dispatch an `input` event with `bubbles: true`

```javascript
/**
 * Fill a React controlled input field
 * @param {HTMLInputElement} element - The input element
 * @param {string} value - Value to set
 */
function fillReactInput(element, value) {
  // Get React's internal value setter (bypasses the getter/setter)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;

  // Call the native setter directly
  nativeInputValueSetter.call(element, value);

  // Create and dispatch the input event
  const inputEvent = new Event('input', { bubbles: true });

  // React 16+ uses a synthetic event system that checks for this
  inputEvent.simulated = true;

  element.dispatchEvent(inputEvent);
}

/**
 * Alternative: Use InputEvent for better compatibility
 */
function fillReactInputV2(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;

  nativeInputValueSetter.call(element, value);

  // InputEvent works better with React 17+
  const inputEvent = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  });

  element.dispatchEvent(inputEvent);
}
```

### React Select Components

React Select and similar libraries use custom components, not native selects:

```javascript
/**
 * Fill a React Select component
 * @param {Element} container - The React Select container
 * @param {string} value - Option text to select
 */
async function fillReactSelect(page, container, value) {
  // Click to open the dropdown
  await container.click();

  // Wait for options to render
  await page.waitForSelector('[role="option"]', { timeout: 2000 });

  // Find and click the matching option
  const option = await page.locator(`[role="option"]:has-text("${value}")`).first();
  await option.click();
}
```

---

## Vue v-model Triggering

Vue's `v-model` directive is syntactic sugar for `:value` + `@input` (Vue 2) or `:modelValue` + `@update:modelValue` (Vue 3).

### Vue 2 Pattern

```javascript
/**
 * Fill a Vue 2 v-model input
 */
function fillVue2Input(element, value) {
  // Set the value
  element.value = value;

  // Vue 2 listens for the 'input' event
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
```

### Vue 3 Pattern

```javascript
/**
 * Fill a Vue 3 v-model input
 * Vue 3 uses 'update:modelValue' internally but still listens for 'input'
 */
function fillVue3Input(element, value) {
  element.value = value;

  // For text inputs, dispatch input event
  element.dispatchEvent(new Event('input', { bubbles: true }));

  // For some components, may need change event too
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
```

### Vue Select/Dropdown Components

```javascript
/**
 * Fill a Vue Select (like vue-select or Element UI)
 */
async function fillVueSelect(page, selector, value) {
  // Click to open
  const select = await page.locator(selector).first();
  await select.click();

  // Wait for dropdown to appear
  await page.waitForTimeout(100);

  // Find option - Vue components often use different selectors
  const optionSelectors = [
    `.el-select-dropdown__item:has-text("${value}")`,  // Element UI
    `.vs__dropdown-option:has-text("${value}")`,       // vue-select
    `[role="option"]:has-text("${value}")`,            // ARIA compliant
    `li:has-text("${value}")`,                         // Generic
  ];

  for (const optSelector of optionSelectors) {
    try {
      const option = await page.locator(optSelector).first();
      if (await option.isVisible()) {
        await option.click();
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
```

---

## Event Dispatching Sequence

Different frameworks expect different event sequences. Here's the complete sequence that works universally:

### Full Event Sequence (Most Compatible)

```javascript
/**
 * Complete event sequence for universal framework compatibility
 */
function fillInputUniversal(element, value) {
  // 1. Focus the element first
  element.focus();
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // 2. Set value using native setter (for React)
  const descriptor = Object.getOwnPropertyDescriptor(
    element.constructor.prototype,
    'value'
  );
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  // 3. Dispatch input event (React + Vue)
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value,
  }));

  // 4. Dispatch change event (native HTML + some frameworks)
  element.dispatchEvent(new Event('change', { bubbles: true }));

  // 5. Blur to trigger validation
  element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}
```

### Minimal Event Sequence (Performance)

For known React/Vue apps, use minimal events:

```javascript
/**
 * Minimal event sequence - faster but less universal
 */
function fillInputMinimal(element, value) {
  // Get native setter
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set || Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Single input event covers React + Vue
  const event = new Event('input', { bubbles: true });
  event.simulated = true;  // React flag
  element.dispatchEvent(event);
}
```

---

## Parallel vs Sequential Decision Logic

### When to Use Parallel Filling

```javascript
const PARALLEL_SAFE_FIELDS = [
  // Basic info - independent fields
  'firstName', 'lastName', 'email', 'phone',
  // URLs - independent fields
  'linkedin', 'github', 'website', 'portfolio',
  // Location fields
  'city', 'state', 'country',
];

const SEQUENTIAL_REQUIRED = [
  // File uploads - can cause race conditions
  'resume', 'coverLetter',
  // Dependent dropdowns - second depends on first
  'country -> state', 'state -> city',
  // Calculated fields
  'salary', 'startDate',
];
```

### Decision Logic Implementation

```javascript
/**
 * Determine if fields can be filled in parallel
 * @param {Array<Field>} fields - Fields to analyze
 * @returns {Object} - { parallel: Field[], sequential: Field[] }
 */
function categorizeFields(fields) {
  const parallel = [];
  const sequential = [];

  // Track dependencies
  const filled = new Set();

  for (const field of fields) {
    const isFileUpload = field.type === 'file';
    const hasDependency = field.dependsOn && !filled.has(field.dependsOn);
    const triggersOthers = field.triggers?.length > 0;
    const isCustomDropdown = field.type === 'react-select' || field.type === 'vue-select';

    if (isFileUpload || hasDependency || triggersOthers || isCustomDropdown) {
      sequential.push(field);
    } else {
      parallel.push(field);
    }

    filled.add(field.name);
  }

  return { parallel, sequential };
}

/**
 * ATS-specific parallelization rules
 */
const ATS_PARALLEL_RULES = {
  greenhouse: {
    maxBatchSize: 4,
    parallelSafe: ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'github'],
    sequential: ['resume', 'coverLetter', 'eeo'],
  },
  lever: {
    maxBatchSize: 5,
    parallelSafe: ['fullName', 'email', 'phone', 'linkedin', 'github', 'website'],
    sequential: ['resume', 'coverLetter'],
  },
  ashby: {
    maxBatchSize: 3,  // Ashby is more sensitive
    parallelSafe: ['name', 'email', 'phone'],
    sequential: ['resume', 'location', 'workAuth'],
  },
  jobvite: {
    maxBatchSize: 4,
    parallelSafe: ['firstName', 'lastName', 'email', 'phone'],
    sequential: ['resume', 'coverLetter', 'customQuestions'],
  },
};
```

---

## MutationObserver for Dynamic Forms

Many ATS platforms load form fields dynamically. Use MutationObserver to detect and fill new fields.

### Implementation

```javascript
/**
 * Watch for dynamically added form fields and fill them
 * @param {Element} formContainer - Form container to observe
 * @param {Object} profile - User profile data
 * @param {Object} options - Options
 */
function watchAndFillDynamicFields(formContainer, profile, options = {}) {
  const { timeout = 10000, onFieldAdded } = options;
  const filled = new Set();
  let timeoutId;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Find input fields in the added node
        const inputs = node.matches?.('input, textarea, select')
          ? [node]
          : node.querySelectorAll?.('input, textarea, select') || [];

        for (const input of inputs) {
          const fieldId = input.id || input.name || input.getAttribute('data-testid');

          if (fieldId && !filled.has(fieldId)) {
            filled.add(fieldId);

            // Small delay for framework to initialize
            setTimeout(() => {
              const value = matchFieldToProfile(input, profile);
              if (value) {
                fillInputUniversal(input, value);
                onFieldAdded?.(input, value);
              }
            }, 50);
          }
        }
      }
    }
  });

  observer.observe(formContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });

  // Auto-disconnect after timeout
  if (timeout > 0) {
    timeoutId = setTimeout(() => observer.disconnect(), timeout);
  }

  return {
    disconnect: () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    },
    filled,
  };
}

/**
 * Wait for a specific field to appear
 */
async function waitForField(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Field ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}
```

### Waiting for React Re-renders

```javascript
/**
 * Wait for React to finish re-rendering after state change
 * Uses React's scheduler if available, falls back to RAF
 */
async function waitForReactRender() {
  return new Promise((resolve) => {
    // Try to use React's scheduler
    if (window.scheduler?.postTask) {
      window.scheduler.postTask(resolve, { priority: 'background' });
    } else {
      // Fallback: requestAnimationFrame + microtask
      requestAnimationFrame(() => {
        queueMicrotask(resolve);
      });
    }
  });
}

/**
 * Wait for Vue's nextTick if available
 */
async function waitForVueUpdate() {
  return new Promise((resolve) => {
    // Check for Vue 3's nextTick
    if (window.Vue?.nextTick) {
      window.Vue.nextTick(resolve);
    } else {
      // Fallback
      requestAnimationFrame(() => setTimeout(resolve, 0));
    }
  });
}

/**
 * Universal framework update wait
 */
async function waitForFrameworkUpdate(page) {
  // Use Playwright's built-in wait which handles most cases
  await page.waitForLoadState('domcontentloaded');

  // Additional microtask cycle for React/Vue
  await page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => setTimeout(r, 10))
  ));
}
```

---

## ATS-Specific Patterns

### Greenhouse (React)

```javascript
/**
 * Greenhouse uses React with custom form components
 */
const GREENHOUSE_PATTERNS = {
  // Input selectors
  selectors: {
    firstName: 'input[name="first_name"], #first_name',
    lastName: 'input[name="last_name"], #last_name',
    email: 'input[name="email"], #email',
    phone: 'input[name="phone"], #phone',
    resume: 'input[type="file"][name*="resume"]',
    linkedin: 'input[name*="linkedin"], input[id*="linkedin"]',
  },

  // Greenhouse React Select pattern
  async fillDropdown(page, labelText, value) {
    // Find the field wrapper
    const wrapper = await page.locator(`div:has(> label:has-text("${labelText}"))`).first();

    // Click the select trigger (shows "Select..." text)
    const trigger = await wrapper.locator('[class*="select"], [class*="dropdown"]').first();
    await trigger.click();

    // Wait for dropdown animation
    await page.waitForTimeout(200);

    // Click the option
    await page.locator(`[role="option"]:has-text("${value}")`).first().click();

    // Wait for React to update
    await page.waitForTimeout(100);
  },

  // Batch fill for Greenhouse
  async batchFill(page, fields) {
    const results = await Promise.allSettled(
      fields.map(async ({ selector, value }) => {
        const el = await page.locator(selector).first();
        await el.fill(value);  // Playwright's fill() handles React
        return true;
      })
    );
    return results.filter(r => r.status === 'fulfilled').length;
  },
};
```

### Lever (React)

```javascript
/**
 * Lever uses React with some unique patterns
 */
const LEVER_PATTERNS = {
  selectors: {
    fullName: 'input[name="name"]',
    email: 'input[name="email"]',
    phone: 'input[name="phone"]',
    currentCompany: 'input[name="org"]',
    resume: 'input[name="resume"]',
    linkedin: 'input[name*="linkedin" i]',
  },

  // Lever often pre-fills from LinkedIn import
  async clearAndFill(page, selector, value) {
    const input = await page.locator(selector).first();

    // Clear existing value
    await input.fill('');

    // Small wait for React state to clear
    await page.waitForTimeout(50);

    // Fill new value
    await input.fill(value);
  },

  // Handle Lever's "Add" buttons for multiple entries
  async fillMultiField(page, category, values) {
    for (let i = 0; i < values.length; i++) {
      if (i > 0) {
        // Click "Add another" button
        await page.locator(`button:has-text("Add ${category}")`).click();
        await page.waitForTimeout(200);
      }

      const inputs = await page.locator(`[data-field="${category}"] input`).all();
      await inputs[i].fill(values[i]);
    }
  },
};
```

### Ashby (React)

```javascript
/**
 * Ashby uses React with drag-drop file uploads
 */
const ASHBY_PATTERNS = {
  selectors: {
    name: 'input[name="name"], input[placeholder*="name" i]',
    email: 'input[name="email"], input[type="email"]',
    phone: 'input[name="phone"], input[type="tel"]',
    resume: 'input[type="file"]',
  },

  // Ashby's dropzone file upload
  async uploadFile(page, filePath) {
    // Method 1: Direct file input
    const fileInput = await page.locator('input[type="file"]').first();

    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(filePath);
      return true;
    }

    // Method 2: Drag-drop simulation for dropzone
    const dropzone = await page.locator('[class*="dropzone"], [class*="upload"]').first();

    if (await dropzone.count() > 0) {
      // Dispatch drop event with file
      await page.evaluate(async (path) => {
        const input = document.createElement('input');
        input.type = 'file';
        document.body.appendChild(input);

        // Trigger the hidden input
        input.click();
      }, filePath);
    }

    return false;
  },

  // Ashby-specific delay between fields (more sensitive)
  delayBetweenFields: 150,
};
```

### Jobvite (Vue/Angular Mix)

```javascript
/**
 * Jobvite uses a mix of Vue and Angular components
 */
const JOBVITE_PATTERNS = {
  selectors: {
    firstName: 'input[name="firstName"], #firstName',
    lastName: 'input[name="lastName"], #lastName',
    email: 'input[name="email"], input[type="email"]',
    phone: 'input[name="phone"], input[type="tel"]',
    resume: 'input[type="file"][accept*="pdf"]',
  },

  // Jobvite custom dropdown (Angular-style)
  async fillAngularDropdown(page, labelText, value) {
    // Find and click the dropdown trigger
    const trigger = await page.locator(
      `[ng-reflect-placeholder*="${labelText}" i], [formcontrolname*="${labelText.toLowerCase()}"]`
    ).first();

    await trigger.click();
    await page.waitForTimeout(200);

    // Click option
    await page.locator(`mat-option:has-text("${value}"), .cdk-option:has-text("${value}")`).first().click();
  },

  // Jobvite needs full event sequence
  async fillField(page, selector, value) {
    const input = await page.locator(selector).first();

    await input.click();
    await input.fill('');
    await input.type(value, { delay: 20 });  // Type with small delay
    await input.blur();
  },
};
```

---

## Implementation Code

### Complete Parallel Form Filler

```javascript
/**
 * Parallel form filler with React/Vue compatibility
 * @param {Page} page - Playwright page
 * @param {Array<Field>} fields - Fields to fill
 * @param {Object} options - Configuration
 */
export async function fillFieldsParallel(page, fields, options = {}) {
  const {
    batchSize = 4,
    delayBetweenBatches = 50,
    atsType = 'generic',
  } = options;

  const startTime = Date.now();
  let success = 0;
  let failed = 0;

  // Get ATS-specific rules
  const rules = ATS_PARALLEL_RULES[atsType] || {
    maxBatchSize: 4,
    parallelSafe: [],
    sequential: [],
  };

  // Categorize fields
  const { parallel, sequential } = categorizeFields(fields);

  // Fill parallel fields in batches
  for (let i = 0; i < parallel.length; i += rules.maxBatchSize) {
    const batch = parallel.slice(i, i + rules.maxBatchSize);

    const results = await Promise.allSettled(
      batch.map(async (field) => {
        try {
          return await fillSingleField(page, field);
        } catch (error) {
          console.log(`Failed to fill "${field.label}": ${error.message}`);
          return false;
        }
      })
    );

    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        success++;
      } else {
        failed++;
      }
    }

    // Wait for framework updates between batches
    if (i + rules.maxBatchSize < parallel.length) {
      await waitForFrameworkUpdate(page);
      await page.waitForTimeout(delayBetweenBatches);
    }
  }

  // Fill sequential fields one by one
  for (const field of sequential) {
    try {
      const result = await fillSingleField(page, field);
      if (result) {
        success++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log(`Failed to fill "${field.label}": ${error.message}`);
      failed++;
    }

    // Sequential fields need full event cycle
    await page.waitForTimeout(100);
  }

  const duration = Date.now() - startTime;

  return { success, failed, duration };
}

/**
 * Fill a single field with proper event handling
 */
async function fillSingleField(page, field) {
  const { label, value, type = 'text', selector } = field;

  if (!value) return false;

  // Try selector first, then label-based
  let element;

  if (selector) {
    element = await page.locator(selector).first();
  } else {
    element = await findFieldByLabel(page, label);
  }

  if (!element || !(await element.count())) {
    return false;
  }

  switch (type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
      // Playwright's fill() handles React/Vue properly
      await element.fill(value);
      break;

    case 'select':
      await element.selectOption({ label: value });
      break;

    case 'react-select':
      await fillReactSelect(page, element, value);
      break;

    case 'checkbox':
      if (value) {
        await element.check();
      } else {
        await element.uncheck();
      }
      break;

    case 'radio':
      await element.check();
      break;

    default:
      await element.fill(String(value));
  }

  return true;
}

/**
 * Find field by label text (multiple strategies)
 */
async function findFieldByLabel(page, labelText) {
  const strategies = [
    // Strategy 1: label[for] -> input#id
    async () => {
      const label = await page.locator(`label:has-text("${labelText}")`).first();
      const forId = await label.getAttribute('for');
      if (forId) {
        return page.locator(`#${forId}`);
      }
      throw new Error('No for attribute');
    },

    // Strategy 2: Label contains input
    async () => {
      return page.locator(`label:has-text("${labelText}") input, label:has-text("${labelText}") textarea`).first();
    },

    // Strategy 3: Placeholder match
    async () => {
      return page.locator(`input[placeholder*="${labelText}" i], textarea[placeholder*="${labelText}" i]`).first();
    },

    // Strategy 4: aria-label match
    async () => {
      return page.locator(`input[aria-label*="${labelText}" i], textarea[aria-label*="${labelText}" i]`).first();
    },

    // Strategy 5: Following sibling
    async () => {
      return page.locator(`text="${labelText}" >> xpath=following::input[1]`).first();
    },
  ];

  for (const strategy of strategies) {
    try {
      const element = await strategy();
      if (await element.count() > 0) {
        return element;
      }
    } catch {
      continue;
    }
  }

  return null;
}
```

### Performance Configuration

```javascript
/**
 * Optimized configuration for parallel form filling
 */
export const FORM_FILL_CONFIG = {
  // Timing (milliseconds)
  delays: {
    betweenFields: 50,       // Within parallel batch
    betweenBatches: 100,     // Between parallel batches
    afterDropdown: 200,      // After opening dropdown
    afterFileUpload: 500,    // After file upload
    beforeSubmit: 800,       // Before clicking submit
  },

  // Parallel settings
  parallel: {
    enabled: true,
    maxBatchSize: 4,
    maxConcurrentFields: 6,
  },

  // Retry settings
  retry: {
    maxAttempts: 3,
    delayBetweenAttempts: 200,
  },

  // Framework detection
  frameworks: {
    detectReact: () => !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
    detectVue: () => !!window.__VUE__,
    detectAngular: () => !!window.ng || !!document.querySelector('[ng-version]'),
  },
};
```

---

## Best Practices

1. **Always use Playwright's `fill()` for text inputs** - it handles React's synthetic event system correctly.

2. **Use `Promise.allSettled()` for parallel operations** - one failure shouldn't break the entire batch.

3. **Categorize fields before filling** - parallel for independent fields, sequential for dependent ones.

4. **Add small delays between batches** - gives frameworks time to process state updates.

5. **Use MutationObserver for dynamic forms** - many ATS platforms load sections lazily.

6. **Test on headful browser first** - easier to debug framework issues.

7. **Log performance metrics** - track which fields are slow and optimize accordingly.
