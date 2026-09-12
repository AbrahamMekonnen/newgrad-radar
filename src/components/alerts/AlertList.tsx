'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { JobAlert, AlertFilters } from './AlertEditor';
import {
  TIER_LABELS,
  ROLE_LABELS,
  DIVERSITY_TAG_LABELS,
  WORK_MODE_LABELS,
  EXPERIENCE_LABELS,
  Tier,
  RoleType,
  DiversityTag,
  WorkMode,
  ExperienceLevel,
} from '@/lib/types';

interface AlertListProps {
  alerts: JobAlert[];
  onEdit: (alert: JobAlert) => void;
  onDelete: (alertId: string) => void;
  onToggle: (alertId: string, isActive: boolean) => void;
  loading?: boolean;
}

function formatDeliveryMode(mode: string): string {
  switch (mode) {
    case 'instant':
      return 'Instant';
    case 'daily_digest':
      return 'Daily';
    case 'weekly_digest':
      return 'Weekly';
    default:
      return mode;
  }
}

function formatFilters(filters: AlertFilters): string {
  const parts: string[] = [];

  if (filters.tiers?.length) {
    parts.push(filters.tiers.map((t) => TIER_LABELS[t as Tier]).join(', '));
  }
  if (filters.role_types?.length) {
    parts.push(filters.role_types.map((r) => ROLE_LABELS[r as RoleType]).join(', '));
  }
  if (filters.experience_levels?.length) {
    parts.push(filters.experience_levels.map((e) => EXPERIENCE_LABELS[e as ExperienceLevel]).join(', '));
  }
  if (filters.diversity_tags?.length) {
    parts.push(filters.diversity_tags.map((d) => DIVERSITY_TAG_LABELS[d as DiversityTag]).join(', '));
  }
  if (filters.work_modes?.length) {
    parts.push(filters.work_modes.map((w) => WORK_MODE_LABELS[w as WorkMode]).join(', '));
  }
  if (filters.locations?.length) {
    parts.push(filters.locations.join(', '));
  }
  if (filters.title_keywords?.length) {
    parts.push(`Keywords: ${filters.title_keywords.join(', ')}`);
  }
  if (filters.title_exclude?.length) {
    parts.push(`Exclude: ${filters.title_exclude.join(', ')}`);
  }
  if (filters.h1b_sponsor) {
    parts.push('H1B Sponsor');
  }

  return parts.length > 0 ? parts.join(' | ') : 'All jobs';
}

function formatLastTriggered(date: string | null): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function AlertList({
  alerts,
  onEdit,
  onDelete,
  onToggle,
  loading,
}: AlertListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4"
          >
            <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3 mb-3" />
            <div className="flex gap-2">
              <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-16" />
              <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
          No alerts yet
        </h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Create your first alert to get notified when matching jobs are posted.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            'bg-white dark:bg-slate-800 rounded-lg border p-4 transition-colors',
            alert.is_active
              ? 'border-gray-200 dark:border-slate-700'
              : 'border-gray-200 dark:border-slate-700 opacity-60'
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-medium text-gray-900 dark:text-white truncate">
                  {alert.name}
                </h3>
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                    alert.is_active
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400'
                  )}
                >
                  {alert.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {formatFilters(alert.filters)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {formatDeliveryMode(alert.delivery_mode)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {alert.trigger_count} matches
                </span>
                <span className="inline-flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Last: {formatLastTriggered(alert.last_triggered_at)}
                </span>
                {alert.push_enabled && (
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                    Push
                  </span>
                )}
                {alert.email_enabled && (
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    Email
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggle(alert.id, !alert.is_active)}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800',
                  alert.is_active ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'
                )}
                role="switch"
                aria-checked={alert.is_active}
                aria-label={`${alert.is_active ? 'Disable' : 'Enable'} alert`}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    alert.is_active ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(alert)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm('Are you sure you want to delete this alert?')) {
                    onDelete(alert.id);
                  }
                }}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
