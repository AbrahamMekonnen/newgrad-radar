'use client';

import { useState, useEffect, useMemo } from 'react';
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

interface BulkFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCompanies: Company[];
  existingFilters?: Record<string, JobFilters>;
  onApply: (slugs: string[], filters: JobFilters) => Promise<void>;
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

// Inner content component
function BulkFilterContent({
  selectedCompanies,
  existingFilters = {},
  onClose,
  onApply,
}: Omit<BulkFilterModalProps, 'isOpen'>) {
  const [selectedRoles, setSelectedRoles] = useState<Set<RoleType>>(new Set());
  const [selectedExperience, setSelectedExperience] = useState<Set<ExperienceLevel>>(new Set());
  const [titleKeywords, setTitleKeywords] = useState('');
  const [titleExclude, setTitleExclude] = useState(DEFAULT_TITLE_EXCLUDE.join(', '));
  const [copyFromCompany, setCopyFromCompany] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Companies with existing filters
  const companiesWithFilters = useMemo(() =>
    selectedCompanies.filter(
      (c) => existingFilters[c.slug] && Object.keys(existingFilters[c.slug]).length > 0
    ),
    [selectedCompanies, existingFilters]
  );

  // Copy filters from existing company when selection changes
  const handleCopyFrom = (slug: string | null) => {
    setCopyFromCompany(slug);
    if (slug && existingFilters[slug]) {
      const filters = existingFilters[slug];
      setSelectedRoles(new Set(filters.role_types || []));
      setSelectedExperience(new Set(filters.experience_levels || []));
      setTitleKeywords((filters.title_keywords || []).join(', '));
      setTitleExclude((filters.title_exclude || DEFAULT_TITLE_EXCLUDE).join(', '));
    } else {
      // Reset to defaults
      setSelectedRoles(new Set());
      setSelectedExperience(new Set());
      setTitleKeywords('');
      setTitleExclude(DEFAULT_TITLE_EXCLUDE.join(', '));
    }
  };

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

  const handleApply = async () => {
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

    const slugs = selectedCompanies.map((c) => c.slug);

    try {
      await onApply(slugs, filters);
      onClose();
    } catch (error) {
      console.error('Failed to apply filters:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleClearFilters = async () => {
    setSaving(true);
    const slugs = selectedCompanies.map((c) => c.slug);
    try {
      await onApply(slugs, {});
      onClose();
    } catch (error) {
      console.error('Failed to clear filters:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Selected companies list */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium mb-2">
          Applying filters to:
        </p>
        <div className="flex flex-wrap gap-2">
          {selectedCompanies.map((company) => (
            <span
              key={company.slug}
              className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-blue-900/40 rounded text-xs text-gray-700 dark:text-gray-300"
            >
              {company.name}
              {existingFilters[company.slug] && (
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" title="Has existing filters" />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Copy from existing company */}
      {companiesWithFilters.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Copy filters from:
          </label>
          <select
            value={copyFromCompany || ''}
            onChange={(e) => handleCopyFrom(e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="">Start fresh</option>
            {companiesWithFilters.map((company) => (
              <option key={company.slug} value={company.slug}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Role Types */}
      <div>
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
          Role Types
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Only notify about these role types (leave empty for all)
        </p>
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
          Experience Levels
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
        placeholder="e.g., engineer, developer, SDE"
      />

      {/* Title Exclude */}
      <Input
        label="Exclude titles containing"
        value={titleExclude}
        onChange={(e) => setTitleExclude(e.target.value)}
        placeholder="e.g., senior, staff, principal"
      />

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleClearFilters}
          className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Clear all filters
        </button>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply} disabled={saving}>
            {saving ? 'Applying...' : `Apply to ${selectedCompanies.length} Companies`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BulkFilterModal({
  isOpen,
  onClose,
  selectedCompanies,
  existingFilters = {},
  onApply,
}: BulkFilterModalProps) {
  // Generate a key from selected company slugs to reset state when selection changes
  const contentKey = selectedCompanies.map((c) => c.slug).sort().join(',');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Apply Filters to ${selectedCompanies.length} Companies`}
      className="max-w-lg"
    >
      {/* Key forces re-mount and state reset when selection changes */}
      <BulkFilterContent
        key={contentKey}
        selectedCompanies={selectedCompanies}
        existingFilters={existingFilters}
        onClose={onClose}
        onApply={onApply}
      />
    </Modal>
  );
}
