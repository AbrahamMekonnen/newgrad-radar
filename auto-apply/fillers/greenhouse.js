/**
 * Greenhouse ATS form filler
 * Handles job applications on boards.greenhouse.io
 */

import browser from '../utils/browser.js';
import fields from '../utils/fields.js';
import resume from '../utils/resume.js';
import eeo from '../utils/eeo.js';
import config from '../config.js';
import { AnswerManager, AnswerSource } from '../answers/index.js';

// Import reliability utilities
import {
  retry,
  retryWithResult,
  retryBrowserOperation,
  getErrorReporter,
  classifyError,
  ErrorType,
  recordServiceFailure,
  recordServiceSuccess,
  getFeatureFlags,
  DegradationLevel,
} from '../utils/reliability.js';

/**
 * Fill a Greenhouse job application
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
  const ATS_TYPE = 'greenhouse';

  console.log('[greenhouse] Starting Greenhouse application');
  console.log(`[greenhouse] URL: ${url}`);
  console.log(`[greenhouse] Dry run: ${dryRun}`);

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
  console.log(`[greenhouse] Company: ${companyName || 'Unknown'}`);

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

    // Check if we're on an application page
    const title = await page.title();
    console.log(`[greenhouse] Page title: ${title}`);

    // PERFORMANCE: Start timing
    const fillStartTime = Date.now();
    fields.perfLogger.start('totalFill');

    // Fill basic info section using PARALLEL field filling
    console.log('[greenhouse] Filling basic information (parallel)...');

    // OPTIMIZATION: Fill basic fields in parallel batches
    fields.perfLogger.start('basicInfo');
    const basicFields = [
      { label: 'First name', value: profile.firstName },
      { label: 'Last name', value: profile.lastName },
      { label: 'Email', value: profile.email },
      { label: 'Phone', value: profile.phone },
    ];
    const basicResult = await fields.fillFieldsParallel(page, basicFields, { batchSize: 4 });
    fields.perfLogger.end('basicInfo');

    // Upload resume (must be sequential - file operations)
    fields.perfLogger.start('resumeUpload');
    console.log('[greenhouse] Uploading resume...');
    await resume.uploadResume(page, profile.resumePath);
    // Wait for upload confirmation instead of fixed timeout
    await page.waitForSelector('input[type="file"][data-uploaded], .upload-success, [class*="uploaded"], [class*="attached"]', { state: 'attached', timeout: 3000 }).catch(() => {});
    fields.perfLogger.end('resumeUpload');

    // Upload cover letter if provided
    if (profile.coverLetterPath) {
      fields.perfLogger.start('coverLetterUpload');
      console.log('[greenhouse] Uploading cover letter...');
      await resume.uploadCoverLetter(page, profile.coverLetterPath);
      // Wait for upload confirmation instead of fixed timeout
      await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"]', { state: 'attached', timeout: 3000 }).catch(() => {});
      fields.perfLogger.end('coverLetterUpload');
    }

    // OPTIMIZATION: Fill URL fields in parallel
    fields.perfLogger.start('urlFields');
    const urlFields = [
      { label: 'LinkedIn', value: profile.linkedin },
      { label: 'Website', value: profile.website },
      { label: 'GitHub', value: profile.github },
    ].filter(f => f.value);

    if (urlFields.length > 0) {
      await fields.fillFieldsParallel(page, urlFields, { batchSize: 3 });
    }
    fields.perfLogger.end('urlFields');

    // Handle custom questions (short answers)
    console.log('[greenhouse] Handling custom questions...');
    await handleCustomQuestions(page, profile, answerManager);

    // Handle long-form questions (Why [Company]?, etc.)
    console.log('[greenhouse] Handling long-form questions...');
    await handleLongFormQuestions(page, profile, answerManager, companyName);

    // Handle common dropdown questions
    console.log('[greenhouse] Handling dropdown questions...');
    await handleCommonDropdowns(page, profile);

    // Handle work authorization dropdown
    await handleWorkAuthorization(page, profile);

    // Handle EEO questions if they exist (using shared utility)
    console.log('[greenhouse] Handling EEO questions...');
    await eeo.fillEEOQuestions(page, profile, 'greenhouse');

    // PERFORMANCE: Log final timing summary
    const totalDuration = fields.perfLogger.end('totalFill');
    const perfSummary = fields.perfLogger.getSummary();
    console.log('\n' + '='.repeat(50));
    console.log('GREENHOUSE FILL PERFORMANCE');
    console.log('='.repeat(50));
    console.log(`Total Fill Time:     ${totalDuration}ms`);
    console.log(`Parallel Batches:    ${perfSummary.parallelBatches}`);
    console.log(`Basic Fields:        ${basicResult.success}/${basicResult.success + basicResult.failed} succeeded`);
    console.log('='.repeat(50) + '\n');

    if (dryRun) {
      console.log('[greenhouse] Dry run - pausing for review');
      await browser.screenshot(page, 'greenhouse-filled');
      await browser.waitForUserInput('Review the form and press Enter to close (form will NOT be submitted)');
    } else {
      console.log('[greenhouse] Submitting application...');
      // REQUIRED: Brief delay before submit to ensure form state is stable.
      // ATS forms often have async validation that needs to complete.
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

      // Find and click submit button
      const submitButton = await page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")').first();
      await submitButton.click();

      // Wait for confirmation page/element instead of fixed timeout
      await Promise.race([
        page.waitForURL(/thank|confirm|success|submitted/i, { timeout: 5000 }),
        page.waitForSelector('[class*="success"], [class*="confirm"], h1:has-text("Thank"), h2:has-text("Thank")', { state: 'visible', timeout: 5000 }),
      ]).catch(() => {});
      console.log('[greenhouse] Application submitted!');
      await browser.screenshot(page, 'greenhouse-submitted');
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
    const userMessage = getUserFriendlyError(classified);

    console.error(`[greenhouse] Error: ${userMessage}`);
    console.error(`[greenhouse] Details: ${error.message}`);

    if (page) {
      await browser.screenshot(page, 'greenhouse-error');
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
function getUserFriendlyError(classified) {
  switch (classified.type) {
    case ErrorType.RATE_LIMITED:
      return 'Greenhouse is rate limiting requests. Please wait a few minutes before trying again.';

    case ErrorType.TRANSIENT:
      if (classified.message.includes('timeout')) {
        return 'The Greenhouse page took too long to respond. Please try again.';
      }
      if (classified.message.includes('ECONNREFUSED') || classified.message.includes('ENOTFOUND')) {
        return 'Could not connect to Greenhouse. Please check your internet connection.';
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
      return 'Greenhouse applications are temporarily unavailable. Please try again later.';

    default:
      return classified.message;
  }
}

/**
 * Extract company name from Greenhouse URL
 */
function extractCompanyName(url) {
  try {
    const urlObj = new URL(url);
    // boards.greenhouse.io/companyname or job-boards.greenhouse.io/companyname
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
 * Handle custom application questions
 */
async function handleCustomQuestions(page, profile, answerManager) {
  // OPTIMIZATION: Fill custom answers from profile in parallel
  if (profile.customAnswers) {
    fields.perfLogger.start('customAnswers');
    const customTextFields = Object.entries(profile.customAnswers).map(([q, a]) => ({
      label: q, value: a
    }));

    // Fill text fields in parallel
    if (customTextFields.length > 0) {
      const result = await fields.fillFieldsParallel(page, customTextFields, { batchSize: 4 });
      console.log(`[greenhouse] Custom answers: ${result.success}/${customTextFields.length} filled in parallel`);

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

  // Find any unfilled text fields/textareas and try to answer with AnswerManager
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

        const inputValue = await input.inputValue().catch(() => null);
        if (inputValue && inputValue.trim()) continue; // Already filled

        // Try to get an answer from AnswerManager
        const { answer, source } = answerManager.answerQuestion(labelText.trim());
        if (answer) {
          const filled = await fields.fillByLabel(page, labelText.trim(), answer);
          if (filled) {
            console.log(`[greenhouse] Answered (${source}): "${labelText.substring(0, 40)}..."`);
          }
          // No delay needed - fillByLabel handles its own timing
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[greenhouse] Error scanning for unanswered questions: ${error.message}`);
  }
}

/**
 * Handle long-form text questions (Why [Company]?, Tell us about yourself, etc.)
 */
async function handleLongFormQuestions(page, profile, answerManager, companyName) {
  // First, fill any explicitly provided longAnswers
  if (profile.longAnswers) {
    for (const [questionKey, answer] of Object.entries(profile.longAnswers)) {
      try {
        // Find textarea that matches this question pattern
        const filled = await fields.fillByLabel(page, questionKey, answer);

        if (filled) {
          console.log(`[greenhouse] Filled long-form question (profile): "${questionKey}"`);
        }
        // No delay needed - fillByLabel handles its own timing
      } catch (error) {
        console.log(`[greenhouse] Could not answer long question "${questionKey}": ${error.message}`);
      }
    }
  }

  // Find textareas that might need long-form answers
  try {
    const textareas = await page.locator('textarea:visible').all();

    for (const textarea of textareas) {
      try {
        // Check if already filled
        const value = await textarea.inputValue();
        if (value && value.trim()) continue;

        // Get the label for this textarea
        const id = await textarea.getAttribute('id');
        const name = await textarea.getAttribute('name');
        const placeholder = await textarea.getAttribute('placeholder');

        let labelText = null;

        // Try to find associated label
        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          if (await label.count() > 0) {
            labelText = await label.textContent();
          }
        }

        // Fall back to placeholder or name
        if (!labelText) {
          labelText = placeholder || name;
        }

        if (!labelText) continue;

        // Check for "Why Company?" pattern
        const whyCompanyMatch = labelText.match(/why\s+(?:do\s+you\s+want\s+to\s+)?(?:work\s+(?:at|for)|join)\s+(?:us|(\w+))/i);
        if (whyCompanyMatch || labelText.toLowerCase().includes('why interested') || labelText.toLowerCase().includes('why this company')) {
          const targetCompany = whyCompanyMatch?.[1] || companyName || 'this company';
          const { answer, source } = answerManager.answerWhyCompany(targetCompany);
          if (answer) {
            await textarea.fill(answer);
            console.log(`[greenhouse] Answered Why ${targetCompany}? (${source})`);
            // No delay needed - textarea.fill is synchronous
            continue;
          }
        }

        // Try general question answering
        const { answer, source } = answerManager.answerQuestion(labelText);
        if (answer) {
          await textarea.fill(answer);
          console.log(`[greenhouse] Filled long-form (${source}): "${labelText.substring(0, 40)}..."`);
          // No delay needed - textarea.fill is synchronous
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[greenhouse] Error scanning for long-form questions: ${error.message}`);
  }
}

/**
 * Handle common dropdown questions (in-person, relocation, visa, arbitration, etc.)
 */
async function handleCommonDropdowns(page, profile) {
  const dropdownMappings = [
    { patterns: ['open to working in-person', 'work in-person', 'in one of our offices'], value: profile.willingToWorkInPerson ? 'Yes' : 'No' },
    { patterns: ['open to relocation', 'willing to relocate'], value: profile.willingToRelocate ? 'Yes' : 'No' },
    { patterns: ['require visa sponsorship', 'visa sponsorship'], value: profile.workAuthRequired ? 'Yes' : 'No' },
    { patterns: ['AI Policy', 'AI partnership'], value: 'Yes' },
    { patterns: ['Agreement to Arbitrate', 'arbitration agreement'], value: 'Yes' },
    { patterns: ['interviewed at', 'interviewed before', 'Have you ever interviewed'], value: profile.previouslyInterviewed ? 'Yes' : 'No' },
  ];

  // Find all visible dropdowns/selects on the page
  const labels = await page.locator('label:visible').all();

  for (const label of labels) {
    try {
      const labelText = await label.textContent();
      if (!labelText) continue;

      // Check if this label matches any of our patterns
      for (const mapping of dropdownMappings) {
        const matches = mapping.patterns.some(pattern =>
          labelText.toLowerCase().includes(pattern.toLowerCase())
        );

        if (matches && mapping.value) {
          const success = await fields.selectByLabel(page, labelText.trim(), mapping.value);
          if (success) {
            console.log(`[greenhouse] Selected dropdown: "${labelText.substring(0, 50)}..." = "${mapping.value}"`);
          }
          // No delay needed - selectByLabel waits for dropdown options internally
          break;
        }
      }
    } catch {
      continue;
    }
  }
}

/**
 * Handle work authorization questions
 */
async function handleWorkAuthorization(page, profile) {
  if (!profile.workAuth) return;

  const authQuestions = [
    'authorized to work',
    'require sponsorship',
    'legally authorized',
    'work authorization',
  ];

  for (const question of authQuestions) {
    try {
      // Try dropdown first
      let filled = await fields.selectByLabel(page, question, profile.workAuth);

      if (!filled) {
        // Try radio button
        await fields.selectRadio(page, profile.workAuth);
      }
      // No delay needed - select/radio operations are synchronous
    } catch {
      continue;
    }
  }
}

export default { fillApplication };
