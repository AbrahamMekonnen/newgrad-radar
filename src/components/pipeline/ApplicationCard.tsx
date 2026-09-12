'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Application, PIPELINE_STAGES } from '@/lib/types';
import { formatTimeAgo, cn } from '@/lib/utils';

interface ApplicationCardProps {
  application: Application;
  onClick?: (application: Application) => void;
  isDragging?: boolean;
}

export function ApplicationCard({
  application,
  onClick,
  isDragging = false,
}: ApplicationCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: application.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const job = application.job;
  const stageConfig = PIPELINE_STAGES.find((s) => s.value === application.stage);

  // Calculate priority based on upcoming interviews
  const hasUpcomingInterview =
    application.next_step_date &&
    new Date(application.next_step_date) > new Date();
  const upcomingDate = hasUpcomingInterview
    ? new Date(application.next_step_date!)
    : null;

  // Priority border colors
  const getPriorityBorder = () => {
    if (!upcomingDate) return '';
    const now = new Date();
    const diffDays = Math.ceil(
      (upcomingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays <= 1) return 'border-l-4 border-l-red-500'; // Urgent - today/tomorrow
    if (diffDays <= 3) return 'border-l-4 border-l-amber-500'; // High - within 3 days
    return '';
  };

  // Format interview date
  const formatInterviewDate = (date: Date) => {
    const now = new Date();
    const diffDays = Math.ceil(
      (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const isCurrentlyDragging = isDragging || isSortableDragging;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick?.(application)}
      className={cn(
        'group bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-3 cursor-grab active:cursor-grabbing',
        'shadow-sm hover:shadow-md transition-all duration-200',
        'hover:border-indigo-300 dark:hover:border-indigo-600',
        getPriorityBorder(),
        isCurrentlyDragging && 'opacity-50 rotate-2 scale-105 shadow-lg'
      )}
    >
      {/* Company and Job Info */}
      <div className="flex items-start gap-2.5">
        {/* Company logo placeholder */}
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center shrink-0 ring-1 ring-gray-200/50 dark:ring-slate-600/50">
          <span className="text-sm font-bold bg-gradient-to-br from-gray-500 to-gray-600 dark:from-gray-300 dark:to-gray-400 bg-clip-text text-transparent">
            {job?.company_name?.charAt(0).toUpperCase() || '?'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-medium uppercase tracking-wide">
            {job?.company_name || 'Unknown Company'}
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight mt-0.5">
            {job?.title || 'Unknown Position'}
          </p>
        </div>
      </div>

      {/* Interview Badge */}
      {hasUpcomingInterview && upcomingDate && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
              Math.ceil(
                (upcomingDate.getTime() - new Date().getTime()) /
                  (1000 * 60 * 60 * 24)
              ) <= 1
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400'
            )}
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {formatInterviewDate(upcomingDate)}
          </span>
          {application.next_step && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {application.next_step}
            </span>
          )}
        </div>
      )}

      {/* Offer Details Badge */}
      {application.stage === 'offer' && application.salary_offered && (
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-100 to-green-100 dark:from-emerald-900/40 dark:to-green-900/40 text-emerald-700 dark:text-emerald-400">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            ${(application.salary_offered / 1000).toFixed(0)}K
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-100 dark:border-slate-700">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {application.applied_at
            ? `Applied ${formatTimeAgo(application.applied_at)}`
            : formatTimeAgo(application.created_at)}
        </span>

        <div className="flex items-center gap-1.5">
          {/* Notes indicator */}
          {application.notes && (
            <span
              className="text-gray-400 dark:text-gray-500 hover:text-indigo-500 dark:hover:text-indigo-400"
              title="Has notes"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>
            </span>
          )}

          {/* Referral indicator */}
          {application.referrer_name && (
            <span
              className="text-purple-400 dark:text-purple-500"
              title={`Referral: ${application.referrer_name}`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
