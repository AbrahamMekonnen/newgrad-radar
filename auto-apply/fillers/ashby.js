/**
 * Ashby ATS form filler
 * Handles job applications on jobs.ashbyhq.com
 */

import browser from '../utils/browser.js';
import fields from '../utils/fields.js';
import resume from '../utils/resume.js';
import eeo from '../utils/eeo.js';
import config from '../config.js';

// Import reliability utilities
import {
  retry,
  retryBrowserOperation,
  getErrorReporter,
  classifyError,
  ErrorType,
  recordServiceFailure,
  recordServiceSuccess,
  getFeatureFlags,
} from '../utils/reliability.js';
import { AnswerManager, AnswerSource } from '../answers/index.js';

/**
 * Fill an Ashby job application
 * @param {Object} options - Application options
 * @param {string} options.url - Job application URL
 * @param {Object} options.profile - User profile data
 * @param {boolean} options.dryRun - If true, fill but don't submit
 * @param {boolean} options.headless - Run browser headlessly
 * @param {string} options.cdpUrl - CDP URL to connect to existing browser
 */
export async function fillApplication(options) {
  const { url, profile, dryRun = true, headless = false, cdpUrl } = options;
  const startTime = Date.now();
  const reporter = getErrorReporter();
  const ATS_TYPE = 'ashby';

  console.log('[ashby] Starting Ashby application');
  console.log(`[ashby] URL: ${url}`);
  console.log(`[ashby] Dry run: ${dryRun}`);

  // Check feature flags before proceeding
  const features = getFeatureFlags();
  if (!features.canApply) {
    const error = new Error(`Cannot apply: ${features.statusMessage}`);
    await reporter.logError(error, {
      atsType: ATS_TYPE,
      jobUrl: url,
      category: 'application'
    });
    return {
      success: false,
      error: features.statusMessage,
      url,
      degraded: true
    };
  }

  // Log application start
  await reporter.logApplicationStart(url, ATS_TYPE, profile.userId);

  // Initialize AnswerManager for intelligent question answering
  const answerManager = new AnswerManager(profile, { logLevel: 'info' });

  // Extract company name from URL for context
  const companyName = extractCompanyName(url);
  console.log(`[ashby] Company: ${companyName || 'Unknown'}`);

  let browserInstance, context, page;

  try {
    // Launch or connect to browser with retry
    const browserResult = await retryBrowserOperation(async () => {
      if (cdpUrl) {
        return browser.connectToBrowser(cdpUrl);
      } else {
        return browser.launchBrowser({ headless });
      }
    }, { operationName: 'browser-launch', maxAttempts: 2 });

    ({ browser: browserInstance, context, page } = browserResult);

    // Navigate to application with retry
    await retryBrowserOperation(
      () => browser.navigateTo(page, url),
      { operationName: 'navigation', maxAttempts: 3 }
    );

    // Ashby may require clicking Apply first
    try {
      const applyButton = await page.locator('button:has-text("Apply"), a:has-text("Apply for this job")').first();
      if (await applyButton.isVisible()) {
        console.log('[ashby] Clicking Apply button...');
        await applyButton.click();
        // Wait for form to appear instead of fixed timeout
        await page.waitForSelector('form, input[name="name"], input[type="email"]', { state: 'visible', timeout: 5000 }).catch(() => {});
      }
    } catch {
      // Already on application form
    }

    const title = await page.title();
    console.log(`[ashby] Page title: ${title}`);

    // PERFORMANCE: Start timing
    fields.perfLogger.start('totalFill');

    // Fill basic info section using PARALLEL field filling
    console.log('[ashby] Filling basic information (parallel)...');

    // Ashby forms can vary - try both full name and first/last
    const fullName = `${profile.firstName} ${profile.lastName}`;

    // OPTIMIZATION: Fill basic fields in parallel batches
    fields.perfLogger.start('basicInfo');
    const basicFields = [
      { label: 'Name', value: fullName },
      { label: 'Full name', value: fullName },
      { label: 'First Name', value: profile.firstName },
      { label: 'Last Name', value: profile.lastName },
      { label: 'Email', value: profile.email },
      { label: 'Phone', value: profile.phone },
      { label: 'Location', value: profile.location },
    ].filter(f => f.value);
    const basicResult = await fields.fillFieldsParallel(page, basicFields, { batchSize: 4 });
    fields.perfLogger.end('basicInfo');

    // Upload resume - Ashby often uses drag-and-drop zones (must be sequential)
    fields.perfLogger.start('resumeUpload');
    console.log('[ashby] Uploading resume...');
    await uploadAshbyResume(page, profile.resumePath);
    // Wait for upload confirmation instead of fixed timeout
    await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"], [data-testid="file-upload-success"]', { state: 'attached', timeout: 3000 }).catch(() => {});
    fields.perfLogger.end('resumeUpload');

    // OPTIMIZATION: Fill URL fields in parallel
    console.log('[ashby] Filling links (parallel)...');
    fields.perfLogger.start('urlFields');
    const urlFields = [
      { label: 'LinkedIn', value: profile.linkedin },
      { label: 'GitHub', value: profile.github },
      { label: 'Website', value: profile.website },
      { label: 'Portfolio', value: profile.website },
    ].filter(f => f.value);

    if (urlFields.length > 0) {
      await fields.fillFieldsParallel(page, urlFields, { batchSize: 4 });
    }
    fields.perfLogger.end('urlFields')

    // Handle custom questions
    console.log('[ashby] Handling custom questions...');
    await handleAshbyQuestions(page, profile, answerManager, companyName);

    // Handle EEO questions if they exist
    console.log('[ashby] Handling EEO questions...');
    await eeo.fillEEOQuestions(page, profile, 'ashby');

    // PERFORMANCE: Log final timing summary
    const totalDuration = fields.perfLogger.end('totalFill');
    const perfSummary = fields.perfLogger.getSummary();
    console.log('\n' + '='.repeat(50));
    console.log('ASHBY FILL PERFORMANCE');
    console.log('='.repeat(50));
    console.log(`Total Fill Time:     ${totalDuration}ms`);
    console.log(`Parallel Batches:    ${perfSummary.parallelBatches}`);
    console.log(`Basic Fields:        ${basicResult.success}/${basicResult.success + basicResult.failed} succeeded`);
    console.log('='.repeat(50) + '\n');

    if (dryRun) {
      console.log('[ashby] Dry run - pausing for review');
      await browser.screenshot(page, 'ashby-filled');
      await browser.waitForUserInput('Review the form and press Enter to close (form will NOT be submitted)');
    } else {
      console.log('[ashby] Submitting application...');
      // REQUIRED: Brief delay before submit to ensure form state is stable
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

      // Ashby submit button
      const submitButton = await page.locator('button[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")').first();
      await submitButton.click();

      // Wait for confirmation page/element instead of fixed timeout
      await Promise.race([
        page.waitForURL(/thank|confirm|success|submitted/i, { timeout: 5000 }),
        page.waitForSelector('[class*="success"], [class*="confirm"], h1:has-text("Thank"), h2:has-text("Thank")', { state: 'visible', timeout: 5000 }),
      ]).catch(() => {});
      console.log('[ashby] Application submitted!');
      await browser.screenshot(page, 'ashby-submitted');
    }

    // Record success
    recordServiceSuccess(ATS_TYPE);

    const duration = Date.now() - startTime;
    await reporter.logApplicationComplete(url, ATS_TYPE, true, duration);

    return { success: true, url, duration };
  } catch (error) {
    // Classify and log the error
    const classified = classifyError(error);
    const duration = Date.now() - startTime;

    // Record service failure for degradation tracking
    recordServiceFailure(ATS_TYPE, error, { threshold: 3 });

    // Generate user-friendly error message
    const userMessage = getUserFriendlyError(classified, ATS_TYPE);

    console.error(`[ashby] Error: ${userMessage}`);
    console.error(`[ashby] Details: ${error.message}`);

    if (page) {
      await browser.screenshot(page, 'ashby-error');
    }

    // Log to application_logs
    await reporter.logApplicationComplete(url, ATS_TYPE, false, duration, {
      errorType: classified.type,
      metadata: {
        originalMessage: error.message,
        shouldRetry: classified.shouldRetry,
        stack: error.stack
      }
    });

    return {
      success: false,
      error: userMessage,
      errorType: classified.type,
      shouldRetry: classified.shouldRetry,
      url,
      duration
    };
  } finally {
    if (!cdpUrl && browserInstance) {
      await browser.closeBrowser(browserInstance);
    }
    // Flush any pending logs
    await reporter.flush().catch(() => {});
  }
}

/**
 * Generate user-friendly error message based on error classification
 */
function getUserFriendlyError(classified, atsType) {
  const atsName = atsType.charAt(0).toUpperCase() + atsType.slice(1);

  switch (classified.type) {
    case ErrorType.RATE_LIMITED:
      return `${atsName} is rate limiting requests. Please wait a few minutes before trying again.`;

    case ErrorType.TRANSIENT:
      if (classified.message.includes('timeout')) {
        return `The ${atsName} page took too long to respond. Please try again.`;
      }
      if (classified.message.includes('ECONNREFUSED') || classified.message.includes('ENOTFOUND')) {
        return `Could not connect to ${atsName}. Please check your internet connection.`;
      }
      return 'A temporary error occurred. Please try again.';

    case ErrorType.PERMANENT:
      if (classified.message.includes('404')) {
        return 'This job posting may no longer be available.';
      }
      if (classified.message.includes('401') || classified.message.includes('403')) {
        return 'Access denied. The application may require login.';
      }
      return `Application failed: ${classified.message}`;

    case ErrorType.CIRCUIT_OPEN:
      return `${atsName} applications are temporarily unavailable. Please try again later.`;

    default:
      return classified.message;
  }
}

/**
 * Handle Ashby's resume upload which may be a dropzone
 */
async function uploadAshbyResume(page, resumePath) {
  if (!resumePath) return false;

  // Try standard file input first
  const uploaded = await resume.uploadResume(page, resumePath);
  if (uploaded) return true;

  // Try Ashby-specific patterns
  try {
    // Look for dropzone or upload area
    const dropzone = await page.locator('[data-testid="file-upload"], .dropzone, [class*="upload"]').first();

    if (await dropzone.isVisible()) {
      // Find the hidden file input within or near the dropzone
      const fileInput = await page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(resumePath);
      console.log('[ashby] Uploaded resume via dropzone');
      return true;
    }
  } catch (error) {
    console.log(`[ashby] Dropzone upload failed: ${error.message}`);
  }

  return false;
}

/**
 * Extract company name from Ashby URL
 */
function extractCompanyName(url) {
  try {
    const urlObj = new URL(url);
    // jobs.ashbyhq.com/companyname or companyname.ashbyhq.com
    if (urlObj.hostname.includes('ashbyhq.com')) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const name = pathParts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
      // Check subdomain
      const subdomain = urlObj.hostname.split('.')[0];
      if (subdomain !== 'jobs' && subdomain !== 'www') {
        return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle Ashby-specific questions
 */
async function handleAshbyQuestions(page, profile, answerManager, companyName) {
  // Work authorization (sequential - may have dependent UI behavior)
  if (profile.workAuth) {
    const authLabels = [
      'authorized to work',
      'require visa sponsorship',
      'work authorization',
    ];

    for (const label of authLabels) {
      try {
        // Ashby often uses radio buttons
        await fields.selectRadio(page, profile.workAuth);
        break;
      } catch {
        try {
          await fields.selectByLabel(page, label, profile.workAuth);
          break;
        } catch {
          continue;
        }
      }
    }
  }

  // OPTIMIZATION: Fill additional info fields in parallel
  fields.perfLogger.start('additionalInfo');
  const additionalFields = [
    { label: 'years of experience', value: profile.yearsExperience },
    { label: 'salary', value: profile.salaryExpectation },
    { label: 'start date', value: profile.startDate },
  ].filter(f => f.value);

  if (additionalFields.length > 0) {
    await fields.fillFieldsParallel(page, additionalFields, { batchSize: 3 });
  }
  fields.perfLogger.end('additionalInfo');

  // OPTIMIZATION: Fill custom answers in parallel where possible
  if (profile.customAnswers) {
    fields.perfLogger.start('customAnswers');
    const customTextFields = [];
    const customSelectFields = [];

    for (const [question, answer] of Object.entries(profile.customAnswers)) {
      // Categorize fields - try text first, dropdowns handled separately
      customTextFields.push({ label: question, value: answer });
    }

    // Fill text fields in parallel
    if (customTextFields.length > 0) {
      const result = await fields.fillFieldsParallel(page, customTextFields, { batchSize: 4 });
      console.log(`[ashby] Custom answers: ${result.success}/${customTextFields.length} filled`);

      // For fields that failed as text, try as dropdowns sequentially
      // (can't easily parallelize dropdown interactions due to overlay behavior)
      for (const field of customTextFields) {
        try {
          await fields.selectByLabel(page, field.label, field.value);
        } catch {
          // Already logged in parallel fill
        }
      }
    }
    fields.perfLogger.end('customAnswers');
  }

  // Answer textareas using AnswerManager (for long-form questions)
  await answerAshbyTextareas(page, answerManager, companyName);

  // Answer remaining text inputs using AnswerManager
  await answerAshbyInputs(page, profile, answerManager);
}

/**
 * Answer textareas using AnswerManager
 */
async function answerAshbyTextareas(page, answerManager, companyName) {
  try {
    const textareas = await page.locator('textarea:visible').all();

    for (const textarea of textareas) {
      try {
        const value = await textarea.inputValue();
        if (value && value.trim()) continue;

        const id = await textarea.getAttribute('id');
        const placeholder = await textarea.getAttribute('placeholder');
        let labelText = null;

        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          if (await label.count() > 0) {
            labelText = await label.textContent();
          }
        }

        if (!labelText) labelText = placeholder;
        if (!labelText) continue;

        // Check for "Why Company?" pattern
        const whyCompanyMatch = labelText.match(/why\s+(?:do\s+you\s+want\s+to\s+)?(?:work\s+(?:at|for)|join)\s+(?:us|(\w+))/i);
        if (whyCompanyMatch || labelText.toLowerCase().includes('why interested') || labelText.toLowerCase().includes('why this company')) {
          const targetCompany = whyCompanyMatch?.[1] || companyName || 'this company';
          const { answer, source } = answerManager.answerWhyCompany(targetCompany);
          if (answer) {
            await textarea.fill(answer);
            console.log(`[ashby] Answered Why ${targetCompany}? (${source})`);
            // No delay needed - textarea.fill is synchronous
            continue;
          }
        }

        const { answer, source } = answerManager.answerQuestion(labelText);
        if (answer) {
          await textarea.fill(answer);
          console.log(`[ashby] Filled long-form (${source}): "${labelText.substring(0, 40)}..."`);
          // No delay needed - textarea.fill is synchronous
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[ashby] Error scanning textareas: ${error.message}`);
  }
}

/**
 * Answer remaining text inputs using AnswerManager
 */
async function answerAshbyInputs(page, profile, answerManager) {
  try {
    const labels = await page.locator('label:visible').all();

    for (const label of labels) {
      try {
        const labelText = await label.textContent();
        if (!labelText || labelText.length < 5) continue;

        if (profile.customAnswers && profile.customAnswers[labelText.trim()]) continue;

        const forAttr = await label.getAttribute('for');
        if (!forAttr) continue;

        const input = page.locator(`#${forAttr}`);
        if (await input.count() === 0) continue;

        const tagName = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => null);
        if (tagName === 'textarea') continue;

        const inputValue = await input.inputValue().catch(() => null);
        if (inputValue && inputValue.trim()) continue;

        const { answer, source } = answerManager.answerQuestion(labelText.trim());
        if (answer) {
          const filled = await fields.fillByLabel(page, labelText.trim(), answer);
          if (filled) {
            console.log(`[ashby] Answered (${source}): "${labelText.substring(0, 40)}..."`);
          }
          // No delay needed - fillByLabel handles its own timing
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[ashby] Error scanning inputs: ${error.message}`);
  }
}

export default { fillApplication };
