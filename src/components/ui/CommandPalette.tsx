'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Job } from '@/lib/types';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  section: 'recent' | 'actions' | 'navigation' | 'jobs';
}

interface CommandPaletteProps {
  jobs?: Job[];
}

// Icons as components
const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const BookmarkIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const HomeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const CogIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const BriefcaseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const RECENT_SEARCHES_KEY = 'command-palette-recent-searches';
const MAX_RECENT_SEARCHES = 5;

// Global shortcuts (Cmd/Ctrl + Shift + key) - work anywhere on site
const GLOBAL_SHORTCUTS: Record<string, string> = {
  'd': '/',              // Cmd+Shift+D → Dashboard
  'a': '/applications',  // Cmd+Shift+A → Applications
  'w': '/my-list',       // Cmd+Shift+W → Watchlist
  't': '/settings',      // Cmd+Shift+T → Settings
};

// Helper to get initial recent searches from localStorage
function getInitialRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }
  return [];
}

export function CommandPalette({ jobs = [] }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(getInitialRecentSearches);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Save recent search
  const addRecentSearch = useCallback((search: string) => {
    if (!search.trim()) return;

    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.toLowerCase() !== search.toLowerCase());
      const updated = [search, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Clear a recent search
  const clearRecentSearch = useCallback((search: string) => {
    setRecentSearches(prev => {
      const updated = prev.filter(s => s !== search);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Navigation actions
  const navigateTo = useCallback((path: string) => {
    setIsOpen(false);
    setQuery('');
    router.push(path);
  }, [router]);

  // Build command items
  const allItems = useMemo((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Recent searches (only show when no query)
    if (!query && recentSearches.length > 0) {
      recentSearches.forEach((search, index) => {
        items.push({
          id: `recent-${index}`,
          label: search,
          icon: <ClockIcon />,
          section: 'recent',
          action: () => {
            setQuery(search);
            addRecentSearch(search);
          },
        });
      });
    }

    // Quick actions - only show functional ones
    items.push({
      id: 'action-view-applications',
      label: 'View applications',
      description: 'See all your applications',
      icon: <EyeIcon />,
      shortcut: '⌘⇧A',
      section: 'actions',
      action: () => navigateTo('/applications'),
    });

    items.push({
      id: 'action-view-all',
      label: 'Browse all jobs',
      description: 'See all available positions',
      icon: <BriefcaseIcon />,
      shortcut: '⌘⇧D',
      section: 'actions',
      action: () => navigateTo('/'),
    });

    // Navigation
    items.push({
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      description: 'View all jobs',
      icon: <HomeIcon />,
      shortcut: '⌘⇧D',
      section: 'navigation',
      action: () => navigateTo('/'),
    });

    items.push({
      id: 'nav-applications',
      label: 'Go to Applications',
      description: 'Track your applications',
      icon: <BookmarkIcon />,
      shortcut: '⌘⇧A',
      section: 'navigation',
      action: () => navigateTo('/applications'),
    });

    items.push({
      id: 'nav-watchlist',
      label: 'Go to Watchlist',
      description: 'Your tracked companies',
      icon: <BriefcaseIcon />,
      shortcut: '⌘⇧W',
      section: 'navigation',
      action: () => navigateTo('/my-list'),
    });

    items.push({
      id: 'nav-settings',
      label: 'Go to Settings',
      description: 'Notification preferences',
      icon: <CogIcon />,
      shortcut: '⌘⇧T',
      section: 'navigation',
      action: () => navigateTo('/settings'),
    });

    // Jobs search results (when query exists)
    if (query.trim()) {
      const searchLower = query.toLowerCase();
      const matchingJobs = jobs
        .filter(job =>
          job.title.toLowerCase().includes(searchLower) ||
          job.company_name.toLowerCase().includes(searchLower) ||
          (job.location && job.location.toLowerCase().includes(searchLower))
        )
        .slice(0, 8);

      matchingJobs.forEach(job => {
        items.push({
          id: `job-${job.id}`,
          label: job.title,
          description: `${job.company_name}${job.location ? ` - ${job.location}` : ''}`,
          icon: <BriefcaseIcon />,
          section: 'jobs',
          action: () => {
            addRecentSearch(query);
            window.open(job.apply_url || job.url, '_blank');
            setIsOpen(false);
            setQuery('');
          },
        });
      });
    }

    return items;
  }, [query, recentSearches, jobs, navigateTo, addRecentSearch]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;

    const searchLower = query.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(searchLower) ||
      (item.description && item.description.toLowerCase().includes(searchLower))
    );
  }, [allItems, query]);

  // Group items by section
  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {
      recent: [],
      actions: [],
      navigation: [],
      jobs: [],
    };

    filteredItems.forEach(item => {
      groups[item.section].push(item);
    });

    return groups;
  }, [filteredItems]);

  // Flatten for keyboard navigation
  const flatItems = useMemo(() => {
    return [
      ...groupedItems.recent,
      ...groupedItems.actions,
      ...groupedItems.navigation,
      ...groupedItems.jobs,
    ];
  }, [groupedItems]);

  // Handle query change with selection reset
  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && flatItems[selectedIndex]) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, flatItems]);

  // Global keyboard listener for Cmd+K, ESC, and Cmd+Shift+X shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Open command palette with Cmd+K or Ctrl+K
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsOpen(prev => !prev);
        return;
      }

      // Close with Escape (global, not just when input focused)
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setQuery('');
        return;
      }

      // Global navigation shortcuts: Cmd+Shift+D/S/M/T (work anywhere)
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const key = event.key.toLowerCase();
        const path = GLOBAL_SHORTCUTS[key];
        if (path) {
          event.preventDefault();
          setIsOpen(false);
          setQuery('');
          router.push(path);
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, router]);

  // Handle keyboard navigation and shortcuts within palette
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const key = event.key.toLowerCase();

    // Check for Cmd/Ctrl + Shift + letter shortcuts (same as global)
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && key.length === 1 && GLOBAL_SHORTCUTS[key]) {
      event.preventDefault();
      navigateTo(GLOBAL_SHORTCUTS[key]);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex(prev =>
          prev < flatItems.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : flatItems.length - 1
        );
        break;
      case 'Enter':
        event.preventDefault();
        if (flatItems[selectedIndex]) {
          flatItems[selectedIndex].action();
        }
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        setQuery('');
        break;
    }
  }, [flatItems, selectedIndex, query, navigateTo]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      setTimeout(() => inputRef.current?.focus(), 10);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Close on click outside
  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      setIsOpen(false);
      setQuery('');
    }
  }, []);

  const renderSection = (section: 'recent' | 'actions' | 'navigation' | 'jobs', title: string) => {
    const items = groupedItems[section];
    if (items.length === 0) return null;

    // Calculate starting index for this section
    let startIndex = 0;
    if (section === 'actions') startIndex = groupedItems.recent.length;
    if (section === 'navigation') startIndex = groupedItems.recent.length + groupedItems.actions.length;
    if (section === 'jobs') startIndex = groupedItems.recent.length + groupedItems.actions.length + groupedItems.navigation.length;

    return (
      <div className="py-2">
        <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {title}
        </div>
        {items.map((item, index) => {
          const globalIndex = startIndex + index;
          const isSelected = globalIndex === selectedIndex;

          return (
            <button
              key={item.id}
              data-index={globalIndex}
              onClick={() => item.action()}
              onMouseEnter={() => setSelectedIndex(globalIndex)}
              className={cn(
                'w-full px-3 py-2 flex items-center gap-3 text-left transition-colors',
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50'
              )}
            >
              <span className={cn(
                'flex-shrink-0',
                isSelected ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              )}>
                {item.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.label}</div>
                {item.description && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {item.description}
                  </div>
                )}
              </div>
              {item.shortcut && (
                <kbd className="flex-shrink-0 hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 rounded border border-gray-200 dark:border-slate-600">
                  {item.shortcut}
                </kbd>
              )}
              {section === 'recent' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearRecentSearch(item.label);
                  }}
                  className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Remove from recent searches"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
    >
      {/* Backdrop with blur - clicking closes palette */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150 cursor-pointer"
        onClick={() => { setIsOpen(false); setQuery(''); }}
        aria-hidden="true"
      />

      {/* Command palette container */}
      <div
        className={cn(
          'relative w-full max-w-xl',
          // Glassmorphism styling
          'bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl',
          'border border-gray-200/50 dark:border-slate-700/50',
          'rounded-xl shadow-2xl shadow-black/20',
          // Animation
          'animate-in fade-in zoom-in-95 duration-150'
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/50 dark:border-slate-700/50">
          <span className="text-gray-400 dark:text-gray-500">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="text"
            id="command-palette-title"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search jobs, commands, or press a shortcut key..."
            className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-base"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 rounded border border-gray-200 dark:border-slate-600">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto overscroll-contain"
        >
          {flatItems.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-gray-400">
              <SearchIcon />
              <p className="mt-2">No results found</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          ) : (
            <>
              {renderSection('recent', 'Recent Searches')}
              {renderSection('actions', 'Quick Actions')}
              {renderSection('navigation', 'Navigation')}
              {renderSection('jobs', 'Jobs')}
            </>
          )}
        </div>

        {/* Footer with keyboard shortcuts */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200/50 dark:border-slate-700/50 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded border border-gray-200 dark:border-slate-600 font-mono" aria-label="Arrow up">
                <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </kbd>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded border border-gray-200 dark:border-slate-600 font-mono" aria-label="Arrow down">
                <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded border border-gray-200 dark:border-slate-600 font-mono">Enter</kbd>
              <span>to select</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded border border-gray-200 dark:border-slate-600 font-mono">
              {typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 rounded border border-gray-200 dark:border-slate-600 font-mono">K</kbd>
            <span>to open</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// Hook for using command palette externally
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsOpen(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { isOpen, setIsOpen };
}
