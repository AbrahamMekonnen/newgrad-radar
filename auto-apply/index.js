#!/usr/bin/env node

/**
 * NewGrad Radar Auto-Apply
 *
 * Main entry point for auto-applying to jobs.
 * Detects ATS from URL and routes to the correct filler.
 *
 * Usage:
 *   node index.js --url "https://boards.greenhouse.io/..." --profile profile.json
 *   node index.js --url "https://jobs.lever.co/..." --profile profile.json --dry-run
 *   node index.js --url "https://..." --profile profile.json --headless
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { program } from 'commander';
import { detectATS } from './config.js';

// Import fillers
import greenhouse from './fillers/greenhouse.js';
import lever from './fillers/lever.js';
import ashby from './fillers/ashby.js';
import jobvite from './fillers/jobvite.js';

// Map ATS names to their filler modules
const fillers = {
  greenhouse,
  lever,
  ashby,
  jobvite,
};

/**
 * Load profile from JSON file
 */
function loadProfile(profilePath) {
  const absolutePath = resolve(profilePath);

  if (!existsSync(absolutePath)) {
    console.error(`Profile file not found: ${absolutePath}`);
    process.exit(1);
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading profile: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main application function
 */
async function main() {
  program
    .name('auto-apply')
    .description('Auto-apply to jobs on various ATS platforms')
    .version('1.0.0')
    .requiredOption('-u, --url <url>', 'Job application URL')
    .requiredOption('-p, --profile <path>', 'Path to profile JSON file')
    .option('-d, --dry-run', 'Fill form but do not submit', true)
    .option('--submit', 'Actually submit the application (disables dry-run)')
    .option('-h, --headless', 'Run browser in headless mode', false)
    .option('-c, --cdp <url>', 'Connect to existing browser via CDP URL')
    .option('-a, --ats <type>', 'Force ATS type (greenhouse, lever, ashby, jobvite)')
    .parse();

  const options = program.opts();

  console.log('='.repeat(60));
  console.log('NewGrad Radar Auto-Apply');
  console.log('='.repeat(60));

  // Load profile
  console.log(`\nLoading profile from: ${options.profile}`);
  const profile = loadProfile(options.profile);
  console.log(`Profile loaded for: ${profile.firstName} ${profile.lastName}`);

  // Detect or use forced ATS type
  let atsType = options.ats;

  if (!atsType) {
    atsType = detectATS(options.url);

    if (!atsType) {
      console.error('\nCould not detect ATS type from URL.');
      console.error('Supported ATS platforms: greenhouse, lever, ashby, jobvite');
      console.error('Use --ats <type> to specify manually.');
      process.exit(1);
    }
  }

  console.log(`\nDetected ATS: ${atsType}`);

  // Get the appropriate filler
  const filler = fillers[atsType];

  if (!filler) {
    console.error(`\nNo filler available for ATS: ${atsType}`);
    console.error('Supported: greenhouse, lever, ashby, jobvite');
    process.exit(1);
  }

  // Determine if this is a dry run
  const dryRun = !options.submit;

  console.log(`\nMode: ${dryRun ? 'DRY RUN (will not submit)' : 'LIVE (will submit!)'}`);
  console.log(`Headless: ${options.headless}`);

  if (options.cdp) {
    console.log(`CDP URL: ${options.cdp}`);
  }

  console.log('\n' + '-'.repeat(60));

  // Run the filler
  const result = await filler.fillApplication({
    url: options.url,
    profile,
    dryRun,
    headless: options.headless,
    cdpUrl: options.cdp,
  });

  console.log('\n' + '='.repeat(60));

  if (result.success) {
    console.log('Application process completed successfully!');
    if (dryRun) {
      console.log('(Dry run - form was not submitted)');
    }
  } else {
    console.error('Application process failed!');
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
