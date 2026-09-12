/**
 * Resume upload utilities
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Upload a file to a file input
 * @param {Page} page - Playwright page
 * @param {string} selector - CSS selector for file input
 * @param {string} filePath - Path to file to upload
 */
export async function uploadFile(page, selector, filePath) {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    console.log(`[resume] File not found: ${absolutePath}`);
    return false;
  }

  try {
    const fileInput = await page.locator(selector).first();
    await fileInput.setInputFiles(absolutePath);
    console.log(`[resume] Uploaded file: ${absolutePath}`);
    return true;
  } catch (error) {
    console.log(`[resume] Could not upload file: ${error.message}`);
    return false;
  }
}

/**
 * Upload resume using various strategies
 * @param {Page} page - Playwright page
 * @param {string} resumePath - Path to resume file
 */
export async function uploadResume(page, resumePath) {
  if (!resumePath) {
    console.log('[resume] No resume path provided');
    return false;
  }

  const absolutePath = resolve(resumePath);

  if (!existsSync(absolutePath)) {
    console.log(`[resume] Resume file not found: ${absolutePath}`);
    return false;
  }

  console.log(`[resume] Uploading resume: ${absolutePath}`);

  // Try various selectors for resume upload
  const selectors = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][id*="cv" i]',
    'input[type="file"][accept*="pdf"]',
    'input[type="file"]',
  ];

  for (const selector of selectors) {
    try {
      const inputs = await page.locator(selector).all();

      for (const input of inputs) {
        try {
          // Check if this input accepts resume-type files
          const accept = await input.getAttribute('accept');
          const name = await input.getAttribute('name');
          const id = await input.getAttribute('id');

          // Skip if it looks like a cover letter input
          if (name?.toLowerCase().includes('cover') || id?.toLowerCase().includes('cover')) {
            continue;
          }

          await input.setInputFiles(absolutePath);
          console.log(`[resume] Successfully uploaded resume via ${selector}`);
          return true;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  // Try clicking an upload button and handling file chooser
  try {
    const uploadButton = await page.locator('button:has-text("Upload"), button:has-text("Attach"), [data-testid*="upload"]').first();

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      uploadButton.click(),
    ]);

    await fileChooser.setFiles(absolutePath);
    console.log('[resume] Successfully uploaded resume via file chooser');
    return true;
  } catch {
    // File chooser strategy didn't work
  }

  console.log('[resume] Could not find resume upload field');
  return false;
}

/**
 * Upload cover letter
 * @param {Page} page - Playwright page
 * @param {string} coverLetterPath - Path to cover letter file
 */
export async function uploadCoverLetter(page, coverLetterPath) {
  if (!coverLetterPath) {
    console.log('[resume] No cover letter path provided');
    return false;
  }

  const absolutePath = resolve(coverLetterPath);

  if (!existsSync(absolutePath)) {
    console.log(`[resume] Cover letter file not found: ${absolutePath}`);
    return false;
  }

  console.log(`[resume] Uploading cover letter: ${absolutePath}`);

  // Try selectors specific to cover letter
  const selectors = [
    'input[type="file"][name*="cover" i]',
    'input[type="file"][id*="cover" i]',
    'input[type="file"][name*="letter" i]',
  ];

  for (const selector of selectors) {
    try {
      const input = await page.locator(selector).first();
      await input.setInputFiles(absolutePath);
      console.log(`[resume] Successfully uploaded cover letter via ${selector}`);
      return true;
    } catch {
      continue;
    }
  }

  console.log('[resume] Could not find cover letter upload field');
  return false;
}

export default {
  uploadFile,
  uploadResume,
  uploadCoverLetter,
};
