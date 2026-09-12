'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import {
  JobFilters,
  RoleType,
  ExperienceLevel,
  ROLE_LABELS,
  EXPERIENCE_LABELS,
  DEFAULT_TITLE_EXCLUDE,
} from '@/lib/types';

interface CompanyFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyName: string;
  companySlug: string;
  initialFilters: JobFilters;
  onSave: (slug: string, filters: JobFilters) => Promise<void>;
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

export function CompanyFilterModal({
  isOpen,
  onClose,
  companyName,
  companySlug,
  initialFilters,
  onSave,
}: CompanyFilterModalProps) {
  const [selectedRoles, setSelectedRoles] = useState<Set<RoleType>>(new Set());
  const [selectedExperience, setSelectedExperience] = useState<Set<ExperienceLevel>>(new Set());
  const [titleKeywords, setTitleKeywords] = useState('');
  const [titleExclude, setTitleExclude] = useState('');
  const [saving, setSaving] = useState(false);

  // Initialize state from initialFilters when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRoles(new Set(initialFilters.role_types || []));
      setSelectedExperience(new Set(initialFilters.experience_levels || []));
      setTitleKeywords((initialFilters.title_keywords || []).join(', '));
      setTitleExclude(
        initialFilters.title_exclude?.length
          ? initialFilters.title_exclude.join(', ')
          : DEFAULT_TITLE_EXCLUDE.join(', ')
      );
    }
  }, [isOpen, initialFilters]);

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

  const handleSave = async () => {
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
      await onSave(companySlug, filters);
      onClose();
    } catch (error) {
      console.error('Failed to save filters:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleClearFilters = () => {
    setSelectedRoles(new Set());
    setSelectedExperience(new Set());
    setTitleKeywords('');
    setTitleExclude(DEFAULT_TITLE_EXCLUDE.join(', '));
  };

  const hasCustomFilters =
    selectedRoles.size > 0 ||
    selectedExperience.size > 0 ||
    titleKeywords.trim().length > 0 ||
    titleExclude.trim() !== DEFAULT_TITLE_EXCLUDE.join(', ');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Filter Jobs from ${companyName}`}
      className="max-w-lg"
    >
      <div className="space-y-6">
        {/* Role Types */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Role Types
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Only notify me about these role types (leave empty for all)
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
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Experience Levels
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Only notify me about these levels (leave empty for all)
          </p>
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
        <div>
          <Input
            label="Title must contain (comma-separated)"
            value={titleKeywords}
            onChange={(e) => setTitleKeywords(e.target.value)}
            placeholder="e.g., engineer, developer, SDE"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Leave empty to match all titles
          </p>
        </div>

        {/* Title Exclude */}
        <div>
          <Input
            label="Exclude titles containing (comma-separated)"
            value={titleExclude}
            onChange={(e) => setTitleExclude(e.target.value)}
            placeholder="e.g., senior, staff, principal"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Jobs with these words in the title will be excluded
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClearFilters}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Reset to defaults
          </button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Filters'}
            </Button>
          </div>
        </div>

        {hasCustomFilters && (
          <p className="text-xs text-blue-600 dark:text-blue-400 text-center">
            Custom filters will be applied to notifications from this company
          </p>
        )}
      </div>
    </Modal>
  );
}
