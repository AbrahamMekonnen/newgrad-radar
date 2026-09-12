'use client';

import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/utils';
import { PipelineStage, PIPELINE_STAGES } from '@/lib/types';

// Extended event type to include email-related events
export type ExtendedEventType =
  | 'stage_change'
  | 'note_added'
  | 'reminder_set'
  | 'interview_scheduled'
  | 'feedback_received'
  | 'email_detected'
  | 'offer_received';

export interface ApplicationEvent {
  id: string;
  application_id: string;
  event_type: ExtendedEventType;
  from_stage: PipelineStage | null;
  to_stage: PipelineStage | null;
  description: string | null;
  metadata: {
    email_subject?: string;
    email_snippet?: string;
    interview_date?: string;
    source?: 'manual' | 'email_parsing' | 'auto';
    [key: string]: unknown;
  } | null;
  created_at: string;
}

interface ApplicationTimelineProps {
  events: ApplicationEvent[];
  currentStage: PipelineStage;
}

// Progress stages in order (8 main stages, excluding rejected/withdrawn)
const PROGRESS_STAGES: PipelineStage[] = [
  'saved',
  'applied',
  'oa',
  'phone_screen',
  'technical',
  'onsite',
  'offer',
];

function getStageIndex(stage: PipelineStage): number {
  const index = PROGRESS_STAGES.indexOf(stage);
  return index >= 0 ? index : -1;
}

function getStageLabel(stage: PipelineStage): string {
  const stageConfig = PIPELINE_STAGES.find(s => s.value === stage);
  return stageConfig?.label || stage;
}

function StageProgressBar({ currentStage }: { currentStage: PipelineStage }) {
  const currentIndex = getStageIndex(currentStage);
  const isTerminal = currentStage === 'rejected' || currentStage === 'withdrawn';

  return (
    <div className="mb-8">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
        Application Progress
      </h3>

      {/* Desktop: Horizontal */}
      <div className="hidden sm:block">
        <div className="relative">
          {/* Progress line */}
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-200 dark:bg-gray-700" />
          <div
            className={cn(
              'absolute top-4 left-4 h-0.5 transition-all duration-500',
              isTerminal ? 'bg-red-400' : 'bg-green-500'
            )}
            style={{
              width: `calc(${Math.max(0, currentIndex) / (PROGRESS_STAGES.length - 1)} * (100% - 32px))`,
            }}
          />

          {/* Stage circles */}
          <div className="relative flex justify-between">
            {PROGRESS_STAGES.map((stage, index) => {
              const isCompleted = index < currentIndex;
              const isCurrent = stage === currentStage;
              const isFuture = index > currentIndex;

              return (
                <div key={stage} className="flex flex-col items-center">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
                      'border-2',
                      isCompleted && 'bg-green-500 border-green-500',
                      isCurrent && !isTerminal && 'bg-blue-500 border-blue-500 ring-4 ring-blue-500/20',
                      isCurrent && isTerminal && 'bg-red-500 border-red-500 ring-4 ring-red-500/20',
                      isFuture && 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                    )}
                  >
                    {isCompleted && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {isCurrent && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                    {isFuture && (
                      <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                        {index + 1}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'mt-2 text-xs font-medium whitespace-nowrap',
                      isCompleted && 'text-green-600 dark:text-green-400',
                      isCurrent && !isTerminal && 'text-blue-600 dark:text-blue-400',
                      isCurrent && isTerminal && 'text-red-600 dark:text-red-400',
                      isFuture && 'text-gray-400 dark:text-gray-500'
                    )}
                  >
                    {getStageLabel(stage)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile: Compact */}
      <div className="sm:hidden">
        <div className="flex items-center space-x-1">
          {PROGRESS_STAGES.map((stage, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = stage === currentStage;

            return (
              <div key={stage} className="flex-1">
                <div
                  className={cn(
                    'h-2 rounded-full transition-all duration-300',
                    isCompleted && 'bg-green-500',
                    isCurrent && !isTerminal && 'bg-blue-500',
                    isCurrent && isTerminal && 'bg-red-500',
                    !isCompleted && !isCurrent && 'bg-gray-200 dark:bg-gray-700'
                  )}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-center">
          <span className={cn(
            'text-sm font-medium',
            isTerminal ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
          )}>
            {getStageLabel(currentStage)}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {' '}({currentIndex + 1}/{PROGRESS_STAGES.length})
          </span>
        </div>
      </div>
    </div>
  );
}

function getEventTitle(event: ApplicationEvent): string {
  switch (event.event_type) {
    case 'stage_change':
      const fromLabel = event.from_stage ? getStageLabel(event.from_stage) : 'Start';
      const toLabel = event.to_stage ? getStageLabel(event.to_stage) : 'Unknown';
      return `Moved from ${fromLabel} to ${toLabel}`;
    case 'email_detected':
      const subject = event.metadata?.email_subject || 'New email';
      return `Email detected: ${subject}`;
    case 'interview_scheduled':
      const date = event.metadata?.interview_date
        ? new Date(event.metadata.interview_date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'TBD';
      return `Interview scheduled for ${date}`;
    case 'offer_received':
      return 'Offer received!';
    case 'note_added':
      return 'Note added';
    case 'reminder_set':
      return 'Reminder set';
    case 'feedback_received':
      return 'Feedback received';
    default:
      return event.description || 'Activity';
  }
}

function getEventIcon(eventType: ExtendedEventType): React.ReactNode {
  switch (eventType) {
    case 'stage_change':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      );
    case 'email_detected':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case 'interview_scheduled':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'offer_received':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'feedback_received':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function getEventColor(eventType: ExtendedEventType): {
  bg: string;
  border: string;
  icon: string;
} {
  switch (eventType) {
    case 'stage_change':
      return {
        bg: 'bg-blue-100 dark:bg-blue-900/30',
        border: 'border-blue-500',
        icon: 'text-blue-600 dark:text-blue-400',
      };
    case 'email_detected':
      return {
        bg: 'bg-purple-100 dark:bg-purple-900/30',
        border: 'border-purple-500',
        icon: 'text-purple-600 dark:text-purple-400',
      };
    case 'interview_scheduled':
      return {
        bg: 'bg-cyan-100 dark:bg-cyan-900/30',
        border: 'border-cyan-500',
        icon: 'text-cyan-600 dark:text-cyan-400',
      };
    case 'offer_received':
      return {
        bg: 'bg-green-100 dark:bg-green-900/30',
        border: 'border-green-500',
        icon: 'text-green-600 dark:text-green-400',
      };
    case 'feedback_received':
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        border: 'border-amber-500',
        icon: 'text-amber-600 dark:text-amber-400',
      };
    default:
      return {
        bg: 'bg-gray-100 dark:bg-gray-800',
        border: 'border-gray-400',
        icon: 'text-gray-600 dark:text-gray-400',
      };
  }
}

interface TimelineEventProps {
  event: ApplicationEvent;
  isLast: boolean;
}

function TimelineEvent({ event, isLast }: TimelineEventProps) {
  const colors = getEventColor(event.event_type);
  const isAutoDetected = event.metadata?.source === 'email_parsing';

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center',
            'border-2',
            colors.bg,
            colors.border,
            colors.icon
          )}
        >
          {getEventIcon(event.event_type)}
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[24px] bg-gray-200 dark:bg-gray-700 my-1" />
        )}
      </div>

      {/* Event content */}
      <div className={cn('flex-1 pb-4', !isLast && 'pb-6')}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {getEventTitle(event)}
            </h4>
            {event.description && event.event_type !== 'stage_change' && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {event.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAutoDetected && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-detected
              </span>
            )}
          </div>
        </div>

        {/* Email snippet */}
        {event.metadata?.email_snippet && (
          <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400 italic line-clamp-2">
              &quot;{event.metadata.email_snippet}&quot;
            </p>
          </div>
        )}

        {/* Timestamp and source */}
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{formatTimeAgo(event.created_at)}</span>
          {event.metadata?.source && event.metadata.source !== 'email_parsing' && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="capitalize">{event.metadata.source}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ApplicationTimeline({ events, currentStage }: ApplicationTimelineProps) {
  // Sort events by date, most recent first
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      {/* Stage progression */}
      <StageProgressBar currentStage={currentStage} />

      {/* Event timeline */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
          Activity Timeline
        </h3>

        {sortedEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-0">
            {sortedEvents.map((event, index) => (
              <TimelineEvent
                key={event.id}
                event={event}
                isLast={index === sortedEvents.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplicationTimeline;
