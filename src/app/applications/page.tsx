'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SavedJob, Job, JobStatus, ApplicationLog, APPLICATION_STATUS_COLORS, APPLICATION_STATUS_LABELS } from '@/lib/types';
import { SavedJobCard } from '@/components/saved/SavedJobCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Badge } from '@/components/ui/Badge';
import { cn, formatTimeAgo } from '@/lib/utils';
import Link from 'next/link';

type ApplicationWithJob = ApplicationLog & { job: Job | null };

export default function ApplicationsPage() {
  return (
    <AuthGuard>
      {(user) => <ApplicationsContent userId={user.id} />}
    </AuthGuard>
  );
}

function ApplicationsContent({ userId }: { userId: string }) {
  const [savedJobs, setSavedJobs] = useState<(SavedJob & { job: Job })[]>([]);
  const [autoApplyJobs, setAutoApplyJobs] = useState<ApplicationWithJob[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [loadingAutoApply, setLoadingAutoApply] = useState(true);
  const [activeSection, setActiveSection] = useState<'saved' | 'autoapply'>('saved');
  const supabase = createClient();

  // Fetch saved jobs (manual applications)
  const fetchSavedJobs = useCallback(async () => {
    setLoadingSaved(true);
    const { data, error } = await supabase
      .from('saved_jobs')
      .select('*, job:jobs(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching saved jobs:', error);
    } else {
      const validJobs = (data || []).filter(
        (item): item is SavedJob & { job: Job } => item.job !== null
      );
      setSavedJobs(validJobs);
    }
    setLoadingSaved(false);
  }, [userId, supabase]);

  // Fetch auto-apply jobs
  const fetchAutoApplyJobs = useCallback(async () => {
    setLoadingAutoApply(true);
    const { data, error } = await supabase
      .from('application_logs')
      .select('*, job:jobs(*)')
      .eq('user_id', userId)
      .not('ats_type', 'is', null) // Auto-apply jobs have ats_type set
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching auto-apply jobs:', error);
    } else {
      setAutoApplyJobs(data || []);
    }
    setLoadingAutoApply(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchSavedJobs();
    fetchAutoApplyJobs();

    // Real-time for saved_jobs
    const savedChannel = supabase
      .channel('saved_jobs_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'saved_jobs',
        filter: `user_id=eq.${userId}`,
      }, () => fetchSavedJobs())
      .subscribe();

    // Real-time for application_logs
    const applyChannel = supabase
      .channel('application_logs_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'application_logs',
        filter: `user_id=eq.${userId}`,
      }, () => fetchAutoApplyJobs())
      .subscribe();

    return () => {
      supabase.removeChannel(savedChannel);
      supabase.removeChannel(applyChannel);
    };
  }, [fetchSavedJobs, fetchAutoApplyJobs, userId, supabase]);

  const handleStatusChange = async (id: string, status: JobStatus) => {
    const updates: Partial<SavedJob> = { status };
    if (status === 'applied') {
      updates.applied_at = new Date().toISOString();
    }

    setSavedJobs((prev) =>
      prev.map((sj) =>
        sj.id === id ? { ...sj, status, applied_at: updates.applied_at || sj.applied_at } : sj
      )
    );

    const { error } = await supabase.from('saved_jobs').update(updates).eq('id', id);
    if (error) {
      console.error('Error updating status:', error);
      fetchSavedJobs();
    }
  };

  const handleNotesUpdate = async (id: string, notes: string) => {
    setSavedJobs((prev) =>
      prev.map((sj) => (sj.id === id ? { ...sj, notes } : sj))
    );

    const { error } = await supabase.from('saved_jobs').update({ notes }).eq('id', id);
    if (error) {
      console.error('Error updating notes:', error);
      fetchSavedJobs();
    }
  };

  const handleRemove = async (id: string) => {
    setSavedJobs((prev) => prev.filter((sj) => sj.id !== id));

    const { error } = await supabase.from('saved_jobs').delete().eq('id', id);
    if (error) {
      console.error('Error removing saved job:', error);
      fetchSavedJobs();
    }
  };

  const handleRemoveAutoApply = async (jobId: string) => {
    setAutoApplyJobs((prev) => prev.filter((a) => a.job_id !== jobId));

    const { error } = await supabase
      .from('application_logs')
      .delete()
      .eq('user_id', userId)
      .eq('job_id', jobId);

    if (error) {
      console.error('Error removing auto-apply job:', error);
      fetchAutoApplyJobs();
    }
  };

  const [savedFilter, setSavedFilter] = useState<'all' | JobStatus>('all');
  const [autoApplyFilter, setAutoApplyFilter] = useState<'all' | string>('all');

  // Count stats
  const savedStats = {
    total: savedJobs.length,
    saved: savedJobs.filter(j => j.status === 'saved').length,
    applied: savedJobs.filter(j => j.status === 'applied').length,
    in_review: savedJobs.filter(j => j.status === 'in_review').length,
    interviewing: savedJobs.filter(j => j.status === 'interviewing').length,
    offer: savedJobs.filter(j => j.status === 'offer').length,
    rejected: savedJobs.filter(j => j.status === 'rejected').length,
  };

  const autoApplyStats = {
    total: autoApplyJobs.length,
    pending: autoApplyJobs.filter(j => j.status === 'pending').length,
    filling: autoApplyJobs.filter(j => j.status === 'filling').length,
    review: autoApplyJobs.filter(j => j.status === 'review').length,
    submitted: autoApplyJobs.filter(j => j.status === 'submitted').length,
    failed: autoApplyJobs.filter(j => j.status === 'failed').length,
  };

  // Filtered lists
  const filteredSavedJobs = savedFilter === 'all'
    ? savedJobs
    : savedJobs.filter(j => j.status === savedFilter);

  const filteredAutoApplyJobs = autoApplyFilter === 'all'
    ? autoApplyJobs
    : autoApplyJobs.filter(j => j.status === autoApplyFilter);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Applications</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Track your job applications
        </p>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveSection('saved')}
          className={cn(
            'flex-1 p-4 rounded-xl border-2 transition-all text-left',
            activeSection === 'saved'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Your Applications</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Jobs you're tracking manually</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{savedStats.total}</span>
              {savedStats.interviewing > 0 && (
                <p className="text-xs text-purple-600">{savedStats.interviewing} interviewing</p>
              )}
            </div>
          </div>
        </button>

        <button
          onClick={() => setActiveSection('autoapply')}
          className={cn(
            'flex-1 p-4 rounded-xl border-2 transition-all text-left',
            activeSection === 'autoapply'
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Auto-Apply</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Automated submissions</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{autoApplyStats.total}</span>
              {autoApplyStats.pending > 0 && (
                <p className="text-xs text-amber-600">{autoApplyStats.pending} in progress</p>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Content */}
      {activeSection === 'saved' ? (
        <div>
          {/* Saved Jobs Filter Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-4 mb-4 scrollbar-hide">
            {[
              { value: 'all', label: 'All', count: savedStats.total },
              { value: 'saved', label: 'Saved', count: savedStats.saved },
              { value: 'applied', label: 'Applied', count: savedStats.applied },
              { value: 'in_review', label: 'In Review', count: savedStats.in_review },
              { value: 'interviewing', label: 'Interviewing', count: savedStats.interviewing },
              { value: 'offer', label: 'Offer', count: savedStats.offer },
              { value: 'rejected', label: 'Rejected', count: savedStats.rejected },
            ].map(({ value, label, count }) => (
              <button
                key={value}
                onClick={() => setSavedFilter(value as 'all' | JobStatus)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                  savedFilter === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                )}
              >
                {label}
                {count > 0 && <span className="ml-1.5 opacity-75">({count})</span>}
              </button>
            ))}
          </div>

          {loadingSaved ? (
            <LoadingSkeleton />
          ) : filteredSavedJobs.length === 0 ? (
            <EmptyState
              icon="bookmark"
              title={savedFilter === 'all' ? 'No saved applications' : `No ${savedFilter.replace('_', ' ')} applications`}
              description={savedFilter === 'all' ? 'Save jobs from the All Jobs page to track your applications here.' : 'No applications with this status yet.'}
            />
          ) : (
            <div className="space-y-4">
              {filteredSavedJobs.map((savedJob) => (
                <SavedJobCard
                  key={savedJob.id}
                  savedJob={savedJob}
                  onStatusChange={handleStatusChange}
                  onNotesUpdate={handleNotesUpdate}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Auto-Apply Filter Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-4 mb-4 scrollbar-hide">
            {[
              { value: 'all', label: 'All', count: autoApplyStats.total },
              { value: 'pending', label: 'Pending', count: autoApplyStats.pending },
              { value: 'filling', label: 'Filling', count: autoApplyStats.filling },
              { value: 'review', label: 'Review', count: autoApplyStats.review },
              { value: 'submitted', label: 'Submitted', count: autoApplyStats.submitted },
              { value: 'failed', label: 'Failed', count: autoApplyStats.failed },
            ].map(({ value, label, count }) => (
              <button
                key={value}
                onClick={() => setAutoApplyFilter(value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                  autoApplyFilter === value
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                )}
              >
                {label}
                {count > 0 && <span className="ml-1.5 opacity-75">({count})</span>}
              </button>
            ))}
          </div>

          {loadingAutoApply ? (
            <LoadingSkeleton />
          ) : filteredAutoApplyJobs.length === 0 ? (
            <EmptyState
              icon="lightning"
              title={autoApplyFilter === 'all' ? 'No auto-apply submissions' : `No ${autoApplyFilter} applications`}
              description={autoApplyFilter === 'all' ? 'Enable auto-apply on companies in your Watchlist to automatically submit applications.' : 'No applications with this status yet.'}
            />
          ) : (
            <div className="space-y-4">
              {filteredAutoApplyJobs.map((application) => (
                <AutoApplyCard
                  key={application.id}
                  application={application}
                  onRemove={() => handleRemoveAutoApply(application.job_id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AutoApplyCard({
  application,
  onRemove,
}: {
  application: ApplicationWithJob;
  onRemove: () => void;
}) {
  const job = application.job;
  const isPending = ['pending', 'filling', 'review'].includes(application.status);
  const isSubmitted = application.status === 'submitted';
  const isFailed = application.status === 'failed';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4 hover:border-gray-300 dark:hover:border-slate-600 transition-colors">
      <div className="flex items-start gap-4">
        {/* Company logo */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            {job?.company_name?.charAt(0).toUpperCase() || '?'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Status + ATS type */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge className={APPLICATION_STATUS_COLORS[application.status]}>
              {APPLICATION_STATUS_LABELS[application.status]}
            </Badge>
            {application.ats_type && (
              <Badge variant="outline" className="text-gray-500 border-gray-300 dark:border-slate-600">
                {application.ats_type}
              </Badge>
            )}
            {isPending && (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing
              </span>
            )}
          </div>

          {/* Job title */}
          <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
            {job?.title || 'Unknown Job'}
          </h3>

          {/* Company */}
          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
            {job?.company_name || 'Unknown Company'}
          </p>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Started {formatTimeAgo(application.created_at)}</span>
            {application.submitted_at && (
              <span className="text-green-600">Submitted {formatTimeAgo(application.submitted_at)}</span>
            )}
            {job?.location && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                {job.location}
              </span>
            )}
          </div>

          {/* Error message */}
          {isFailed && application.error_message && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-xs text-red-700 dark:text-red-400">{application.error_message}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={onRemove}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            title="Remove"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {job?.url && (
            <Link
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
              title="View job posting"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: 'bookmark' | 'lightning'; title: string; description: string }) {
  return (
    <div className="text-center py-12">
      <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        {icon === 'bookmark' ? (
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">{description}</p>
    </div>
  );
}
