'use client';

import { useState } from 'react';
import {
  ApplicationLog,
  ApplicationStatus as AppStatus,
  APPLICATION_STATUS_COLORS,
  APPLICATION_STATUS_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface ApplicationStatusProps {
  application: ApplicationLog;
  compact?: boolean;
  onCancel?: (jobId: string) => Promise<void>;
}

export function ApplicationStatus({ application, compact = false, onCancel }: ApplicationStatusProps) {
  const [cancelling, setCancelling] = useState(false);
  const status = application.status as AppStatus;
  const colorClass = APPLICATION_STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
  const label = APPLICATION_STATUS_LABELS[status] || status;

  const canCancel = ['pending', 'filling', 'review'].includes(status);

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    setCancelling(true);
    try {
      await onCancel(application.job_id);
    } finally {
      setCancelling(false);
    }
  };

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1">
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            colorClass
          )}
        >
          {status === 'filling' && (
            <svg className="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          )}
          {label}
        </span>
        {canCancel && onCancel && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            title="Cancel application"
          >
            {cancelling ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg p-3', colorClass.replace('text-', 'border-').replace('bg-', 'bg-'))}>
      <div className="flex items-center gap-2">
        {status === 'pending' && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {status === 'filling' && (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {status === 'review' && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
        {status === 'submitted' && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === 'failed' && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="font-medium text-sm">{label}</span>
      </div>

      {application.error_message && status === 'failed' && (
        <p className="mt-1 text-xs opacity-80">{application.error_message}</p>
      )}

      {application.submitted_at && status === 'submitted' && (
        <p className="mt-1 text-xs opacity-80">
          Submitted {new Date(application.submitted_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
