'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApplicationLog, ApplicationStatus as AppStatus } from '@/lib/types';
import { ApplicationStatus } from './ApplicationStatus';
import { cn } from '@/lib/utils';
import { ResumeScore } from '@/lib/resume-scorer';
import { tracker, buildLogPayload, ApplicationAttempt, ErrorCategory } from '@/lib/autoapply-tracker';
import { ATSType } from '@/lib/ats-registry';
import { isAutoApplySupported } from '@/lib/autoapply-support';
import { useNotificationGate } from '@/components/pwa/NotificationGate';

interface AutoApplyButtonProps {
  jobId: string;
  atsType: string | null;
  application?: ApplicationLog | null;
  onAutoApply: (jobId: string, optimizedResume?: boolean) => Promise<void>;
  onOptimizeFirst?: () => void;
  onCancelApplication?: (jobId: string) => Promise<void>;
  resumeScore?: ResumeScore | null;
  disabled?: boolean;
  applicationUrl?: string;
  hideStatus?: boolean;
  queuedStatus?: string | null;  // status in the new autoapply_job_queue, if any
}

// How each queue status reads on a job card (keeps card + Auto-Apply tab in sync).
const QUEUED_LABEL: Record<string, string> = {
  pending: 'Queued', processing: 'Preparing…', prepared: 'In Auto-Apply',
  submit_requested: 'Submitting…', submitting: 'Submitting…',
  submitted: 'Applied', applied: 'Applied',
};

/**
 * Log an application attempt to the API
 */
async function logApplicationAttempt(
  attempt: ApplicationAttempt,
  authToken?: string
): Promise<void> {
  try {
    const payload = buildLogPayload(attempt);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch('/api/log-application', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn('Failed to log application attempt:', await response.text());
    }
  } catch (error) {
    // Don't fail the application if logging fails
    console.warn('Error logging application attempt:', error);
  }
}

export function AutoApplyButton({
  jobId,
  atsType,
  application,
  onAutoApply,
  onOptimizeFirst,
  onCancelApplication,
  resumeScore,
  disabled = false,
  applicationUrl,
  hideStatus = false,
  queuedStatus,
}: AutoApplyButtonProps) {
  const [loading, setLoading] = useState(false);
  const { requireNotifications } = useNotificationGate();

  const needsOptimization = resumeScore && resumeScore.suggestion !== 'good';

  const handleClick = async () => {
    if (needsOptimization && onOptimizeFirst) {
      onOptimizeFirst();
      return;
    }

    // Nudge the user to enable notifications so we can ping them when this
    // application finishes or needs their input. Non-blocking — the apply runs
    // regardless of their choice.
    void requireNotifications({
      reason: 'so we can alert you when this application is submitted or needs you to finish it.',
    });

    setLoading(true);
    const startTime = Date.now();

    // Start tracking the attempt
    tracker.startAttempt(
      jobId,
      (atsType as ATSType) || 'unknown',
      applicationUrl
    );

    try {
      await onAutoApply(jobId, false);

      // Mark as successful
      tracker.markSubmitted();
      tracker.markConfirmed();

      const attempt = tracker.completeAttempt(
        true,
        Date.now() - startTime
      );

      // Log the successful attempt
      if (attempt) {
        console.log('[AutoApply]', tracker.createSummary(attempt));
        await logApplicationAttempt(attempt);
      }
    } catch (error) {
      // Determine error category
      let errorCategory: ErrorCategory = 'unknown';
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('captcha') || errorMessage.includes('CAPTCHA')) {
        errorCategory = 'captcha_blocked';
      } else if (errorMessage.includes('login') || errorMessage.includes('account')) {
        errorCategory = 'login_required';
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorCategory = 'network_error';
      } else if (errorMessage.includes('field') || errorMessage.includes('selector')) {
        errorCategory = 'field_not_found';
      } else if (errorMessage.includes('upload') || errorMessage.includes('file')) {
        errorCategory = 'file_upload_failed';
      } else if (errorMessage.includes('submit')) {
        errorCategory = 'form_submit_error';
      } else if (errorMessage.includes('rate') || errorMessage.includes('limit')) {
        errorCategory = 'rate_limited';
      }

      const attempt = tracker.completeAttempt(
        false,
        Date.now() - startTime,
        errorMessage,
        errorCategory
      );

      // Log the failed attempt
      if (attempt) {
        console.error('[AutoApply]', tracker.createSummary(attempt));
        await logApplicationAttempt(attempt);
      }
    } finally {
      setLoading(false);
    }
  };

  // If there's an existing application, show status (unless hideStatus is true)
  if (application && !hideStatus) {
    return <ApplicationStatus application={application} compact onCancel={onCancelApplication} />;
  }

  // Already in the auto-apply queue — show its live state instead of the button,
  // so the job card mirrors the Auto-Apply tab.
  if (queuedStatus && QUEUED_LABEL[queuedStatus]) {
    const done = queuedStatus === 'submitted' || queuedStatus === 'applied';
    return (
      <a href="/applications?section=autoapply"
         className={cn('inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border',
           done ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700')}
         title="View in Applications → Auto-Apply">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {QUEUED_LABEL[queuedStatus]}
      </a>
    );
  }

  // Supported by the new auto-apply pipeline (12 ATS adapters).
  const isSupported = isAutoApplySupported(atsType);

  if (!isSupported) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-400 bg-gray-100 dark:bg-slate-700 dark:text-gray-500 rounded cursor-not-allowed"
        title="Auto-apply not available for this application"
        aria-label="Auto-apply not supported for this job"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Not Supported
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800',
        needsOptimization
          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-transparent hover:from-amber-600 hover:to-orange-600'
          : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
      aria-label={loading ? 'Starting auto-apply' : needsOptimization ? 'Optimize resume and auto-apply' : 'Auto-apply to this job'}
    >
      {loading ? (
        <>
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Starting...</span>
        </>
      ) : needsOptimization ? (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Optimize & Apply</span>
          {resumeScore && (
            <span className={cn(
              'ml-1 px-1 py-0.5 rounded text-[10px]',
              resumeScore.overall >= 50 ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'
            )}>
              {resumeScore.overall}%
            </span>
          )}
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Auto Apply</span>
        </>
      )}
    </button>
  );
}
