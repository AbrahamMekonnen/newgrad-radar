#!/usr/bin/env node

/**
 * Batch Auto-Apply
 *
 * Optimized for applying to 50+ jobs efficiently.
 * Features:
 * - Browser connection reuse (avoids startup overhead)
 * - Parallel field filling
 * - Request batching
 * - Progress tracking
 * - Performance metrics
 *
 * Usage:
 *   node batch-apply.js --jobs jobs.json --profile profile.json
 *   node batch-apply.js --jobs jobs.json --profile profile.json --concurrency 2
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { program } from 'commander';
import { chromium } from 'playwright';
import { detectATS } from './config.js';

// Import fillers
import greenhouse from './fillers/greenhouse.js';
import lever from './fillers/lever.js';
import ashby from './fillers/ashby.js';
import jobvite from './fillers/jobvite.js';

// Import reliability utilities
import {
  initErrorReporter,
  flushLogs,
  classifyError,
  ErrorType,
  getAllBreakerStatus,
  hasOpenCircuits,
  getOpenCircuits,
  getDegradationState,
  getFeatureFlags,
  formatDegradationState,
} from './utils/reliability.js';

const fillers = { greenhouse, lever, ashby, jobvite };

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

class BatchPerformanceTracker {
  constructor() {
    this.startTime = Date.now();
    this.jobs = [];
    this.totalJobs = 0;
    this.completed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.browserStartupTime = 0;
    this.totalFillTime = 0;
    this.connectionReuses = 0;

    // Error type tracking
    this.errorsByType = {
      TRANSIENT: 0,
      PERMANENT: 0,
      RATE_LIMITED: 0,
      CIRCUIT_OPEN: 0,
      UNKNOWN: 0,
    };
    this.retryableErrors = 0;
  }

  recordBrowserStartup(duration) {
    this.browserStartupTime = duration;
    console.log(`[PERF] Browser startup: ${duration}ms`);
  }

  recordConnectionReuse() {
    this.connectionReuses++;
  }

  recordJobComplete(job) {
    this.completed++;
    this.jobs.push(job);

    if (job.success) {
      this.succeeded++;
    } else {
      this.failed++;

      // Track error types
      const errorType = job.errorType || 'UNKNOWN';
      this.errorsByType[errorType] = (this.errorsByType[errorType] || 0) + 1;

      if (job.shouldRetry) {
        this.retryableErrors++;
      }
    }

    if (job.fillDuration) {
      this.totalFillTime += job.fillDuration;
    }

    // Progress update with error type info
    const progress = Math.round((this.completed / this.totalJobs) * 100);
    let progressMsg = `\n[PROGRESS] ${this.completed}/${this.totalJobs} (${progress}%) - ${this.succeeded} succeeded, ${this.failed} failed`;

    if (!job.success && job.errorType) {
      progressMsg += ` [${job.errorType}${job.shouldRetry ? ' - retryable' : ''}]`;
    }

    console.log(progressMsg);
  }

  getSummary() {
    const totalDuration = Date.now() - this.startTime;
    const avgFillTime = this.completed > 0 ? this.totalFillTime / this.completed : 0;

    // Estimate time saved from connection reuse
    // Each browser startup takes ~2-3 seconds
    const estimatedStartupSavings = this.connectionReuses * 2500;

    // Estimate time saved from parallel field filling
    // Assume each job has ~10 fields, parallel saves ~50% of sequential time
    const estimatedParallelSavings = this.succeeded * 10 * 100 * 0.5;

    const totalSavings = estimatedStartupSavings + estimatedParallelSavings;

    // Get circuit breaker and degradation status
    const circuitStatus = getAllBreakerStatus();
    const degradationState = getDegradationState();

    return {
      totalDuration,
      totalJobs: this.totalJobs,
      completed: this.completed,
      succeeded: this.succeeded,
      failed: this.failed,
      browserStartupTime: this.browserStartupTime,
      avgFillTime,
      connectionReuses: this.connectionReuses,
      estimatedTimeSaved: totalSavings,
      jobsPerMinute: (this.completed / (totalDuration / 60000)).toFixed(2),
      // Error breakdown
      errorsByType: this.errorsByType,
      retryableErrors: this.retryableErrors,
      // System health
      circuitStatus,
      degradationState,
      openCircuits: getOpenCircuits(),
    };
  }

  printSummary() {
    const summary = this.getSummary();

    console.log('\n' + '='.repeat(60));
    console.log('BATCH APPLICATION PERFORMANCE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Duration:          ${(summary.totalDuration / 1000).toFixed(1)}s`);
    console.log(`Jobs Processed:          ${summary.completed}/${summary.totalJobs}`);
    console.log(`Successful:              ${summary.succeeded}`);
    console.log(`Failed:                  ${summary.failed}`);
    console.log(`Success Rate:            ${((summary.succeeded / summary.completed) * 100).toFixed(1)}%`);
    console.log(`Avg Fill Time:           ${summary.avgFillTime.toFixed(0)}ms per job`);
    console.log(`Jobs per Minute:         ${summary.jobsPerMinute}`);
    console.log(`Browser Startup:         ${summary.browserStartupTime}ms (one-time)`);
    console.log(`Connection Reuses:       ${summary.connectionReuses}`);
    console.log(`Est. Time Saved:         ${(summary.estimatedTimeSaved / 1000).toFixed(1)}s`);
    console.log('='.repeat(60));

    // Error breakdown (if any failures)
    if (summary.failed > 0) {
      console.log('\nError Breakdown:');
      for (const [type, count] of Object.entries(summary.errorsByType)) {
        if (count > 0) {
          console.log(`  ${type}: ${count}`);
        }
      }
      if (summary.retryableErrors > 0) {
        console.log(`  Retryable: ${summary.retryableErrors} (can be re-run)`);
      }
    }

    // System health status
    console.log('\nSystem Health:');
    console.log(`  Degradation: ${formatDegradationState(summary.degradationState)}`);
    if (summary.openCircuits.length > 0) {
      console.log(`  Open Circuits: ${summary.openCircuits.join(', ')}`);
    } else {
      console.log(`  All circuits: CLOSED (healthy)`);
    }

    // If we had done this sequentially without optimization
    const sequentialEstimate = summary.completed * (summary.browserStartupTime + summary.avgFillTime + 2000);
    const speedup = sequentialEstimate / summary.totalDuration;
    console.log(`\nOptimization Impact:`);
    console.log(`  Sequential estimate:   ${(sequentialEstimate / 1000).toFixed(1)}s`);
    console.log(`  Actual time:           ${(summary.totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Speedup:               ${speedup.toFixed(2)}x faster`);
    console.log('='.repeat(60) + '\n');
  }

  saveReport(outputPath) {
    const summary = this.getSummary();
    const report = {
      summary,
      jobs: this.jobs,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Report saved to: ${outputPath}`);
  }
}

// ============================================================================
// BATCH PROCESSOR
// ============================================================================

class BatchProcessor {
  constructor(options) {
    this.profile = options.profile;
    this.jobs = options.jobs;
    this.dryRun = options.dryRun;
    this.headless = options.headless;
    this.concurrency = options.concurrency;

    this.browser = null;
    this.contexts = [];
    this.tracker = new BatchPerformanceTracker();
    this.tracker.totalJobs = this.jobs.length;
  }

  async initialize() {
    console.log('[batch] Initializing browser...');
    const startTime = Date.now();

    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: 50, // Reduced for batch mode
    });

    // Create connection pool
    for (let i = 0; i < this.concurrency; i++) {
      const context = await this.browser.newContext();
      const page = await context.newPage();
      this.contexts.push({ context, page, busy: false, id: i });
    }

    this.tracker.recordBrowserStartup(Date.now() - startTime);
    console.log(`[batch] Browser ready with ${this.concurrency} connections`);
  }

  async acquireConnection() {
    // Find available connection
    for (const conn of this.contexts) {
      if (!conn.busy) {
        conn.busy = true;
        this.tracker.recordConnectionReuse();
        return conn;
      }
    }

    // Wait for available connection
    return new Promise((resolve) => {
      const check = setInterval(() => {
        for (const conn of this.contexts) {
          if (!conn.busy) {
            clearInterval(check);
            conn.busy = true;
            this.tracker.recordConnectionReuse();
            resolve(conn);
            return;
          }
        }
      }, 100);
    });
  }

  releaseConnection(conn) {
    conn.busy = false;
  }

  async processJob(job, conn) {
    const { url, atsType: forcedAts } = job;
    const startTime = Date.now();

    const atsType = forcedAts || detectATS(url);
    const filler = atsType ? fillers[atsType] : null;

    const result = {
      url,
      atsType,
      success: false,
      error: null,
      fillDuration: 0,
    };

    if (!filler) {
      result.error = `Unsupported ATS: ${atsType || 'unknown'}`;
      return result;
    }

    try {
      console.log(`\n[batch] Processing: ${url}`);
      console.log(`[batch] ATS: ${atsType}`);

      // Check if any circuits are open for this ATS
      const openCircuits = getOpenCircuits();
      if (openCircuits.includes(atsType)) {
        result.error = `Circuit breaker OPEN for ${atsType}. Skipping.`;
        result.errorType = 'CIRCUIT_OPEN';
        result.shouldRetry = true;
        result.fillDuration = 0;
        return result;
      }

      // Navigate to page
      await conn.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // Fill application using the filler (which uses parallel filling internally)
      const fillResult = await filler.fillApplication({
        url,
        profile: this.profile,
        dryRun: this.dryRun,
        page: conn.page, // Pass existing page (connection reuse)
        browserInstance: this.browser,
        context: conn.context,
        skipBrowserManagement: true, // Don't open/close browser
      });

      result.success = fillResult.success;
      result.error = fillResult.error;
      result.errorType = fillResult.errorType;
      result.shouldRetry = fillResult.shouldRetry;
      result.fillDuration = fillResult.duration || (Date.now() - startTime);

    } catch (error) {
      // Classify the error
      const classified = classifyError(error);
      result.error = classified.message;
      result.errorType = classified.type;
      result.shouldRetry = classified.shouldRetry;
      result.fillDuration = Date.now() - startTime;
    }

    return result;
  }

  async run() {
    console.log('='.repeat(60));
    console.log('BATCH AUTO-APPLY');
    console.log('='.repeat(60));
    console.log(`Jobs to process: ${this.jobs.length}`);
    console.log(`Concurrency: ${this.concurrency}`);
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('='.repeat(60) + '\n');

    await this.initialize();

    // Process jobs (with concurrency limit)
    const queue = [...this.jobs];

    const processNext = async (conn) => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;

        const result = await this.processJob(job, conn);
        this.tracker.recordJobComplete(result);
      }
    };

    // Start concurrent processors
    const processors = this.contexts.map(conn => processNext(conn));
    await Promise.all(processors);

    // Cleanup
    await this.cleanup();

    // Print summary
    this.tracker.printSummary();

    return this.tracker.getSummary();
  }

  async cleanup() {
    console.log('\n[batch] Cleaning up...');
    for (const conn of this.contexts) {
      await conn.context.close().catch(() => {});
    }
    await this.browser.close().catch(() => {});
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  program
    .name('batch-apply')
    .description('Apply to multiple jobs in batch with optimized performance')
    .version('1.0.0')
    .requiredOption('-j, --jobs <path>', 'Path to jobs JSON file (array of {url, atsType?})')
    .requiredOption('-p, --profile <path>', 'Path to profile JSON file')
    .option('-d, --dry-run', 'Fill forms but do not submit', true)
    .option('--submit', 'Actually submit applications (disables dry-run)')
    .option('-h, --headless', 'Run browser in headless mode', false)
    .option('-c, --concurrency <n>', 'Number of concurrent connections', '1')
    .option('-o, --output <path>', 'Path to save performance report')
    .parse();

  const options = program.opts();

  // Initialize error reporter for batch session
  const sessionId = `batch_${Date.now()}`;
  initErrorReporter({
    sessionId,
    minLevel: 'info',
    batchLogs: true,
  });

  // Load jobs
  const jobsPath = resolve(options.jobs);
  if (!existsSync(jobsPath)) {
    console.error(`Jobs file not found: ${jobsPath}`);
    process.exit(1);
  }
  const jobs = JSON.parse(readFileSync(jobsPath, 'utf-8'));

  // Load profile
  const profilePath = resolve(options.profile);
  if (!existsSync(profilePath)) {
    console.error(`Profile file not found: ${profilePath}`);
    process.exit(1);
  }
  const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

  // Create processor
  const processor = new BatchProcessor({
    profile,
    jobs,
    dryRun: !options.submit,
    headless: options.headless,
    concurrency: parseInt(options.concurrency, 10),
  });

  try {
    const summary = await processor.run();

    if (options.output) {
      processor.tracker.saveReport(resolve(options.output));
    }

    // Flush all pending logs before exiting
    await flushLogs();

    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error:', error);

    // Flush logs even on error
    await flushLogs().catch(() => {});

    process.exit(1);
  }
}

main();
