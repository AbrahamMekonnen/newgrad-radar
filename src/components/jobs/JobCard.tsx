'use client';

import { useState, useEffect } from 'react';
import { Job, Recruiter, ApplicationLog, TIER_COLORS, TIER_LABELS, ROLE_COLORS, ROLE_LABELS, Tier, RoleType, FundingStage, FundingFilter, FUNDING_FILTER_COLORS, FUNDING_FILTER_LABELS, fundingStageToFilter, SPONSORSHIP_COLORS, SPONSORSHIP_LABELS, SponsorshipStatus, JobSource, getHiddenGemBadge, HIDDEN_GEM_BADGE_LABELS, HIDDEN_GEM_BADGE_COLORS, isHiddenGem, WorkMode, WORK_MODE_LABELS } from '@/lib/types';
import { formatTimeAgo, cn } from '@/lib/utils';
import { formatDeadline, isDeadlinePassed } from '@/lib/deadline-detector';
import { getJobEventBadges, getBadgeIconPath, MAX_EVENT_BADGES, EventBadge } from '@/lib/job-badges';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RecruiterList } from '@/components/recruiters/RecruiterList';
import { AddRecruiterModal, RecruiterFormData } from '@/components/recruiters/AddRecruiterModal';
import { AutoApplyButton } from '@/components/autoapply/AutoApplyButton';
import { ResumeTweakModal } from '@/components/resume/ResumeTweakModal';
import { LoginPromptModal } from '@/components/auth/LoginPromptModal';
import { ResumeData } from '@/lib/resume-templates';
import { ResumeScore, scoreResume, extractJobRequirements } from '@/lib/resume-scorer';
import { createClient } from '@/lib/supabase/client';
import { InterviewPrepBadge } from '@/components/interview';

interface JobCardProps {
  job: Job & { ats_type?: string | null; apply_url?: string | null };
  isSaved?: boolean;
  onSave?: (jobId: string) => void;
  recruiters?: Recruiter[];
  isLoggedIn?: boolean;
  onAddRecruiter?: (data: RecruiterFormData) => Promise<void>;
  onVoteRecruiter?: (recruiterId: string, voteType: 'up' | 'down') => Promise<void>;
  onFindRecruiters?: (companySlug: string, companyName: string, jobId: string) => Promise<void>;
  autoApplyEnabled?: boolean;
  application?: ApplicationLog | null;
  onAutoApply?: (jobId: string) => Promise<void>;
  onCancelApplication?: (jobId: string) => Promise<void>;
  saveCount?: number;
}

export function JobCard({
  job,
  isSaved = false,
  onSave,
  recruiters = [],
  isLoggedIn = false,
  onAddRecruiter,
  onVoteRecruiter,
  onFindRecruiters,
  autoApplyEnabled = false,
  application,
  onAutoApply,
  onCancelApplication,
  saveCount = 0,
}: JobCardProps) {
  const [showRecruiters, setShowRecruiters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showUploadPrompt, setShowUploadPrompt] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [userResume, setUserResume] = useState<ResumeData | null>(null);
  const [hasResume, setHasResume] = useState(false);
  const [needsResumeUpload, setNeedsResumeUpload] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [resumeScore, setResumeScore] = useState<ResumeScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [fundingFilter, setFundingFilter] = useState<FundingFilter | null>(null);
  const [salaryData, setSalaryData] = useState<{
    min: number | null;
    max: number | null;
    formatted: string;
    confidence: string;
  } | null>(null);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [eventBadges, setEventBadges] = useState<EventBadge[]>([]);
  const supabase = createClient();

  // Compute Hidden Gem badge based on job source
  const hiddenGemBadge = job.source ? getHiddenGemBadge(job.source as JobSource, job.tier, job.source_url) : null;
  const isJobHiddenGem = job.source ? isHiddenGem(job.source as JobSource) : false;

  // Work mode badge colors (blue for remote, purple for hybrid, gray for on-site)
  const WORK_MODE_BADGE_COLORS: Record<WorkMode, string> = {
    remote: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    hybrid: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    onsite: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    flexible: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400',
  };

  // In-memory cache for company enrichment data (shared across all JobCard instances)
  const ENRICHMENT_CACHE_KEY = 'company-enrichment-cache';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Fetch company enrichment data on mount
  useEffect(() => {
    const fetchEnrichment = async () => {
      const companyKey = job.company_slug || job.company_name.toLowerCase().replace(/\s+/g, '-');

      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(ENRICHMENT_CACHE_KEY);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const entry = cacheData[companyKey];
          if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
            const filterCategory = fundingStageToFilter(entry.fundingStage as FundingStage);
            setFundingFilter(filterCategory);
            return;
          }
        }
      } catch (e) {
        // Ignore cache read errors
      }

      // Fetch from API
      try {
        const response = await fetch(`/api/enrich-company?name=${encodeURIComponent(job.company_name)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            const stage = data.data.fundingStage as FundingStage;
            const filterCategory = fundingStageToFilter(stage);
            setFundingFilter(filterCategory);

            // Update cache
            try {
              const cached = localStorage.getItem(ENRICHMENT_CACHE_KEY);
              const cacheData = cached ? JSON.parse(cached) : {};
              cacheData[companyKey] = {
                fundingStage: stage,
                timestamp: Date.now(),
              };
              localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(cacheData));
            } catch (e) {
              // Ignore cache write errors
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch company enrichment:', e);
      }
    };

    fetchEnrichment();
  }, [job.company_slug, job.company_name]);

  // Calculate event badges when funding filter changes
  useEffect(() => {
    const badges = getJobEventBadges(job, {
      fundingStage: fundingFilter ? (fundingFilter as FundingStage) : null,
    });
    setEventBadges(badges.slice(0, MAX_EVENT_BADGES));
  }, [job, fundingFilter]);

  // Fetch salary data on mount
  const SALARY_CACHE_KEY = 'salary-data-cache';
  const SALARY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  useEffect(() => {
    const fetchSalary = async () => {
      // Helper to format salary - handles null/undefined
      const formatK = (n: number | null | undefined) => {
        if (n === null || n === undefined || isNaN(n)) return null;
        return `$${Math.round(n / 1000)}K`;
      };

      // If job already has valid salary data from DB, use that
      if (job.salary_min != null && job.salary_max != null &&
          !isNaN(job.salary_min) && !isNaN(job.salary_max) &&
          job.salary_min > 0 && job.salary_max > 0) {
        const minFormatted = formatK(job.salary_min);
        const maxFormatted = formatK(job.salary_max);
        if (minFormatted && maxFormatted) {
          setSalaryData({
            min: job.salary_min,
            max: job.salary_max,
            formatted: job.salary_min === job.salary_max
              ? minFormatted
              : `${minFormatted} - ${maxFormatted}`,
            confidence: 'high',
          });
          return;
        }
      }

      const cacheKey = `${job.company_slug || job.company_name.toLowerCase()}-${job.tier}`;

      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(SALARY_CACHE_KEY);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const entry = cacheData[cacheKey];
          if (entry && Date.now() - entry.timestamp < SALARY_CACHE_TTL) {
            setSalaryData(entry.data);
            return;
          }
        }
      } catch (e) {
        // Ignore cache read errors
      }

      // Fetch from API
      setSalaryLoading(true);
      try {
        const params = new URLSearchParams({
          company: job.company_name,
          title: job.title,
          tier: job.tier,
        });
        if (job.location) {
          params.set('location', job.location);
        }

        const response = await fetch(`/api/salary-lookup?${params}`);
        if (response.ok) {
          const data = await response.json();
          const salaryInfo = {
            min: data.range?.min || null,
            max: data.range?.max || null,
            formatted: data.formatted || 'Salary unknown',
            confidence: data.confidence || 'none',
          };
          setSalaryData(salaryInfo);

          // Update cache
          try {
            const cached = localStorage.getItem(SALARY_CACHE_KEY);
            const cacheData = cached ? JSON.parse(cached) : {};
            cacheData[cacheKey] = {
              data: salaryInfo,
              timestamp: Date.now(),
            };
            localStorage.setItem(SALARY_CACHE_KEY, JSON.stringify(cacheData));
          } catch (e) {
            // Ignore cache write errors
          }
        }
      } catch (e) {
        console.error('Failed to fetch salary data:', e);
        setSalaryData({
          min: null,
          max: null,
          formatted: 'Salary unknown',
          confidence: 'none',
        });
      } finally {
        setSalaryLoading(false);
      }
    };

    fetchSalary();
  }, [job.company_name, job.company_slug, job.title, job.tier, job.location, job.salary_min, job.salary_max]);

  // Check if user has a resume profile and calculate match score
  useEffect(() => {
    const checkResumeAndScore = async () => {
      if (!isLoggedIn) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('first_name, last_name, email, phone, linkedin_url, github_url, portfolio_url, resume_url, resume_filename')
        .eq('user_id', user.id)
        .single();

      if (!profile) {
        console.log('[JobCard] No profile found');
        return;
      }

      console.log('[JobCard] Profile data:', {
        resume_url: profile.resume_url,
        resume_filename: profile.resume_filename,
        first_name: profile.first_name,
      });

      let resumeData: ResumeData | null = null;

      // Option 1: Check if user has PDF resume uploaded
      if (profile.resume_url) {
        try {
          const parseResponse = await fetch('/api/parse-resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resumeUrl: profile.resume_url }),
          });

          if (parseResponse.ok) {
            const parsed = await parseResponse.json();
            console.log('[JobCard] Parsed resume:', parsed);
            resumeData = {
              ...parsed,
              name: parsed.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
              email: parsed.email || profile.email || '',
              phone: parsed.phone || profile.phone || undefined,
              linkedin: parsed.linkedin || profile.linkedin_url || undefined,
              github: parsed.github || profile.github_url || undefined,
              portfolio: parsed.portfolio || profile.portfolio_url || undefined,
            };
          } else {
            const errBody = await parseResponse.json();
            console.error('[JobCard] Parse API error:', parseResponse.status, errBody);
            // Resume exists but AI parsing failed
            setAiUnavailable(true);
            setHasResume(true); // Resume IS uploaded, just can't parse it
          }
        } catch (e) {
          console.error('[JobCard] Failed to parse PDF resume:', e);
          setAiUnavailable(true);
          setHasResume(true);
        }
      }

      // Option 2: Check user_resumes table (manual builder)
      if (!resumeData) {
        const { data: savedResume } = await supabase
          .from('user_resumes')
          .select('resume_data')
          .eq('user_id', user.id)
          .eq('is_base', true)
          .maybeSingle();

        if (savedResume?.resume_data) {
          try {
            const parsed = typeof savedResume.resume_data === 'string'
              ? JSON.parse(savedResume.resume_data)
              : savedResume.resume_data;

            if (parsed && (parsed.experience?.length > 0 || parsed.skills?.length > 0 || parsed.projects?.length > 0)) {
              resumeData = {
                ...parsed,
                name: parsed.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
                email: parsed.email || profile.email || '',
              };
            }
          } catch (e) {
            console.error('Failed to parse saved resume:', e);
          }
        }
      }

      // If no resume data found, show upload prompt
      if (!resumeData) {
        setNeedsResumeUpload(true);
        setHasResume(false);
        return;
      }

      setUserResume(resumeData);
      setHasResume(true);

      // Calculate resume match score for this job
      setScoreLoading(true);
      try {
        const jobReqs = await extractJobRequirements(
          job.title,
          job.company_name,
          job.tier,
          job.role_types?.[0] || 'swe',
          undefined
        );
        const score = scoreResume(resumeData, jobReqs);
        setResumeScore(score);
      } catch (e) {
        console.error('Failed to calculate resume score:', e);
      } finally {
        setScoreLoading(false);
      }
    };

    checkResumeAndScore();
  }, [isLoggedIn, supabase, job.title, job.company_name, job.tier, job.role_types]);

  // Generate direct application URL based on ATS type
  const getApplyUrl = (url: string, source?: string): string => {
    if (!url) return url;

    // Greenhouse: add #app anchor only for specific job URLs (contains /jobs/)
    if (url.includes('greenhouse.io') && url.includes('/jobs/') && !url.includes('#app')) {
      return `${url}#app`;
    }

    // Lever: add /apply suffix only for specific job URLs (not already /apply)
    if (url.includes('lever.co') && !url.endsWith('/apply') && !url.includes('/apply?')) {
      return `${url.replace(/\/$/, '')}/apply`;
    }

    return url;
  };

  // Use stored apply_url if different from url, otherwise generate it
  const applyUrl = (job.apply_url && job.apply_url !== job.url)
    ? job.apply_url
    : getApplyUrl(job.url, job.source);


  const handleApplyClick = () => {
    if (needsResumeUpload && !aiUnavailable) {
      // Show upload prompt instead of applying
      setShowUploadPrompt(true);
      return;
    }
    if (hasResume && userResume) {
      setShowResumeModal(true);
    } else {
      // Not logged in, AI unavailable, or no resume features - just open the application URL directly
      window.open(applyUrl, '_blank');
    }
  };

  const handleApplyWithResume = (resume: ResumeData, versionName: string) => {
    // In production: save the resume version to DB, track which version was used
    console.log('Applying with resume version:', versionName);
    window.open(applyUrl, '_blank');
  };

  const tier = job.tier as Tier;
  const tierColor = TIER_COLORS[tier] || 'bg-gray-600';
  const tierLabel = TIER_LABELS[tier] || job.tier;
  const recruiterCount = recruiters.length;

  // Calculate deadline urgency
  const getDeadlineInfo = () => {
    if (!job.deadline) return null;
    if (isDeadlinePassed(job.deadline)) return { label: 'Deadline passed', color: 'bg-gray-400 text-white', urgent: false };

    const deadlineDate = new Date(job.deadline);
    const now = new Date();
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { label: 'Due today!', color: 'bg-red-600 text-white', urgent: true };
    if (diffDays === 1) return { label: 'Closes tomorrow', color: 'bg-red-500 text-white', urgent: true };
    if (diffDays < 3) return { label: `Closes in ${diffDays} days`, color: 'bg-red-500 text-white', urgent: true };
    if (diffDays < 7) return { label: `Closes in ${diffDays} days`, color: 'bg-yellow-500 text-white', urgent: false };
    return { label: formatDeadline(job.deadline), color: 'bg-gray-200 text-gray-700', urgent: false };
  };

  const deadlineInfo = getDeadlineInfo();

  // Check if job is fresh (posted < 24 hours ago) for Early Applicant badge
  const isEarlyApplicant = () => {
    const postedDate = job.posted || job.created_at;
    if (!postedDate) return false;
    const posted = new Date(postedDate);
    const now = new Date();
    const diffHours = (now.getTime() - posted.getTime()) / (1000 * 60 * 60);
    return diffHours < 24;
  };

  const showEarlyBadge = isEarlyApplicant();

  return (
    <div className="group relative bg-white dark:bg-slate-800/95 rounded-xl border border-gray-100 dark:border-slate-700/80 p-4 sm:p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_30px_-8px_rgba(99,102,241,0.15)] dark:hover:shadow-[0_8px_30px_-8px_rgba(129,140,248,0.2)] hover:border-indigo-200 dark:hover:border-indigo-500/30 transform hover:scale-[1.01] transition-all duration-300 ease-out">
      {/* Early Applicant Ribbon */}
      {showEarlyBadge && (
        <div className="absolute -top-0.5 -right-0.5 z-10">
          <div className="bg-gradient-to-r from-emerald-500 to-green-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-bl-lg rounded-tr-xl shadow-sm flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            Early Applicant
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          {/* Company name - enhanced typography */}
          <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 truncate tracking-wide uppercase">
            {job.company_name}
          </p>

          {/* Job title - enhanced */}
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-0.5 text-base sm:text-lg font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 line-clamp-2 break-words transition-colors duration-200"
          >
            {job.title}
          </a>

          {/* Salary - on its own line below title */}
          {salaryLoading ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : salaryData && salaryData.confidence !== 'none' ? (
            <p
              className={cn(
                'mt-1.5 text-sm font-semibold',
                salaryData.confidence === 'high'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : salaryData.confidence === 'medium'
                  ? 'text-emerald-600/80 dark:text-emerald-400/80'
                  : 'text-gray-500 dark:text-gray-400'
              )}
              title={`Based on H1B data (${salaryData.confidence} confidence)`}
            >
              {salaryData.formatted}
            </p>
          ) : null}

          {/* Primary info row - always visible */}
          <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-3">
            {job.location && (
              <span className="inline-flex items-center gap-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate max-w-[150px] sm:max-w-none">
                <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {job.location}
              </span>
            )}
            {/* Work mode badges */}
            {job.work_modes && job.work_modes.length > 0 && job.work_modes.map((mode) => {
              const modeKey = mode as WorkMode;
              const modeColor = WORK_MODE_BADGE_COLORS[modeKey] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
              const modeLabel = WORK_MODE_LABELS[modeKey] || mode;
              return (
                <Badge key={mode} className={cn(modeColor, 'text-xs px-2 py-0.5 rounded-md')}>
                  {modeLabel}
                </Badge>
              );
            })}
            <Badge className={tierColor}>{tierLabel}</Badge>
            {/* Role types inline */}
            {job.role_types && job.role_types.length > 0 && job.role_types.slice(0, 2).map((role) => {
              const roleKey = role as RoleType;
              const roleColor = ROLE_COLORS[roleKey] || 'bg-gray-500';
              const roleLabel = ROLE_LABELS[roleKey] || role;
              return (
                <Badge key={role} className={cn(roleColor, 'text-xs px-2 py-0.5 rounded-md')}>
                  {roleLabel}
                </Badge>
              );
            })}
            {/* Expanded badges - inline with others */}
            {showAllBadges && (
              <>
              {/* Hidden Gem Source Badge */}
              {hiddenGemBadge && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold shadow-sm ring-1 ring-inset ring-white/20',
                    HIDDEN_GEM_BADGE_COLORS[hiddenGemBadge]
                  )}
                  title="Hidden Gem: Not listed on major job boards"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
                  </svg>
                  {HIDDEN_GEM_BADGE_LABELS[hiddenGemBadge]}
                </span>
              )}
              {/* Event Badges */}
              {eventBadges.map((badge) => (
                <span
                  key={badge.type}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm',
                    badge.color
                  )}
                >
                  {badge.icon && (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d={getBadgeIconPath(badge.icon)} />
                    </svg>
                  )}
                  {badge.label}
                </span>
              ))}
              {fundingFilter && (
                <Badge className={FUNDING_FILTER_COLORS[fundingFilter]}>
                  {FUNDING_FILTER_LABELS[fundingFilter]}
                </Badge>
              )}
              {deadlineInfo && (
                <Badge className={cn(deadlineInfo.color, deadlineInfo.urgent && 'animate-pulse')}>
                  {deadlineInfo.label}
                </Badge>
              )}
              {/* Sponsorship Badge */}
              {job.sponsorship_status && job.sponsorship_status !== 'unknown' && (
                <Badge className={SPONSORSHIP_COLORS[job.sponsorship_status]}>
                  {SPONSORSHIP_LABELS[job.sponsorship_status]}
                </Badge>
              )}
              {/* Extra role types */}
              {job.role_types && job.role_types.length > 2 && job.role_types.slice(2).map((role) => {
                const roleKey = role as RoleType;
                const roleColor = ROLE_COLORS[roleKey] || 'bg-gray-500';
                const roleLabel = ROLE_LABELS[roleKey] || role;
                return (
                  <Badge key={role} className={cn(roleColor, 'text-xs px-2 py-0.5 rounded-md')}>
                    {roleLabel}
                  </Badge>
                );
              })}
              </>
            )}
            {/* Show more/less toggle */}
            {(() => {
              const extraBadgeCount = (hiddenGemBadge ? 1 : 0) + eventBadges.length + (fundingFilter ? 1 : 0) + (deadlineInfo ? 1 : 0) + (job.sponsorship_status && job.sponsorship_status !== 'unknown' ? 1 : 0) + ((job.role_types?.length || 0) > 2 ? 1 : 0);
              if (extraBadgeCount > 0) {
                return (
                  <button
                    onClick={() => setShowAllBadges(!showAllBadges)}
                    aria-expanded={showAllBadges}
                    aria-label={showAllBadges ? 'Show fewer badges' : `Show ${extraBadgeCount} more badges`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 bg-gray-100 dark:bg-slate-700 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    {showAllBadges ? (
                      <>
                        Less
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </>
                    ) : (
                      <>
                        +{extraBadgeCount}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                );
              }
              return null;
            })()}
          </div>
        </div>
      </div>

      {/* Recruiters Section - enhanced styling */}
      <div className="mt-4 pt-4 border-t border-gray-100/80 dark:border-slate-700/60">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 min-h-[44px]">
          <button
            type="button"
            onClick={() => setShowRecruiters(!showRecruiters)}
            aria-expanded={showRecruiters}
            aria-label={`${showRecruiters ? 'Hide' : 'Show'} ${recruiterCount} recruiters`}
            className="flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-200 transition-all duration-200 -mx-1.5 px-1.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/70"
          >
            <svg
              className={cn(
                'w-4 h-4 transition-transform duration-200',
                showRecruiters && 'rotate-90'
              )}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span className="font-medium">Recruiters</span>
            <span
              className={cn(
                'inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold transition-colors',
                recruiterCount > 0
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
              )}
              aria-hidden="true"
            >
              {recruiterCount}
            </span>
          </button>
          {isLoggedIn && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="ml-auto text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 text-xs font-semibold min-h-[44px] min-w-[44px] flex items-center justify-center -mr-1 transition-colors duration-200"
            >
              + Add
            </button>
          )}
        </div>

        {showRecruiters && (
          <div className="mt-3">
            <RecruiterList
              recruiters={recruiters}
              onVote={onVoteRecruiter}
              maxVisible={3}
            />
            {!isLoggedIn && recruiterCount === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Sign in to add recruiter contacts
              </p>
            )}
          </div>
        )}
      </div>

      {/* Resume Upload Prompt - shown when user hasn't uploaded a resume */}
      {isLoggedIn && needsResumeUpload && !aiUnavailable && (
        <div className="mt-4 pt-4 border-t border-gray-100/80 dark:border-slate-700/60">
          <button
            type="button"
            className="flex items-center gap-3 p-3.5 w-full bg-gradient-to-r from-indigo-50/80 to-purple-50/80 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-xl border border-indigo-100/60 dark:border-indigo-800/40 cursor-pointer hover:from-indigo-100/80 hover:to-purple-100/80 dark:hover:from-indigo-900/50 dark:hover:to-purple-900/50 transition-all duration-200"
            onClick={() => setShowUploadPrompt(!showUploadPrompt)}
            aria-expanded={showUploadPrompt}
            aria-label={showUploadPrompt ? 'Hide resume upload instructions' : 'Show resume upload instructions'}
          >
            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Upload your resume</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Get match scores & AI optimization</p>
            </div>
            <svg className={cn("w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200", showUploadPrompt && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showUploadPrompt && (
            <div className="mt-3 p-4 bg-gray-50/80 dark:bg-slate-700/50 rounded-xl text-sm space-y-2.5">
              <p className="font-semibold text-gray-900 dark:text-white">Upload your resume to get started:</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Your resume will be parsed automatically to show match scores</p>
              <div className="pt-2">
                <a
                  href="/settings/profile"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload Resume in Settings
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resume Match Score Badge - shown when user has uploaded a resume */}
      {hasResume && resumeScore && (
        <div className="mt-4 pt-4 border-t border-gray-100/80 dark:border-slate-700/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shadow-sm',
                resumeScore.overall >= 80
                  ? 'bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/50 dark:to-green-900/50 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200/50 dark:ring-emerald-700/30'
                  : resumeScore.overall >= 50
                  ? 'bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/50 dark:to-yellow-900/50 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200/50 dark:ring-amber-700/30'
                  : 'bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/50 dark:to-rose-900/50 text-red-700 dark:text-red-400 ring-1 ring-red-200/50 dark:ring-red-700/30'
              )}>
                {resumeScore.overall}%
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Resume Match</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {resumeScore.suggestion === 'good' ? 'Strong fit' :
                   resumeScore.suggestion === 'tweak' ? 'Could improve' : 'Needs work'}
                </p>
              </div>
            </div>
            {resumeScore.suggestion !== 'good' && (
              <button
                onClick={() => setShowResumeModal(true)}
                aria-label="Optimize your resume for this job"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all duration-200"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Optimize
              </button>
            )}
          </div>

          {/* Enhanced Skill Suggestions - Actionable */}
          {resumeScore.suggestion !== 'good' && (
            <div className="mt-4 space-y-2.5">
              {/* Top Priority Skills to Add */}
              {resumeScore.topPriority && resumeScore.topPriority.length > 0 && (
                <div className="p-3 bg-amber-50/80 dark:bg-amber-900/20 rounded-xl border border-amber-100/60 dark:border-amber-800/40">
                  <div className="flex items-center gap-1.5 mb-2">
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">Add these skills</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {resumeScore.topPriority.map(skill => (
                      <button
                        key={skill}
                        onClick={() => setShowResumeModal(true)}
                        className="group inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-700 text-amber-700 dark:text-amber-400 text-xs font-semibold rounded-lg border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:border-amber-300 dark:hover:border-amber-600 transition-all duration-200 cursor-pointer shadow-sm"
                        aria-label={`Add ${skill} to your resume`}
                      >
                        <svg className="w-3 h-3 text-amber-500 group-hover:text-amber-600 dark:group-hover:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {skill}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Nice-to-Have Skills */}
              {resumeScore.missingNice && resumeScore.missingNice.length > 0 && (
                <div className="p-3 bg-gray-50/80 dark:bg-slate-700/50 rounded-xl border border-gray-100/60 dark:border-slate-600/40">
                  <div className="flex items-center gap-1.5 mb-2">
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Nice to have</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {resumeScore.missingNice.slice(0, 3).map(skill => (
                      <span
                        key={skill}
                        className="px-2 py-0.5 bg-white dark:bg-slate-600 text-gray-600 dark:text-gray-300 text-xs rounded-md border border-gray-200 dark:border-slate-500"
                      >
                        {skill}
                      </span>
                    ))}
                    {resumeScore.missingNice.length > 3 && (
                      <span className="px-2 py-0.5 text-gray-400 dark:text-gray-500 text-xs">
                        +{resumeScore.missingNice.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Specific Suggestion - Top priority actionable tip */}
              {resumeScore.skillSuggestions && resumeScore.skillSuggestions.length > 0 && (
                <button
                  onClick={() => setShowResumeModal(true)}
                  aria-label="Edit resume with suggested improvements"
                  className="w-full text-left p-3 bg-indigo-50/80 dark:bg-indigo-900/20 rounded-xl border border-indigo-100/60 dark:border-indigo-800/40 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/40 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-200 group"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-800 transition-colors">
                      <svg className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-indigo-800 dark:text-indigo-300 font-semibold leading-snug">
                        {resumeScore.skillSuggestions[0].suggestion}
                      </p>
                      <p className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1 font-medium">
                        <span>Click to edit resume</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </p>
                    </div>
                  </div>
                </button>
              )}

              {/* Improvement Potential Indicator */}
              {resumeScore.improvementPotential && resumeScore.improvementPotential > 10 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
                  Adding these skills could boost your score by up to <span className="font-bold text-emerald-600 dark:text-emerald-400">+{Math.min(resumeScore.improvementPotential, 30)}%</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Interview Prep Section */}
      <InterviewPrepBadge
        companySlug={job.company_slug || undefined}
        companyName={job.company_name}
        position={job.role_types?.[0]}
        className="mt-4 pt-4 border-t border-gray-100/80 dark:border-slate-700/60"
      />

      {/* Footer - enhanced with save count */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-2 mt-5 pt-4 border-t border-gray-100/80 dark:border-slate-700/60">
        <div className="flex items-center gap-3 order-2 sm:order-1 justify-center sm:justify-start">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {formatTimeAgo(job.posted || job.created_at)}
          </span>
          {/* Save count indicator */}
          {saveCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <span className="font-medium">{saveCount}</span>
              <span>saves</span>
            </span>
          )}
        </div>

        <div className="flex items-center justify-center sm:justify-end gap-2 order-1 sm:order-2">
          {autoApplyEnabled && onAutoApply && (
            <AutoApplyButton
              jobId={job.id}
              atsType={job.ats_type || null}
              application={application}
              onAutoApply={onAutoApply}
              onCancelApplication={onCancelApplication}
              onOptimizeFirst={() => setShowResumeModal(true)}
              resumeScore={resumeScore}
              applicationUrl={applyUrl}
              hideStatus
            />
          )}
          {onSave && (
            <Button
              variant={isSaved ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => {
                if (!isLoggedIn) {
                  setShowLoginModal(true);
                  return;
                }
                onSave(job.id);
              }}
              className={cn(
                'min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 transition-all duration-200',
                isSaved && 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400'
              )}
            >
              <span className="flex items-center gap-1.5">
                {isSaved ? (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    <span className="hidden sm:inline">Saved</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    <span className="hidden sm:inline">Save</span>
                  </>
                )}
              </span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleApplyClick}
            className={cn(
              'min-h-[44px] sm:min-h-0 font-semibold shadow-sm hover:shadow-md transition-all duration-200',
              hasResume && resumeScore && resumeScore.suggestion !== 'good'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 dark:from-indigo-500 dark:to-purple-500'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
            )}
          >
            {needsResumeUpload
              ? 'Apply'
              : hasResume && resumeScore
                ? (resumeScore.suggestion === 'good' ? 'Apply' : 'Optimize & Apply')
                : 'Apply'}
          </Button>
        </div>
      </div>

      {/* Add Recruiter Modal */}
      <AddRecruiterModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        jobId={job.id}
        companySlug={job.company_slug}
        companyName={job.company_name}
        onSubmit={onAddRecruiter}
      />

      {/* Resume Tweak Modal */}
      {userResume && (
        <ResumeTweakModal
          isOpen={showResumeModal}
          onClose={() => setShowResumeModal(false)}
          resume={userResume}
          jobId={job.id}
          jobTitle={job.title}
          companyName={job.company_name}
          companyTier={job.tier}
          roleType={job.role_types?.[0] || 'swe'}
          onApply={handleApplyWithResume}
          onAutoApply={onAutoApply}
          jobUrl={applyUrl}
        />
      )}

      {/* Login Prompt Modal - shown when logged-out user tries to save */}
      <LoginPromptModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        title="Sign in to save jobs"
        message="Create a free account to save jobs and track your applications."
      />
    </div>
  );
}
