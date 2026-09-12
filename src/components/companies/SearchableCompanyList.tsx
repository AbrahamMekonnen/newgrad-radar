'use client';

import { useState, useEffect, useRef } from 'react';
import { Company } from '@/lib/types';
import { TierBadge } from './TierBadge';
import { cn } from '@/lib/utils';

interface SearchableCompanyListProps {
  companies: Company[];
  trackedSlugs: Set<string>;
  onSelect: (company: Company) => void;
  placeholder?: string;
  loading?: boolean;
}

export function SearchableCompanyList({
  companies,
  trackedSlugs,
  onSelect,
  placeholder = 'Search for a company...',
  loading = false,
}: SearchableCompanyListProps) {
  const [search, setSearch] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter companies based on search
  const filteredCompanies = search.trim()
    ? companies.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.slug.toLowerCase().includes(search.toLowerCase())
      )
    : companies;

  // Only show companies not already tracked
  const availableCompanies = filteredCompanies.filter((c) => !trackedSlugs.has(c.slug));

  // Show results when focused and has input
  const showResults = isFocused && (search.length > 0 || companies.length > 0);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        listRef.current &&
        !listRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (company: Company) => {
    onSelect(company);
    setSearch('');
    inputRef.current?.blur();
    setIsFocused(false);
  };

  return (
    <div className="relative w-full">
      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 text-base border border-gray-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showResults && (
        <div
          ref={listRef}
          className="absolute z-20 w-full mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 max-h-80 overflow-y-auto"
        >
          {loading ? (
            <div className="p-4 text-center">
              <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              <p className="mt-2 text-sm text-gray-500">Loading companies...</p>
            </div>
          ) : availableCompanies.length === 0 ? (
            <div className="p-4 text-center">
              {search ? (
                <>
                  <svg className="mx-auto w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    No companies found for &quot;{search}&quot;
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Try a different search or add a custom company
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  All available companies have been added
                </p>
              )}
            </div>
          ) : (
            <>
              {search && (
                <div className="px-3 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {availableCompanies.length} {availableCompanies.length === 1 ? 'company' : 'companies'} found
                  </p>
                </div>
              )}
              <ul className="py-1">
                {availableCompanies.slice(0, 20).map((company) => (
                  <li key={company.slug}>
                    <button
                      onClick={() => handleSelect(company)}
                      className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-white truncate">
                            {company.name}
                          </span>
                          <TierBadge tier={company.tier} />
                        </div>
                        {company.industry && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {company.industry}
                          </p>
                        )}
                      </div>
                      <svg
                        className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                  </li>
                ))}
                {availableCompanies.length > 20 && (
                  <li className="px-3 py-2 text-center text-xs text-gray-400 border-t border-gray-100 dark:border-slate-700">
                    Showing 20 of {availableCompanies.length} results. Type to narrow down.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
