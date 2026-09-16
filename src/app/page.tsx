'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { Job, Tier, RoleType, ApplicationLog, Recruiter, SponsorshipStatus, FundingFilter, SourceFilter, SmartFilter, ExperienceLevel, DiversityTag, WorkMode, BadgeTag, LocationFilter, LOCATION_FILTER_PATTERNS, rawSourcesForFilters } from '@/lib/types';
import { JobList } from '@/components/jobs/JobList';
import { RecruiterFormData } from '@/components/recruiters/AddRecruiterModal';
import { JobFilters, MobileFilters } from '@/components/jobs/JobFilters';
import { SmartFilters } from '@/components/jobs/SmartFilters';
import { AlertFilters } from '@/components/alerts/SaveAlertModal';
import { SearchBox } from '@/components/jobs/SearchBox';
import { Button } from '@/components/ui/Button';
import { Toast, useToast } from '@/components/ui/Toast';
import { HeroAnimated, StatsContainer, Animated } from '@/components/ui/AnimatedContainer';
import { NewJobsBanner } from '@/components/ui/NewJobsBanner';
import { ConnectionStatusIndicator } from '@/components/ui/ConnectionStatusIndicator';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { GuestHero } from '@/components/dashboard/GuestHero';
import { CompanyLogos } from '@/components/dashboard/CompanyLogos';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { JobCardSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { useStreak, useSupabaseRealtime, useOptimisticJobs, useJobFilterCounts } from '@/hooks';

// Dynamic imports for heavy components that aren't needed immediately
const CommandPalette = dynamic(
  () => import('@/components/ui/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

const SaveAlertModal = dynamic(
  () => import('@/components/alerts/SaveAlertModal').then(m => m.SaveAlertModal),
  { ssr: false }
);

const TrendingSection = dynamic(
  () => import('@/components/dashboard/TrendingSection').then(m => m.TrendingSection),
  { ssr: false, loading: () => <TrendingSectionSkeleton /> }
);

// Skeleton for TrendingSection while loading
function TrendingSectionSkeleton() {
  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Trending Now Column Skeleton */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="w-6 h-6 rounded" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-9 h-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <Skeleton className="h-5 w-10" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Closing Soon Column Skeleton */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="w-6 h-6 rounded" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex items-start gap-3">
                  <Skeleton className="w-9 h-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Skeleton for JobList section
function JobListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}

const PAGE_SIZE = 12;

interface UserProfile {
  firstName: string;
  weeklyGoal: number;
}

interface StatsData {
  activeCount: number;
  activeThisWeek: number;
  processingCount: number;
  interviewCount: number;
  nextInterviewDate?: string;
  weeklyProgress: number;
}

export default function HomePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTiers, setSelectedTiers] = useState<Tier[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<RoleType[]>([]);
  const [sponsorshipFilter, setSponsorshipFilter] = useState<SponsorshipStatus | null>(null);
  const [selectedFundingStages, setSelectedFundingStages] = useState<FundingFilter[]>([]);
  const [selectedSources, setSelectedSources] = useState<SourceFilter[]>([]);
  const [salaryMin, setSalaryMin] = useState<number | null>(null);
  const [salaryMax, setSalaryMax] = useState<number | null>(null);
  const [hasRecruiters, setHasRecruiters] = useState(false);
  const [jobsWithRecruiters, setJobsWithRecruiters] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [autoApplyEnabled, setAutoApplyEnabled] = useState(true);
  const [applications, setApplications] = useState<Map<string, ApplicationLog>>(new Map());
  // job_id -> status in the new autoapply_job_queue, so cards mirror the Auto-Apply tab.
  const [autoApplyStatuses, setAutoApplyStatuses] = useState<Record<string, string>>({});
  const [recruitersMap, setRecruitersMap] = useState<Map<string, Recruiter[]>>(new Map());
  // Job ids we've already fetched recruiters for — so infinite-scroll only
  // fetches the delta instead of re-querying the whole list each append.
  const fetchedRecruiterJobIds = useRef<Set<string>>(new Set());
  // Bulk interview-question counts per company (fetched once), so each job
  // card's Interview Prep badge reads from this map instead of firing its own
  // request — the per-card fetch was an N+1 that made scrolling lag.
  const [interviewCounts, setInterviewCounts] = useState<Record<string, number>>({});
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [totalJobCount, setTotalJobCount] = useState(0);
  // New filter state
  const [smartFilters, setSmartFilters] = useState<SmartFilter[]>([]);
  const [experienceLevels, setExperienceLevels] = useState<ExperienceLevel[]>([]);
  const [diversityTags, setDiversityTags] = useState<DiversityTag[]>([]);
  const [workModes, setWorkModes] = useState<WorkMode[]>([]);
  const [badges, setBadges] = useState<BadgeTag[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<LocationFilter[]>([]);
  const [sortBy, setSortBy] = useState<'date' | 'salary' | 'company'>('date');
  const [showSaveAlertModal, setShowSaveAlertModal] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [statsData, setStatsData] = useState<StatsData>({
    activeCount: 0,
    activeThisWeek: 0,
    processingCount: 0,
    interviewCount: 0,
    weeklyProgress: 0,
  });
  const { toasts, showToast, removeToast } = useToast();
  const supabase = createClient();

  // Streak hook for logged-in users
  const { days: streakDays, incrementStreak } = useStreak();

  // Real-time updates with useSupabaseRealtime hook
  const {
    connectionStatus,
    newJobCount,
    newJobs,
    clearNewJobs,
    reconnect,
    isConnected,
  } = useSupabaseRealtime({
    tierFilter: selectedTiers.length > 0 ? selectedTiers : undefined,
    roleFilter: selectedRoles.length > 0 ? selectedRoles : undefined,
    onNewJob: (job) => {
      console.log('New job received:', job.title);
    },
  });

  // Optimistic updates for job actions
  const {
    addOptimisticSave,
    addOptimisticUnsave,
    confirmSave,
    confirmUnsave,
    revertSave,
    revertUnsave,
    isOptimisticallySaved,
  } = useOptimisticJobs();

  // Real-time filter counts
  const {
    counts: filterCounts,
    loading: filterCountsLoading,
  } = useJobFilterCounts({ realtime: true });

  const fetchJobsWithRecruiters = useCallback(async () => {
    // Get recruiters with direct job links
    const { data: jobRecruiters } = await supabase
      .from('recruiters')
      .select('job_id')
      .not('job_id', 'is', null);

    // Get recruiters linked to companies (for company-level recruiters)
    const { data: companyRecruiters } = await supabase
      .from('recruiters')
      .select('company_slug');

    const jobIds = new Set<string>();

    // Add direct job IDs
    if (jobRecruiters) {
      jobRecruiters.forEach((r) => {
        if (r.job_id) jobIds.add(r.job_id);
      });
    }

    // For company recruiters, find jobs from those companies
    if (companyRecruiters && companyRecruiters.length > 0) {
      const companySlugs = [...new Set(companyRecruiters.map((r) => r.company_slug))];
      const { data: companyJobs } = await supabase
        .from('jobs')
        .select('id')
        .in('company_slug', companySlugs)
        .eq('is_active', true);

      if (companyJobs) {
        companyJobs.forEach((j) => jobIds.add(j.id));
      }
    }

    console.log('Jobs with recruiters:', jobIds.size);
    setJobsWithRecruiters(jobIds);
    return jobIds;
  }, [supabase]);

  const fetchJobs = useCallback(async (reset = false, recruiterJobIds?: Set<string>, pageOverride?: number) => {
    setLoading(true);
    const currentPage = reset ? 0 : (pageOverride ?? page);

    let query = supabase
      .from('jobs')
      .select('*')
      .eq('is_active', true)
      // Hide listings the enricher flagged as non-jobs (conferences/events/ads).
      .neq('is_job', false);

    // Apply sort order based on sortBy
    if (sortBy === 'salary') {
      query = query.order('salary_max', { ascending: false, nullsFirst: false });
    } else if (sortBy === 'company') {
      query = query.order('company_name', { ascending: true });
    } else {
      // Default: date (newest first)
      query = query.order('posted', { ascending: false, nullsFirst: false });
    }

    query = query.range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`);
    }

    if (selectedTiers.length > 0) {
      query = query.in('tier', selectedTiers);
    }

    if (selectedRoles.length > 0) {
      query = query.overlaps('role_types', selectedRoles);
    }

    // Filter by sponsorship status
    if (sponsorshipFilter) {
      query = query.eq('sponsorship_status', sponsorshipFilter);
    }

    // Filter by funding stage
    if (selectedFundingStages.length > 0) {
      query = query.in('funding_stage', selectedFundingStages);
    }

    // Filter by source
    // Source filter: the UI selects categories (ats/job_boards/conferences…)
    // but the jobs table stores raw source names (greenhouse/simplify/…), so
    // expand categories to the raw values before filtering.
    if (selectedSources.length > 0) {
      const rawSources = rawSourcesForFilters(selectedSources);
      // If a category maps to no known raw source, return nothing rather than
      // silently ignoring the filter.
      query = query.in('source', rawSources.length > 0 ? rawSources : ['__none__']);
    }

    // Filter by salary range
    if (salaryMin !== null) {
      query = query.gte('salary_max', salaryMin * 1000);
    }
    if (salaryMax !== null) {
      query = query.lte('salary_min', salaryMax * 1000);
    }

    // Filter by jobs with recruiters
    if (hasRecruiters) {
      if (recruiterJobIds && recruiterJobIds.size > 0) {
        query = query.in('id', Array.from(recruiterJobIds));
      } else {
        // No jobs with recruiters found - return empty
        setJobs([]);
        setHasMore(false);
        setLoading(false);
        return;
      }
    }

    // Smart filters
    if (smartFilters.includes('hidden_gems')) {
      // Jobs not from LinkedIn/Indeed
      query = query.not('source', 'in', '(linkedin,indeed)');
    }

    if (smartFilters.includes('hot_now')) {
      // Posted in last 3 days
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      query = query.gte('posted', threeDaysAgo.toISOString());
    }

    if (smartFilters.includes('new_grad_only')) {
      // experience_level = 'new_grad' or title contains "new grad"
      query = query.or('experience_level.eq.new_grad,title.ilike.%new grad%');
    }

    if (smartFilters.includes('closing_soon')) {
      // Deadline within 7 days
      const today = new Date();
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(today.getDate() + 7);
      query = query.not('deadline', 'is', null)
        .gte('deadline', today.toISOString())
        .lte('deadline', sevenDaysFromNow.toISOString());
    }

    if (smartFilters.includes('high_paying')) {
      // salary_min >= 150000
      query = query.gte('salary_min', 150000);
    }

    // Filter by experience level (multi-select). Picking "New Grad" is
    // inclusive of everything a new grad can actually apply to — new_grad/
    // entry/junior plus unclassified generic roles — while excluding clearly-
    // senior postings. Levels combine as a union (e.g. New Grad + Mid).
    if (experienceLevels.length > 0) {
      const levelSet = new Set<string>();
      let includeNull = false;
      experienceLevels.forEach((l) => {
        if (l === 'new_grad') {
          ['new_grad', 'entry_level', 'junior'].forEach((x) => levelSet.add(x));
          includeNull = true;
        } else {
          levelSet.add(l);
        }
      });
      const inList = Array.from(levelSet).join(',');
      if (includeNull) {
        query = query.or(`experience_level.in.(${inList}),experience_level.is.null`);
      } else {
        query = query.in('experience_level', Array.from(levelSet));
      }
    }

    // Filter by diversity tags (overlaps array)
    if (diversityTags.length > 0) {
      query = query.overlaps('diversity_tags', diversityTags);
    }

    // Filter by work modes (overlaps array)
    if (workModes.length > 0) {
      query = query.overlaps('work_modes', workModes);
    }

    // Filter by badges (overlaps array)
    if (badges.length > 0) {
      query = query.overlaps('badges', badges);
    }

    // Filter by location
    if (selectedLocations.length > 0) {
      // Build OR conditions for all selected location patterns
      const locationConditions: string[] = [];
      selectedLocations.forEach((loc) => {
        const patterns = LOCATION_FILTER_PATTERNS[loc];
        patterns.forEach((pattern) => {
          locationConditions.push(`location.ilike.%${pattern}%`);
        });
      });
      if (locationConditions.length > 0) {
        query = query.or(locationConditions.join(','));
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching jobs:', error);
      setFetchError('Failed to load jobs. Please try again.');
      setLoading(false);
      return;
    }

    // Clear any previous error on successful fetch
    setFetchError(null);

    if (reset) {
      setJobs(data || []);
      setPage(0);
    } else {
      setJobs((prev) => [...prev, ...(data || [])]);
    }

    setHasMore((data?.length || 0) === PAGE_SIZE);
    setLoading(false);
    // `page` is intentionally omitted from deps: Load More passes the target
    // page via pageOverride, so fetchJobs must NOT be recreated on page change
    // (that would refire the reset effect below and wipe appended results).
  }, [search, selectedTiers, selectedRoles, sponsorshipFilter, selectedFundingStages, selectedSources, salaryMin, salaryMax, hasRecruiters, smartFilters, experienceLevels, diversityTags, workModes, badges, selectedLocations, sortBy, supabase]);

  const fetchSavedJobs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('saved_jobs')
      .select('job_id')
      .eq('user_id', user.id);

    if (data) {
      setSavedJobIds(new Set(data.map((s) => s.job_id)));
    }
  }, [supabase]);

  const fetchAutoApplyData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch user profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('auto_apply_enabled, first_name, weekly_goal')
      .eq('user_id', user.id)
      .single();

    if (profile) {
      // Use the actual value from DB, default to true if null/undefined
      setAutoApplyEnabled(profile.auto_apply_enabled !== false);
      setUserProfile({
        firstName: profile.first_name || 'there',
        weeklyGoal: profile.weekly_goal || 10,
      });
    }

    // Fetch the user's auto-apply queue state so job cards mirror the Auto-Apply tab.
    fetch('/api/auto-apply/queue')
      .then((r) => r.json())
      .then((d) => setAutoApplyStatuses(d.statuses || {}))
      .catch(() => {});

    // Fetch application logs
    const { data: logs } = await supabase
      .from('application_logs')
      .select('*')
      .eq('user_id', user.id);

    if (logs) {
      const appMap = new Map<string, ApplicationLog>();
      logs.forEach((log) => appMap.set(log.job_id, log as ApplicationLog));
      setApplications(appMap);

      // Calculate stats
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0);

      let activeCount = 0;
      let activeThisWeek = 0;
      let processingCount = 0;
      let interviewCount = 0;
      let weeklyProgress = 0;
      let nextInterviewDate: string | undefined;

      logs.forEach((log) => {
        const createdAt = new Date(log.created_at);

        // Active applications (pending, submitted, or in_review)
        if (['pending', 'submitted', 'in_review'].includes(log.status)) {
          activeCount++;
        }

        // Applications this week
        if (createdAt >= weekStart) {
          activeThisWeek++;
          weeklyProgress++;
        }

        // Processing (awaiting response)
        if (log.status === 'submitted' || log.status === 'in_review') {
          processingCount++;
        }

        // Interviews scheduled
        if (log.status === 'interview_scheduled') {
          interviewCount++;
          // Track next interview date
          if (log.interview_date) {
            const interviewDate = new Date(log.interview_date);
            if (interviewDate > now) {
              if (!nextInterviewDate || interviewDate < new Date(nextInterviewDate)) {
                nextInterviewDate = log.interview_date;
              }
            }
          }
        }
      });

      setStatsData({
        activeCount,
        activeThisWeek,
        processingCount,
        interviewCount,
        nextInterviewDate,
        weeklyProgress,
      });
    }
  }, [supabase]);

  const fetchRecruiters = useCallback(async (jobIds: string[], companySlugs: string[]) => {
    if (jobIds.length === 0 && companySlugs.length === 0) return;
    const { data } = await supabase
      .from('recruiters')
      .select('*')
      .or(`job_id.in.(${jobIds.join(',')}),company_slug.in.(${companySlugs.join(',')})`);

    if (data) {
      // Build a partial map for just the keys we queried, then MERGE it into the
      // existing map (overwriting only those keys). This lets us fetch recruiters
      // incrementally for newly-loaded jobs instead of re-querying every job on
      // the page on each infinite-scroll append.
      const partial = new Map<string, Recruiter[]>();
      data.forEach((r) => {
        const key = r.job_id || r.company_slug;
        if (key) {
          const existing = partial.get(key) || [];
          existing.push(r as Recruiter);
          partial.set(key, existing);
        }
      });
      setRecruitersMap((prev) => {
        const map = new Map(prev);
        partial.forEach((list, key) => map.set(key, list));
        return map;
      });
    }
  }, [supabase]);

  const handleFindRecruiters = async (companySlug: string, companyName: string, jobId: string) => {
    try {
      const response = await fetch('/api/find-recruiters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companySlug, companyName, jobId }),
      });

      const result = await response.json();

      if (result.found > 0) {
        showToast(`Found ${result.found} recruiter(s) for ${companyName}!`, 'success');
        // Refresh recruiters
        const jobIds = jobs.map((j) => j.id);
        const slugs = [...new Set(jobs.map((j) => j.company_slug))];
        await fetchRecruiters(jobIds, slugs);
      } else {
        showToast(`No recruiters found for ${companyName}`, 'info');
      }
    } catch (error) {
      showToast('Failed to find recruiters', 'error');
    }
  };

  const handleAddRecruiter = async (data: RecruiterFormData) => {
    try {
      const response = await fetch('/api/recruiters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          title: data.title,
          email: data.email,
          phone: data.phone,
          linkedin_url: data.linkedin_url,
          company_slug: data.company_slug,
          job_id: data.job_id || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        showToast(result.error || 'Failed to add recruiter', 'error');
        return;
      }
      showToast(result.merged ? 'Updated recruiter contact' : 'Recruiter added — thanks!', 'success');
      const jobIds = jobs.map((j) => j.id);
      const slugs = [...new Set(jobs.map((j) => j.company_slug))];
      await fetchRecruiters(jobIds, slugs);
    } catch {
      showToast('Failed to add recruiter', 'error');
    }
  };

  useEffect(() => {
    const loadData = async () => {
      // Check if logged in
      const { data: { user } } = await supabase.auth.getUser();
      setIsLoggedIn(!!user);

      let recruiterJobIds: Set<string> | undefined;
      if (hasRecruiters) {
        recruiterJobIds = await fetchJobsWithRecruiters();
      }
      fetchJobs(true, recruiterJobIds);

      // Fetch user-specific data
      fetchSavedJobs();
      fetchAutoApplyData();
    };
    loadData();
  }, [search, selectedTiers, selectedRoles, selectedLocations, sponsorshipFilter, selectedFundingStages, selectedSources, salaryMin, salaryMax, hasRecruiters, smartFilters, experienceLevels, diversityTags, workModes, badges, sortBy, fetchJobs, fetchJobsWithRecruiters, fetchSavedJobs, fetchAutoApplyData]);

  // Fetch interview-question counts for all companies ONCE (bulk), so job-card
  // badges don't each fire their own request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/interview-questions/company-counts');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setInterviewCounts(data.counts || {});
        }
      } catch {
        /* non-fatal: badges just won't show until counts load */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Refetch auto-apply setting when page gains focus (e.g., returning from settings)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAutoApplyData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchAutoApplyData]);

  // Fetch existing recruiters when jobs change.
  // NOTE: we intentionally do NOT auto-call /api/find-recruiters on every load
  // — that spammed a slow, key-dependent endpoint for every company on each
  // render. Recruiter discovery now runs only on explicit user action
  // (handleFindRecruiters).
  useEffect(() => {
    const loadRecruiters = async () => {
      // Only fetch recruiters for jobs we haven't fetched yet. Previously this
      // re-queried EVERY job on the page on each infinite-scroll append, which
      // grew O(n²) and made cards render slowly while scrolling.
      const newJobs = jobs.filter((j) => !fetchedRecruiterJobIds.current.has(j.id));
      if (newJobs.length === 0) return;
      const jobIds = newJobs.map((j) => j.id);
      const slugs = [...new Set(newJobs.map((j) => j.company_slug))];
      newJobs.forEach((j) => fetchedRecruiterJobIds.current.add(j.id));
      await fetchRecruiters(jobIds, slugs);
    };

    loadRecruiters();
  }, [jobs, fetchRecruiters]);

  // Real-time subscription for application updates
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let mounted = true;

    const setupSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      channel = supabase
        .channel('home_application_updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'application_logs',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const log = payload.new as ApplicationLog;
              setApplications((prev) => {
                const next = new Map(prev);
                next.set(log.job_id, log);
                return next;
              });
            } else if (payload.eventType === 'DELETE') {
              const log = payload.old as ApplicationLog;
              setApplications((prev) => {
                const next = new Map(prev);
                next.delete(log.job_id);
                return next;
              });
            }
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      mounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [supabase]);

  // Note: Real-time subscription for new jobs is now handled by useSupabaseRealtime hook

  const handleSaveJob = async (jobId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = '/auth/login';
      return;
    }

    const isCurrentlySaved = savedJobIds.has(jobId);

    if (isCurrentlySaved) {
      // Optimistic unsave - show immediate UI feedback
      addOptimisticUnsave(jobId);

      try {
        const { error } = await supabase
          .from('saved_jobs')
          .delete()
          .eq('user_id', user.id)
          .eq('job_id', jobId);

        if (error) {
          // Server failed - revert optimistic update
          revertUnsave(jobId);
          showToast('Failed to unsave job', 'error');
          return;
        }

        // Server confirmed - update actual state and clear optimistic
        confirmUnsave(jobId);
        setSavedJobIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      } catch {
        revertUnsave(jobId);
        showToast('Failed to unsave job', 'error');
      }
    } else {
      // Optimistic save - show immediate UI feedback
      addOptimisticSave(jobId);

      try {
        const { error } = await supabase
          .from('saved_jobs')
          .insert({ user_id: user.id, job_id: jobId, status: 'saved' });

        if (error) {
          // Server failed - revert optimistic update
          revertSave(jobId);
          showToast('Failed to save job', 'error');
          return;
        }

        // Server confirmed - update actual state and clear optimistic
        confirmSave(jobId);
        setSavedJobIds((prev) => new Set(prev).add(jobId));
        // Increment streak when user saves a job
        incrementStreak();
      } catch {
        revertSave(jobId);
        showToast('Failed to save job', 'error');
      }
    }
  };

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    // Pass the next page explicitly — fetchJobs' closure still holds the old
    // `page` value at this point (state updates are async).
    fetchJobs(false, undefined, nextPage);
  }, [page, fetchJobs]);

  // Infinite scroll: auto-load the next page when the sentinel near the bottom
  // scrolls into view. rootMargin prefetches ~700px early so new jobs are
  // already loading before the user reaches the end — feels continuous.
  useEffect(() => {
    const el = loadMoreRef.current;
    // Don't auto-load while the filter drawer is open — the extra content
    // reflows the page and fights the user scrolling through the filters.
    if (!el || !hasMore || loading || jobs.length === 0 || showFilters) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) handleLoadMore();
      },
      { rootMargin: '700px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, jobs.length, handleLoadMore, showFilters]);

  const handleAutoApply = async (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      showToast('Job not found', 'error');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showToast('Please log in to use auto-apply', 'error');
      window.location.href = '/auth/login';
      return;
    }

    try {
      // Feed the SAME pipeline as the saved criteria: queue this job so it gets
      // prepared (auto-filled + AI-drafted) and shows in the Auto-Apply tab.
      const response = await fetch('/api/auto-apply/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await response.json();
      if (!response.ok) {
        showToast(data.error || 'Could not add to Auto-Apply', 'error');
        return;
      }
      showToast(data.message || 'Added to Auto-Apply.', data.queued ? 'success' : 'info');
      // Reflect the queued state on the card immediately (in sync with the tab).
      if (data.queued || data.already) {
        setAutoApplyStatuses((prev) => ({ ...prev, [jobId]: data.status || 'pending' }));
      }
    } catch (err) {
      console.error('Unexpected error in auto-apply:', err);
      showToast('An unexpected error occurred', 'error');
    }
  };

  const handleCancelApplication = async (jobId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      // Delete the application log
      const { error } = await supabase
        .from('application_logs')
        .delete()
        .eq('user_id', user.id)
        .eq('job_id', jobId);

      if (error) throw error;

      // Remove from local state
      setApplications((prev) => {
        const next = new Map(prev);
        next.delete(jobId);
        return next;
      });

      showToast('Application cancelled', 'success');
    } catch (err) {
      console.error('Failed to cancel application:', err);
      showToast('Failed to cancel application', 'error');
    }
  };

  const handleClearFilters = () => {
    setSelectedTiers([]);
    setSelectedRoles([]);
    setSelectedLocations([]);
    setSponsorshipFilter(null);
    setSelectedFundingStages([]);
    setSelectedSources([]);
    setSalaryMin(null);
    setSalaryMax(null);
    setHasRecruiters(false);
    // Clear new filter state
    setSmartFilters([]);
    setExperienceLevels([]);
    setDiversityTags([]);
    setWorkModes([]);
    setBadges([]);
  };

  // Handle smart filter toggle
  const handleSmartFilterToggle = (filter: SmartFilter) => {
    setSmartFilters((prev) =>
      prev.includes(filter)
        ? prev.filter((f) => f !== filter)
        : [...prev, filter]
    );
  };

  const handleSalaryChange = (min: number | null, max: number | null) => {
    setSalaryMin(min);
    setSalaryMax(max);
  };

  // Get current filters for save alert modal
  const getCurrentFilters = useCallback((): AlertFilters => {
    return {
      search: search || undefined,
      tiers: selectedTiers.length > 0 ? selectedTiers : undefined,
      roles: selectedRoles.length > 0 ? selectedRoles : undefined,
      locations: selectedLocations.length > 0 ? selectedLocations : undefined,
      sponsorshipFilter: sponsorshipFilter || undefined,
      fundingStages: selectedFundingStages.length > 0 ? selectedFundingStages : undefined,
      sources: selectedSources.length > 0 ? selectedSources : undefined,
      salaryMin: salaryMin ?? undefined,
      salaryMax: salaryMax ?? undefined,
      hasRecruiters: hasRecruiters || undefined,
      smartFilters: smartFilters.length > 0 ? smartFilters : undefined,
      experienceLevels: experienceLevels.length > 0 ? experienceLevels : undefined,
      diversityTags: diversityTags.length > 0 ? diversityTags : undefined,
      workModes: workModes.length > 0 ? workModes : undefined,
      badges: badges.length > 0 ? badges : undefined,
    };
  }, [search, selectedTiers, selectedRoles, selectedLocations, sponsorshipFilter, selectedFundingStages, selectedSources, salaryMin, salaryMax, hasRecruiters, smartFilters, experienceLevels, diversityTags, workModes, badges]);

  const handleSaveAsAlert = () => {
    if (!isLoggedIn) {
      window.location.href = '/auth/login';
      return;
    }
    setShowSaveAlertModal(true);
  };

  // Handle continue section interactions
  const handleJobClick = (job: { id: string; title: string; companyName: string }) => {
    // Find the full job and open it
    const fullJob = jobs.find((j) => j.id === job.id);
    if (fullJob) {
      window.open(fullJob.url, '_blank');
    }
  };

  const filterCount = selectedTiers.length + selectedRoles.length + selectedLocations.length + (sponsorshipFilter ? 1 : 0) + selectedFundingStages.length + selectedSources.length + (salaryMin !== null || salaryMax !== null ? 1 : 0) + (hasRecruiters ? 1 : 0) + smartFilters.length + experienceLevels.length + diversityTags.length + workModes.length + badges.length;

  // Determine if jobs are filtered (for empty state)
  const hasActiveFilters = filterCount > 0 || search.trim().length > 0;
  const showEmptyState = !loading && jobs.length === 0 && hasActiveFilters;

  // Compute optimistic saved state for display
  // This combines server state (savedJobIds) with optimistic updates
  const getOptimisticSavedJobIds = useCallback(() => {
    const result = new Set<string>();
    // Check each job if it should be displayed as saved
    jobs.forEach((job) => {
      if (isOptimisticallySaved(job.id, savedJobIds.has(job.id))) {
        result.add(job.id);
      }
    });
    // Also include saved jobs that might not be in current page
    savedJobIds.forEach((id) => {
      if (isOptimisticallySaved(id, true)) {
        result.add(id);
      }
    });
    return result;
  }, [jobs, savedJobIds, isOptimisticallySaved]);

  const optimisticSavedJobIds = getOptimisticSavedJobIds();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Hero Section - For logged-in users */}
      {isLoggedIn && (
        <HeroSection
          firstName={userProfile?.firstName || 'there'}
          streakDays={streakDays}
          applicationCount={applications.size}
          nextInterview={
            statsData.nextInterviewDate
              ? {
                  company: 'Scheduled',
                  date: new Date(statsData.nextInterviewDate),
                }
              : null
          }
        />
      )}

      {/* Guest Hero Section - For non-logged-in users */}
      {!isLoggedIn && (
        <>
          <GuestHero totalJobCount={filterCounts.total} />
          <CompanyLogos />
        </>
      )}

      {/* Stats Cards - Only for logged-in users */}
      {isLoggedIn && (
        <div className="mt-6 mb-8">
          <StatsCards
            activeCount={statsData.activeCount}
            activeThisWeek={statsData.activeThisWeek}
            processingCount={statsData.processingCount}
            interviewCount={statsData.interviewCount}
            nextInterviewDate={statsData.nextInterviewDate}
            weeklyProgress={statsData.weeklyProgress}
            weeklyGoal={userProfile?.weeklyGoal || 10}
          />
        </div>
      )}

      {/* Connection Status Indicator */}
      <div className="flex justify-end mb-2">
        <ConnectionStatusIndicator
          status={connectionStatus}
          onReconnect={reconnect}
          showLabel={true}
        />
      </div>

      {/* Trending & Closing Soon Section */}
      <TrendingSection />


      {/* Header with fade-in animation */}
      <HeroAnimated className="mb-6" delay={0}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">All Jobs</h1>
          {!filterCountsLoading && filterCounts.total > 0 && (
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {filterCounts.total.toLocaleString()} active
            </span>
          )}
        </div>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Browse tech roles at every level, from interns to senior
        </p>
      </HeroAnimated>

      {/* Search and filter bar with staggered animation */}
      <HeroAnimated className="mb-6" delay={100}>
        <div className="flex gap-3">
          <div className="flex-1">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search jobs or companies..."
            />
          </div>
          {/* Sort dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'salary' | 'company')}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors cursor-pointer hover:border-gray-300 dark:hover:border-slate-600"
            aria-label="Sort jobs by"
          >
            <option value="date">Newest First</option>
            <option value="salary">Highest Salary</option>
            <option value="company">Company A-Z</option>
          </select>
          <Button
            variant="outline"
            onClick={() => setShowFilters(true)}
            className="lg:hidden"
          >
            Filter
            {filterCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                {filterCount}
              </span>
            )}
          </Button>
        </div>
      </HeroAnimated>

      <div className="flex gap-8">
        {/* Desktop sidebar filters with slide-in animation */}
        <Animated animation="slide-right" delay={200} className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-slate-700/50 p-4 shadow-sm">
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Smart Filters</h3>
              <SmartFilters
                activeFilters={smartFilters}
                onToggle={handleSmartFilterToggle}
              />
            </div>
            <JobFilters
              selectedTiers={selectedTiers}
              selectedRoles={selectedRoles}
              selectedLocations={selectedLocations}
              hasRecruiters={hasRecruiters}
              sponsorshipFilter={sponsorshipFilter}
              selectedFundingStages={selectedFundingStages}
              selectedSources={selectedSources}
              salaryMin={salaryMin}
              salaryMax={salaryMax}
              experienceLevels={experienceLevels}
              diversityTags={diversityTags}
              workModes={workModes}
              badges={badges}
              onTierChange={setSelectedTiers}
              onRoleChange={setSelectedRoles}
              onLocationsChange={setSelectedLocations}
              onHasRecruitersChange={setHasRecruiters}
              onSponsorshipChange={setSponsorshipFilter}
              onFundingChange={setSelectedFundingStages}
              onSourceChange={setSelectedSources}
              onSalaryChange={handleSalaryChange}
              onExperienceLevelsChange={setExperienceLevels}
              onDiversityTagsChange={setDiversityTags}
              onWorkModesChange={setWorkModes}
              onBadgesChange={setBadges}
              onClear={handleClearFilters}
              onSaveAsAlert={handleSaveAsAlert}
            />
          </div>
        </Animated>

        {/* Job list with fade-up animation */}
        <Animated animation="fade-up" delay={300} className="flex-1 min-w-0">
          {/* Error banner when fetch fails */}
          {fetchError && jobs.length === 0 && (
            <div className="mb-6 p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <svg
                    className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    {fetchError}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchJobs(true)}
                  className="shrink-0 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {showEmptyState ? (
            <EmptyState
              variant="noSearchResults"
              onClearFilters={handleClearFilters}
            />
          ) : (
            <Suspense fallback={<JobListSkeleton />}>
              <JobList
                jobs={jobs}
                savedJobIds={optimisticSavedJobIds}
                onSaveJob={handleSaveJob}
                loading={loading && jobs.length === 0}
                autoApplyEnabled={autoApplyEnabled}
                applications={applications}
                autoApplyStatuses={autoApplyStatuses}
                onAutoApply={handleAutoApply}
                onCancelApplication={handleCancelApplication}
                recruitersMap={recruitersMap}
                onFindRecruiters={handleFindRecruiters}
                onAddRecruiter={handleAddRecruiter}
                isLoggedIn={isLoggedIn}
                interviewCounts={interviewCounts}
              />

              {/* Infinite scroll sentinel + status. The observer above watches
                  this element and loads the next page as it nears the viewport. */}
              {jobs.length > 0 && (
                <div ref={loadMoreRef} className="mt-8 flex flex-col items-center justify-center min-h-[3rem]">
                  {hasMore ? (
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                      <span className="inline-block w-5 h-5 border-2 border-gray-300 dark:border-slate-600 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading more jobs…</span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">You've reached the end — that's all the jobs for these filters.</p>
                  )}
                </div>
              )}
            </Suspense>
          )}
        </Animated>
      </div>

      {/* New jobs banner / scroll to top */}
      <NewJobsBanner
        newJobCount={newJobCount}
        onRefresh={() => {
          clearNewJobs();
          fetchJobs(true);
        }}
      />

      {/* Mobile filter drawer */}
      <MobileFilters
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        selectedTiers={selectedTiers}
        selectedRoles={selectedRoles}
        selectedLocations={selectedLocations}
        hasRecruiters={hasRecruiters}
        sponsorshipFilter={sponsorshipFilter}
        selectedFundingStages={selectedFundingStages}
        selectedSources={selectedSources}
        salaryMin={salaryMin}
        salaryMax={salaryMax}
        experienceLevels={experienceLevels}
        diversityTags={diversityTags}
        workModes={workModes}
        badges={badges}
        smartFilters={smartFilters}
        onTierChange={setSelectedTiers}
        onRoleChange={setSelectedRoles}
        onLocationsChange={setSelectedLocations}
        onHasRecruitersChange={setHasRecruiters}
        onSponsorshipChange={setSponsorshipFilter}
        onFundingChange={setSelectedFundingStages}
        onSourceChange={setSelectedSources}
        onSalaryChange={handleSalaryChange}
        onExperienceLevelsChange={setExperienceLevels}
        onDiversityTagsChange={setDiversityTags}
        onWorkModesChange={setWorkModes}
        onBadgesChange={setBadges}
        onSmartFilterToggle={handleSmartFilterToggle}
        onClear={handleClearFilters}
        onSaveAsAlert={handleSaveAsAlert}
      />

      {/* Command Palette - Global */}
      <CommandPalette jobs={jobs} />

      {/* Save Alert Modal */}
      <SaveAlertModal
        isOpen={showSaveAlertModal}
        onClose={() => setShowSaveAlertModal(false)}
        filters={getCurrentFilters()}
        onSuccess={() => showToast('Alert saved successfully!', 'success')}
      />

      {/* Toast notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
