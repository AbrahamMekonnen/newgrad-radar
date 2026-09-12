/**
 * Performance Logger for Auto-Apply
 *
 * Tracks timing metrics for form filling operations to measure optimization impact.
 * Provides detailed breakdowns and aggregated statistics.
 */

export interface TimingEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceStats {
  totalDuration: number;
  fieldFillTime: number;
  navigationTime: number;
  uploadTime: number;
  avgFieldTime: number;
  fieldCount: number;
  parallelOps: number;
  sequentialOps: number;
  savedTime: number; // Time saved vs sequential approach
}

class PerformanceLogger {
  private entries: Map<string, TimingEntry> = new Map();
  private fieldTimings: number[] = [];
  private parallelBatches: number = 0;
  private sequentialOps: number = 0;
  private sessionStart: number = 0;
  private enabled: boolean = true;

  /**
   * Start a new performance tracking session
   */
  startSession(sessionName: string = 'auto-apply'): void {
    this.entries.clear();
    this.fieldTimings = [];
    this.parallelBatches = 0;
    this.sequentialOps = 0;
    this.sessionStart = performance.now();

    this.log(`[PERF] Session started: ${sessionName}`);
  }

  /**
   * Start timing an operation
   */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    this.entries.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * End timing an operation
   */
  end(name: string): number {
    if (!this.enabled) return 0;

    const entry = this.entries.get(name);
    if (!entry) {
      console.warn(`[PERF] No start entry found for: ${name}`);
      return 0;
    }

    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;

    // Track field timings separately for averaging
    if (name.startsWith('field:')) {
      this.fieldTimings.push(entry.duration);
      this.sequentialOps++;
    }

    this.log(`[PERF] ${name}: ${entry.duration.toFixed(2)}ms`);
    return entry.duration;
  }

  /**
   * Record a parallel batch operation (multiple fields filled at once)
   */
  recordParallelBatch(fieldCount: number, duration: number): void {
    if (!this.enabled) return;

    this.parallelBatches++;
    this.log(`[PERF] Parallel batch (${fieldCount} fields): ${duration.toFixed(2)}ms`);

    // Estimate time saved: sequential would be fieldCount * avgFieldTime
    const estimatedSequential = fieldCount * (this.avgFieldTime() || 150);
    const timeSaved = estimatedSequential - duration;

    if (timeSaved > 0) {
      this.log(`[PERF] Time saved from parallelization: ${timeSaved.toFixed(2)}ms`);
    }
  }

  /**
   * Get average field fill time
   */
  avgFieldTime(): number {
    if (this.fieldTimings.length === 0) return 0;
    return this.fieldTimings.reduce((a, b) => a + b, 0) / this.fieldTimings.length;
  }

  /**
   * End session and return stats
   */
  endSession(): PerformanceStats {
    const totalDuration = performance.now() - this.sessionStart;

    // Calculate category totals
    let fieldFillTime = 0;
    let navigationTime = 0;
    let uploadTime = 0;

    for (const entry of this.entries.values()) {
      if (!entry.duration) continue;

      if (entry.name.startsWith('field:') || entry.name.startsWith('parallel:')) {
        fieldFillTime += entry.duration;
      } else if (entry.name.startsWith('nav:') || entry.name.startsWith('page:')) {
        navigationTime += entry.duration;
      } else if (entry.name.startsWith('upload:')) {
        uploadTime += entry.duration;
      }
    }

    // Estimate time saved from parallel operations
    // Assume each parallel batch of N fields saves (N-1) * avgFieldTime
    const avgTime = this.avgFieldTime() || 150;
    const parallelFieldsEstimate = this.parallelBatches * 4; // Assume avg 4 fields per batch
    const savedTime = this.parallelBatches > 0
      ? (parallelFieldsEstimate - this.parallelBatches) * avgTime
      : 0;

    const stats: PerformanceStats = {
      totalDuration,
      fieldFillTime,
      navigationTime,
      uploadTime,
      avgFieldTime: this.avgFieldTime(),
      fieldCount: this.fieldTimings.length,
      parallelOps: this.parallelBatches,
      sequentialOps: this.sequentialOps,
      savedTime,
    };

    this.logSummary(stats);
    return stats;
  }

  /**
   * Log a summary of performance stats
   */
  private logSummary(stats: PerformanceStats): void {
    console.log('\n' + '='.repeat(50));
    console.log('PERFORMANCE SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Duration:      ${stats.totalDuration.toFixed(2)}ms`);
    console.log(`Field Fill Time:     ${stats.fieldFillTime.toFixed(2)}ms`);
    console.log(`Navigation Time:     ${stats.navigationTime.toFixed(2)}ms`);
    console.log(`Upload Time:         ${stats.uploadTime.toFixed(2)}ms`);
    console.log(`Avg Field Time:      ${stats.avgFieldTime.toFixed(2)}ms`);
    console.log(`Fields Filled:       ${stats.fieldCount}`);
    console.log(`Parallel Batches:    ${stats.parallelOps}`);
    console.log(`Sequential Ops:      ${stats.sequentialOps}`);
    console.log(`Est. Time Saved:     ${stats.savedTime.toFixed(2)}ms`);
    console.log('='.repeat(50) + '\n');
  }

  /**
   * Internal logging (can be toggled)
   */
  private log(message: string): void {
    if (this.enabled) {
      console.log(message);
    }
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get detailed timing breakdown
   */
  getDetailedBreakdown(): TimingEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.duration !== undefined)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0));
  }
}

// Singleton instance
export const perfLogger = new PerformanceLogger();

/**
 * Helper function to time an async operation
 */
export async function withTiming<T>(
  name: string,
  operation: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  perfLogger.start(name, metadata);
  try {
    const result = await operation();
    perfLogger.end(name);
    return result;
  } catch (error) {
    perfLogger.end(name);
    throw error;
  }
}

/**
 * Helper to time a synchronous operation
 */
export function withTimingSync<T>(
  name: string,
  operation: () => T,
  metadata?: Record<string, unknown>
): T {
  perfLogger.start(name, metadata);
  try {
    const result = operation();
    perfLogger.end(name);
    return result;
  } catch (error) {
    perfLogger.end(name);
    throw error;
  }
}

export default perfLogger;
