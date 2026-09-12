/**
 * Lever ATS form filler
 * Handles job applications on jobs.lever.co
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
 * Fill a Lever job application
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
  const ATS_TYPE = 'lever';

  console.log('[lever] Starting Lever application');
  console.log(`[lever] URL: ${url}`);
  console.log(`[lever] Dry run: ${dryRun}`);

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
  console.log(`[lever] Company: ${companyName || 'Unknown'}`);

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

    // Check if we need to click "Apply" button first
    try {
      const applyButton = await page.locator('a.postings-btn, button:has-text("Apply for this job"), .apply-button').first();
      if (await applyButton.isVisible()) {
        console.log('[lever] Clicking Apply button...');
        await applyButton.click();
        // Wait for form to appear instead of fixed timeout
        await page.waitForSelector('form, input[name="name"], input[name="email"]', { state: 'visible', timeout: 5000 }).catch(() => {});
      }
    } catch {
      // Already on application form
    }

    const title = await page.title();
    console.log(`[lever] Page title: ${title}`);

    // PERFORMANCE: Start timing
    const fillStartTime = Date.now();
    fields.perfLogger.start('totalFill');

    // Fill basic info section using PARALLEL field filling
    console.log('[lever] Filling basic information (parallel)...');

    // OPTIMIZATION: Fill basic fields in parallel
    const fullName = `${profile.firstName} ${profile.lastName}`;
    fields.perfLogger.start('basicInfo');
    const basicFields = [
      { label: 'Full name', value: fullName },
      { label: 'First name', value: profile.firstName },
      { label: 'Last name', value: profile.lastName },
      { label: 'Email', value: profile.email },
      { label: 'Phone', value: profile.phone },
    ];
    const basicResult = await fields.fillFieldsParallel(page, basicFields, { batchSize: 5 });
    fields.perfLogger.end('basicInfo');

    // OPTIMIZATION: Fill location fields in parallel
    fields.perfLogger.start('locationFields');
    const locationFields = [
      { label: 'Current location', value: profile.location },
      { label: 'Current company', value: profile.currentCompany },
    ].filter(f => f.value);

    if (locationFields.length > 0) {
      await fields.fillFieldsParallel(page, locationFields, { batchSize: 2 });
    }
    fields.perfLogger.end('locationFields');

    // Upload resume (must be sequential - file operations)
    fields.perfLogger.start('resumeUpload');
    console.log('[lever] Uploading resume...');
    await resume.uploadResume(page, profile.resumePath);
    // Wait for upload confirmation instead of fixed timeout
    await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"], input[type="file"][data-uploaded]', { state: 'attached', timeout: 3000 }).catch(() => {});
    fields.perfLogger.end('resumeUpload');

    // Lever has specific resume input patterns
    try {
      const resumeInput = await page.locator('input[name="resume"]').first();
      if (await resumeInput.isVisible()) {
        await resumeInput.setInputFiles(profile.resumePath);
      }
    } catch {
      // Already uploaded
    }

    // Upload cover letter if provided
    if (profile.coverLetterPath) {
      fields.perfLogger.start('coverLetterUpload');
      console.log('[lever] Uploading cover letter...');
      await resume.uploadCoverLetter(page, profile.coverLetterPath);
      // Wait for upload confirmation instead of fixed timeout
      await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"]', { state: 'attached', timeout: 3000 }).catch(() => {});
      fields.perfLogger.end('coverLetterUpload');
    }

    // OPTIMIZATION: Fill URL fields in parallel
    console.log('[lever] Filling links (parallel)...');
    fields.perfLogger.start('urlFields');
    const urlFields = [
      { label: 'LinkedIn URL', value: profile.linkedin },
      { label: 'GitHub URL', value: profile.github },
      { label: 'Portfolio', value: profile.website },
      { label: 'Other website', value: profile.website },
    ].filter(f => f.value);

    if (urlFields.length > 0) {
      await fields.fillFieldsParallel(page, urlFields, { batchSize: 4 });
    }
    fields.perfLogger.end('urlFields');

    // Handle additional questions
    console.log('[lever] Handling additional questions...');
    await handleAdditionalQuestions(page, profile, answerManager, companyName);

    // Handle EEO questions if they exist
    console.log('[lever] Handling EEO questions...');
    await eeo.fillEEOQuestions(page, profile, 'lever');

    // PERFORMANCE: Log final timing summary
    const totalDuration = fields.perfLogger.end('totalFill');
    const perfSummary = fields.perfLogger.getSummary();
    console.log('\n' + '='.repeat(50));
    console.log('LEVER FILL PERFORMANCE');
    console.log('='.repeat(50));
    console.log(`Total Fill Time:     ${totalDuration}ms`);
    console.log(`Parallel Batches:    ${perfSummary.parallelBatches}`);
    console.log(`Basic Fields:        ${basicResult.success}/${basicResult.success + basicResult.failed} succeeded`);
    console.log('='.repeat(50) + '\n');

    if (dryRun) {
      console.log('[lever] Dry run - pausing for review');
      await browser.screenshot(page, 'lever-filled');
      await browser.waitForUserInput('Review the form and press Enter to close (form will NOT be submitted)');
    } else {
      console.log('[lever] Submitting application...');
      // REQUIRED: Brief delay before submit to ensure form state is stable
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

      // Lever submit button
      const submitButton = await page.locator('button[type="submit"], button.postings-btn:has-text("Submit"), button:has-text("Submit application")').first();
      await submitButton.click();

      // Wait for confirmation page/element instead of fixed timeout
      await Promise.race([
        page.waitForURL(/thank|confirm|success|submitted/i, { timeout: 5000 }),
        page.waitForSelector('[class*="success"], [class*="confirm"], h1:has-text("Thank"), h2:has-text("Thank")', { state: 'visible', timeout: 5000 }),
      ]).catch(() => {});
      console.log('[lever] Application submitted!');
      await browser.screenshot(page, 'lever-submitted');
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

    console.error(`[lever] Error: ${userMessage}`);
    console.error(`[lever] Details: ${error.message}`);

    if (page) {
      await browser.screenshot(page, 'lever-error');
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
 * Extract company name from Lever URL
 */
function extractCompanyName(url) {
  try {
    const urlObj = new URL(url);
    // jobs.lever.co/companyname
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      // Capitalize first letter
      const name = pathParts[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle additional Lever questions
 */
async function handleAdditionalQuestions(page, profile, answerManager, companyName) {
  // Handle work authorization (sequential - dropdowns may have UI dependencies)
  if (profile.workAuth) {
    const authQuestions = [
      'Are you legally authorized to work',
      'sponsorship',
      'work authorization',
    ];

    for (const question of authQuestions) {
      try {
        await fields.selectByLabel(page, question, profile.workAuth);
        break; // Stop after first successful match
      } catch {
        continue;
      }
    }
  }

  // Handle referral source
  if (profile.referralSource) {
    await fields.fillByLabel(page, 'How did you hear about this job', profile.referralSource);
  }

  // OPTIMIZATION: Fill custom answers from profile in parallel
  if (profile.customAnswers) {
    fields.perfLogger.start('customAnswers');
    const customTextFields = Object.entries(profile.customAnswers).map(([q, a]) => ({
      label: q, value: a
    }));

    // Fill text fields in parallel
    if (customTextFields.length > 0) {
      const result = await fields.fillFieldsParallel(page, customTextFields, { batchSize: 4 });
      console.log(`[lever] Custom answers: ${result.success}/${customTextFields.length} filled in parallel`);

      // For fields that failed as text, try as dropdowns sequentially
      // (can't parallelize dropdown interactions due to overlay behavior)
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

  // Find and answer textareas using AnswerManager
  await answerTextareas(page, answerManager, companyName);

  // Find and answer remaining text inputs using AnswerManager
  await answerTextInputs(page, profile, answerManager);
}

/**
 * Answer textareas using AnswerManager (for long-form questions)
 */
async function answerTextareas(page, answerManager, companyName) {
  try {
    const textareas = await page.locator('textarea:visible').all();

    for (const textarea of textareas) {
      try {
        // Check if already filled
        const value = await textarea.inputValue();
        if (value && value.trim()) continue;

        // Get the label for this textarea
        const id = await textarea.getAttribute('id');
        const placeholder = await textarea.getAttribute('placeholder');

        let labelText = null;

        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          if (await label.count() > 0) {
            labelText = await label.textContent();
          }
        }

        if (!labelText) {
          labelText = placeholder;
        }

        if (!labelText) continue;

        // Check for "Why Company?" pattern
        const whyCompanyMatch = labelText.match(/why\s+(?:do\s+you\s+want\s+to\s+)?(?:work\s+(?:at|for)|join)\s+(?:us|(\w+))/i);
        if (whyCompanyMatch || labelText.toLowerCase().includes('why interested') || labelText.toLowerCase().includes('why this company')) {
          const targetCompany = whyCompanyMatch?.[1] || companyName || 'this company';
          const { answer, source } = answerManager.answerWhyCompany(targetCompany);
          if (answer) {
            await textarea.fill(answer);
            console.log(`[lever] Answered Why ${targetCompany}? (${source})`);
            // No delay needed - textarea.fill is synchronous
            continue;
          }
        }

        // Try general question answering
        const { answer, source } = answerManager.answerQuestion(labelText);
        if (answer) {
          await textarea.fill(answer);
          console.log(`[lever] Filled long-form (${source}): "${labelText.substring(0, 40)}..."`);
          // No delay needed - textarea.fill is synchronous
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[lever] Error scanning textareas: ${error.message}`);
  }
}

/**
 * Answer remaining text inputs using AnswerManager
 */
async function answerTextInputs(page, profile, answerManager) {
  try {
    const labels = await page.locator('label:visible').all();

    for (const label of labels) {
      try {
        const labelText = await label.textContent();
        if (!labelText || labelText.length < 5) continue;

        // Skip if already answered via customAnswers
        if (profile.customAnswers && profile.customAnswers[labelText.trim()]) continue;

        // Check if the associated input is empty
        const forAttr = await label.getAttribute('for');
        if (!forAttr) continue;

        const input = page.locator(`#${forAttr}`);
        if (await input.count() === 0) continue;

        const tagName = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => null);
        if (tagName === 'textarea') continue; // Already handled

        const inputValue = await input.inputValue().catch(() => null);
        if (inputValue && inputValue.trim()) continue; // Already filled

        // Try to get an answer from AnswerManager
        const { answer, source } = answerManager.answerQuestion(labelText.trim());
        if (answer) {
          const filled = await fields.fillByLabel(page, labelText.trim(), answer);
          if (filled) {
            console.log(`[lever] Answered (${source}): "${labelText.substring(0, 40)}..."`);
          }
          // No delay needed - fillByLabel handles its own timing
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[lever] Error scanning text inputs: ${error.message}`);
  }
}

export default { fillApplication };
