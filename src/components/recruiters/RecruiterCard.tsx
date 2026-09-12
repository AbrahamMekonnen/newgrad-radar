'use client';

import { Recruiter } from '@/lib/types';
import { VoteButtons } from './VoteButtons';
import { cn } from '@/lib/utils';

interface RecruiterCardProps {
  recruiter: Recruiter;
  onVote?: (recruiterId: string, voteType: 'up' | 'down') => Promise<void>;
  compact?: boolean;
}

function VerificationBadge({
  verified,
  type,
}: {
  verified: boolean;
  type: 'email' | 'linkedin';
}) {
  if (verified) {
    return (
      <span
        className="inline-flex items-center text-green-600"
        title={`Verified ${type}`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center text-yellow-500"
      title={`Unverified ${type}`}
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function LinkedInIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function SourceBadge({ source }: { source: Recruiter['source'] }) {
  const styles: Record<Recruiter['source'], string> = {
    job_posting: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    pattern: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    user: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    osint: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300',
  };

  const labels: Record<Recruiter['source'], string> = {
    job_posting: 'Job Posting',
    pattern: 'Pattern',
    user: 'Community',
    osint: 'OSINT',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        styles[source]
      )}
    >
      {labels[source]}
    </span>
  );
}

export function RecruiterCard({ recruiter, onVote, compact = false }: RecruiterCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-3',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Name and title */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {recruiter.name}
            </span>
            <SourceBadge source={recruiter.source} />
          </div>

          {recruiter.title && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{recruiter.title}</p>
          )}

          {/* Contact info */}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {recruiter.linkedin_url && (
              <a
                href={recruiter.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                <LinkedInIcon />
                <span>LinkedIn</span>
                <VerificationBadge
                  verified={recruiter.linkedin_verified}
                  type="linkedin"
                />
              </a>
            )}
          </div>

          {/* Email options */}
          {(recruiter.email_variants && recruiter.email_variants.length > 0) ? (
            <div className="mt-2 space-y-1.5">
              {/* Check if first email is verified (from external service) */}
              {recruiter.email_variants[0]?.confidence >= 0.9 ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Verified Email
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  Possible emails
                  <span className="text-yellow-600 dark:text-yellow-500 ml-1" title="Verify via LinkedIn before contacting">
                    (verify on LinkedIn first)
                  </span>
                </p>
              )}
              {recruiter.email_variants.slice(0, 4).map((variant, idx) => (
                <div key={variant.email} className="flex items-center gap-2">
                  <a
                    href={`mailto:${variant.email}`}
                    className={cn(
                      "inline-flex items-center gap-1 text-sm hover:text-blue-800 dark:hover:text-blue-300",
                      variant.confidence >= 0.9 ? "text-green-700 dark:text-green-400 font-medium" :
                      idx === 0 ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-600 dark:text-gray-400"
                    )}
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="truncate max-w-[180px]">{variant.email}</span>
                  </a>
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    variant.confidence >= 0.9 ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" :
                    variant.confidence >= 0.7 ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400" :
                    variant.confidence >= 0.5 ? "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400" :
                    "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400"
                  )}>
                    {variant.confidence >= 0.9 ? (
                      <span className="flex items-center gap-0.5">
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        verified
                      </span>
                    ) : (
                      `${Math.round(variant.confidence * 100)}%`
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : recruiter.email && (
            <div className="mt-2">
              <a
                href={`mailto:${recruiter.email}`}
                className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span className="truncate max-w-[180px]">{recruiter.email}</span>
                <VerificationBadge
                  verified={recruiter.email_verified}
                  type="email"
                />
              </a>
            </div>
          )}
        </div>

        {/* Vote buttons */}
        <VoteButtons
          upvotes={recruiter.upvotes}
          downvotes={recruiter.downvotes}
          recruiterId={recruiter.id}
          onVote={onVote}
        />
      </div>
    </div>
  );
}
