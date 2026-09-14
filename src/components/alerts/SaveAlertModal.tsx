'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import {
  Tier,
  RoleType,
  SponsorshipStatus,
  FundingFilter,
  SourceFilter,
  LocationFilter,
  ExperienceLevel,
  DiversityTag,
  WorkMode,
  BadgeTag,
  SmartFilter,
  DeliveryMode,
  DELIVERY_MODE_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AlertFilters {
  search?: string;
  tiers?: Tier[];
  roles?: RoleType[];
  locations?: LocationFilter[];
  sponsorshipFilter?: SponsorshipStatus | null;
  fundingStages?: FundingFilter[];
  sources?: SourceFilter[];
  salaryMin?: number | null;
  salaryMax?: number | null;
  hasRecruiters?: boolean;
  smartFilters?: SmartFilter[];
  experienceLevels?: ExperienceLevel[];
  diversityTags?: DiversityTag[];
  workModes?: WorkMode[];
  badges?: BadgeTag[];
}

interface SaveAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: AlertFilters;
  onSuccess?: () => void;
}

export function SaveAlertModal({
  isOpen,
  onClose,
  filters,
  onSuccess,
}: SaveAlertModalProps) {
  const [alertName, setAlertName] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('daily_digest');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleSave = async () => {
    if (!alertName.trim()) {
      setError('Please enter an alert name');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('Please log in to save alerts');
        setSaving(false);
        return;
      }

      // Clean up filters - remove empty arrays and null values
      // Note: Database uses snake_case field names (role_types, experience_levels, etc.)
      const cleanFilters: Record<string, unknown> = {};
      if (filters.search?.trim()) cleanFilters.search = filters.search;
      if (filters.tiers?.length) cleanFilters.tiers = filters.tiers;
      if (filters.roles?.length) cleanFilters.role_types = filters.roles;
      if (filters.sponsorshipFilter === 'sponsors') cleanFilters.h1b_sponsor = true;
      if (filters.fundingStages?.length) cleanFilters.fundingStages = filters.fundingStages;
      if (filters.sources?.length) cleanFilters.sources = filters.sources;
      if (filters.salaryMin !== null && filters.salaryMin !== undefined) cleanFilters.salary_min = filters.salaryMin;
      if (filters.salaryMax !== null && filters.salaryMax !== undefined) cleanFilters.salaryMax = filters.salaryMax;
      if (filters.hasRecruiters) cleanFilters.hasRecruiters = true;
      if (filters.smartFilters?.length) cleanFilters.smartFilters = filters.smartFilters;
      if (filters.experienceLevels && filters.experienceLevels.length > 0) cleanFilters.experience_levels = filters.experienceLevels;
      if (filters.diversityTags?.length) cleanFilters.diversity_tags = filters.diversityTags;
      if (filters.workModes?.length) cleanFilters.work_modes = filters.workModes;
      if (filters.badges?.length) cleanFilters.badges = filters.badges;

      const { error: insertError } = await supabase.from('job_alerts').insert({
        user_id: user.id,
        name: alertName.trim(),
        is_active: true,
        delivery_mode: deliveryMode,
        push_enabled: pushEnabled,
        email_enabled: emailEnabled,
        filters: cleanFilters,
        trigger_count: 0,
      });

      if (insertError) {
        console.error('Error saving alert:', insertError);
        // Show more specific error messages
        if (insertError.code === '42P01') {
          setError('Alert system not configured. Please contact support.');
        } else if (insertError.code === '42501') {
          setError('Permission denied. Please log out and log back in.');
        } else if (insertError.code === '23505') {
          setError('An alert with this name already exists.');
        } else {
          setError(`Failed to save alert: ${insertError.message || insertError.code || 'Unknown error'}`);
        }
        setSaving(false);
        return;
      }

      // Success - reset form and close
      setSaving(false);
      setAlertName('');
      setDeliveryMode('daily_digest');
      setPushEnabled(true);
      setEmailEnabled(true);
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Unexpected error saving alert:', err);
      setError('An unexpected error occurred');
      setSaving(false);
    }
  };

  const getFilterSummary = (): string[] => {
    const summary: string[] = [];
    if (filters.search?.trim()) summary.push(`Search: "${filters.search}"`);
    if (filters.tiers?.length) summary.push(`${filters.tiers.length} tier(s)`);
    if (filters.roles?.length) summary.push(`${filters.roles.length} role(s)`);
    if (filters.sponsorshipFilter) summary.push('Sponsorship filter');
    if (filters.smartFilters?.length) summary.push(`${filters.smartFilters.length} smart filter(s)`);
    if (filters.experienceLevels && filters.experienceLevels.length > 0) summary.push('Experience level');
    if (filters.workModes?.length) summary.push(`${filters.workModes.length} work mode(s)`);
    if (filters.diversityTags?.length) summary.push(`${filters.diversityTags.length} diversity tag(s)`);
    if (filters.salaryMin || filters.salaryMax) summary.push('Salary range');
    if (filters.hasRecruiters) summary.push('Has recruiters');
    return summary;
  };

  if (!isOpen) return null;

  const filterSummary = getFilterSummary();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-alert-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2
            id="save-alert-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            Save as Alert
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Filter Summary */}
        <div className="mb-4 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Filters included:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {filterSummary.map((item, i) => (
              <span
                key={i}
                className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Alert Name */}
        <div className="mb-4">
          <label
            htmlFor="alert-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Alert Name
          </label>
          <input
            id="alert-name"
            type="text"
            placeholder="e.g., Remote ML Jobs at FAANG"
            value={alertName}
            onChange={(e) => setAlertName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />
        </div>

        {/* Delivery Mode */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Delivery Frequency
          </label>
          <div className="flex gap-2">
            {(['instant', 'daily_digest', 'weekly_digest'] as DeliveryMode[]).map(
              (mode) => (
                <button
                  key={mode}
                  onClick={() => setDeliveryMode(mode)}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                    deliveryMode === mode
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                  )}
                >
                  {DELIVERY_MODE_LABELS[mode]}
                </button>
              )
            )}
          </div>
        </div>

        {/* Notification Channels */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Notification Channels
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={pushEnabled}
                onChange={(e) => setPushEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Push notifications
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Email notifications
              </span>
            </label>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            className="flex-1"
          >
            {saving ? 'Saving...' : 'Save Alert'}
          </Button>
        </div>
      </div>
    </div>
  );
}
