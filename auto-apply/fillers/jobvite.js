/**
 * Jobvite ATS form filler
 * Handles job applications on jobs.jobvite.com
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
  retryBrowserOperation,
  getErrorReporter,
  classifyError,
  ErrorType,
  recordServiceFailure,
  recordServiceSuccess,
  getFeatureFlags,
} from '../utils/reliability.js';

/**
 * Fill a Jobvite job application
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
  const ATS_TYPE = 'jobvite';

  console.log('[jobvite] Starting Jobvite application');
  console.log(`[jobvite] URL: ${url}`);
  console.log(`[jobvite] Dry run: ${dryRun}`);

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
  console.log(`[jobvite] Company: ${companyName || 'Unknown'}`);

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

    // Jobvite typically has an "Apply" button on the job listing
    try {
      const applyButton = await page.locator('a.jv-button-primary, button:has-text("Apply"), .apply-btn').first();
      if (await applyButton.isVisible()) {
        console.log('[jobvite] Clicking Apply button...');
        await applyButton.click();
        // Wait for form to appear instead of fixed timeout
        await page.waitForSelector('form, input[name="firstName"], input[type="email"]', { state: 'visible', timeout: 5000 }).catch(() => {});
      }
    } catch {
      // Already on application form
    }

    const title = await page.title();
    console.log(`[jobvite] Page title: ${title}`);

    // PERFORMANCE: Start timing
    fields.perfLogger.start('totalFill');

    // Fill basic info section using PARALLEL field filling
    console.log('[jobvite] Filling basic information (parallel)...');

    // OPTIMIZATION: Fill basic fields in parallel batches
    fields.perfLogger.start('basicInfo');
    const basicFields = [
      { label: 'First Name', value: profile.firstName },
      { label: 'Last Name', value: profile.lastName },
      { label: 'Email', value: profile.email },
      { label: 'Phone', value: profile.phone },
      { label: 'Location', value: profile.location },
    ].filter(f => f.value);
    const basicResult = await fields.fillFieldsParallel(page, basicFields, { batchSize: 5 });

    // Also try Jobvite-specific field names (parallel)
    await Promise.allSettled([
      fields.fillText(page, 'input[name="firstName"]', profile.firstName),
      fields.fillText(page, 'input[name="lastName"]', profile.lastName),
      fields.fillText(page, 'input[name="email"]', profile.email),
      fields.fillText(page, 'input[name="phone"]', profile.phone),
    ]);
    fields.perfLogger.end('basicInfo');

    // OPTIMIZATION: Fill address fields in parallel (if provided)
    if (profile.address) {
      fields.perfLogger.start('addressFields');
      const addressFields = [
        { label: 'Address', value: profile.address.street },
        { label: 'City', value: profile.address.city },
        { label: 'State', value: profile.address.state },
        { label: 'Zip', value: profile.address.zip },
      ].filter(f => f.value);
      await fields.fillFieldsParallel(page, addressFields, { batchSize: 4 });
      fields.perfLogger.end('addressFields');
    }

    // Upload resume (must be sequential - file operations)
    fields.perfLogger.start('resumeUpload');
    console.log('[jobvite] Uploading resume...');
    await uploadJobviteResume(page, profile.resumePath);
    // Wait for upload confirmation instead of fixed timeout
    await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"], .jv-file-upload-success', { state: 'attached', timeout: 3000 }).catch(() => {});
    fields.perfLogger.end('resumeUpload');

    // Upload cover letter if provided
    if (profile.coverLetterPath) {
      fields.perfLogger.start('coverLetterUpload');
      console.log('[jobvite] Uploading cover letter...');
      await resume.uploadCoverLetter(page, profile.coverLetterPath);
      // Wait for upload confirmation instead of fixed timeout
      await page.waitForSelector('.upload-success, [class*="uploaded"], [class*="attached"]', { state: 'attached', timeout: 3000 }).catch(() => {});
      fields.perfLogger.end('coverLetterUpload');
    }

    // OPTIMIZATION: Fill URL fields in parallel
    console.log('[jobvite] Filling links (parallel)...');
    fields.perfLogger.start('urlFields');
    const urlFields = [
      { label: 'LinkedIn', value: profile.linkedin },
      { label: 'Website', value: profile.website },
    ].filter(f => f.value);

    if (urlFields.length > 0) {
      await fields.fillFieldsParallel(page, urlFields, { batchSize: 2 });
      // Also try Jobvite-specific LinkedIn selector
      if (profile.linkedin) {
        await fields.fillText(page, 'input[name*="linkedin" i]', profile.linkedin);
      }
    }
    fields.perfLogger.end('urlFields')

    // Handle additional questions
    console.log('[jobvite] Handling additional questions...');
    await handleJobviteQuestions(page, profile, answerManager, companyName);

    // PERFORMANCE: Log final timing summary
    const totalDuration = fields.perfLogger.end('totalFill');
    const perfSummary = fields.perfLogger.getSummary();
    console.log('\n' + '='.repeat(50));
    console.log('JOBVITE FILL PERFORMANCE');
    console.log('='.repeat(50));
    console.log(`Total Fill Time:     ${totalDuration}ms`);
    console.log(`Parallel Batches:    ${perfSummary.parallelBatches}`);
    console.log(`Basic Fields:        ${basicResult.success}/${basicResult.success + basicResult.failed} succeeded`);
    console.log('='.repeat(50) + '\n');

    if (dryRun) {
      console.log('[jobvite] Dry run - pausing for review');
      await browser.screenshot(page, 'jobvite-filled');
      await browser.waitForUserInput('Review the form and press Enter to close (form will NOT be submitted)');
    } else {
      console.log('[jobvite] Submitting application...');
      // REQUIRED: Brief delay before submit to ensure form state is stable
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

      // Jobvite submit button patterns
      const submitButton = await page.locator('button[type="submit"], input[type="submit"], button.jv-button-primary:has-text("Submit"), button:has-text("Submit Application")').first();
      await submitButton.click();

      // Wait for confirmation page/element instead of fixed timeout
      await Promise.race([
        page.waitForURL(/thank|confirm|success|submitted/i, { timeout: 5000 }),
        page.waitForSelector('[class*="success"], [class*="confirm"], h1:has-text("Thank"), h2:has-text("Thank")', { state: 'visible', timeout: 5000 }),
      ]).catch(() => {});
      console.log('[jobvite] Application submitted!');
      await browser.screenshot(page, 'jobvite-submitted');
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

    console.error(`[jobvite] Error: ${userMessage}`);
    console.error(`[jobvite] Details: ${error.message}`);

    if (page) {
      await browser.screenshot(page, 'jobvite-error');
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
 * Handle Jobvite's resume upload
 */
async function uploadJobviteResume(page, resumePath) {
  if (!resumePath) return false;

  // Try standard upload first
  const uploaded = await resume.uploadResume(page, resumePath);
  if (uploaded) return true;

  // Jobvite-specific selectors
  try {
    const selectors = [
      'input[name="resume"]',
      'input[id*="resume" i]',
      '.jv-file-upload input[type="file"]',
      'input[type="file"]',
    ];

    for (const selector of selectors) {
      try {
        const input = await page.locator(selector).first();
        if (await input.count() > 0) {
          await input.setInputFiles(resumePath);
          console.log(`[jobvite] Uploaded resume via ${selector}`);
          return true;
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[jobvite] Resume upload failed: ${error.message}`);
  }

  return false;
}

/**
 * Extract company name from Jobvite URL
 */
function extractCompanyName(url) {
  try {
    const urlObj = new URL(url);
    // jobs.jobvite.com/companyname or companyname.jobvite.com
    if (urlObj.hostname.includes('jobvite.com')) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const name = pathParts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
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
 * Handle Jobvite-specific questions
 */
async function handleJobviteQuestions(page, profile, answerManager, companyName) {
  // Work authorization - Jobvite often has these as required (sequential - may trigger UI changes)
  if (profile.workAuth) {
    const authLabels = [
      'legally authorized to work',
      'require sponsorship',
      'work authorization',
      'employment eligibility',
    ];

    for (const label of authLabels) {
      try {
        // Try radio button first (common in Jobvite)
        const yesNo = profile.workAuthRequired ? 'No' : 'Yes';
        await fields.selectRadio(page, yesNo);
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

  // Source/Referral (dropdowns - keep sequential to avoid overlay conflicts)
  if (profile.referralSource) {
    await fields.selectByLabel(page, 'How did you hear about us', profile.referralSource);
    await fields.selectByLabel(page, 'Source', profile.referralSource);
  }

  // OPTIMIZATION: Fill education fields in parallel (text fields only)
  if (profile.education) {
    fields.perfLogger.start('educationFields');
    const educationTextFields = [
      { label: 'School', value: profile.education.school },
      { label: 'Major', value: profile.education.major },
    ].filter(f => f.value);

    if (educationTextFields.length > 0) {
      await fields.fillFieldsParallel(page, educationTextFields, { batchSize: 2 });
    }

    // Degree dropdown handled sequentially
    if (profile.education.degree) {
      await fields.selectByLabel(page, 'Degree', profile.education.degree);
    }
    fields.perfLogger.end('educationFields');
  }

  // Years of experience
  if (profile.yearsExperience) {
    await fields.fillByLabel(page, 'Years of Experience', profile.yearsExperience);
  }

  // EEO questions (often required in Jobvite) - using shared utility
  console.log('[jobvite] Handling EEO questions...');
  await eeo.fillEEOQuestions(page, profile, 'jobvite');

  // OPTIMIZATION: Fill custom answers in parallel where possible
  if (profile.customAnswers) {
    fields.perfLogger.start('customAnswers');
    const customTextFields = Object.entries(profile.customAnswers).map(([q, a]) => ({
      label: q, value: a
    }));

    // Fill text fields in parallel
    if (customTextFields.length > 0) {
      const result = await fields.fillFieldsParallel(page, customTextFields, { batchSize: 4 });
      console.log(`[jobvite] Custom answers: ${result.success}/${customTextFields.length} filled`);

      // For fields that failed as text, try as dropdowns sequentially
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
  await answerJobviteTextareas(page, answerManager, companyName);

  // Answer remaining text inputs using AnswerManager
  await answerJobviteInputs(page, profile, answerManager);
}

/**
 * Answer textareas using AnswerManager
 */
async function answerJobviteTextareas(page, answerManager, companyName) {
  try {
    const textareas = await page.locator('textarea:visible').all();

    for (const textarea of textareas) {
      try {
        const value = await textarea.inputValue();
        if (value && value.trim()) continue;

        const id = await textarea.getAttribute('id');
        const name = await textarea.getAttribute('name');
        const placeholder = await textarea.getAttribute('placeholder');
        let labelText = null;

        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          if (await label.count() > 0) {
            labelText = await label.textContent();
          }
        }

        if (!labelText) labelText = placeholder || name;
        if (!labelText) continue;

        // Check for "Why Company?" pattern
        const whyCompanyMatch = labelText.match(/why\s+(?:do\s+you\s+want\s+to\s+)?(?:work\s+(?:at|for)|join)\s+(?:us|(\w+))/i);
        if (whyCompanyMatch || labelText.toLowerCase().includes('why interested') || labelText.toLowerCase().includes('why this company')) {
          const targetCompany = whyCompanyMatch?.[1] || companyName || 'this company';
          const { answer, source } = answerManager.answerWhyCompany(targetCompany);
          if (answer) {
            await textarea.fill(answer);
            console.log(`[jobvite] Answered Why ${targetCompany}? (${source})`);
            // No delay needed - textarea.fill is synchronous
            continue;
          }
        }

        const { answer, source } = answerManager.answerQuestion(labelText);
        if (answer) {
          await textarea.fill(answer);
          console.log(`[jobvite] Filled long-form (${source}): "${labelText.substring(0, 40)}..."`);
          // No delay needed - textarea.fill is synchronous
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[jobvite] Error scanning textareas: ${error.message}`);
  }
}

/**
 * Answer remaining text inputs using AnswerManager
 */
async function answerJobviteInputs(page, profile, answerManager) {
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
            console.log(`[jobvite] Answered (${source}): "${labelText.substring(0, 40)}..."`);
          }
          // No delay needed - fillByLabel handles its own timing
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.log(`[jobvite] Error scanning inputs: ${error.message}`);
  }
}

export default { fillApplication };
