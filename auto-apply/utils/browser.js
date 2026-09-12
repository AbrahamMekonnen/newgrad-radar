/**
 * Browser utilities for Playwright
 */

import { chromium } from 'playwright';
import config from '../config.js';

/**
 * Launch a new browser instance
 * @param {Object} options - Browser options
 * @returns {Promise<{browser: Browser, context: BrowserContext, page: Page}>}
 */
export async function launchBrowser(options = {}) {
  const browserOptions = {
    headless: options.headless ?? config.browser.headless,
    slowMo: options.slowMo ?? config.browser.slowMo,
  };

  console.log(`[browser] Launching browser (headless: ${browserOptions.headless})`);

  const browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(options.timeout ?? config.browser.timeout);

  return { browser, context, page };
}

/**
 * Connect to an existing browser via CDP
 * @param {string} cdpUrl - Chrome DevTools Protocol URL (e.g., http://localhost:9222)
 * @returns {Promise<{browser: Browser, context: BrowserContext, page: Page}>}
 */
export async function connectToBrowser(cdpUrl) {
  console.log(`[browser] Connecting to existing browser at ${cdpUrl}`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();

  let context;
  let page;

  if (contexts.length > 0) {
    context = contexts[0];
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
  } else {
    context = await browser.newContext();
    page = await context.newPage();
  }

  page.setDefaultTimeout(config.browser.timeout);

  return { browser, context, page };
}

/**
 * Navigate to URL and wait for page to be ready
 * @param {Page} page - Playwright page
 * @param {string} url - URL to navigate to
 */
export async function navigateTo(page, url) {
  console.log(`[browser] Navigating to ${url}`);

  await page.goto(url, { waitUntil: 'networkidle' });
  // Wait for DOM to be ready instead of fixed timeout
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
}

/**
 * Take a screenshot for debugging
 * @param {Page} page - Playwright page
 * @param {string} name - Screenshot name
 */
export async function screenshot(page, name) {
  const filename = `screenshot-${name}-${Date.now()}.png`;
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`[browser] Screenshot saved: ${filename}`);
}

/**
 * Close browser gracefully
 * @param {Browser} browser - Playwright browser
 */
export async function closeBrowser(browser) {
  if (browser) {
    console.log('[browser] Closing browser');
    await browser.close();
  }
}

/**
 * Wait for user to press Enter (for manual review)
 * @param {string} message - Message to display
 */
export async function waitForUserInput(message = 'Press Enter to continue...') {
  console.log(`\n[browser] ${message}`);
  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

export default {
  launchBrowser,
  connectToBrowser,
  navigateTo,
  screenshot,
  closeBrowser,
  waitForUserInput,
};
