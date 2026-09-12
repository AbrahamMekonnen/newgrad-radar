'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

export interface InterviewQuestion {
  id: string;
  company: string;
  company_logo?: string;
  position?: string;
  question_type: 'technical' | 'behavioral' | 'system_design' | 'oa';
  question_text: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  interview_date?: string;
  source?: string;
  source_url?: string;
  upvotes: number;
  tags?: string[];
}

interface InterviewQuestionCardProps {
  question: InterviewQuestion;
  onUpvote?: (id: string) => void;
  hasUpvoted?: boolean;
  className?: string;
}

const typeConfig = {
  technical: { label: 'Technical', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  behavioral: { label: 'Behavioral', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  system_design: { label: 'System Design', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  oa: { label: 'Online Assessment', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

const difficultyConfig = {
  easy: { label: 'Easy', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  hard: { label: 'Hard', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export function InterviewQuestionCard({
  question,
  onUpvote,
  hasUpvoted = false,
  className,
}: InterviewQuestionCardProps) {
  const [localUpvoted, setLocalUpvoted] = useState(hasUpvoted);
  const [localUpvotes, setLocalUpvotes] = useState(question.upvotes);

  const handleUpvote = () => {
    if (onUpvote) {
      onUpvote(question.id);
    }
    if (!localUpvoted) {
      setLocalUpvotes(prev => prev + 1);
      setLocalUpvoted(true);
    } else {
      setLocalUpvotes(prev => prev - 1);
      setLocalUpvoted(false);
    }
  };

  const typeInfo = typeConfig[question.question_type];
  const difficultyInfo = question.difficulty ? difficultyConfig[question.difficulty] : null;

  const formattedDate = question.interview_date
    ? new Date(question.interview_date).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div
      className={cn(
        'p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700',
        'hover:border-gray-300 dark:hover:border-slate-600 transition-colors',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Company logo/initial */}
        <div className="flex-shrink-0">
          {question.company_logo ? (
            <img
              src={question.company_logo}
              alt={question.company}
              className="w-10 h-10 rounded-lg object-contain bg-gray-100 dark:bg-slate-700"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {question.company.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Company and role */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {question.company}
            </span>
            {question.position && (
              <>
                <span className="text-gray-400 dark:text-gray-500">•</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                  {question.position}
                </span>
              </>
            )}
          </div>

          {/* Question text */}
          <p className="text-gray-700 dark:text-gray-300 mb-3 line-clamp-3">
            {question.question_text}
          </p>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
            {difficultyInfo && (
              <Badge className={difficultyInfo.color}>{difficultyInfo.label}</Badge>
            )}
            {formattedDate && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formattedDate}
              </span>
            )}
            {question.tags?.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Upvote button */}
        <div className="flex-shrink-0">
          <button
            onClick={handleUpvote}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800',
              localUpvoted
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400'
            )}
            aria-label={localUpvoted ? 'Remove upvote' : 'Upvote'}
          >
            <svg
              className={cn('w-5 h-5', localUpvoted && 'fill-current')}
              fill="none"
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
            <span className="text-xs font-medium">{localUpvotes}</span>
          </button>
        </div>
      </div>

      {/* Source link */}
      {question.source_url && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <a
            href={question.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <span>Source: {question.source || 'View original'}</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}
