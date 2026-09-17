'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SavedJob, Job, JobStatus } from '@/lib/types';
import { SavedJobCard } from '@/components/saved/SavedJobCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { cn } from '@/lib/utils';
import { AutoApplyInbox } from '@/components/autoapply/AutoApplyInbox';
import { useSearchParams } from 'next/navigation';


export default function ApplicationsPage() {
  return (
    <AuthGuard>
      {(user) => <ApplicationsContent userId={user.id} />}
    </AuthGuard>
  );
}

function ApplicationsContent({ userId }: { userId: string }) {
  const [savedJobs, setSavedJobs] = useState<(SavedJob & { job: Job })[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const searchParams = useSearchParams();
  const [activeSection, setActiveSection] = useState<'saved' | 'autoapply'>(
    searchParams.get('section') === 'autoapply' ? 'autoapply' : 'saved'
  );
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


  useEffect(() => {
    fetchSavedJobs();

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


    return () => {
      supabase.removeChannel(savedChannel);
    };
  }, [fetchSavedJobs, userId, supabase]);

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


  const [savedFilter, setSavedFilter] = useState<'all' | JobStatus>('all');

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


  // Filtered lists
  const filteredSavedJobs = savedFilter === 'all'
    ? savedJobs
    : savedJobs.filter(j => j.status === savedFilter);


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
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Live queue</span>
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
        <AutoApplyInbox embedded />
      )}
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
