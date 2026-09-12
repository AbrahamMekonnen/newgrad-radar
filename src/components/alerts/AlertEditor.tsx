'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn } from '@/lib/utils';
import {
  Tier,
  RoleType,
  DiversityTag,
  WorkMode,
  ExperienceLevel,
  TIER_LABELS,
  ROLE_LABELS,
  DIVERSITY_TAG_LABELS,
  WORK_MODE_LABELS,
  EXPERIENCE_LABELS,
} from '@/lib/types';

// Alert filter structure matching database JSONB
export interface AlertFilters {
  tiers?: Tier[];
  role_types?: RoleType[];
  experience_levels?: ExperienceLevel[];
  diversity_tags?: DiversityTag[];
  work_modes?: WorkMode[];
  locations?: string[];
  title_keywords?: string[];
  title_exclude?: string[];
  h1b_sponsor?: boolean;
}

export type DeliveryMode = 'instant' | 'daily_digest' | 'weekly_digest';

export interface JobAlert {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  delivery_mode: DeliveryMode;
  push_enabled: boolean;
  email_enabled: boolean;
  filters: AlertFilters;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

interface AlertEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (alert: Partial<JobAlert>) => Promise<void>;
  editingAlert?: JobAlert | null;
}

const ALL_TIERS: Tier[] = ['faang', 'ai', 'unicorn', 'yc', 'fintech', 'infra'];
const ALL_ROLES: RoleType[] = ['swe', 'ml', 'backend', 'frontend', 'fullstack', 'infra', 'data', 'security', 'mobile'];
const ALL_EXPERIENCE: ExperienceLevel[] = ['new_grad', 'entry_level', 'junior', 'mid', 'senior', 'staff', 'principal'];
const ALL_DIVERSITY_TAGS: DiversityTag[] = [
  'ghc_sponsor',
  'nsbe_sponsor',
  'shpe_sponsor',
  'tapia_sponsor',
  'afrotech_sponsor',
  'outtie_sponsor',
  'lesbians_who_tech_sponsor',
  'techqueria_sponsor',
  'diversity_focused',
];
const ALL_WORK_MODES: WorkMode[] = ['remote', 'hybrid', 'onsite', 'flexible'];

const DELIVERY_OPTIONS: { value: DeliveryMode; label: string; description: string }[] = [
  { value: 'instant', label: 'Instant', description: 'Get notified as soon as a job matches' },
  { value: 'daily_digest', label: 'Daily Digest', description: 'One email per day with all matches' },
  { value: 'weekly_digest', label: 'Weekly Digest', description: 'One email per week with all matches' },
];

export function AlertEditor({ isOpen, onClose, onSave, editingAlert }: AlertEditorProps) {
  const [name, setName] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('instant');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [filters, setFilters] = useState<AlertFilters>({});
  const [locationInput, setLocationInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [excludeInput, setExcludeInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form when editing alert changes
  useEffect(() => {
    if (editingAlert) {
      setName(editingAlert.name);
      setDeliveryMode(editingAlert.delivery_mode);
      setPushEnabled(editingAlert.push_enabled);
      setEmailEnabled(editingAlert.email_enabled);
      setFilters(editingAlert.filters || {});
    } else {
      setName('');
      setDeliveryMode('instant');
      setPushEnabled(true);
      setEmailEnabled(true);
      setFilters({});
    }
    setLocationInput('');
    setKeywordInput('');
    setExcludeInput('');
  }, [editingAlert, isOpen]);

  const toggleArrayFilter = <T extends string>(
    key: keyof AlertFilters,
    value: T
  ) => {
    const current = (filters[key] as T[] | undefined) || [];
    if (current.includes(value)) {
      setFilters({
        ...filters,
        [key]: current.filter((v) => v !== value),
      });
    } else {
      setFilters({
        ...filters,
        [key]: [...current, value],
      });
    }
  };

  const addStringToArray = (key: keyof AlertFilters, value: string) => {
    if (!value.trim()) return;
    const current = (filters[key] as string[] | undefined) || [];
    if (!current.includes(value.trim())) {
      setFilters({
        ...filters,
        [key]: [...current, value.trim()],
      });
    }
  };

  const removeStringFromArray = (key: keyof AlertFilters, value: string) => {
    const current = (filters[key] as string[] | undefined) || [];
    setFilters({
      ...filters,
      [key]: current.filter((v) => v !== value),
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...(editingAlert ? { id: editingAlert.id } : {}),
        name: name.trim(),
        delivery_mode: deliveryMode,
        push_enabled: pushEnabled,
        email_enabled: emailEnabled,
        filters,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const renderChipSelector = <T extends string>(
    items: T[],
    selected: T[],
    labels: Record<T, string>,
    onToggle: (value: T) => void
  ) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onToggle(item)}
          className={cn(
            'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
            selected.includes(item)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          )}
        >
          {labels[item]}
        </button>
      ))}
    </div>
  );

  const renderTagChips = (items: string[], onRemove: (value: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
        >
          {item}
          <button
            type="button"
            onClick={() => onRemove(item)}
            className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
            aria-label={`Remove ${item}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingAlert ? 'Edit Alert' : 'Create Alert'}
      className="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <div className="space-y-6">
        {/* Alert Name */}
        <Input
          label="Alert Name"
          id="alert-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., AI Engineer at Top Companies"
        />

        {/* Company Tiers */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Company Tiers
          </label>
          {renderChipSelector(
            ALL_TIERS,
            filters.tiers || [],
            TIER_LABELS,
            (tier) => toggleArrayFilter('tiers', tier)
          )}
        </div>

        {/* Role Types */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Role Types
          </label>
          {renderChipSelector(
            ALL_ROLES,
            filters.role_types || [],
            ROLE_LABELS,
            (role) => toggleArrayFilter('role_types', role)
          )}
        </div>

        {/* Experience Level */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Experience Level
          </label>
          {renderChipSelector(
            ALL_EXPERIENCE,
            filters.experience_levels || [],
            EXPERIENCE_LABELS,
            (level) => toggleArrayFilter('experience_levels', level)
          )}
        </div>

        {/* Diversity Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Diversity Programs
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_DIVERSITY_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleArrayFilter('diversity_tags', tag)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  (filters.diversity_tags || []).includes(tag)
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                )}
              >
                {DIVERSITY_TAG_LABELS[tag]}
              </button>
            ))}
          </div>
        </div>

        {/* Work Modes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Work Mode
          </label>
          {renderChipSelector(
            ALL_WORK_MODES,
            filters.work_modes || [],
            WORK_MODE_LABELS,
            (mode) => toggleArrayFilter('work_modes', mode)
          )}
        </div>

        {/* Locations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Locations
          </label>
          <div className="flex gap-2 mb-2">
            <Input
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              placeholder="e.g., San Francisco"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStringToArray('locations', locationInput);
                  setLocationInput('');
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                addStringToArray('locations', locationInput);
                setLocationInput('');
              }}
            >
              Add
            </Button>
          </div>
          {(filters.locations?.length || 0) > 0 && renderTagChips(
            filters.locations || [],
            (val) => removeStringFromArray('locations', val)
          )}
        </div>

        {/* Title Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Title Keywords (Include)
          </label>
          <div className="flex gap-2 mb-2">
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="e.g., engineer, developer"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStringToArray('title_keywords', keywordInput);
                  setKeywordInput('');
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                addStringToArray('title_keywords', keywordInput);
                setKeywordInput('');
              }}
            >
              Add
            </Button>
          </div>
          {(filters.title_keywords?.length || 0) > 0 && renderTagChips(
            filters.title_keywords || [],
            (val) => removeStringFromArray('title_keywords', val)
          )}
        </div>

        {/* Title Exclude */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Title Exclude (Keywords to avoid)
          </label>
          <div className="flex gap-2 mb-2">
            <Input
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              placeholder="e.g., senior, staff, principal"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStringToArray('title_exclude', excludeInput);
                  setExcludeInput('');
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                addStringToArray('title_exclude', excludeInput);
                setExcludeInput('');
              }}
            >
              Add
            </Button>
          </div>
          {(filters.title_exclude?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {(filters.title_exclude || []).map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                >
                  {item}
                  <button
                    type="button"
                    onClick={() => removeStringFromArray('title_exclude', item)}
                    className="hover:bg-red-200 dark:hover:bg-red-800 rounded-full p-0.5"
                    aria-label={`Remove ${item}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* H1B Sponsor */}
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <Checkbox
            label="Only jobs that sponsor H1B visas"
            checked={filters.h1b_sponsor || false}
            onChange={(checked) => setFilters({ ...filters, h1b_sponsor: checked || undefined })}
          />
        </div>

        {/* Delivery Mode */}
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Delivery Mode
          </label>
          <div className="space-y-3">
            {DELIVERY_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="deliveryMode"
                  value={option.value}
                  checked={deliveryMode === option.value}
                  onChange={() => setDeliveryMode(option.value)}
                  className="w-4 h-4 mt-0.5 text-blue-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {option.label}
                  </span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Notification Channels */}
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Notification Channels
          </label>
          <div className="space-y-2">
            <Checkbox
              label="Push notifications"
              checked={pushEnabled}
              onChange={setPushEnabled}
            />
            <Checkbox
              label="Email notifications"
              checked={emailEnabled}
              onChange={setEmailEnabled}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : editingAlert ? 'Update Alert' : 'Create Alert'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
