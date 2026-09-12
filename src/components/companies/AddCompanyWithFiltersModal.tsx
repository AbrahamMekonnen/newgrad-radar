'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import {
  Company,
  JobFilters,
  RoleType,
  ExperienceLevel,
  ROLE_LABELS,
  EXPERIENCE_LABELS,
  DEFAULT_TITLE_EXCLUDE,
} from '@/lib/types';

interface AddCompanyWithFiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  company: Company | null;
  onSubmit: (
    slug: string,
    filters: JobFilters,
    options: { autoApply?: boolean; notifyEnabled?: boolean }
  ) => Promise<void>;
}

const ROLE_OPTIONS: { value: RoleType; label: string }[] = [
  { value: 'swe', label: ROLE_LABELS.swe },
  { value: 'ml', label: ROLE_LABELS.ml },
  { value: 'backend', label: ROLE_LABELS.backend },
  { value: 'frontend', label: ROLE_LABELS.frontend },
  { value: 'fullstack', label: ROLE_LABELS.fullstack },
  { value: 'infra', label: ROLE_LABELS.infra },
  { value: 'data', label: ROLE_LABELS.data },
  { value: 'security', label: ROLE_LABELS.security },
  { value: 'mobile', label: ROLE_LABELS.mobile },
];

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'new_grad', label: EXPERIENCE_LABELS.new_grad },
  { value: 'entry_level', label: EXPERIENCE_LABELS.entry_level },
  { value: 'junior', label: EXPERIENCE_LABELS.junior },
];

// Inner content component that resets state via key when company changes
function AddCompanyWithFiltersContent({
  company,
  onClose,
  onSubmit,
}: {
  company: Company;
  onClose: () => void;
  onSubmit: (
    slug: string,
    filters: JobFilters,
    options: { autoApply?: boolean; notifyEnabled?: boolean }
  ) => Promise<void>;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<Set<RoleType>>(new Set());
  const [selectedExperience, setSelectedExperience] = useState<Set<ExperienceLevel>>(new Set());
  const [titleKeywords, setTitleKeywords] = useState('');
  const [titleExclude, setTitleExclude] = useState(DEFAULT_TITLE_EXCLUDE.join(', '));
  const [autoApply, setAutoApply] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleRoleToggle = (role: RoleType) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  const handleExperienceToggle = (level: ExperienceLevel) => {
    setSelectedExperience((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const parseCommaSeparated = (value: string): string[] => {
    return value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  };

  const handleQuickAdd = async () => {
    setSaving(true);
    try {
      await onSubmit(company.slug, {}, { autoApply, notifyEnabled });
      onClose();
    } catch (error) {
      console.error('Failed to add company:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddWithFilters = async () => {
    setSaving(true);

    const filters: JobFilters = {};

    if (selectedRoles.size > 0) {
      filters.role_types = Array.from(selectedRoles);
    }

    if (selectedExperience.size > 0) {
      filters.experience_levels = Array.from(selectedExperience);
    }

    const keywords = parseCommaSeparated(titleKeywords);
    if (keywords.length > 0) {
      filters.title_keywords = keywords;
    }

    const exclude = parseCommaSeparated(titleExclude);
    if (exclude.length > 0) {
      filters.title_exclude = exclude;
    }

    try {
      await onSubmit(company.slug, filters, { autoApply, notifyEnabled });
      onClose();
    } catch (error) {
      console.error('Failed to add company:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick info */}
      <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <p className="font-medium text-gray-900 dark:text-white">{company.name}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Get notified about new job postings
        </p>
      </div>

      {/* Quick options */}
      <div className="space-y-2">
        <Checkbox
          label="Enable notifications for new jobs"
          checked={notifyEnabled}
          onChange={setNotifyEnabled}
        />
        <Checkbox
          label="Auto-apply to matching jobs"
          checked={autoApply}
          onChange={setAutoApply}
        />
      </div>

      {/* Advanced filters toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {showAdvanced ? 'Hide filters' : 'Add job filters (optional)'}
      </button>

      {showAdvanced && (
        <div className="space-y-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          {/* Role Types */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Only notify me about these roles
            </h4>
            <div className="grid grid-cols-2 gap-1">
              {ROLE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  label={option.label}
                  checked={selectedRoles.has(option.value)}
                  onChange={() => handleRoleToggle(option.value)}
                />
              ))}
            </div>
          </div>

          {/* Experience Levels */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Experience levels
            </h4>
            <div className="grid grid-cols-2 gap-1">
              {EXPERIENCE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  label={option.label}
                  checked={selectedExperience.has(option.value)}
                  onChange={() => handleExperienceToggle(option.value)}
                />
              ))}
            </div>
          </div>

          {/* Title Keywords */}
          <Input
            label="Title must contain (comma-separated)"
            value={titleKeywords}
            onChange={(e) => setTitleKeywords(e.target.value)}
            placeholder="e.g., engineer, developer"
          />

          {/* Title Exclude */}
          <Input
            label="Exclude titles containing"
            value={titleExclude}
            onChange={(e) => setTitleExclude(e.target.value)}
            placeholder="e.g., senior, staff"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={saving}
          className="flex-1"
        >
          Cancel
        </Button>
        {!showAdvanced ? (
          <Button
            variant="primary"
            onClick={handleQuickAdd}
            disabled={saving}
            className="flex-1"
          >
            {saving ? 'Adding...' : 'Add to My List'}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={handleAddWithFilters}
            disabled={saving}
            className="flex-1"
          >
            {saving ? 'Adding...' : 'Add with Filters'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AddCompanyWithFiltersModal({
  isOpen,
  onClose,
  company,
  onSubmit,
}: AddCompanyWithFiltersModalProps) {
  if (!company) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add ${company.name}`}
      className="max-w-lg"
    >
      {/* Key forces re-mount and state reset when company changes */}
      <AddCompanyWithFiltersContent
        key={company.slug}
        company={company}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
