'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface VoteButtonsProps {
  upvotes: number;
  downvotes: number;
  recruiterId: string;
  onVote?: (recruiterId: string, voteType: 'up' | 'down') => Promise<void>;
  disabled?: boolean;
}

export function VoteButtons({
  upvotes,
  downvotes,
  recruiterId,
  onVote,
  disabled = false,
}: VoteButtonsProps) {
  const [currentUpvotes, setCurrentUpvotes] = useState(upvotes);
  const [currentDownvotes, setCurrentDownvotes] = useState(downvotes);
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = async (voteType: 'up' | 'down') => {
    if (disabled || isVoting) return;

    setIsVoting(true);
    try {
      // Optimistic update
      if (userVote === voteType) {
        // Undo vote
        if (voteType === 'up') {
          setCurrentUpvotes((prev) => prev - 1);
        } else {
          setCurrentDownvotes((prev) => prev - 1);
        }
        setUserVote(null);
      } else {
        // New vote or switch
        if (userVote === 'up') {
          setCurrentUpvotes((prev) => prev - 1);
        } else if (userVote === 'down') {
          setCurrentDownvotes((prev) => prev - 1);
        }

        if (voteType === 'up') {
          setCurrentUpvotes((prev) => prev + 1);
        } else {
          setCurrentDownvotes((prev) => prev + 1);
        }
        setUserVote(voteType);
      }

      if (onVote) {
        await onVote(recruiterId, voteType);
      }
    } catch (error) {
      // Revert on error
      setCurrentUpvotes(upvotes);
      setCurrentDownvotes(downvotes);
      setUserVote(null);
    } finally {
      setIsVoting(false);
    }
  };

  const score = currentUpvotes - currentDownvotes;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleVote('up')}
        disabled={disabled || isVoting}
        className={cn(
          'p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500',
          userVote === 'up' && 'text-green-600 bg-green-50 dark:bg-green-900/30'
        )}
        aria-label={`Upvote recruiter${userVote === 'up' ? ' (voted)' : ''}`}
        aria-pressed={userVote === 'up'}
      >
        <svg
          className="w-4 h-4"
          fill={userVote === 'up' ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 15l7-7 7 7"
          />
        </svg>
      </button>

      <span
        className={cn(
          'text-sm font-medium min-w-[2rem] text-center',
          score > 0 && 'text-green-600',
          score < 0 && 'text-red-600',
          score === 0 && 'text-gray-500'
        )}
      >
        {score}
      </span>

      <button
        onClick={() => handleVote('down')}
        disabled={disabled || isVoting}
        className={cn(
          'p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500',
          userVote === 'down' && 'text-red-600 bg-red-50 dark:bg-red-900/30'
        )}
        aria-label={`Downvote recruiter${userVote === 'down' ? ' (voted)' : ''}`}
        aria-pressed={userVote === 'down'}
      >
        <svg
          className="w-4 h-4"
          fill={userVote === 'down' ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    </div>
  );
}
