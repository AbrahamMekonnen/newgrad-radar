# Real-Time Progress UI Implementation

## Recommended Approach: Supabase Realtime + Database Updates

After analyzing the codebase and evaluating WebSockets, SSE, long polling, and Supabase Realtime, **Supabase Realtime is the recommended approach** because:

1. Already integrated (`@supabase/ssr`, `@supabase/supabase-js` v2.115.0)
2. Proven pattern in `useSupabaseRealtime.ts` for job updates
3. Working subscription in `applications/page.tsx` for application_logs
4. No additional infrastructure needed
5. Built-in connection management, reconnection, and multiplexing

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Auto-Apply Worker                              │
│  (batch-apply.js / Playwright)                                          │
│                                                                          │
│   1. For each field filled:                                              │
│      POST /api/log-application { status: 'filling', fields_filled: [...] │
│                                                                          │
│   2. On completion:                                                      │
│      POST /api/log-application { status: 'submitted' }                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Supabase Database                                │
│                                                                          │
│   application_logs table                                                 │
│   ├── status: 'pending' | 'filling' | 'review' | 'submitted' | 'failed' │
│   ├── fields_filled: JSONB array                                        │
│   ├── fields_failed: JSONB array                                        │
│   ├── fields_missing: TEXT[]                                            │
│   └── custom_questions: JSONB array                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          (postgres_changes event)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         React UI                                         │
│                                                                          │
│   useAutoApplyProgress hook                                              │
│   ├── Subscribes to application_logs changes                            │
│   ├── Updates progress state in real-time                               │
│   └── Provides field-by-field status                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Database: Progress Tracking Schema

The schema already exists in `application_logs`. Key columns for real-time progress:

```sql
-- Already in migrations
ALTER TABLE application_logs
ADD COLUMN IF NOT EXISTS fields_filled JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS fields_failed JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS fields_missing TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS custom_questions JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
ADD COLUMN IF NOT EXISTS error_category TEXT;
```

### Progress Update Granularity

For real-time field-by-field updates, add a `progress` column:

```sql
-- New migration for granular progress
ALTER TABLE application_logs
ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT '{}';

-- Progress structure:
-- {
--   "total_fields": 12,
--   "filled_fields": 5,
--   "current_field": "phone",
--   "current_step": "filling",
--   "steps_completed": ["firstName", "lastName", "email", "resume", "linkedin"],
--   "estimated_remaining_ms": 15000
-- }

COMMENT ON COLUMN application_logs.progress IS 'Real-time progress state for UI updates';
```

---

## 2. Server: Enhanced Log-Application API

Modify `/src/app/api/log-application/route.ts` to handle incremental updates:

```typescript
// Add to existing LogApplicationRequest interface
interface ProgressUpdate {
  total_fields: number;
  filled_fields: number;
  current_field?: string;
  current_step: 'detecting' | 'filling' | 'validating' | 'submitting' | 'confirming';
  steps_completed: string[];
  estimated_remaining_ms?: number;
}

interface LogApplicationRequest {
  job_id: string;
  ats_type: string;
  status: 'pending' | 'filling' | 'review' | 'submitted' | 'failed';
  progress?: ProgressUpdate;  // NEW: For real-time updates
  fields_filled?: FieldAttempt[];
  fields_failed?: FieldAttempt[];
  // ... existing fields
}

// In POST handler, add progress update handling
export async function POST(request: NextRequest) {
  // ... existing auth code ...

  const body: LogApplicationRequest = await request.json();

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    status: body.status,
    ats_type: body.ats_type,
  };

  // Include progress if provided (for real-time updates)
  if (body.progress) {
    updatePayload.progress = body.progress;
  }

  // Include fields if this is a final update
  if (body.fields_filled) {
    updatePayload.fields_filled = body.fields_filled;
    updatePayload.fields_failed = body.fields_failed || [];
    updatePayload.fields_missing = body.fields_missing || [];
  }

  // Upsert logic...
}
```

---

## 3. Client: useAutoApplyProgress Hook

Create `/src/hooks/useAutoApplyProgress.ts`:

```typescript
/**
 * Real-time progress tracking for auto-apply applications
 * 
 * Uses Supabase Realtime to receive field-by-field progress updates
 * as the auto-apply worker fills each form field.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface FieldProgress {
  field: string;
  status: 'pending' | 'filling' | 'success' | 'failed' | 'skipped';
  error?: string;
  duration_ms?: number;
}

export interface ApplicationProgress {
  /** Application log ID */
  id: string;
  /** Job ID being applied to */
  jobId: string;
  /** Overall status */
  status: 'pending' | 'filling' | 'review' | 'submitted' | 'failed';
  /** Detected ATS type */
  atsType: string;
  /** Total number of fields to fill */
  totalFields: number;
  /** Number of fields filled so far */
  filledFields: number;
  /** Current field being processed */
  currentField?: string;
  /** Current step within the field */
  currentStep: 'detecting' | 'filling' | 'validating' | 'submitting' | 'confirming';
  /** Fields that have been completed */
  completedFields: FieldProgress[];
  /** Estimated time remaining in ms */
  estimatedRemainingMs?: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp of last update */
  lastUpdatedAt: Date;
}

export interface UseAutoApplyProgressOptions {
  /** User ID to track applications for */
  userId: string;
  /** Optional: Only track specific job IDs */
  jobIds?: string[];
  /** Callback when progress updates */
  onProgress?: (progress: ApplicationProgress) => void;
  /** Callback when application completes (success or fail) */
  onComplete?: (progress: ApplicationProgress) => void;
  /** Callback when a new application starts */
  onStart?: (progress: ApplicationProgress) => void;
}

export interface UseAutoApplyProgressReturn {
  /** Map of job ID to progress state */
  applications: Map<string, ApplicationProgress>;
  /** Array of all active applications */
  activeApplications: ApplicationProgress[];
  /** Number of applications currently in progress */
  inProgressCount: number;
  /** Connection status */
  isConnected: boolean;
  /** Last error */
  error: Error | null;
  /** Force refresh from database */
  refresh: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const CHANNEL_NAME = 'autoapply_progress';

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAutoApplyProgress(
  options: UseAutoApplyProgressOptions
): UseAutoApplyProgressReturn {
  const { userId, jobIds, onProgress, onStart, onComplete } = options;

  // State
  const [applications, setApplications] = useState<Map<string, ApplicationProgress>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef(createClient());
  const callbacksRef = useRef({ onProgress, onStart, onComplete });

  // Update callback refs
  useEffect(() => {
    callbacksRef.current = { onProgress, onStart, onComplete };
  }, [onProgress, onStart, onComplete]);

  /**
   * Parse database row into ApplicationProgress
   */
  const parseProgress = useCallback((row: Record<string, unknown>): ApplicationProgress => {
    const progress = (row.progress as Record<string, unknown>) || {};
    const fieldsFilledArr = (row.fields_filled as Array<Record<string, unknown>>) || [];
    const fieldsFailedArr = (row.fields_failed as Array<Record<string, unknown>>) || [];

    const completedFields: FieldProgress[] = [
      ...fieldsFilledArr.map(f => ({
        field: f.field as string,
        status: 'success' as const,
        duration_ms: f.duration_ms as number | undefined,
      })),
      ...fieldsFailedArr.map(f => ({
        field: f.field as string,
        status: 'failed' as const,
        error: f.error as string | undefined,
      })),
    ];

    const totalFields = (progress.total_fields as number) || completedFields.length || 10;
    const filledFields = (progress.filled_fields as number) || completedFields.filter(f => f.status === 'success').length;

    return {
      id: row.id as string,
      jobId: row.job_id as string,
      status: row.status as ApplicationProgress['status'],
      atsType: row.ats_type as string,
      totalFields,
      filledFields,
      currentField: progress.current_field as string | undefined,
      currentStep: (progress.current_step as ApplicationProgress['currentStep']) || 'detecting',
      completedFields,
      estimatedRemainingMs: progress.estimated_remaining_ms as number | undefined,
      progressPercent: Math.round((filledFields / totalFields) * 100),
      errorMessage: row.error_message as string | undefined,
      lastUpdatedAt: new Date(row.updated_at as string || row.created_at as string),
    };
  }, []);

  /**
   * Handle incoming changes
   */
  const handleChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const row = payload.new as Record<string, unknown>;
      if (!row.id) return;

      // Filter by job IDs if specified
      if (jobIds && !jobIds.includes(row.job_id as string)) return;

      const progress = parseProgress(row);

      setApplications(prev => {
        const next = new Map(prev);
        const existing = prev.get(progress.jobId);

        // Detect new application
        if (!existing && payload.eventType === 'INSERT') {
          callbacksRef.current.onStart?.(progress);
        }

        // Update map
        next.set(progress.jobId, progress);

        // Fire progress callback
        callbacksRef.current.onProgress?.(progress);

        // Detect completion
        if (progress.status === 'submitted' || progress.status === 'failed') {
          callbacksRef.current.onComplete?.(progress);
        }

        return next;
      });
    },
    [jobIds, parseProgress]
  );

  /**
   * Fetch current applications from database
   */
  const refresh = useCallback(async () => {
    const supabase = supabaseRef.current;
    setError(null);

    try {
      let query = supabase
        .from('application_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filter by job IDs if specified
      if (jobIds && jobIds.length > 0) {
        query = query.in('job_id', jobIds);
      } else {
        // Only get active applications (not completed)
        query = query.in('status', ['pending', 'filling', 'review']);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(new Error(fetchError.message));
        return;
      }

      const progressMap = new Map<string, ApplicationProgress>();
      for (const row of data || []) {
        const progress = parseProgress(row);
        progressMap.set(progress.jobId, progress);
      }

      setApplications(progressMap);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch applications'));
    }
  }, [userId, jobIds, parseProgress]);

  /**
   * Set up realtime subscription
   */
  useEffect(() => {
    const supabase = supabaseRef.current;

    // Initial fetch
    refresh();

    // Set up channel
    const channel = supabase
      .channel(`${CHANNEL_NAME}_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        handleChange
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        handleChange
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setError(null);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsConnected(false);
          setError(new Error(`Connection ${status.toLowerCase()}`));
        } else if (status === 'CLOSED') {
          setIsConnected(false);
        }
      });

    channelRef.current = channel;

    // Cleanup
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, handleChange, refresh]);

  // Computed values
  const activeApplications = Array.from(applications.values())
    .filter(app => ['pending', 'filling', 'review'].includes(app.status))
    .sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());

  return {
    applications,
    activeApplications,
    inProgressCount: activeApplications.length,
    isConnected,
    error,
    refresh,
  };
}

export default useAutoApplyProgress;
```

---

## 4. Client: Progress UI Components

### ProgressBar Component

Create `/src/components/autoapply/ProgressBar.tsx`:

```typescript
'use client';

import { cn } from '@/lib/utils';
import type { ApplicationProgress, FieldProgress } from '@/hooks/useAutoApplyProgress';

interface ProgressBarProps {
  progress: ApplicationProgress;
  showFields?: boolean;
  className?: string;
}

export function ProgressBar({ progress, showFields = false, className }: ProgressBarProps) {
  const { progressPercent, currentField, currentStep, status, completedFields, atsType } = progress;

  // Status colors
  const statusColors = {
    pending: 'bg-yellow-500',
    filling: 'bg-blue-500',
    review: 'bg-purple-500',
    submitted: 'bg-green-500',
    failed: 'bg-red-500',
  };

  // Step labels
  const stepLabels = {
    detecting: 'Detecting form fields...',
    filling: `Filling ${currentField || 'fields'}...`,
    validating: 'Validating inputs...',
    submitting: 'Submitting application...',
    confirming: 'Confirming submission...',
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Header */}
      <div className="flex justify-between items-center text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{atsType}</span>
          <span className="text-gray-500">-</span>
          <span className="text-gray-600">{stepLabels[currentStep]}</span>
        </div>
        <span className="font-mono text-gray-600">{progressPercent}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-300 ease-out',
            statusColors[status],
            status === 'filling' && 'animate-pulse'
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Field details */}
      {showFields && completedFields.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {completedFields.map((field, i) => (
            <FieldChip key={`${field.field}-${i}`} field={field} />
          ))}
          {currentField && (
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full animate-pulse">
              {currentField}...
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {status === 'failed' && progress.errorMessage && (
        <p className="text-sm text-red-600 mt-1">{progress.errorMessage}</p>
      )}
    </div>
  );
}

function FieldChip({ field }: { field: FieldProgress }) {
  const colors = {
    pending: 'bg-gray-100 text-gray-600',
    filling: 'bg-blue-100 text-blue-700',
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-yellow-100 text-yellow-700',
  };

  const icons = {
    pending: '',
    filling: '...',
    success: '✓',
    failed: '✗',
    skipped: '○',
  };

  return (
    <span
      className={cn(
        'px-2 py-0.5 text-xs rounded-full transition-colors',
        colors[field.status]
      )}
      title={field.error || `${field.field}: ${field.status}`}
    >
      {icons[field.status]} {field.field}
    </span>
  );
}
```

### ActiveApplicationsPanel Component

Create `/src/components/autoapply/ActiveApplicationsPanel.tsx`:

```typescript
'use client';

import { useAutoApplyProgress, ApplicationProgress } from '@/hooks/useAutoApplyProgress';
import { ProgressBar } from './ProgressBar';
import { cn } from '@/lib/utils';

interface ActiveApplicationsPanelProps {
  userId: string;
  className?: string;
}

export function ActiveApplicationsPanel({ userId, className }: ActiveApplicationsPanelProps) {
  const {
    activeApplications,
    inProgressCount,
    isConnected,
    error,
  } = useAutoApplyProgress({
    userId,
    onComplete: (progress) => {
      // Could show toast notification here
      console.log('Application completed:', progress.status, progress.jobId);
    },
  });

  if (inProgressCount === 0) {
    return null; // Don't show panel when nothing is in progress
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 w-96 max-h-96 overflow-y-auto',
        'bg-white rounded-lg shadow-lg border border-gray-200',
        'z-50',
        className
      )}
    >
      {/* Header */}
      <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Auto-Applying ({inProgressCount})
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                isConnected ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            <span className="text-xs text-gray-500">
              {isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-500 mt-1">{error.message}</p>
        )}
      </div>

      {/* Application list */}
      <div className="divide-y divide-gray-100">
        {activeApplications.map((app) => (
          <ApplicationProgressCard key={app.id} progress={app} />
        ))}
      </div>
    </div>
  );
}

function ApplicationProgressCard({ progress }: { progress: ApplicationProgress }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {progress.jobId}
          </p>
          <ProgressBar progress={progress} showFields className="mt-2" />
        </div>
      </div>
    </div>
  );
}
```

---

## 5. Worker: Incremental Progress Updates

Modify the auto-apply scripts to send progress updates as they fill each field.

### batch-apply.js Integration

Add progress reporting to `auto-apply/batch-apply.js`:

```javascript
// Add to batch-apply.js

class ProgressReporter {
  constructor(apiUrl, authToken) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;
    this.pendingUpdates = [];
    this.batchInterval = null;
  }

  /**
   * Report progress for a job application
   */
  async reportProgress(jobId, atsType, update) {
    const payload = {
      job_id: jobId,
      ats_type: atsType,
      status: update.status || 'filling',
      progress: {
        total_fields: update.totalFields || 10,
        filled_fields: update.filledFields || 0,
        current_field: update.currentField,
        current_step: update.step || 'filling',
        steps_completed: update.stepsCompleted || [],
        estimated_remaining_ms: update.estimatedRemainingMs,
      },
    };

    // For final updates, include field details
    if (update.status === 'submitted' || update.status === 'failed') {
      payload.fields_filled = update.fieldsFilled || [];
      payload.fields_failed = update.fieldsFailed || [];
      payload.fields_missing = update.fieldsMissing || [];
      payload.duration_ms = update.durationMs;
      payload.error_message = update.errorMessage;
    }

    try {
      await fetch(`${this.apiUrl}/api/log-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error('Failed to report progress:', error.message);
    }
  }

  /**
   * Create a field reporter for tracking individual field fills
   */
  createFieldReporter(jobId, atsType, totalFields) {
    let filledCount = 0;
    const stepsCompleted = [];
    const startTime = Date.now();

    return {
      onFieldStart: async (fieldName) => {
        await this.reportProgress(jobId, atsType, {
          totalFields,
          filledFields: filledCount,
          currentField: fieldName,
          step: 'filling',
          stepsCompleted,
        });
      },

      onFieldComplete: async (fieldName, success) => {
        if (success) {
          filledCount++;
          stepsCompleted.push(fieldName);
        }

        const avgTimePerField = (Date.now() - startTime) / Math.max(filledCount, 1);
        const remainingFields = totalFields - filledCount;

        await this.reportProgress(jobId, atsType, {
          totalFields,
          filledFields: filledCount,
          currentField: null,
          step: 'filling',
          stepsCompleted,
          estimatedRemainingMs: Math.round(remainingFields * avgTimePerField),
        });
      },

      onSubmitting: async () => {
        await this.reportProgress(jobId, atsType, {
          totalFields,
          filledFields: filledCount,
          step: 'submitting',
          stepsCompleted,
        });
      },

      onComplete: async (result) => {
        await this.reportProgress(jobId, atsType, {
          status: result.success ? 'submitted' : 'failed',
          totalFields,
          filledFields: filledCount,
          step: result.success ? 'confirming' : 'filling',
          stepsCompleted,
          fieldsFilled: result.fieldsFilled,
          fieldsFailed: result.fieldsFailed,
          fieldsMissing: result.fieldsMissing,
          durationMs: Date.now() - startTime,
          errorMessage: result.error,
        });
      },
    };
  }
}

// Usage in fillJob function
async function fillJob(page, job, profile, progressReporter) {
  const atsType = detectATS(job.url);
  const filler = fillers[atsType];
  
  if (!filler) {
    throw new Error(`Unsupported ATS: ${atsType}`);
  }

  // Count fields
  const fieldCount = Object.keys(filler.fields).length;
  const reporter = progressReporter.createFieldReporter(job.id, atsType, fieldCount);

  const fieldsFilled = [];
  const fieldsFailed = [];

  for (const [fieldName, fieldConfig] of Object.entries(filler.fields)) {
    await reporter.onFieldStart(fieldName);

    try {
      const value = profile[fieldConfig.profileKey];
      if (value) {
        await page.fill(fieldConfig.selector, value);
        fieldsFilled.push({ field: fieldName, selector: fieldConfig.selector, found: true, filled: true });
        await reporter.onFieldComplete(fieldName, true);
      }
    } catch (error) {
      fieldsFailed.push({ field: fieldName, selector: fieldConfig.selector, found: false, filled: false, error: error.message });
      await reporter.onFieldComplete(fieldName, false);
    }
  }

  await reporter.onSubmitting();

  // Submit form
  try {
    await page.click(filler.submitSelector);
    await page.waitForSelector(filler.confirmationSelector, { timeout: 10000 });
    
    await reporter.onComplete({
      success: true,
      fieldsFilled,
      fieldsFailed,
      fieldsMissing: [],
    });
  } catch (error) {
    await reporter.onComplete({
      success: false,
      fieldsFilled,
      fieldsFailed,
      fieldsMissing: [],
      error: error.message,
    });
  }
}
```

---

## 6. Alternative: SSE for Browser Extension

If auto-apply runs from a browser extension that cannot use the Supabase client library, use Server-Sent Events (SSE) as a lightweight alternative.

### SSE API Route

Create `/src/app/api/autoapply/stream/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const jobIds = searchParams.get('jobIds')?.split(',');

  if (!userId) {
    return new Response('Missing userId', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Build filter
      let filter = `user_id=eq.${userId}`;
      if (jobIds && jobIds.length > 0) {
        filter += `&job_id=in.(${jobIds.join(',')})`;
      }

      // Subscribe to changes
      const channel = supabase
        .channel('sse_autoapply')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'application_logs',
            filter,
          },
          (payload) => {
            const data = `data: ${JSON.stringify(payload)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        )
        .subscribe();

      // Keep connection alive
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(':keepalive\n\n'));
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        supabase.removeChannel(channel);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### SSE Client Hook

```typescript
export function useAutoApplyProgressSSE(userId: string, jobIds?: string[]) {
  const [progress, setProgress] = useState<Map<string, ApplicationProgress>>(new Map());

  useEffect(() => {
    const params = new URLSearchParams({ userId });
    if (jobIds) params.set('jobIds', jobIds.join(','));

    const eventSource = new EventSource(`/api/autoapply/stream?${params}`);

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      // Parse and update state...
    };

    eventSource.onerror = () => {
      // Reconnect logic...
    };

    return () => eventSource.close();
  }, [userId, jobIds?.join(',')]);

  return progress;
}
```

---

## 7. Comparison: WebSocket vs SSE vs Supabase Realtime

| Feature | Supabase Realtime | SSE | Raw WebSocket |
|---------|-------------------|-----|---------------|
| Already integrated | Yes | No | No |
| Bidirectional | Yes (via client) | No | Yes |
| Auto-reconnect | Yes | Browser handles | Manual |
| Multiplexing | Yes | Per-connection | Manual |
| Database triggers | Built-in | Manual | Manual |
| Auth handling | Built-in | Manual | Manual |
| Complexity | Low | Medium | High |

**Verdict**: Use **Supabase Realtime** for the web app. Consider **SSE** only for browser extension scenarios where the Supabase client is not available.

---

## 8. Integration Example

Full integration in the Applications page:

```typescript
// In /src/app/applications/page.tsx

import { useAutoApplyProgress } from '@/hooks/useAutoApplyProgress';
import { ActiveApplicationsPanel } from '@/components/autoapply/ActiveApplicationsPanel';

function ApplicationsContent({ userId }: { userId: string }) {
  const { activeApplications, inProgressCount } = useAutoApplyProgress({
    userId,
    onComplete: (progress) => {
      // Show toast notification
      toast({
        title: progress.status === 'submitted' ? 'Application Submitted!' : 'Application Failed',
        description: progress.status === 'submitted' 
          ? `Successfully applied to ${progress.jobId}` 
          : progress.errorMessage,
        variant: progress.status === 'submitted' ? 'success' : 'error',
      });
    },
  });

  return (
    <div>
      {/* Show in-progress count in header */}
      {inProgressCount > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-800">
            <span className="font-medium">{inProgressCount}</span> application{inProgressCount > 1 ? 's' : ''} in progress...
          </p>
        </div>
      )}

      {/* Existing application list */}
      {/* ... */}

      {/* Floating progress panel */}
      <ActiveApplicationsPanel userId={userId} />
    </div>
  );
}
```

---

## 9. Performance Considerations

1. **Debounce frequent updates**: If filling rapidly, batch updates every 200-500ms
2. **Limit active subscriptions**: Unsubscribe from completed applications
3. **Use filters**: Always filter by user_id to reduce server load
4. **Connection reuse**: The Supabase client multiplexes over a single WebSocket
5. **Fallback polling**: For browsers with WebSocket issues, poll every 2-3 seconds

---

## Summary

The recommended implementation uses:

1. **Supabase Realtime** with `postgres_changes` for live updates
2. **Database-centric approach**: Worker writes to DB, UI subscribes
3. **`useAutoApplyProgress` hook** for centralized state management
4. **Progress component** for visual feedback
5. **SSE fallback** only for browser extension scenarios

This approach leverages existing infrastructure, requires minimal new code, and provides a responsive real-time experience.
