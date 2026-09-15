'use client';

import { Job, ApplicationLog, Recruiter, recruitersForJob } from '@/lib/types';
import { JobCard } from './JobCard';
import { RecruiterFormData } from '@/components/recruiters/AddRecruiterModal';
import { JobCardSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface JobListProps {
  jobs: Job[];
  savedJobIds?: Set<string>;
  onSaveJob?: (jobId: string) => void;
  loading?: boolean;
  autoApplyEnabled?: boolean;
  applications?: Map<string, ApplicationLog>;
  onAutoApply?: (jobId: string) => Promise<void>;
  onCancelApplication?: (jobId: string) => Promise<void>;
  recruitersMap?: Map<string, Recruiter[]>;
  onFindRecruiters?: (companySlug: string, companyName: string, jobId: string) => Promise<void>;
  onAddRecruiter?: (data: RecruiterFormData) => Promise<void>;
  isLoggedIn?: boolean;
}

export function JobList({
  jobs,
  savedJobIds = new Set(),
  onSaveJob,
  loading,
  autoApplyEnabled,
  applications,
  onAutoApply,
  onCancelApplication,
  recruitersMap = new Map(),
  onFindRecruiters,
  onAddRecruiter,
  isLoggedIn = false,
}: JobListProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-fade-in"
            style={{
              animationDelay: `${i * 50}ms`,
              animationFillMode: 'both',
            }}
          >
            <JobCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
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
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">No jobs found</h3>
        <p className="mt-2 text-gray-500">
          Try adjusting your filters or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job, index) => (
        <div
          key={job.id}
          className={cn(
            'animate-fade-up',
            // Apply stagger based on position in visible grid
            // Max stagger of 300ms for performance
          )}
          style={{
            animationDelay: `${Math.min(index * 50, 300)}ms`,
            animationFillMode: 'both',
          }}
        >
          <JobCard
            job={job}
            isSaved={savedJobIds.has(job.id)}
            onSave={onSaveJob}
            autoApplyEnabled={autoApplyEnabled}
            application={applications?.get(job.id)}
            onAutoApply={onAutoApply}
            onCancelApplication={onCancelApplication}
            recruiters={recruitersForJob(recruitersMap.get(job.id) || recruitersMap.get(job.company_slug) || [], job)}
            onFindRecruiters={onFindRecruiters}
            onAddRecruiter={onAddRecruiter}
            isLoggedIn={isLoggedIn}
          />
        </div>
      ))}
    </div>
  );
}
