'use client';

import { useState } from 'react';
import { SavedJob, Job, TIER_COLORS, TIER_LABELS, Tier } from '@/lib/types';
import { formatTimeAgo, cn } from '@/lib/utils';
import { formatDeadline, isDeadlinePassed } from '@/lib/deadline-detector';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatusDropdown } from './StatusDropdown';
import { NotesModal } from './NotesModal';

interface SavedJobCardProps {
  savedJob: SavedJob & { job: Job };
  onStatusChange: (id: string, status: SavedJob['status']) => void;
  onNotesUpdate: (id: string, notes: string) => void;
  onRemove: (id: string) => void;
}

export function SavedJobCard({ savedJob, onStatusChange, onNotesUpdate, onRemove }: SavedJobCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const { job } = savedJob;
  const tier = job.tier as Tier;
  const tierColor = TIER_COLORS[tier] || 'bg-gray-600';
  const tierLabel = TIER_LABELS[tier] || job.tier;

  // Calculate deadline urgency
  const getDeadlineInfo = () => {
    if (!job.deadline) return null;
    if (isDeadlinePassed(job.deadline)) return { label: 'Deadline passed', color: 'bg-gray-400 text-white', urgent: false };

    const deadlineDate = new Date(job.deadline);
    const now = new Date();
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { label: 'Due today!', color: 'bg-red-600 text-white', urgent: true };
    if (diffDays === 1) return { label: 'Closes tomorrow', color: 'bg-red-500 text-white', urgent: true };
    if (diffDays < 3) return { label: `Closes in ${diffDays} days`, color: 'bg-red-500 text-white', urgent: true };
    if (diffDays < 7) return { label: `Closes in ${diffDays} days`, color: 'bg-yellow-500 text-white', urgent: false };
    return { label: formatDeadline(job.deadline), color: 'bg-gray-200 text-gray-700', urgent: false };
  };

  const deadlineInfo = getDeadlineInfo();

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex items-start gap-3">
          {/* Company logo placeholder */}
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-gray-400 dark:text-gray-300">
              {job.company_name.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-500 dark:text-gray-400">{job.company_name}</p>
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2"
            >
              {job.title}
            </a>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {job.location && (
                <span className="text-sm text-gray-500 dark:text-gray-400">{job.location}</span>
              )}
              <Badge className={tierColor}>{tierLabel}</Badge>
              {deadlineInfo && (
                <Badge className={cn(deadlineInfo.color, deadlineInfo.urgent && 'animate-pulse')}>
                  {deadlineInfo.label}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Status and actions */}
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <StatusDropdown
                value={savedJob.status}
                onChange={(status) => onStatusChange(savedJob.id, status)}
              />
              {savedJob.applied_at && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Applied {formatTimeAgo(savedJob.applied_at)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNotes(true)}
                title="Notes"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {savedJob.notes && <span className="ml-1 w-2 h-2 bg-blue-500 rounded-full" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(savedJob.id)}
                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => window.open(job.apply_url || job.url, '_blank')}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </div>

      <NotesModal
        isOpen={showNotes}
        onClose={() => setShowNotes(false)}
        initialNotes={savedJob.notes || ''}
        onSave={(notes) => onNotesUpdate(savedJob.id, notes)}
        jobTitle={job.title}
      />
    </>
  );
}
