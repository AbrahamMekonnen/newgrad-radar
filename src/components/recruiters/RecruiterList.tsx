'use client';

import { useState } from 'react';
import { Recruiter } from '@/lib/types';
import { RecruiterCard } from './RecruiterCard';
import { cn } from '@/lib/utils';

interface RecruiterListProps {
  recruiters: Recruiter[];
  onVote?: (recruiterId: string, voteType: 'up' | 'down') => Promise<void>;
  maxVisible?: number;
  className?: string;
}

export function RecruiterList({
  recruiters,
  onVote,
  maxVisible = 3,
  className,
}: RecruiterListProps) {
  const [expanded, setExpanded] = useState(false);

  if (recruiters.length === 0) {
    return (
      <div className={cn('text-sm text-gray-500 dark:text-gray-400 italic', className)}>
        No recruiters found for this position
      </div>
    );
  }

  // Sort by score (upvotes - downvotes), then by verification status
  const sortedRecruiters = [...recruiters].sort((a, b) => {
    const scoreA = a.upvotes - a.downvotes;
    const scoreB = b.upvotes - b.downvotes;
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Prefer verified emails
    if (a.email_verified !== b.email_verified) {
      return a.email_verified ? -1 : 1;
    }
    return 0;
  });

  const visibleRecruiters = expanded
    ? sortedRecruiters
    : sortedRecruiters.slice(0, maxVisible);
  const remainingCount = recruiters.length - maxVisible;

  return (
    <div className={cn('space-y-2', className)}>
      {visibleRecruiters.map((recruiter) => (
        <RecruiterCard
          key={recruiter.id}
          recruiter={recruiter}
          onVote={onVote}
          compact
        />
      ))}

      {remainingCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 py-1"
        >
          {expanded ? 'Show less' : `Show ${remainingCount} more`}
        </button>
      )}
    </div>
  );
}
