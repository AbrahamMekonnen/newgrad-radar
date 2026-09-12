'use client';

import { cn } from '@/lib/utils';

// Diversity source keys
export type DiversitySourceKey =
  | 'ghc'
  | 'afrotech'
  | 'nsbe'
  | 'shpe'
  | 'tapia'
  | 'diversify_tech';

// Source info configuration
export interface DiversitySourceInfo {
  name: string;
  shortName?: string;
  color: string;
  badgeLabel: string;
  icon?: 'users' | 'star' | 'sparkle';
  description?: string;
}

// Configuration for each diversity source
const DIVERSITY_SOURCE_CONFIG: Record<DiversitySourceKey, DiversitySourceInfo> = {
  ghc: {
    name: 'Grace Hopper',
    shortName: 'GHC',
    color: 'from-fuchsia-500 to-pink-500',
    badgeLabel: 'GHC Sponsor',
    icon: 'users',
    description: 'Grace Hopper Celebration sponsor - supporting women in tech',
  },
  afrotech: {
    name: 'AfroTech',
    color: 'from-amber-500 to-orange-500',
    badgeLabel: 'AfroTech Partner',
    description: 'AfroTech conference partner - supporting Black tech professionals',
  },
  nsbe: {
    name: 'NSBE',
    color: 'from-violet-500 to-purple-500',
    badgeLabel: 'NSBE',
    description: 'National Society of Black Engineers sponsor',
  },
  shpe: {
    name: 'SHPE',
    color: 'from-red-500 to-rose-500',
    badgeLabel: 'SHPE',
    description: 'Society of Hispanic Professional Engineers sponsor',
  },
  tapia: {
    name: 'Tapia',
    color: 'from-teal-500 to-cyan-500',
    badgeLabel: 'Tapia',
    description: 'Richard Tapia Conference sponsor - celebrating diversity in computing',
  },
  diversify_tech: {
    name: 'DiversifyTech',
    color: 'from-emerald-500 to-green-500',
    badgeLabel: 'DiversifyTech',
    description: 'DiversifyTech partner - connecting underrepresented talent with opportunities',
  },
};

// Map source strings to diversity source keys
const SOURCE_TO_KEY: Record<string, DiversitySourceKey> = {
  // GHC sources
  'ghc_sponsors': 'ghc',
  'ghc_jobs': 'ghc',
  'grace_hopper': 'ghc',
  // NSBE sources
  'nsbe_jobs': 'nsbe',
  'nsbe_sponsors': 'nsbe',
  // SHPE sources
  'shpe_jobs': 'shpe',
  'shpe_sponsors': 'shpe',
  // AfroTech sources
  'afrotech_careers': 'afrotech',
  'afrotech_sponsors': 'afrotech',
  // DiversifyTech
  'diversify_tech': 'diversify_tech',
  'diversifytech': 'diversify_tech',
  // Tapia
  'tapia_sponsors': 'tapia',
  'tapia_jobs': 'tapia',
  'tapia': 'tapia',
};

interface DiversitySourceBadgeProps {
  source: string;
  variant?: 'full' | 'compact';
  className?: string;
}

/**
 * Check if a source string is a diversity source
 */
export function isDiversitySource(source: string): boolean {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return normalized in SOURCE_TO_KEY;
}

/**
 * Get diversity source info for a given source string
 * Returns null if not a diversity source
 */
export function getDiversitySourceInfo(source: string): DiversitySourceInfo | null {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const key = SOURCE_TO_KEY[normalized];
  if (!key) return null;
  return DIVERSITY_SOURCE_CONFIG[key];
}

/**
 * Get the diversity source key for a given source string
 * Returns null if not a diversity source
 */
export function getDiversitySourceKey(source: string): DiversitySourceKey | null {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SOURCE_TO_KEY[normalized] || null;
}

/**
 * Get icon SVG path for diversity badge icons
 */
function getIconPath(icon: DiversitySourceInfo['icon']): string {
  switch (icon) {
    case 'users':
      return 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z';
    case 'star':
      return 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z';
    case 'sparkle':
      return 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z';
    default:
      return '';
  }
}

/**
 * Diversity Source Badge Component
 *
 * Displays a badge indicating that a job comes from a diversity-focused source
 * like Grace Hopper, NSBE, SHPE, AfroTech, etc.
 */
export function DiversitySourceBadge({
  source,
  variant = 'compact',
  className,
}: DiversitySourceBadgeProps) {
  const info = getDiversitySourceInfo(source);

  // Don't render if not a diversity source
  if (!info) return null;

  if (variant === 'compact') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold shadow-sm ring-1 ring-inset ring-white/20',
          `bg-gradient-to-r ${info.color} text-white`,
          className
        )}
        title={info.description}
      >
        {info.icon && (
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d={getIconPath(info.icon)}
            />
          </svg>
        )}
        {info.badgeLabel}
      </span>
    );
  }

  // Full variant - card-style with description
  return (
    <div
      className={cn(
        'rounded-xl p-4 shadow-sm border',
        'bg-gradient-to-br from-white to-gray-50 dark:from-slate-800 dark:to-slate-900',
        'border-gray-100 dark:border-slate-700',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon badge */}
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center shadow-sm',
            `bg-gradient-to-br ${info.color}`
          )}
        >
          {info.icon ? (
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={getIconPath(info.icon)}
              />
            </svg>
          ) : (
            <span className="text-white font-bold text-sm">
              {info.shortName?.[0] || info.name[0]}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Source name and badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {info.name}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm',
                `bg-gradient-to-r ${info.color} text-white`
              )}
            >
              {info.badgeLabel}
            </span>
          </div>

          {/* Description */}
          {info.description && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {info.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default DiversitySourceBadge;
