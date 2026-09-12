'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ApplicationStatus as AppStatus, APPLICATION_STATUS_LABELS } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export type FieldStatus = 'pending' | 'filling' | 'done' | 'failed' | 'skipped';

export interface FieldProgress {
  /** Field name/identifier */
  name: string;
  /** Display label for the field */
  label: string;
  /** Current status */
  status: FieldStatus;
  /** Error message if failed */
  error?: string;
  /** Time taken to fill this field in ms */
  durationMs?: number;
}

export interface JobProgress {
  /** Job ID being applied to */
  jobId: string;
  /** Job title */
  jobTitle: string;
  /** Company name */
  companyName: string;
  /** Company logo URL */
  companyLogo?: string;
  /** ATS type (greenhouse, lever, etc.) */
  atsType: string;
  /** Overall application status */
  status: AppStatus;
  /** Fields progress */
  fields: FieldProgress[];
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Estimated time remaining in ms */
  estimatedRemainingMs?: number;
  /** Time started */
  startedAt: Date;
  /** Error message if failed */
  errorMessage?: string;
  /** Whether this can be retried */
  canRetry?: boolean;
}

export interface ProgressPanelProps {
  /** Current job progress data */
  progress: JobProgress | null;
  /** Whether the panel is visible */
  isVisible?: boolean;
  /** Whether auto-apply is paused */
  isPaused?: boolean;
  /** Callback when pause is clicked */
  onPause?: () => void;
  /** Callback when resume is clicked */
  onResume?: () => void;
  /** Callback when cancel is clicked */
  onCancel?: () => void;
  /** Callback when retry is clicked */
  onRetry?: () => void;
  /** Callback when minimize is clicked */
  onMinimize?: () => void;
  /** Whether the panel is minimized */
  isMinimized?: boolean;
  /** Position of the panel */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Additional class names */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const FIELD_STATUS_CONFIG: Record<FieldStatus, { icon: string; color: string; bgColor: string }> = {
  pending: {
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    color: 'text-gray-400 dark:text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-slate-700',
  },
  filling: {
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    color: 'text-blue-500 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  },
  done: {
    icon: 'M5 13l4 4L19 7',
    color: 'text-green-500 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
  },
  failed: {
    icon: 'M6 18L18 6M6 6l12 12',
    color: 'text-red-500 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
  },
  skipped: {
    icon: 'M13 7l5 5m0 0l-5 5m5-5H6',
    color: 'text-yellow-500 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
};

const POSITION_CLASSES: Record<string, string> = {
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-right': 'top-20 right-4',
  'top-left': 'top-20 left-4',
};

// ============================================================================
// Helper Components
// ============================================================================

function FieldStatusIcon({ status }: { status: FieldStatus }) {
  const config = FIELD_STATUS_CONFIG[status];
  const isAnimating = status === 'filling';

  return (
    <svg
      className={cn('w-4 h-4', config.color, isAnimating && 'animate-spin')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
    </svg>
  );
}

function FieldItem({ field }: { field: FieldProgress }) {
  const config = FIELD_STATUS_CONFIG[field.status];

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-200',
        config.bgColor,
        field.status === 'filling' && 'ring-2 ring-blue-400 dark:ring-blue-500'
      )}
      title={field.error || `${field.label}: ${field.status}`}
    >
      <FieldStatusIcon status={field.status} />
      <span className={cn('text-xs font-medium truncate', config.color)}>
        {field.label}
      </span>
      {field.durationMs !== undefined && field.status === 'done' && (
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {(field.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      {field.error && (
        <span className="text-xs text-red-500 dark:text-red-400 ml-auto truncate max-w-[80px]">
          {field.error}
        </span>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatElapsed(startDate: Date): string {
  const elapsed = Date.now() - startDate.getTime();
  return formatDuration(elapsed);
}

// ============================================================================
// Main Component
// ============================================================================

export function ProgressPanel({
  progress,
  isVisible = true,
  isPaused = false,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onMinimize,
  isMinimized = false,
  position = 'bottom-right',
  className,
}: ProgressPanelProps) {
  const [elapsed, setElapsed] = useState('0s');
  const [showAllFields, setShowAllFields] = useState(false);

  // Update elapsed time
  useEffect(() => {
    if (!progress || progress.status === 'submitted' || progress.status === 'failed') {
      return;
    }

    const interval = setInterval(() => {
      setElapsed(formatElapsed(progress.startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [progress]);

  // Toggle field visibility
  const toggleFields = useCallback(() => {
    setShowAllFields(prev => !prev);
  }, []);

  if (!isVisible || !progress) {
    return null;
  }

  const isActive = ['pending', 'filling', 'review'].includes(progress.status);
  const isDone = progress.status === 'submitted';
  const isFailed = progress.status === 'failed';

  // Calculate field counts
  const doneCount = progress.fields.filter(f => f.status === 'done').length;
  const failedCount = progress.fields.filter(f => f.status === 'failed').length;
  const totalCount = progress.fields.length;

  // Get the currently filling field
  const currentField = progress.fields.find(f => f.status === 'filling');

  // Minimized view
  if (isMinimized) {
    return (
      <div
        className={cn(
          'fixed z-50',
          POSITION_CLASSES[position],
          className
        )}
      >
        <button
          onClick={onMinimize}
          className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all',
            'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700',
            'hover:shadow-xl hover:scale-105'
          )}
        >
          {/* Status indicator */}
          <div
            className={cn(
              'w-3 h-3 rounded-full',
              isActive && 'bg-blue-500 animate-pulse',
              isDone && 'bg-green-500',
              isFailed && 'bg-red-500'
            )}
          />

          {/* Company info */}
          {progress.companyLogo && (
            <img
              src={progress.companyLogo}
              alt={progress.companyName}
              className="w-6 h-6 rounded object-cover"
            />
          )}

          {/* Progress */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {progress.progressPercent}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {doneCount}/{totalCount} fields
            </span>
          </div>

          {/* Expand icon */}
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'fixed z-50 w-80 max-h-[80vh] overflow-hidden',
        'bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700',
        'flex flex-col',
        POSITION_CLASSES[position],
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div
            className={cn(
              'w-2.5 h-2.5 rounded-full',
              isActive && !isPaused && 'bg-blue-500 animate-pulse',
              isActive && isPaused && 'bg-yellow-500',
              isDone && 'bg-green-500',
              isFailed && 'bg-red-500'
            )}
          />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isActive && !isPaused && 'Auto-Applying...'}
            {isActive && isPaused && 'Paused'}
            {isDone && 'Application Submitted'}
            {isFailed && 'Application Failed'}
          </h3>
        </div>

        {/* Minimize button */}
        {onMinimize && (
          <button
            onClick={onMinimize}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Minimize"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Job Info */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <div className="flex items-start gap-3">
          {/* Company logo */}
          {progress.companyLogo ? (
            <img
              src={progress.companyLogo}
              alt={progress.companyName}
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">
                {progress.companyName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {progress.jobTitle}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {progress.companyName}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 capitalize">
                {progress.atsType}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {elapsed}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {currentField ? `Filling: ${currentField.label}` : APPLICATION_STATUS_LABELS[progress.status]}
          </span>
          <span className="text-xs font-mono text-gray-600 dark:text-gray-300">
            {progress.progressPercent}%
          </span>
        </div>

        {/* Progress bar track */}
        <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              isActive && !isPaused && 'bg-gradient-to-r from-blue-500 to-blue-600',
              isPaused && 'bg-yellow-500',
              isDone && 'bg-green-500',
              isFailed && 'bg-red-500'
            )}
            style={{ width: `${progress.progressPercent}%` }}
          />
        </div>

        {/* Progress stats */}
        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-green-600 dark:text-green-400">
              {doneCount} done
            </span>
            {failedCount > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {failedCount} failed
              </span>
            )}
          </div>
          {progress.estimatedRemainingMs !== undefined && isActive && (
            <span className="text-gray-400 dark:text-gray-500">
              ~{formatDuration(progress.estimatedRemainingMs)} left
            </span>
          )}
        </div>
      </div>

      {/* Fields List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <button
          onClick={toggleFields}
          className="flex items-center justify-between w-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-2"
        >
          <span>Fields ({doneCount + failedCount}/{totalCount})</span>
          <svg
            className={cn('w-4 h-4 transition-transform', showAllFields && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={cn('space-y-1.5', !showAllFields && 'max-h-32 overflow-hidden')}>
          {progress.fields.map((field, index) => (
            <FieldItem key={`${field.name}-${index}`} field={field} />
          ))}
        </div>

        {!showAllFields && progress.fields.length > 4 && (
          <button
            onClick={toggleFields}
            className="w-full text-center text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 mt-2"
          >
            Show all {progress.fields.length} fields
          </button>
        )}
      </div>

      {/* Error Display */}
      {isFailed && progress.errorMessage && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-700 bg-red-50 dark:bg-red-900/20">
          <div className="flex items-start gap-2">
            <svg
              className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-xs text-red-600 dark:text-red-400">
              {progress.errorMessage}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          {/* Active state buttons */}
          {isActive && (
            <>
              {isPaused ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onResume}
                  className="flex-1"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Resume
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onPause}
                  className="flex-1"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                  Pause
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/30"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </Button>
            </>
          )}

          {/* Failed state buttons */}
          {isFailed && (
            <>
              {progress.canRetry && onRetry && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onRetry}
                  className="flex-1"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Retry
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="flex-1"
              >
                Dismiss
              </Button>
            </>
          )}

          {/* Success state */}
          {isDone && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="w-full"
            >
              <svg className="w-4 h-4 mr-1.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProgressPanel;
