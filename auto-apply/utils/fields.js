/**
 * Field filling utilities
 */

import config from '../config.js';

/**
 * Fill a text input field
 * @param {Page} page - Playwright page
 * @param {string} selector - CSS selector or text to find field
 * @param {string} value - Value to fill
 */
export async function fillText(page, selector, value) {
  if (!value) return false;

  try {
    const field = await page.locator(selector).first();
    await field.click();
    await field.fill(value);
    console.log(`[fields] Filled text field: ${selector.substring(0, 50)}...`);
    return true;
  } catch (error) {
    console.log(`[fields] Could not fill field ${selector}: ${error.message}`);
    return false;
  }
}

/**
 * Fill a field by its label text
 * @param {Page} page - Playwright page
 * @param {string} labelText - Label text to search for
 * @param {string} value - Value to fill
 */
export async function fillByLabel(page, labelText, value) {
  if (!value) return false;

  try {
    // Try multiple strategies to find the field
    const strategies = [
      // Strategy 1: Find label and get associated input
      async () => {
        const label = await page.locator(`label:has-text("${labelText}")`).first();
        const forAttr = await label.getAttribute('for');
        if (forAttr) {
          await page.locator(`#${forAttr}`).fill(value);
          return true;
        }
        // Check for nested input
        const input = await label.locator('input, textarea').first();
        await input.fill(value);
        return true;
      },
      // Strategy 2: Find input with placeholder
      async () => {
        const input = await page.locator(`input[placeholder*="${labelText}" i], textarea[placeholder*="${labelText}" i]`).first();
        await input.fill(value);
        return true;
      },
      // Strategy 3: Find input with aria-label
      async () => {
        const input = await page.locator(`input[aria-label*="${labelText}" i], textarea[aria-label*="${labelText}" i]`).first();
        await input.fill(value);
        return true;
      },
      // Strategy 4: Find input near text
      async () => {
        const input = await page.locator(`text="${labelText}" >> xpath=following::input[1]`).first();
        await input.fill(value);
        return true;
      },
    ];

    for (const strategy of strategies) {
      try {
        await strategy();
        console.log(`[fields] Filled field by label: "${labelText}"`);
        return true;
      } catch {
        continue;
      }
    }

    console.log(`[fields] Could not find field for label: "${labelText}"`);
    return false;
  } catch (error) {
    console.log(`[fields] Error filling field "${labelText}": ${error.message}`);
    return false;
  }
}

/**
 * Select an option from a dropdown
 * @param {Page} page - Playwright page
 * @param {string} selector - CSS selector for the select element
 * @param {string} value - Value or text to select
 */
export async function selectDropdown(page, selector, value) {
  if (!value) return false;

  try {
    const select = await page.locator(selector).first();

    // Try by value first, then by label
    try {
      await select.selectOption({ value });
    } catch {
      await select.selectOption({ label: value });
    }

    console.log(`[fields] Selected dropdown option: ${value}`);
    return true;
  } catch (error) {
    console.log(`[fields] Could not select dropdown ${selector}: ${error.message}`);
    return false;
  }
}

/**
 * Select dropdown by finding it near a label
 * Handles both native <select> and custom React Select dropdowns
 * @param {Page} page - Playwright page
 * @param {string} labelText - Label text to search for
 * @param {string} value - Value to select
 */
export async function selectByLabel(page, labelText, value) {
  if (!value) return false;

  try {
    const strategies = [
      // Strategy 1: Find label and get associated native select
      async () => {
        const label = await page.locator(`label:has-text("${labelText}")`).first();
        const forAttr = await label.getAttribute('for');
        if (forAttr) {
          const select = page.locator(`#${forAttr}`);
          await select.selectOption({ label: value });
          return true;
        }
        throw new Error('No for attribute');
      },
      // Strategy 2: Find native select near text
      async () => {
        const select = await page.locator(`text="${labelText}" >> xpath=following::select[1]`).first();
        await select.selectOption({ label: value });
        return true;
      },
      // Strategy 3: Greenhouse/React Select - find "Select..." button and click
      async () => {
        const container = await page.locator(`text="${labelText}"`).first();
        const dropdown = await container.locator('xpath=following::*[contains(text(), "Select...")][1]').first();
        await dropdown.click();
        // Wait for dropdown options to appear instead of fixed timeout
        await page.waitForSelector('[role="option"], [role="listbox"]', { state: 'visible', timeout: 2000 });
        await page.locator(`[role="option"]:has-text("${value}")`).first().click();
        return true;
      },
      // Strategy 4: React Select with data-testid or aria
      async () => {
        const dropdown = await page.locator(`[aria-label*="${labelText}" i], [data-testid*="${labelText.toLowerCase().replace(/\s+/g, '-')}" i]`).first();
        await dropdown.click();
        // Wait for dropdown options to appear instead of fixed timeout
        await page.waitForSelector('[role="option"], [role="listbox"]', { state: 'visible', timeout: 2000 });
        await page.locator(`[role="option"]:has-text("${value}")`).first().click();
        return true;
      },
      // Strategy 5: Click any dropdown-like element near label text
      async () => {
        await page.locator(`text="${labelText}" >> xpath=following::*[contains(@class, "select") or contains(@class, "dropdown") or contains(@class, "listbox")][1]`).click();
        // Wait for dropdown options to appear instead of fixed timeout
        await page.waitForSelector('[role="option"], [role="listbox"]', { state: 'visible', timeout: 2000 });
        await page.locator(`[role="option"]:has-text("${value}"), [role="listbox"] >> text="${value}"`).first().click();
        return true;
      },
      // Strategy 6: Greenhouse specific - find field wrapper and click input
      async () => {
        const fieldWrapper = await page.locator(`div:has(> label:has-text("${labelText}"))`).first();
        const selectInput = await fieldWrapper.locator('[class*="select"], [class*="dropdown"], input[readonly]').first();
        await selectInput.click();
        // Wait for dropdown options to appear instead of fixed timeout
        await page.waitForSelector('[role="option"], [role="listbox"], li', { state: 'visible', timeout: 2000 });
        await page.locator(`[role="option"]:has-text("${value}"), li:has-text("${value}")`).first().click();
        return true;
      },
    ];

    for (const strategy of strategies) {
      try {
        await strategy();
        console.log(`[fields] Selected by label: "${labelText}" = "${value}"`);
        return true;
      } catch {
        continue;
      }
    }

    console.log(`[fields] Could not find dropdown for label: "${labelText}"`);
    return false;
  } catch (error) {
    console.log(`[fields] Error selecting "${labelText}": ${error.message}`);
    return false;
  }
}

/**
 * Check or uncheck a checkbox
 * @param {Page} page - Playwright page
 * @param {string} selector - CSS selector
 * @param {boolean} checked - Whether to check or uncheck
 */
export async function setCheckbox(page, selector, checked = true) {
  try {
    const checkbox = await page.locator(selector).first();

    if (checked) {
      await checkbox.check();
    } else {
      await checkbox.uncheck();
    }

    console.log(`[fields] Set checkbox ${selector}: ${checked}`);
    return true;
  } catch (error) {
    console.log(`[fields] Could not set checkbox ${selector}: ${error.message}`);
    return false;
  }
}

/**
 * Click a radio button
 * @param {Page} page - Playwright page
 * @param {string} labelText - Text of the radio option to select
 */
export async function selectRadio(page, labelText) {
  try {
    const radio = await page.locator(`label:has-text("${labelText}") input[type="radio"], input[type="radio"] + label:has-text("${labelText}")`).first();
    await radio.check();
    console.log(`[fields] Selected radio: "${labelText}"`);
    return true;
  } catch (error) {
    console.log(`[fields] Could not select radio "${labelText}": ${error.message}`);
    return false;
  }
}

/**
 * Match a field label to profile data key
 * @param {string} label - Field label text
 * @returns {string|null} - Profile key or null
 */
export function matchLabelToProfileKey(label) {
  const normalizedLabel = label.toLowerCase().trim();

  for (const [key, patterns] of Object.entries(config.fieldPatterns)) {
    for (const pattern of patterns) {
      if (normalizedLabel.includes(pattern.toLowerCase())) {
        return key;
      }
    }
  }

  return null;
}

/**
 * Auto-fill form fields based on profile data
 * @param {Page} page - Playwright page
 * @param {Object} profile - User profile data
 */
export async function autoFillForm(page, profile) {
  console.log('[fields] Auto-filling form fields...');

  // Find all visible labels
  const labels = await page.locator('label:visible').all();

  for (const label of labels) {
    try {
      const labelText = await label.textContent();
      const profileKey = matchLabelToProfileKey(labelText);

      if (profileKey && profile[profileKey]) {
        await fillByLabel(page, labelText, profile[profileKey]);
        // No delay needed - fillByLabel handles its own timing
      }
    } catch {
      continue;
    }
  }
}

// ============================================================================
// PERFORMANCE OPTIMIZATION: PARALLEL FIELD FILLING
// ============================================================================

/**
 * Performance logger for tracking timing metrics
 */
class PerfLogger {
  constructor() {
    this.entries = new Map();
    this.sessionStart = Date.now();
    this.parallelBatches = 0;
  }

  start(name) {
    this.entries.set(name, { startTime: Date.now() });
  }

  end(name) {
    const entry = this.entries.get(name);
    if (entry) {
      entry.endTime = Date.now();
      entry.duration = entry.endTime - entry.startTime;
      console.log(`[PERF] ${name}: ${entry.duration}ms`);
      return entry.duration;
    }
    return 0;
  }

  recordParallelBatch(fieldCount, duration) {
    this.parallelBatches++;
    console.log(`[PERF] Parallel batch (${fieldCount} fields): ${duration}ms`);
  }

  getSummary() {
    const totalDuration = Date.now() - this.sessionStart;
    let fieldFillTime = 0;
    for (const entry of this.entries.values()) {
      if (entry.duration) fieldFillTime += entry.duration;
    }
    return {
      totalDuration,
      fieldFillTime,
      parallelBatches: this.parallelBatches,
    };
  }
}

// Global performance logger instance
export const perfLogger = new PerfLogger();

/**
 * Fill multiple fields in parallel for better performance
 * Groups independent field operations and executes them concurrently
 *
 * @param {Page} page - Playwright page
 * @param {Array<{label: string, value: string, type?: 'text'|'select'}>} fields - Fields to fill
 * @param {Object} options - Options
 * @param {number} options.batchSize - Max fields per parallel batch (default: 4)
 * @param {number} options.delayBetweenBatches - Delay between batches in ms (default: 50)
 * @returns {Promise<{success: number, failed: number, duration: number}>}
 */
export async function fillFieldsParallel(page, fields, options = {}) {
  const { batchSize = 4, delayBetweenBatches = 50 } = options;
  const startTime = Date.now();
  let success = 0;
  let failed = 0;

  console.log(`[fields] Parallel fill: ${fields.length} fields in batches of ${batchSize}`);

  // Process fields in batches
  for (let i = 0; i < fields.length; i += batchSize) {
    const batch = fields.slice(i, i + batchSize);
    const batchStartTime = Date.now();

    // Execute batch operations in parallel
    const results = await Promise.allSettled(
      batch.map(async (field) => {
        const { label, value, type = 'text' } = field;
        if (!value) return false;

        try {
          if (type === 'select') {
            return await selectByLabel(page, label, value);
          } else {
            return await fillByLabel(page, label, value);
          }
        } catch (error) {
          console.log(`[fields] Failed to fill "${label}": ${error.message}`);
          return false;
        }
      })
    );

    // Count successes and failures
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        success++;
      } else {
        failed++;
      }
    }

    const batchDuration = Date.now() - batchStartTime;
    perfLogger.recordParallelBatch(batch.length, batchDuration);

    // REQUIRED: Small delay between batches to prevent overwhelming the page.
    // This is necessary because ATS forms often trigger validation/re-render on field changes.
    // 50ms is the minimum that works reliably across ATS platforms.
    if (i + batchSize < fields.length && delayBetweenBatches > 0) {
      await page.waitForTimeout(delayBetweenBatches);
    }
  }

  const totalDuration = Date.now() - startTime;
  const estimatedSequential = fields.length * (config.delays.betweenFields + 100);
  const timeSaved = estimatedSequential - totalDuration;

  console.log(`[fields] Parallel fill complete: ${success}/${fields.length} succeeded in ${totalDuration}ms`);
  if (timeSaved > 0) {
    console.log(`[fields] Estimated time saved: ${timeSaved}ms (vs ${estimatedSequential}ms sequential)`);
  }

  return { success, failed, duration: totalDuration };
}

/**
 * Optimized form fill that uses parallel operations where possible
 * Separates fields into groups that can be filled concurrently
 *
 * @param {Page} page - Playwright page
 * @param {Object} profile - User profile data
 * @param {Object} options - Fill options
 * @returns {Promise<{filled: number, failed: number, duration: number}>}
 */
export async function fillFormOptimized(page, profile, options = {}) {
  const { skipUploads = false } = options;
  perfLogger.start('fillFormOptimized');

  console.log('[fields] Starting optimized form fill...');

  // Group 1: Basic info fields (can be filled in parallel)
  const basicFields = [
    { label: 'First name', value: profile.firstName },
    { label: 'Last name', value: profile.lastName },
    { label: 'Email', value: profile.email },
    { label: 'Phone', value: profile.phone },
    { label: 'Full name', value: `${profile.firstName} ${profile.lastName}` },
  ].filter(f => f.value);

  // Group 2: URL fields (can be filled in parallel)
  const urlFields = [
    { label: 'LinkedIn', value: profile.linkedin },
    { label: 'LinkedIn URL', value: profile.linkedin },
    { label: 'GitHub', value: profile.github },
    { label: 'GitHub URL', value: profile.github },
    { label: 'Website', value: profile.website },
    { label: 'Portfolio', value: profile.website },
  ].filter(f => f.value);

  // Group 3: Location/other fields (can be filled in parallel)
  const otherFields = [
    { label: 'Location', value: profile.location },
    { label: 'Current location', value: profile.location },
    { label: 'Current company', value: profile.currentCompany },
  ].filter(f => f.value);

  // Group 4: Dropdown fields (fill sequentially since they may have dependencies)
  const dropdownFields = [];

  // Fill each group in parallel
  let totalFilled = 0;
  let totalFailed = 0;

  // Fill basic fields
  if (basicFields.length > 0) {
    perfLogger.start('basicFields');
    const result = await fillFieldsParallel(page, basicFields);
    perfLogger.end('basicFields');
    totalFilled += result.success;
    totalFailed += result.failed;
  }

  // No pause needed - parallel batches handle their own timing

  // Fill URL fields
  if (urlFields.length > 0) {
    perfLogger.start('urlFields');
    const result = await fillFieldsParallel(page, urlFields);
    perfLogger.end('urlFields');
    totalFilled += result.success;
    totalFailed += result.failed;
  }

  // Fill other fields
  if (otherFields.length > 0) {
    perfLogger.start('otherFields');
    const result = await fillFieldsParallel(page, otherFields);
    perfLogger.end('otherFields');
    totalFilled += result.success;
    totalFailed += result.failed;
  }

  const totalDuration = perfLogger.end('fillFormOptimized');
  const summary = perfLogger.getSummary();

  console.log('\n' + '='.repeat(50));
  console.log('FORM FILL PERFORMANCE SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total Duration:      ${totalDuration}ms`);
  console.log(`Fields Filled:       ${totalFilled}`);
  console.log(`Fields Failed:       ${totalFailed}`);
  console.log(`Parallel Batches:    ${summary.parallelBatches}`);
  console.log('='.repeat(50) + '\n');

  return { filled: totalFilled, failed: totalFailed, duration: totalDuration };
}

/**
 * Connection pool for browser reuse between applications
 */
class BrowserConnectionPool {
  constructor(maxConnections = 3) {
    this.maxConnections = maxConnections;
    this.connections = [];
    this.available = [];
  }

  async acquire(browser, options = {}) {
    // Check for available connection
    if (this.available.length > 0) {
      const connection = this.available.pop();
      console.log('[pool] Reusing existing browser connection');
      return connection;
    }

    // Create new connection if under limit
    if (this.connections.length < this.maxConnections) {
      console.log('[pool] Creating new browser connection');
      const context = await browser.newContext();
      const page = await context.newPage();
      const connection = { context, page, id: this.connections.length };
      this.connections.push(connection);
      return connection;
    }

    // Wait for available connection
    console.log('[pool] Waiting for available connection...');
    return new Promise((resolve) => {
      const checkAvailable = setInterval(() => {
        if (this.available.length > 0) {
          clearInterval(checkAvailable);
          resolve(this.available.pop());
        }
      }, 100);
    });
  }

  release(connection) {
    console.log(`[pool] Releasing connection ${connection.id}`);
    this.available.push(connection);
  }

  async closeAll() {
    for (const conn of this.connections) {
      try {
        await conn.context.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    this.connections = [];
    this.available = [];
  }
}

// Singleton connection pool
export const browserPool = new BrowserConnectionPool();

export default {
  fillText,
  fillByLabel,
  selectDropdown,
  selectByLabel,
  setCheckbox,
  selectRadio,
  matchLabelToProfileKey,
  autoFillForm,
  // Performance optimizations
  fillFieldsParallel,
  fillFormOptimized,
  perfLogger,
  browserPool,
};
