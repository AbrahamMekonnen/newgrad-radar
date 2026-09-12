'use client';

import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Application, PipelineStage, PIPELINE_STAGES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ApplicationCard } from './ApplicationCard';

interface KanbanColumnProps {
  stage: PipelineStage;
  applications: Application[];
  onApplicationClick?: (application: Application) => void;
  isDraggingActive?: boolean;
}

export function KanbanColumn({
  stage,
  applications,
  onApplicationClick,
  isDraggingActive = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage,
  });

  const stageConfig = PIPELINE_STAGES.find((s) => s.value === stage);
  if (!stageConfig) return null;

  // Count upcoming interviews in this stage
  const upcomingInterviews = applications.filter((app) => {
    if (!app.next_step_date) return false;
    return new Date(app.next_step_date) > new Date();
  }).length;

  // Get icon SVG path based on stage
  const getIconPath = (icon: string) => {
    switch (icon) {
      case 'bookmark':
        return 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z';
      case 'send':
        return 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8';
      case 'code':
        return 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4';
      case 'phone':
        return 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z';
      case 'terminal':
        return 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z';
      case 'building':
        return 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4';
      case 'check-circle':
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'x-circle':
        return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'arrow-left':
        return 'M10 19l-7-7m0 0l7-7m-7 7h18';
      default:
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] bg-gray-50 dark:bg-slate-900/50 rounded-xl border transition-all duration-200',
        isOver
          ? 'border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-900/20'
          : 'border-gray-200 dark:border-slate-700'
      )}
    >
      {/* Column Header */}
      <div
        className={cn(
          'p-3 rounded-t-xl border-b',
          stageConfig.bgColor,
          'border-gray-200 dark:border-slate-700'
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className={cn('w-4 h-4', stageConfig.color)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={getIconPath(stageConfig.icon)}
              />
            </svg>
            <h3 className={cn('text-sm font-semibold', stageConfig.color)}>
              {stageConfig.label}
            </h3>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Upcoming interviews badge */}
            {upcomingInterviews > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                <svg
                  className="w-2.5 h-2.5"
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
                {upcomingInterviews}
              </span>
            )}

            {/* Application count badge */}
            <span
              className={cn(
                'inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold',
                applications.length > 0
                  ? `${stageConfig.bgColor} ${stageConfig.color}`
                  : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
              )}
            >
              {applications.length}
            </span>
          </div>
        </div>
      </div>

      {/* Column Content */}
      <div className="flex-1 p-2 overflow-y-auto max-h-[calc(100vh-200px)]">
        <SortableContext
          items={applications.map((app) => app.id)}
          strategy={verticalListSortingStrategy}
        >
          {applications.length > 0 ? (
            <div className="space-y-2">
              {applications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  onClick={onApplicationClick}
                />
              ))}
            </div>
          ) : (
            <div
              className={cn(
                'flex flex-col items-center justify-center py-8 px-4 text-center rounded-lg border-2 border-dashed transition-all duration-200',
                isDraggingActive
                  ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/20'
                  : 'border-gray-200 dark:border-slate-700'
              )}
            >
              {isDraggingActive ? (
                <>
                  <svg
                    className="w-8 h-8 text-indigo-400 dark:text-indigo-500 mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                  </svg>
                  <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                    Drop here
                  </p>
                </>
              ) : (
                <>
                  <svg
                    className={cn('w-8 h-8 mb-2 opacity-40', stageConfig.color)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={getIconPath(stageConfig.icon)}
                    />
                  </svg>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No applications
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {stageConfig.description}
                  </p>
                </>
              )}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
