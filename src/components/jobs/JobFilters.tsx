'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Tier, RoleType, SponsorshipStatus, FundingFilter, SourceFilter, ExperienceLevel, DiversityTag, WorkMode, BadgeTag, SmartFilter, LocationFilter, TIER_LABELS, ROLE_LABELS, SPONSORSHIP_LABELS, FUNDING_FILTER_LABELS, SOURCE_FILTER_LABELS, EXPERIENCE_LABELS, DIVERSITY_TAG_LABELS, WORK_MODE_LABELS, BADGE_TAG_LABELS, LOCATION_FILTER_LABELS } from '@/lib/types';
import { SmartFilters } from './SmartFilters';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const ALL_TIERS: Tier[] = ['faang', 'ai', 'unicorn', 'yc', 'fintech', 'infra'];
const ALL_ROLES: RoleType[] = ['swe', 'ml', 'backend', 'frontend', 'fullstack', 'infra', 'data', 'security', 'mobile'];
const SPONSORSHIP_OPTIONS: SponsorshipStatus[] = ['sponsors', 'no_sponsor', 'unknown'];
const ALL_FUNDING_STAGES: FundingFilter[] = ['seed', 'series-a', 'series-b+', 'public'];
const ALL_SOURCE_FILTERS: SourceFilter[] = ['ats', 'job_boards', 'vc_portfolios', 'conferences', 'newsletters', 'government'];
const ALL_EXPERIENCE_LEVELS: ExperienceLevel[] = ['new_grad', 'entry_level', 'junior', 'mid', 'senior', 'staff', 'principal'];
const ALL_DIVERSITY_TAGS: DiversityTag[] = ['ghc_sponsor', 'nsbe_sponsor', 'shpe_sponsor', 'tapia_sponsor', 'afrotech_sponsor', 'outtie_sponsor', 'lesbians_who_tech_sponsor', 'techqueria_sponsor', 'diversity_focused'];
const ALL_WORK_MODES: WorkMode[] = ['remote', 'hybrid', 'onsite', 'flexible'];
const ALL_BADGE_TAGS: BadgeTag[] = ['just_funded', 'hot_hiring', 'fast_growing', 'closing_soon', 'high_paying', 'new_listing', 'hidden_gem', 'quick_apply', 'no_cover_letter', 'referral_available'];
const ALL_LOCATIONS: LocationFilter[] = ['remote', 'san_francisco', 'new_york', 'seattle', 'austin', 'boston', 'los_angeles', 'denver', 'chicago'];

// Salary range presets in thousands
const SALARY_PRESETS = [
  { label: '$100K+', min: 100, max: null },
  { label: '$150K+', min: 150, max: null },
  { label: '$200K+', min: 200, max: null },
  { label: '$100K - $150K', min: 100, max: 150 },
  { label: '$150K - $200K', min: 150, max: 200 },
  { label: '$200K - $250K', min: 200, max: 250 },
];

// Section IDs for localStorage persistence
const SECTION_IDS = {
  smartFilters: 'filter-section-smart-filters',
  tier: 'filter-section-tier',
  role: 'filter-section-role',
  location: 'filter-section-location',
  sponsorship: 'filter-section-sponsorship',
  funding: 'filter-section-funding',
  source: 'filter-section-source',
  experience: 'filter-section-experience',
  workMode: 'filter-section-work-mode',
  diversity: 'filter-section-diversity',
  badges: 'filter-section-badges',
  salary: 'filter-section-salary',
  hiddenGems: 'filter-section-hidden-gems',
  other: 'filter-section-other',
} as const;

// Default expanded state - Tier and Role are open by default
const DEFAULT_EXPANDED: Record<string, boolean> = {
  [SECTION_IDS.smartFilters]: true,
  [SECTION_IDS.tier]: true,
  [SECTION_IDS.role]: true,
  [SECTION_IDS.location]: false,
  [SECTION_IDS.sponsorship]: false,
  [SECTION_IDS.funding]: false,
  [SECTION_IDS.source]: false,
  [SECTION_IDS.experience]: false,
  [SECTION_IDS.workMode]: false,
  [SECTION_IDS.diversity]: false,
  [SECTION_IDS.badges]: false,
  [SECTION_IDS.salary]: false,
  [SECTION_IDS.hiddenGems]: false,
  [SECTION_IDS.other]: false,
};

// Hook for managing collapsible sections with localStorage persistence
function useCollapsibleSections() {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(DEFAULT_EXPANDED);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after hydration to avoid mismatch
  useEffect(() => {
    try {
      const stored = localStorage.getItem('job-filter-sections');
      if (stored) {
        setExpandedSections({ ...DEFAULT_EXPANDED, ...JSON.parse(stored) });
      }
    } catch {
      // Ignore localStorage errors
    }
    setHydrated(true);
  }, []);

  // Save to localStorage only after initial hydration
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('job-filter-sections', JSON.stringify(expandedSections));
    } catch {
      // Ignore localStorage errors
    }
  }, [expandedSections, hydrated]);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const expandAll = useCallback(() => {
    const allExpanded = Object.keys(SECTION_IDS).reduce((acc, key) => {
      acc[SECTION_IDS[key as keyof typeof SECTION_IDS]] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setExpandedSections(allExpanded);
  }, []);

  const collapseAll = useCallback(() => {
    const allCollapsed = Object.keys(SECTION_IDS).reduce((acc, key) => {
      acc[SECTION_IDS[key as keyof typeof SECTION_IDS]] = false;
      return acc;
    }, {} as Record<string, boolean>);
    setExpandedSections(allCollapsed);
  }, []);

  const isExpanded = useCallback((sectionId: string) => {
    return expandedSections[sectionId] ?? DEFAULT_EXPANDED[sectionId] ?? false;
  }, [expandedSections]);

  const allExpanded = Object.values(SECTION_IDS).every((id) => expandedSections[id]);

  return { isExpanded, toggleSection, expandAll, collapseAll, allExpanded };
}

// Chevron icon component
function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={cn(
        'w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200',
        isExpanded ? 'rotate-180' : 'rotate-0'
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// Collapsible section component
interface CollapsibleSectionProps {
  sectionId: string;
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  useFieldset?: boolean;
}

function CollapsibleSection({
  sectionId,
  title,
  isExpanded,
  onToggle,
  children,
  icon,
  useFieldset = false,
}: CollapsibleSectionProps) {
  const contentId = `${sectionId}-content`;

  const Wrapper = useFieldset ? 'fieldset' : 'div';
  const TitleElement = useFieldset ? 'legend' : 'h3';

  return (
    <Wrapper>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left group"
        aria-expanded={isExpanded}
        aria-controls={contentId}
      >
        <TitleElement className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          {icon}
          {title}
        </TitleElement>
        <ChevronIcon isExpanded={isExpanded} />
      </button>
      <div
        id={contentId}
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          isExpanded ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'
        )}
      >
        {children}
      </div>
    </Wrapper>
  );
}

interface JobFiltersProps {
  selectedTiers: Tier[];
  selectedRoles: RoleType[];
  selectedLocations?: LocationFilter[];
  hasRecruiters?: boolean;
  hiddenGemsOnly?: boolean;
  sponsorshipFilter?: SponsorshipStatus | null;
  selectedFundingStages?: FundingFilter[];
  selectedSources?: SourceFilter[];
  salaryMin?: number | null;
  salaryMax?: number | null;
  experienceLevels?: ExperienceLevel[];
  diversityTags?: DiversityTag[];
  workModes?: WorkMode[];
  badges?: BadgeTag[];
  onTierChange: (tiers: Tier[]) => void;
  onRoleChange: (roles: RoleType[]) => void;
  onLocationsChange?: (locations: LocationFilter[]) => void;
  onHasRecruitersChange?: (value: boolean) => void;
  onHiddenGemsChange?: (value: boolean) => void;
  onSponsorshipChange?: (status: SponsorshipStatus | null) => void;
  onFundingChange?: (stages: FundingFilter[]) => void;
  onSourceChange?: (sources: SourceFilter[]) => void;
  onSalaryChange?: (min: number | null, max: number | null) => void;
  onExperienceLevelsChange?: (levels: ExperienceLevel[]) => void;
  onDiversityTagsChange?: (tags: DiversityTag[]) => void;
  onWorkModesChange?: (modes: WorkMode[]) => void;
  onBadgesChange?: (badges: BadgeTag[]) => void;
  onClear: () => void;
  onSaveAsAlert?: () => void;
}

export function JobFilters({
  selectedTiers,
  selectedRoles,
  selectedLocations = [],
  hasRecruiters = false,
  hiddenGemsOnly = false,
  sponsorshipFilter = null,
  selectedFundingStages = [],
  selectedSources = [],
  salaryMin = null,
  salaryMax = null,
  experienceLevels = [],
  diversityTags = [],
  workModes = [],
  badges = [],
  onTierChange,
  onRoleChange,
  onLocationsChange,
  onHasRecruitersChange,
  onHiddenGemsChange,
  onSponsorshipChange,
  onFundingChange,
  onSourceChange,
  onSalaryChange,
  onExperienceLevelsChange,
  onDiversityTagsChange,
  onWorkModesChange,
  onBadgesChange,
  onClear,
  onSaveAsAlert,
}: JobFiltersProps) {
  const { isExpanded, toggleSection, expandAll, collapseAll, allExpanded } = useCollapsibleSections();

  const toggleTier = (tier: Tier) => {
    if (selectedTiers.includes(tier)) {
      onTierChange(selectedTiers.filter((t) => t !== tier));
    } else {
      onTierChange([...selectedTiers, tier]);
    }
  };

  const toggleRole = (role: RoleType) => {
    if (selectedRoles.includes(role)) {
      onRoleChange(selectedRoles.filter((r) => r !== role));
    } else {
      onRoleChange([...selectedRoles, role]);
    }
  };

  const toggleLocation = (location: LocationFilter) => {
    if (onLocationsChange) {
      if (selectedLocations.includes(location)) {
        onLocationsChange(selectedLocations.filter((l) => l !== location));
      } else {
        onLocationsChange([...selectedLocations, location]);
      }
    }
  };

  const toggleSponsorship = (status: SponsorshipStatus) => {
    if (onSponsorshipChange) {
      if (sponsorshipFilter === status) {
        onSponsorshipChange(null);
      } else {
        onSponsorshipChange(status);
      }
    }
  };

  const toggleFunding = (stage: FundingFilter) => {
    if (onFundingChange) {
      if (selectedFundingStages.includes(stage)) {
        onFundingChange(selectedFundingStages.filter((s) => s !== stage));
      } else {
        onFundingChange([...selectedFundingStages, stage]);
      }
    }
  };

  const toggleSource = (source: SourceFilter) => {
    if (onSourceChange) {
      if (selectedSources.includes(source)) {
        onSourceChange(selectedSources.filter((s) => s !== source));
      } else {
        onSourceChange([...selectedSources, source]);
      }
    }
  };

  const toggleExperienceLevel = (level: ExperienceLevel) => {
    if (onExperienceLevelsChange) {
      onExperienceLevelsChange(
        experienceLevels.includes(level)
          ? experienceLevels.filter((l) => l !== level)
          : [...experienceLevels, level]
      );
    }
  };

  const toggleDiversityTag = (tag: DiversityTag) => {
    if (onDiversityTagsChange) {
      if (diversityTags.includes(tag)) {
        onDiversityTagsChange(diversityTags.filter((t) => t !== tag));
      } else {
        onDiversityTagsChange([...diversityTags, tag]);
      }
    }
  };

  const toggleWorkMode = (mode: WorkMode) => {
    if (onWorkModesChange) {
      if (workModes.includes(mode)) {
        onWorkModesChange(workModes.filter((m) => m !== mode));
      } else {
        onWorkModesChange([...workModes, mode]);
      }
    }
  };

  const toggleBadge = (badge: BadgeTag) => {
    if (onBadgesChange) {
      if (badges.includes(badge)) {
        onBadgesChange(badges.filter((b) => b !== badge));
      } else {
        onBadgesChange([...badges, badge]);
      }
    }
  };

  const hasFilters = selectedTiers.length > 0 || selectedRoles.length > 0 || selectedLocations.length > 0 || hasRecruiters || hiddenGemsOnly || sponsorshipFilter !== null || selectedFundingStages.length > 0 || selectedSources.length > 0 || salaryMin !== null || salaryMax !== null || experienceLevels.length > 0 || diversityTags.length > 0 || workModes.length > 0 || badges.length > 0;

  return (
    <div className="space-y-4" role="group" aria-label="Job filters">
      {/* Expand/Collapse All Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={allExpanded ? collapseAll : expandAll}
          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Tier filters */}
      <CollapsibleSection
        sectionId={SECTION_IDS.tier}
        title="Tier"
        isExpanded={isExpanded(SECTION_IDS.tier)}
        onToggle={() => toggleSection(SECTION_IDS.tier)}
        useFieldset
      >
        <div className="space-y-2" role="group" aria-label="Filter by company tier">
          {ALL_TIERS.map((tier) => (
            <Checkbox
              key={tier}
              label={TIER_LABELS[tier]}
              checked={selectedTiers.includes(tier)}
              onChange={() => toggleTier(tier)}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Role filters */}
      <CollapsibleSection
        sectionId={SECTION_IDS.role}
        title="Role"
        isExpanded={isExpanded(SECTION_IDS.role)}
        onToggle={() => toggleSection(SECTION_IDS.role)}
        useFieldset
      >
        <div className="space-y-2" role="group" aria-label="Filter by role type">
          {ALL_ROLES.map((role) => (
            <Checkbox
              key={role}
              label={ROLE_LABELS[role]}
              checked={selectedRoles.includes(role)}
              onChange={() => toggleRole(role)}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Location filter */}
      {onLocationsChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.location}
          title="Location"
          isExpanded={isExpanded(SECTION_IDS.location)}
          onToggle={() => toggleSection(SECTION_IDS.location)}
        >
          <div className="space-y-2">
            {ALL_LOCATIONS.map((location) => (
              <Checkbox
                key={location}
                label={LOCATION_FILTER_LABELS[location]}
                checked={selectedLocations.includes(location)}
                onChange={() => toggleLocation(location)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Visa Sponsorship filter */}
      {onSponsorshipChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.sponsorship}
          title="Visa Sponsorship"
          isExpanded={isExpanded(SECTION_IDS.sponsorship)}
          onToggle={() => toggleSection(SECTION_IDS.sponsorship)}
        >
          <div className="space-y-2">
            {SPONSORSHIP_OPTIONS.map((status) => (
              <Checkbox
                key={status}
                label={SPONSORSHIP_LABELS[status]}
                checked={sponsorshipFilter === status}
                onChange={() => toggleSponsorship(status)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Funding Stage filter */}
      {onFundingChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.funding}
          title="Funding Stage"
          isExpanded={isExpanded(SECTION_IDS.funding)}
          onToggle={() => toggleSection(SECTION_IDS.funding)}
        >
          <div className="space-y-2">
            {ALL_FUNDING_STAGES.map((stage) => (
              <Checkbox
                key={stage}
                label={FUNDING_FILTER_LABELS[stage]}
                checked={selectedFundingStages.includes(stage)}
                onChange={() => toggleFunding(stage)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Source filter */}
      {onSourceChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.source}
          title="Source"
          isExpanded={isExpanded(SECTION_IDS.source)}
          onToggle={() => toggleSection(SECTION_IDS.source)}
        >
          <div className="space-y-2">
            {ALL_SOURCE_FILTERS.map((source) => (
              <Checkbox
                key={source}
                label={SOURCE_FILTER_LABELS[source]}
                checked={selectedSources.includes(source)}
                onChange={() => toggleSource(source)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Experience Level filter */}
      {onExperienceLevelsChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.experience}
          title="Experience Level"
          isExpanded={isExpanded(SECTION_IDS.experience)}
          onToggle={() => toggleSection(SECTION_IDS.experience)}
        >
          <div className="space-y-2">
            {ALL_EXPERIENCE_LEVELS.map((level) => (
              <Checkbox
                key={level}
                label={EXPERIENCE_LABELS[level]}
                checked={experienceLevels.includes(level)}
                onChange={() => toggleExperienceLevel(level)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Work Mode filter */}
      {onWorkModesChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.workMode}
          title="Work Mode"
          isExpanded={isExpanded(SECTION_IDS.workMode)}
          onToggle={() => toggleSection(SECTION_IDS.workMode)}
        >
          <div className="space-y-2">
            {ALL_WORK_MODES.map((mode) => (
              <Checkbox
                key={mode}
                label={WORK_MODE_LABELS[mode]}
                checked={workModes.includes(mode)}
                onChange={() => toggleWorkMode(mode)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Diversity Tags filter */}
      {onDiversityTagsChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.diversity}
          title="Diversity Focus"
          isExpanded={isExpanded(SECTION_IDS.diversity)}
          onToggle={() => toggleSection(SECTION_IDS.diversity)}
        >
          <div className="space-y-2">
            {ALL_DIVERSITY_TAGS.map((tag) => (
              <Checkbox
                key={tag}
                label={DIVERSITY_TAG_LABELS[tag]}
                checked={diversityTags.includes(tag)}
                onChange={() => toggleDiversityTag(tag)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Badges filter */}
      {onBadgesChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.badges}
          title="Badges"
          isExpanded={isExpanded(SECTION_IDS.badges)}
          onToggle={() => toggleSection(SECTION_IDS.badges)}
        >
          <div className="space-y-2">
            {ALL_BADGE_TAGS.map((badge) => (
              <Checkbox
                key={badge}
                label={BADGE_TAG_LABELS[badge]}
                checked={badges.includes(badge)}
                onChange={() => toggleBadge(badge)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Salary Range filter */}
      {onSalaryChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.salary}
          title="Salary Range"
          isExpanded={isExpanded(SECTION_IDS.salary)}
          onToggle={() => toggleSection(SECTION_IDS.salary)}
        >
          <div className="space-y-3">
            {/* Min/Max inputs */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Min ($K)</label>
                <input
                  type="number"
                  placeholder="100"
                  value={salaryMin ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    onSalaryChange(val, salaryMax);
                  }}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <span className="text-gray-400 dark:text-gray-500 pt-5">-</span>
              <div className="flex-1">
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Max ($K)</label>
                <input
                  type="number"
                  placeholder="250"
                  value={salaryMax ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    onSalaryChange(salaryMin, val);
                  }}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {SALARY_PRESETS.slice(0, 3).map((preset) => {
                const isActive = salaryMin === preset.min && salaryMax === preset.max;
                return (
                  <button
                    key={preset.label}
                    onClick={() => {
                      if (isActive) {
                        onSalaryChange(null, null);
                      } else {
                        onSalaryChange(preset.min, preset.max);
                      }
                    }}
                    className={cn(
                      'px-2 py-1 rounded text-xs font-medium border transition-colors',
                      isActive
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Hidden Gems - Special filter for exclusive sources */}
      {onHiddenGemsChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.hiddenGems}
          title="Hidden Gems"
          isExpanded={isExpanded(SECTION_IDS.hiddenGems)}
          onToggle={() => toggleSection(SECTION_IDS.hiddenGems)}
          icon={
            <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
            </svg>
          }
        >
          <button
            onClick={() => onHiddenGemsChange(!hiddenGemsOnly)}
            className={cn(
              'w-full px-3 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200 flex items-center gap-2 justify-center',
              hiddenGemsOnly
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500 shadow-md shadow-amber-500/25'
                : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-amber-50 dark:hover:bg-slate-600 hover:border-amber-300 dark:hover:border-amber-500/50'
            )}
          >
            <span>Show Hidden Gems Only</span>
            {hiddenGemsOnly && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Jobs from conferences (GHC, Tapia), VC portfolios, hackathons, and newsletters - not on LinkedIn/Indeed
          </p>
        </CollapsibleSection>
      )}

      {/* Other filters */}
      {onHasRecruitersChange && (
        <CollapsibleSection
          sectionId={SECTION_IDS.other}
          title="Other"
          isExpanded={isExpanded(SECTION_IDS.other)}
          onToggle={() => toggleSection(SECTION_IDS.other)}
        >
          <div className="space-y-2">
            <Checkbox
              label="Has Recruiters"
              checked={hasRecruiters}
              onChange={() => onHasRecruitersChange(!hasRecruiters)}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Clear and Save Alert buttons */}
      {hasFilters && (
        <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-slate-700">
          {onSaveAsAlert && (
            <Button
              variant="primary"
              size="sm"
              onClick={onSaveAsAlert}
              className="w-full flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Save as Alert
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear} className="w-full">
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}

// Mobile Collapsible Section - similar but styled for mobile
interface MobileCollapsibleSectionProps {
  sectionId: string;
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  useFieldset?: boolean;
}

function MobileCollapsibleSection({
  sectionId,
  title,
  isExpanded,
  onToggle,
  children,
  icon,
  useFieldset = false,
}: MobileCollapsibleSectionProps) {
  const contentId = `${sectionId}-content`;

  const Wrapper = useFieldset ? 'fieldset' : 'div';
  const TitleElement = useFieldset ? 'legend' : 'h3';

  return (
    <Wrapper>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left py-1 group"
        aria-expanded={isExpanded}
        aria-controls={contentId}
      >
        <TitleElement className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          {icon}
          {title}
        </TitleElement>
        <ChevronIcon isExpanded={isExpanded} />
      </button>
      <div
        id={contentId}
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          isExpanded ? 'max-h-[1000px] opacity-100 mt-3' : 'max-h-0 opacity-0'
        )}
      >
        {children}
      </div>
    </Wrapper>
  );
}

// Mobile filter drawer
interface MobileFiltersProps extends JobFiltersProps {
  isOpen: boolean;
  onClose: () => void;
  smartFilters?: SmartFilter[];
  onSmartFilterToggle?: (filter: SmartFilter) => void;
  onSaveAsAlert?: () => void;
  selectedLocations?: LocationFilter[];
  onLocationsChange?: (locations: LocationFilter[]) => void;
}

export function MobileFilters({
  isOpen,
  onClose,
  selectedTiers,
  selectedRoles,
  selectedLocations = [],
  hasRecruiters = false,
  hiddenGemsOnly = false,
  sponsorshipFilter = null,
  selectedFundingStages = [],
  selectedSources = [],
  salaryMin = null,
  salaryMax = null,
  experienceLevels = [],
  diversityTags = [],
  workModes = [],
  badges = [],
  smartFilters = [],
  onTierChange,
  onRoleChange,
  onLocationsChange,
  onHasRecruitersChange,
  onHiddenGemsChange,
  onSponsorshipChange,
  onFundingChange,
  onSourceChange,
  onSalaryChange,
  onExperienceLevelsChange,
  onDiversityTagsChange,
  onWorkModesChange,
  onBadgesChange,
  onSmartFilterToggle,
  onClear,
  onSaveAsAlert,
}: MobileFiltersProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { isExpanded, toggleSection, expandAll, collapseAll, allExpanded } = useCollapsibleSections();

  // Handle keyboard events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }

    // Trap focus within drawer
    if (event.key === 'Tab' && drawerRef.current) {
      const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      // Store currently focused element
      previousFocusRef.current = document.activeElement as HTMLElement;

      // Focus the close button when drawer opens
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);

      // Add keyboard event listener
      document.addEventListener('keydown', handleKeyDown);
    } else {
      // Restore focus to previously focused element
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Filter options"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-800 rounded-t-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 id="filter-title" className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={allExpanded ? collapseAll : expandAll}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              {allExpanded ? 'Collapse All' : 'Expand All'}
            </button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-3 -m-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close filters"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
          {/* Smart Filters */}
          {onSmartFilterToggle && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.smartFilters}
              title="Smart Filters"
              isExpanded={isExpanded(SECTION_IDS.smartFilters)}
              onToggle={() => toggleSection(SECTION_IDS.smartFilters)}
            >
              <SmartFilters
                activeFilters={smartFilters}
                onToggle={onSmartFilterToggle}
              />
            </MobileCollapsibleSection>
          )}

          {/* Tier toggle buttons */}
          <MobileCollapsibleSection
            sectionId={SECTION_IDS.tier}
            title="Tier"
            isExpanded={isExpanded(SECTION_IDS.tier)}
            onToggle={() => toggleSection(SECTION_IDS.tier)}
            useFieldset
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by company tier">
              {ALL_TIERS.map((tier) => {
                const isSelected = selectedTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    onClick={() =>
                      isSelected
                        ? onTierChange(selectedTiers.filter((t) => t !== tier))
                        : onTierChange([...selectedTiers, tier])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                    aria-pressed={isSelected}
                  >
                    {TIER_LABELS[tier]}
                  </button>
                );
              })}
            </div>
          </MobileCollapsibleSection>

          {/* Role toggle buttons */}
          <MobileCollapsibleSection
            sectionId={SECTION_IDS.role}
            title="Role"
            isExpanded={isExpanded(SECTION_IDS.role)}
            onToggle={() => toggleSection(SECTION_IDS.role)}
            useFieldset
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by role type">
              {ALL_ROLES.map((role) => {
                const isSelected = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() =>
                      isSelected
                        ? onRoleChange(selectedRoles.filter((r) => r !== role))
                        : onRoleChange([...selectedRoles, role])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                    aria-pressed={isSelected}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
          </MobileCollapsibleSection>

          {/* Location filter */}
          {onLocationsChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.location}
              title="Location"
              isExpanded={isExpanded(SECTION_IDS.location)}
              onToggle={() => toggleSection(SECTION_IDS.location)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_LOCATIONS.map((location) => (
                  <button
                    key={location}
                    onClick={() =>
                      selectedLocations.includes(location)
                        ? onLocationsChange(selectedLocations.filter((l) => l !== location))
                        : onLocationsChange([...selectedLocations, location])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      selectedLocations.includes(location)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {LOCATION_FILTER_LABELS[location]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Visa Sponsorship filter */}
          {onSponsorshipChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.sponsorship}
              title="Visa Sponsorship"
              isExpanded={isExpanded(SECTION_IDS.sponsorship)}
              onToggle={() => toggleSection(SECTION_IDS.sponsorship)}
            >
              <div className="flex flex-wrap gap-2">
                {SPONSORSHIP_OPTIONS.map((status) => (
                  <button
                    key={status}
                    onClick={() => onSponsorshipChange(sponsorshipFilter === status ? null : status)}
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      sponsorshipFilter === status
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {SPONSORSHIP_LABELS[status]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Funding Stage filter */}
          {onFundingChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.funding}
              title="Funding Stage"
              isExpanded={isExpanded(SECTION_IDS.funding)}
              onToggle={() => toggleSection(SECTION_IDS.funding)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_FUNDING_STAGES.map((stage) => (
                  <button
                    key={stage}
                    onClick={() =>
                      selectedFundingStages.includes(stage)
                        ? onFundingChange(selectedFundingStages.filter((s) => s !== stage))
                        : onFundingChange([...selectedFundingStages, stage])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      selectedFundingStages.includes(stage)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {FUNDING_FILTER_LABELS[stage]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Source filter */}
          {onSourceChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.source}
              title="Source"
              isExpanded={isExpanded(SECTION_IDS.source)}
              onToggle={() => toggleSection(SECTION_IDS.source)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_SOURCE_FILTERS.map((source) => (
                  <button
                    key={source}
                    onClick={() =>
                      selectedSources.includes(source)
                        ? onSourceChange(selectedSources.filter((s) => s !== source))
                        : onSourceChange([...selectedSources, source])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      selectedSources.includes(source)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {SOURCE_FILTER_LABELS[source]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Experience Level filter */}
          {onExperienceLevelsChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.experience}
              title="Experience Level"
              isExpanded={isExpanded(SECTION_IDS.experience)}
              onToggle={() => toggleSection(SECTION_IDS.experience)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_EXPERIENCE_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() =>
                      onExperienceLevelsChange?.(
                        experienceLevels.includes(level)
                          ? experienceLevels.filter((l) => l !== level)
                          : [...experienceLevels, level]
                      )
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      experienceLevels.includes(level)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {EXPERIENCE_LABELS[level]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Work Mode filter */}
          {onWorkModesChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.workMode}
              title="Work Mode"
              isExpanded={isExpanded(SECTION_IDS.workMode)}
              onToggle={() => toggleSection(SECTION_IDS.workMode)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_WORK_MODES.map((mode) => (
                  <button
                    key={mode}
                    onClick={() =>
                      workModes.includes(mode)
                        ? onWorkModesChange(workModes.filter((m) => m !== mode))
                        : onWorkModesChange([...workModes, mode])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      workModes.includes(mode)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {WORK_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Diversity Tags filter */}
          {onDiversityTagsChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.diversity}
              title="Diversity Focus"
              isExpanded={isExpanded(SECTION_IDS.diversity)}
              onToggle={() => toggleSection(SECTION_IDS.diversity)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_DIVERSITY_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() =>
                      diversityTags.includes(tag)
                        ? onDiversityTagsChange(diversityTags.filter((t) => t !== tag))
                        : onDiversityTagsChange([...diversityTags, tag])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      diversityTags.includes(tag)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {DIVERSITY_TAG_LABELS[tag]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Badges filter */}
          {onBadgesChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.badges}
              title="Badges"
              isExpanded={isExpanded(SECTION_IDS.badges)}
              onToggle={() => toggleSection(SECTION_IDS.badges)}
            >
              <div className="flex flex-wrap gap-2">
                {ALL_BADGE_TAGS.map((badge) => (
                  <button
                    key={badge}
                    onClick={() =>
                      badges.includes(badge)
                        ? onBadgesChange(badges.filter((b) => b !== badge))
                        : onBadgesChange([...badges, badge])
                    }
                    className={cn(
                      'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                      badges.includes(badge)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                    )}
                  >
                    {BADGE_TAG_LABELS[badge]}
                  </button>
                ))}
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Salary Range filter */}
          {onSalaryChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.salary}
              title="Salary Range"
              isExpanded={isExpanded(SECTION_IDS.salary)}
              onToggle={() => toggleSection(SECTION_IDS.salary)}
            >
              <div className="space-y-3">
                {/* Min/Max inputs */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Min ($K)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="100"
                      value={salaryMin ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        onSalaryChange(val, salaryMax);
                      }}
                      className="w-full px-3 py-2 text-base border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <span className="text-gray-400 dark:text-gray-500 pt-5">-</span>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Max ($K)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="250"
                      value={salaryMax ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        onSalaryChange(salaryMin, val);
                      }}
                      className="w-full px-3 py-2 text-base border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                {/* Quick presets */}
                <div className="flex flex-wrap gap-2">
                  {SALARY_PRESETS.map((preset) => {
                    const isActive = salaryMin === preset.min && salaryMax === preset.max;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          if (isActive) {
                            onSalaryChange(null, null);
                          } else {
                            onSalaryChange(preset.min, preset.max);
                          }
                        }}
                        className={cn(
                          'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                          isActive
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </MobileCollapsibleSection>
          )}

          {/* Hidden Gems toggle */}
          {onHiddenGemsChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.hiddenGems}
              title="Hidden Gems"
              isExpanded={isExpanded(SECTION_IDS.hiddenGems)}
              onToggle={() => toggleSection(SECTION_IDS.hiddenGems)}
              icon={
                <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
                </svg>
              }
            >
              <button
                onClick={() => onHiddenGemsChange(!hiddenGemsOnly)}
                className={cn(
                  'w-full px-4 py-3 min-h-[48px] rounded-xl text-sm font-semibold border transition-all duration-200 flex items-center gap-2 justify-center',
                  hiddenGemsOnly
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500 shadow-lg shadow-amber-500/25'
                    : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-amber-50 dark:hover:bg-slate-600 hover:border-amber-300'
                )}
              >
                <span>Show Hidden Gems Only</span>
                {hiddenGemsOnly && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Jobs from conferences (GHC, Tapia), VC portfolios, hackathons, and newsletters - not on LinkedIn/Indeed
              </p>
            </MobileCollapsibleSection>
          )}

          {/* Has Recruiters toggle */}
          {onHasRecruitersChange && (
            <MobileCollapsibleSection
              sectionId={SECTION_IDS.other}
              title="Other"
              isExpanded={isExpanded(SECTION_IDS.other)}
              onToggle={() => toggleSection(SECTION_IDS.other)}
            >
              <button
                onClick={() => onHasRecruitersChange(!hasRecruiters)}
                className={cn(
                  'px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                  hasRecruiters
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 active:bg-gray-100 dark:active:bg-slate-500'
                )}
              >
                Has Recruiters
              </button>
            </MobileCollapsibleSection>
          )}
        </div>

        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 p-4 space-y-3 pb-safe">
          {/* Save as Alert button - only show when filters are active */}
          {onSaveAsAlert && (selectedTiers.length > 0 || selectedRoles.length > 0 || selectedLocations.length > 0 || hasRecruiters || sponsorshipFilter !== null || selectedFundingStages.length > 0 || selectedSources.length > 0 || salaryMin !== null || salaryMax !== null || experienceLevels.length > 0 || diversityTags.length > 0 || workModes.length > 0 || badges.length > 0 || smartFilters.length > 0) && (
            <Button
              variant="outline"
              onClick={() => {
                onSaveAsAlert();
                onClose();
              }}
              className="w-full min-h-[48px] flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              Save as Alert
            </Button>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClear} className="flex-1 min-h-[48px]">
              Clear All
            </Button>
            <Button variant="primary" onClick={onClose} className="flex-1 min-h-[48px]">
              Apply Filters
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
