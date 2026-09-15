'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Company, NotifyMode, JobFilters, NOTIFY_MODE_LABELS, NOTIFY_MODE_DESCRIPTIONS } from '@/lib/types';
import { CompanyGrid } from '@/components/companies/CompanyGrid';
import { SearchBox } from '@/components/jobs/SearchBox';
import { Button } from '@/components/ui/Button';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AddCompanyModal } from '@/components/companies/AddCompanyModal';
import { CompanyFilterModal } from '@/components/companies/CompanyFilterModal';
import { AddCompanyWithFiltersModal } from '@/components/companies/AddCompanyWithFiltersModal';
import { BulkFilterModal } from '@/components/companies/BulkFilterModal';
import { ToastContainer, useToast } from '@/components/ui/Toast';

type TabType = 'my-companies' | 'add-companies';

export default function MyListPage() {
  return (
    <AuthGuard>
      {(user) => <MyListContent userId={user.id} />}
    </AuthGuard>
  );
}

function MyListContent({ userId }: { userId: string }) {
  const { toasts, showToast, removeToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('my-companies');
  const [trackedCompanies, setTrackedCompanies] = useState<Company[]>([]);
  const [autoApplySlugs, setAutoApplySlugs] = useState<Set<string>>(new Set());
  const [notifySlugs, setNotifySlugs] = useState<Set<string>>(new Set());
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('instant');
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({});
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  // Filter modal state
  const [filterModalSlug, setFilterModalSlug] = useState<string | null>(null);
  const [companyFilters, setCompanyFilters] = useState<Record<string, JobFilters>>({});
  // New UX features
  const [selectedCompanyToAdd, setSelectedCompanyToAdd] = useState<Company | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [showBulkFilterModal, setShowBulkFilterModal] = useState(false);
  const supabase = createClient();

  const fetchTrackedCompanies = useCallback(async () => {
    let listData: { company_slug: string; auto_apply?: boolean; notify_enabled?: boolean; notify_mode?: NotifyMode; job_filters?: JobFilters }[] | null = null;

    const { data, error } = await supabase
      .from('user_lists')
      .select('company_slug, auto_apply, notify_enabled, notify_mode, job_filters')
      .eq('user_id', userId);

    if (error) {
      console.log('Fetching user_lists (trying fallback):', error.message);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('user_lists')
        .select('company_slug')
        .eq('user_id', userId);

      if (fallbackError) {
        console.error('Error fetching user_lists:', fallbackError);
      }
      listData = fallbackData;
    } else {
      listData = data;
    }

    console.log('Fetched tracked companies:', listData?.length || 0, 'for user:', userId);

    if (!listData || listData.length === 0) {
      setTrackedCompanies([]);
      setAutoApplySlugs(new Set());
      setNotifySlugs(new Set());
      setCompanyFilters({});
      return [];
    }

    const slugs = listData.map((item) => item.company_slug);
    const autoApply = new Set(
      listData.filter((item) => item.auto_apply).map((item) => item.company_slug)
    );
    setAutoApplySlugs(autoApply);

    // Set notification state
    const notify = new Set(
      listData.filter((item) => item.notify_enabled !== false).map((item) => item.company_slug)
    );
    setNotifySlugs(notify);

    // Set company filters
    const filters: Record<string, JobFilters> = {};
    listData.forEach((item) => {
      if (item.job_filters && Object.keys(item.job_filters).length > 0) {
        filters[item.company_slug] = item.job_filters;
      }
    });
    setCompanyFilters(filters);

    // Get the most common notify mode (default to instant)
    const modes = listData.filter((item) => item.notify_mode).map((item) => item.notify_mode!);
    if (modes.length > 0) {
      const modeCount: Record<string, number> = {};
      modes.forEach((m) => { modeCount[m] = (modeCount[m] || 0) + 1; });
      const topMode = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0]?.[0] as NotifyMode;
      if (topMode) setNotifyMode(topMode);
    }

    const { data: companiesData } = await supabase
      .from('companies')
      .select('*')
      .in('slug', slugs);

    if (companiesData) {
      setTrackedCompanies(companiesData as Company[]);

      // Fetch job counts for these companies
      const { data: jobsData } = await supabase
        .from('jobs')
        .select('company_slug')
        .in('company_slug', slugs)
        .eq('is_active', true);

      if (jobsData) {
        const counts: Record<string, number> = {};
        jobsData.forEach((job) => {
          counts[job.company_slug] = (counts[job.company_slug] || 0) + 1;
        });
        setJobCounts(counts);
      }

      return slugs;
    }
    return slugs;
  }, [userId, supabase]);

  const fetchAllCompanies = useCallback(async () => {
    let query = supabase.from('companies').select('*').order('name');

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data } = await query;
    if (data) {
      setAllCompanies(data);
    }
  }, [search, supabase]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        fetchTrackedCompanies(),
        fetchAllCompanies(),
      ]);
      setLoading(false);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (activeTab !== 'add-companies') return;

    let cancelled = false;

    const loadCompanies = async () => {
      let query = supabase.from('companies').select('*').order('name');

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data } = await query;
      if (!cancelled && data) {
        setAllCompanies(data);
      }
    };

    loadCompanies();

    return () => {
      cancelled = true;
    };
  }, [search, activeTab, supabase]);

  const handleToggleCompany = async (slug: string) => {
    const isTracked = trackedCompanies.some((c) => c.slug === slug);

    if (isTracked) {
      const { error } = await supabase
        .from('user_lists')
        .delete()
        .eq('user_id', userId)
        .eq('company_slug', slug);

      if (error) {
        console.error('Error removing company:', error);
        return;
      }

      setTrackedCompanies((prev) => prev.filter((c) => c.slug !== slug));
      setAutoApplySlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setNotifySlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    } else {
      let insertError = null;
      // Default notify_enabled to true when adding a company
      const { error } = await supabase
        .from('user_lists')
        .insert({ user_id: userId, company_slug: slug, auto_apply: false, notify_enabled: true, notify_mode: notifyMode });

      if (error) {
        const { error: fallbackError } = await supabase
          .from('user_lists')
          .insert({ user_id: userId, company_slug: slug });
        insertError = fallbackError;
      }

      if (insertError) {
        console.error('Error adding company:', insertError);
        return;
      }

      const company = allCompanies.find((c) => c.slug === slug);
      if (company) {
        setTrackedCompanies((prev) => [...prev, company]);
        // Enable notifications by default for new companies
        setNotifySlugs((prev) => new Set(prev).add(slug));
      }
    }
  };

  const handleAutoApplyToggle = async (slug: string, enabled: boolean) => {
    // Update UI immediately (optimistic update)
    setAutoApplySlugs((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(slug);
      } else {
        next.delete(slug);
      }
      return next;
    });

    // Try to persist to database (will fail gracefully if column doesn't exist)
    const { error } = await supabase
      .from('user_lists')
      .update({ auto_apply: enabled })
      .eq('user_id', userId)
      .eq('company_slug', slug);

    if (error) {
      console.log('Auto-apply toggle: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleAutoApplyAll = async (enabled: boolean) => {
    const slugs = trackedCompanies.map((c) => c.slug);

    // Update UI immediately (optimistic update)
    if (enabled) {
      setAutoApplySlugs(new Set(slugs));
    } else {
      setAutoApplySlugs(new Set());
    }

    // Try to persist to database (will fail gracefully if column doesn't exist)
    const { error } = await supabase
      .from('user_lists')
      .update({ auto_apply: enabled })
      .eq('user_id', userId)
      .in('company_slug', slugs);

    if (error) {
      console.log('Auto-apply all: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleNotifyToggle = async (slug: string, enabled: boolean) => {
    // Update UI immediately (optimistic update)
    setNotifySlugs((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(slug);
      } else {
        next.delete(slug);
      }
      return next;
    });

    // Persist to database
    const { error } = await supabase
      .from('user_lists')
      .update({ notify_enabled: enabled })
      .eq('user_id', userId)
      .eq('company_slug', slug);

    if (error) {
      console.log('Notify toggle: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleNotifyAll = async (enabled: boolean) => {
    const slugs = trackedCompanies.map((c) => c.slug);

    // Update UI immediately (optimistic update)
    if (enabled) {
      setNotifySlugs(new Set(slugs));
    } else {
      setNotifySlugs(new Set());
    }

    // Persist to database
    const { error } = await supabase
      .from('user_lists')
      .update({ notify_enabled: enabled })
      .eq('user_id', userId)
      .in('company_slug', slugs);

    if (error) {
      console.log('Notify all: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleNotifyModeChange = async (mode: NotifyMode) => {
    setNotifyMode(mode);

    // Update all user_lists entries with the new mode
    const { error } = await supabase
      .from('user_lists')
      .update({ notify_mode: mode })
      .eq('user_id', userId);

    if (error) {
      console.log('Notify mode change: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleFilterClick = (slug: string) => {
    setFilterModalSlug(slug);
  };

  // New: Add company with filters from the Add Companies tab
  const handleAddCompanyWithFilters = async (
    slug: string,
    filters: JobFilters,
    options: { autoApply?: boolean; notifyEnabled?: boolean }
  ) => {
    const { autoApply = false, notifyEnabled = true } = options;

    // Already tracking this company? Tell the user instead of failing silently.
    if (trackedCompanies.some((c) => c.slug === slug)) {
      showToast('That company is already in your watchlist.', 'info');
      setSelectedCompanyToAdd(null);
      return;
    }

    // Insert into user_lists with all options
    const { error } = await supabase
      .from('user_lists')
      .insert({
        user_id: userId,
        company_slug: slug,
        auto_apply: autoApply,
        notify_enabled: notifyEnabled,
        notify_mode: notifyMode,
        job_filters: Object.keys(filters).length > 0 ? filters : null,
      });

    if (error) {
      // Unique-constraint violation = already tracked (race with the check above).
      if (error.code === '23505') {
        showToast('That company is already in your watchlist.', 'info');
        setSelectedCompanyToAdd(null);
        return;
      }
      // Try fallback without filters (e.g. optional columns missing)
      const { error: fallbackError } = await supabase
        .from('user_lists')
        .insert({ user_id: userId, company_slug: slug });
      if (fallbackError) {
        if (fallbackError.code === '23505') {
          showToast('That company is already in your watchlist.', 'info');
        } else {
          console.error('Error adding company:', fallbackError);
          showToast('Could not add that company. Please try again.', 'error');
        }
        setSelectedCompanyToAdd(null);
        return;
      }
    }
    showToast('Added to your watchlist.', 'success');

    const company = allCompanies.find((c) => c.slug === slug);
    if (company) {
      setTrackedCompanies((prev) => [...prev, company]);
      if (notifyEnabled) {
        setNotifySlugs((prev) => new Set(prev).add(slug));
      }
      if (autoApply) {
        setAutoApplySlugs((prev) => new Set(prev).add(slug));
      }
      if (Object.keys(filters).length > 0) {
        setCompanyFilters((prev) => ({ ...prev, [slug]: filters }));
      }
    }
    setSelectedCompanyToAdd(null);
  };

  // New: Apply bulk filters to multiple companies
  const handleBulkFilters = async (slugs: string[], filters: JobFilters) => {
    // Update UI optimistically
    setCompanyFilters((prev) => {
      const next = { ...prev };
      slugs.forEach((slug) => {
        if (Object.keys(filters).length > 0) {
          next[slug] = filters;
        } else {
          delete next[slug];
        }
      });
      return next;
    });

    // Persist to database for each company
    const updatePromises = slugs.map((slug) =>
      supabase
        .from('user_lists')
        .update({ job_filters: Object.keys(filters).length > 0 ? filters : null })
        .eq('user_id', userId)
        .eq('company_slug', slug)
    );

    const results = await Promise.all(updatePromises);
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      console.log('Some bulk filter updates failed:', errors.length);
    }

    // Clear selection mode after applying
    setSelectMode(false);
    setSelectedSlugs(new Set());
  };

  // New: Toggle company selection for bulk operations
  const handleSelectToggle = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleSaveFilters = async (slug: string, filters: JobFilters) => {
    // Update UI immediately (optimistic update)
    setCompanyFilters((prev) => {
      const next = { ...prev };
      if (Object.keys(filters).length > 0) {
        next[slug] = filters;
      } else {
        delete next[slug];
      }
      return next;
    });

    // Persist to database
    const { error } = await supabase
      .from('user_lists')
      .update({ job_filters: filters })
      .eq('user_id', userId)
      .eq('company_slug', slug);

    if (error) {
      console.log('Filter save: column may not exist yet, UI updated but not persisted');
    }
  };

  const handleAddCustomCompany = async (name: string, careersUrl: string, tier: string): Promise<{ success: boolean; error?: string }> => {
    // Use the new API endpoint that adds companies globally
    // This makes user-added companies available to all users
    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          careers_url: careersUrl || undefined,
          tier: tier || 'other',
          add_to_list: true, // Automatically track the company
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 409) {
          // Company already exists - suggest searching for it
          return {
            success: false,
            error: result.error || 'This company already exists. Search for it in "Add Companies".',
          };
        }
        if (response.status === 429) {
          return {
            success: false,
            error: 'Rate limit exceeded. Please try again later.',
          };
        }
        return {
          success: false,
          error: result.error || 'Failed to add company. Please try again.',
        };
      }

      // Company added successfully - update local state
      const newCompany: Company = {
        slug: result.company.slug,
        name: result.company.name,
        tier: result.company.tier as Company['tier'],
        ats_type: null,
        ats_token: null,
        logo_url: null,
        careers_url: result.company.careers_url,
        created_at: new Date().toISOString(),
        funding_stage: null,
        company_size: null,
        industry: null,
        founded_year: null,
        headquarters: null,
        description: null,
        stock_ticker: null,
        is_public: null,
        enriched_at: null,
      };

      setTrackedCompanies((prev) => [...prev, newCompany]);
      // Also add to allCompanies so it shows up in search
      setAllCompanies((prev) => [...prev, newCompany]);
      setNotifySlugs((prev) => new Set(prev).add(newCompany.slug));
      setShowAddCompanyModal(false);

      return { success: true };
    } catch (error) {
      console.error('Error adding company:', error);
      return {
        success: false,
        error: 'Failed to add company. Please try again.',
      };
    }
  };

  const trackedSlugs = new Set(trackedCompanies.map((c) => c.slug));
  const filterSlugs = new Set(Object.keys(companyFilters));
  const allAutoApplyEnabled = trackedCompanies.length > 0 && autoApplySlugs.size === trackedCompanies.length;
  const allNotifyEnabled = trackedCompanies.length > 0 && notifySlugs.size === trackedCompanies.length;
  const someNotifyEnabled = notifySlugs.size > 0;
  const filterModalCompany = filterModalSlug ? trackedCompanies.find((c) => c.slug === filterModalSlug) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Watchlist</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Track companies to get notified about new jobs
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('my-companies')}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'my-companies'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Companies ({trackedCompanies.length})
        </button>
        <button
          onClick={() => setActiveTab('add-companies')}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'add-companies'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          + Add Companies
        </button>
      </div>

      {activeTab === 'my-companies' && (
        trackedCompanies.length === 0 ? (
          <div className="text-center py-12">
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
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">No companies tracked yet</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400 mb-4">
              Track companies to get notified when they post new jobs.
            </p>
            <Button variant="primary" onClick={() => setActiveTab('add-companies')}>
              Add Companies
            </Button>
          </div>
        ) : (
          <>
            {/* Quick Settings Bar - Compact toggles */}
            <div className="mb-6 flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg">
              {/* Notifications toggle */}
              <button
                onClick={() => handleNotifyAll(!allNotifyEnabled)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  allNotifyEnabled
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-gray-400'
                }`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
                Notifications {allNotifyEnabled ? 'On' : 'Off'}
              </button>

              {/* Auto-apply toggle */}
              <button
                onClick={() => handleAutoApplyAll(!allAutoApplyEnabled)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  allAutoApplyEnabled
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                    : 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-gray-400'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-Apply {allAutoApplyEnabled ? 'On' : 'Off'}
              </button>

              {/* Status summary */}
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                {notifySlugs.size}/{trackedCompanies.length} notifications • {autoApplySlugs.size}/{trackedCompanies.length} auto-apply
              </span>
            </div>

            {/* Bulk actions bar */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant={selectMode ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectMode(!selectMode);
                    if (selectMode) {
                      setSelectedSlugs(new Set());
                    }
                  }}
                >
                  {selectMode ? 'Cancel Selection' : 'Select Companies'}
                </Button>
                {selectMode && selectedSlugs.size > 0 && (
                  <>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedSlugs.size} selected
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedSlugs(new Set(trackedCompanies.map((c) => c.slug)))}
                    >
                      Select All
                    </Button>
                  </>
                )}
              </div>
              {selectMode && selectedSlugs.size > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowBulkFilterModal(true)}
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                  Apply Filters to {selectedSlugs.size}
                </Button>
              )}
            </div>

            <CompanyGrid
              companies={trackedCompanies}
              trackedSlugs={trackedSlugs}
              autoApplySlugs={autoApplySlugs}
              notifySlugs={notifySlugs}
              filterSlugs={filterSlugs}
              jobCounts={jobCounts}
              onToggle={handleToggleCompany}
              onAutoApplyToggle={handleAutoApplyToggle}
              onNotifyToggle={handleNotifyToggle}
              onFilterClick={handleFilterClick}
              showAutoApplyToggle={true}
              showNotifyToggle={true}
              loading={loading}
              selectMode={selectMode}
              selectedSlugs={selectedSlugs}
              onSelectToggle={handleSelectToggle}
            />
          </>
        )
      )}

      {activeTab === 'add-companies' && (
        <>
          {/* Unified search and browse */}
          <div className="mb-6 flex gap-4">
            <div className="flex-1">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search companies..."
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setShowAddCompanyModal(true)}
            >
              + Add Custom
            </Button>
          </div>

          {/* Company grid - filtered by search */}
          <CompanyGrid
            companies={allCompanies.filter(c => !trackedSlugs.has(c.slug))}
            trackedSlugs={trackedSlugs}
            jobCounts={jobCounts}
            onToggle={(slug) => {
              const company = allCompanies.find((c) => c.slug === slug);
              if (company) {
                setSelectedCompanyToAdd(company);
              }
            }}
            loading={loading}
          />
        </>
      )}

      <AddCompanyModal
        isOpen={showAddCompanyModal}
        onClose={() => setShowAddCompanyModal(false)}
        onSubmit={handleAddCustomCompany}
      />

      {filterModalCompany && (
        <CompanyFilterModal
          isOpen={filterModalSlug !== null}
          onClose={() => setFilterModalSlug(null)}
          companyName={filterModalCompany.name}
          companySlug={filterModalCompany.slug}
          initialFilters={companyFilters[filterModalCompany.slug] || {}}
          onSave={handleSaveFilters}
        />
      )}

      {/* Add Company with Filters Modal */}
      <AddCompanyWithFiltersModal
        isOpen={selectedCompanyToAdd !== null}
        onClose={() => setSelectedCompanyToAdd(null)}
        company={selectedCompanyToAdd}
        onSubmit={handleAddCompanyWithFilters}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Bulk Filter Modal */}
      <BulkFilterModal
        isOpen={showBulkFilterModal}
        onClose={() => setShowBulkFilterModal(false)}
        selectedCompanies={trackedCompanies.filter((c) => selectedSlugs.has(c.slug))}
        existingFilters={companyFilters}
        onApply={handleBulkFilters}
      />
    </div>
  );
}
