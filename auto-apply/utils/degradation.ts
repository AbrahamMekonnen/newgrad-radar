/**
 * Graceful Degradation for Auto-Apply
 *
 * Manages service degradation levels and provides feature flags
 * based on system health. When external services fail, the system
 * gracefully degrades to provide partial functionality.
 */

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * Degradation levels from full functionality to offline.
 */
export enum DegradationLevel {
  /** All features available - normal operation */
  FULL = 'FULL',

  /** Some features disabled due to partial service issues */
  PARTIAL = 'PARTIAL',

  /** Serving stale/cached data - live updates unavailable */
  CACHED = 'CACHED',

  /** Core features only - non-essential features disabled */
  MINIMAL = 'MINIMAL',

  /** Service completely unavailable */
  OFFLINE = 'OFFLINE'
}

export interface DegradationState {
  /** Current degradation level */
  level: DegradationLevel;

  /** Human-readable reason for degradation */
  reason: string;

  /** List of affected services/components */
  affectedServices: string[];

  /** When degradation started */
  since: Date;

  /** Estimated recovery time (if known) */
  estimatedRecovery?: Date;

  /** Number of degradation events since last full recovery */
  degradationCount: number;
}

export interface DegradedResponse<T> {
  /** Response data (may be partial or cached) */
  data: T | null;

  /** Current degradation state (null if fully operational) */
  degradation: DegradationState | null;

  /** Whether the data is stale/cached */
  isStale: boolean;

  /** Age of cached data in milliseconds */
  cacheAge?: number;

  /** Source of the data (live, cache, fallback) */
  source: 'live' | 'cache' | 'fallback' | 'none';
}

export interface DegradationOptions<T> {
  /** Function to get cached data */
  cache?: {
    get: () => Promise<T | null>;
    set: (value: T) => Promise<void>;
    ttl?: number;
  };

  /** Fallback function when primary and cache fail */
  fallback?: () => T | Promise<T>;

  /** Minimum degradation level required to execute */
  minLevel?: DegradationLevel;

  /** Whether this operation is critical */
  critical?: boolean;
}

// ============================================================================
// Feature Flags
// ============================================================================

export interface FeatureFlags {
  /** Can start new application processes */
  canApply: boolean;

  /** Can use AI to generate answers */
  canGenerateAnswers: boolean;

  /** Can upload files (resume, cover letter) */
  canUploadFiles: boolean;

  /** Can submit applications */
  canSubmit: boolean;

  /** Can fetch job listings */
  canFetchJobs: boolean;

  /** Can use browser automation */
  canUseBrowser: boolean;

  /** Can log to application_logs */
  canLog: boolean;

  /** Can access cached data */
  canUseCache: boolean;

  /** Show degradation warning to user */
  showWarning: boolean;

  /** User-friendly status message */
  statusMessage: string;
}

// ============================================================================
// Global State Management
// ============================================================================

// Module-level state
let currentState: DegradationState = {
  level: DegradationLevel.FULL,
  reason: '',
  affectedServices: [],
  since: new Date(),
  degradationCount: 0
};

// Service-specific degradation tracking
const serviceStatus = new Map<string, {
  level: DegradationLevel;
  lastError?: Error;
  errorCount: number;
  lastSuccess?: Date;
}>();

// Listeners for state changes
const listeners = new Set<(state: DegradationState) => void>();

// ============================================================================
// State Management Functions
// ============================================================================

/**
 * Get the current degradation state.
 */
export function getDegradationState(): DegradationState {
  return { ...currentState };
}

/**
 * Update the degradation level.
 *
 * @param level - New degradation level
 * @param reason - Human-readable reason
 * @param affectedServices - List of affected services
 */
export function setDegradationLevel(
  level: DegradationLevel,
  reason: string,
  affectedServices: string[] = []
): void {
  const previousLevel = currentState.level;

  currentState = {
    level,
    reason,
    affectedServices,
    since: level !== previousLevel ? new Date() : currentState.since,
    degradationCount: level !== DegradationLevel.FULL
      ? currentState.degradationCount + (level !== previousLevel ? 1 : 0)
      : 0
  };

  // Log state change
  if (level !== previousLevel) {
    console.warn(
      `[degradation] Level changed: ${previousLevel} -> ${level}. Reason: ${reason}`
    );
  }

  // Notify listeners
  listeners.forEach(listener => listener(currentState));
}

/**
 * Record a service failure and update degradation if needed.
 */
export function recordServiceFailure(
  serviceName: string,
  error: Error,
  options: { threshold?: number; escalate?: boolean } = {}
): void {
  const { threshold = 3, escalate = true } = options;

  const status = serviceStatus.get(serviceName) || {
    level: DegradationLevel.FULL,
    errorCount: 0
  };

  status.errorCount++;
  status.lastError = error;

  // Determine service degradation level based on error count
  if (status.errorCount >= threshold * 2) {
    status.level = DegradationLevel.OFFLINE;
  } else if (status.errorCount >= threshold) {
    status.level = DegradationLevel.PARTIAL;
  }

  serviceStatus.set(serviceName, status);

  // Escalate to global degradation if needed
  if (escalate && status.level !== DegradationLevel.FULL) {
    updateGlobalDegradation();
  }
}

/**
 * Record a service success and potentially recover.
 */
export function recordServiceSuccess(serviceName: string): void {
  const status = serviceStatus.get(serviceName);

  if (status) {
    status.errorCount = Math.max(0, status.errorCount - 1);
    status.lastSuccess = new Date();

    if (status.errorCount === 0) {
      status.level = DegradationLevel.FULL;
    }

    serviceStatus.set(serviceName, status);
    updateGlobalDegradation();
  }
}

/**
 * Update global degradation based on all service statuses.
 */
function updateGlobalDegradation(): void {
  const affectedServices: string[] = [];
  let worstLevel = DegradationLevel.FULL;

  for (const [name, status] of serviceStatus) {
    if (status.level !== DegradationLevel.FULL) {
      affectedServices.push(name);
      if (isLevelWorse(status.level, worstLevel)) {
        worstLevel = status.level;
      }
    }
  }

  if (affectedServices.length === 0) {
    setDegradationLevel(DegradationLevel.FULL, 'All services operational', []);
  } else {
    setDegradationLevel(
      worstLevel,
      `${affectedServices.length} service(s) experiencing issues`,
      affectedServices
    );
  }
}

/**
 * Subscribe to degradation state changes.
 */
export function onDegradationChange(
  listener: (state: DegradationState) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reset all degradation state.
 */
export function resetDegradation(): void {
  serviceStatus.clear();
  currentState = {
    level: DegradationLevel.FULL,
    reason: '',
    affectedServices: [],
    since: new Date(),
    degradationCount: 0
  };
  listeners.forEach(listener => listener(currentState));
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Get feature flags based on current degradation level.
 */
export function getFeatureFlags(): FeatureFlags {
  const level = currentState.level;

  return {
    canApply: level === DegradationLevel.FULL || level === DegradationLevel.PARTIAL,
    canGenerateAnswers: level === DegradationLevel.FULL,
    canUploadFiles: level !== DegradationLevel.OFFLINE,
    canSubmit: level === DegradationLevel.FULL,
    canFetchJobs: level !== DegradationLevel.OFFLINE,
    canUseBrowser: level !== DegradationLevel.OFFLINE,
    canLog: true, // Always try to log
    canUseCache: level !== DegradationLevel.OFFLINE,
    showWarning: level !== DegradationLevel.FULL,
    statusMessage: getStatusMessage(level)
  };
}

/**
 * Check if a specific feature is available.
 */
export function isFeatureAvailable(feature: keyof FeatureFlags): boolean {
  return getFeatureFlags()[feature] as boolean;
}

/**
 * Check if a service is degraded.
 */
export function isServiceDegraded(serviceName: string): boolean {
  const status = serviceStatus.get(serviceName);
  return status ? status.level !== DegradationLevel.FULL : false;
}

// ============================================================================
// Degradation Wrapper
// ============================================================================

/**
 * Wrapper that handles degradation automatically.
 * Tries primary function, falls back to cache, then fallback.
 *
 * @example
 * const result = await withDegradation(
 *   'job-api',
 *   () => fetchJobsFromAPI(),
 *   {
 *     cache: {
 *       get: () => getCachedJobs(),
 *       set: (jobs) => setCachedJobs(jobs)
 *     },
 *     fallback: () => []
 *   }
 * );
 *
 * if (result.isStale) {
 *   console.log('Showing cached jobs from', result.cacheAge, 'ms ago');
 * }
 */
export async function withDegradation<T>(
  serviceName: string,
  primaryFn: () => Promise<T>,
  options: DegradationOptions<T> = {}
): Promise<DegradedResponse<T>> {
  const { cache, fallback, minLevel, critical = false } = options;

  // Check if we're below minimum required level
  if (minLevel && isLevelWorse(currentState.level, minLevel)) {
    return {
      data: null,
      degradation: currentState,
      isStale: false,
      source: 'none'
    };
  }

  // Check if service is already known to be offline
  const serviceState = serviceStatus.get(serviceName);
  if (serviceState?.level === DegradationLevel.OFFLINE && !critical) {
    // Try cache directly
    if (cache) {
      const cachedData = await cache.get();
      if (cachedData !== null) {
        return {
          data: cachedData,
          degradation: currentState,
          isStale: true,
          source: 'cache'
        };
      }
    }
    // Try fallback
    if (fallback) {
      return {
        data: await fallback(),
        degradation: currentState,
        isStale: false,
        source: 'fallback'
      };
    }
    return {
      data: null,
      degradation: currentState,
      isStale: false,
      source: 'none'
    };
  }

  try {
    const data = await primaryFn();

    // Record success
    recordServiceSuccess(serviceName);

    // Cache successful result
    if (cache) {
      try {
        await cache.set(data);
      } catch (cacheError) {
        console.warn(`[degradation] Failed to cache ${serviceName} data:`, cacheError);
      }
    }

    return {
      data,
      degradation: null,
      isStale: false,
      source: 'live'
    };
  } catch (error) {
    // Record failure
    recordServiceFailure(serviceName, error as Error);

    // Try to get cached data
    if (cache) {
      try {
        const cachedData = await cache.get();
        if (cachedData !== null) {
          return {
            data: cachedData,
            degradation: currentState,
            isStale: true,
            source: 'cache'
          };
        }
      } catch (cacheError) {
        console.warn(`[degradation] Cache read failed for ${serviceName}:`, cacheError);
      }
    }

    // Try fallback
    if (fallback) {
      try {
        const fallbackData = await fallback();
        return {
          data: fallbackData,
          degradation: currentState,
          isStale: false,
          source: 'fallback'
        };
      } catch (fallbackError) {
        console.warn(`[degradation] Fallback failed for ${serviceName}:`, fallbackError);
      }
    }

    // Full failure
    return {
      data: null,
      degradation: currentState,
      isStale: false,
      source: 'none'
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if one degradation level is worse than another.
 */
function isLevelWorse(a: DegradationLevel, b: DegradationLevel): boolean {
  const order = [
    DegradationLevel.FULL,
    DegradationLevel.PARTIAL,
    DegradationLevel.CACHED,
    DegradationLevel.MINIMAL,
    DegradationLevel.OFFLINE
  ];
  return order.indexOf(a) > order.indexOf(b);
}

/**
 * Get user-friendly status message for degradation level.
 */
function getStatusMessage(level: DegradationLevel): string {
  switch (level) {
    case DegradationLevel.FULL:
      return 'All systems operational';

    case DegradationLevel.PARTIAL:
      return 'Some features may be slower or limited';

    case DegradationLevel.CACHED:
      return 'Showing cached data. Live updates temporarily unavailable';

    case DegradationLevel.MINIMAL:
      return 'Limited functionality. Only core features available';

    case DegradationLevel.OFFLINE:
      return 'Service temporarily unavailable. Please try again later';

    default:
      return 'Unknown status';
  }
}

/**
 * Format degradation state for logging.
 */
export function formatDegradationState(state: DegradationState): string {
  const duration = Date.now() - state.since.getTime();
  const durationStr = duration < 60000
    ? `${Math.floor(duration / 1000)}s`
    : `${Math.floor(duration / 60000)}m`;

  return [
    `Level: ${state.level}`,
    `Reason: ${state.reason}`,
    `Duration: ${durationStr}`,
    `Affected: ${state.affectedServices.join(', ') || 'none'}`,
    `Events: ${state.degradationCount}`
  ].join(' | ');
}

/**
 * Get all service statuses for monitoring.
 */
export function getAllServiceStatuses(): Record<string, {
  level: DegradationLevel;
  errorCount: number;
  lastError?: string;
  lastSuccess?: string;
}> {
  const result: Record<string, any> = {};

  for (const [name, status] of serviceStatus) {
    result[name] = {
      level: status.level,
      errorCount: status.errorCount,
      lastError: status.lastError?.message,
      lastSuccess: status.lastSuccess?.toISOString()
    };
  }

  return result;
}
