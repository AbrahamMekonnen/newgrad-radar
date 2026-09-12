'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface InterviewQuestion {
  id: string;
  company_name: string;
  question_type: string;
  question_text: string;
  question_title: string | null;
  difficulty: string;
  interview_date: string | null;
  source_name: string | null;
}

interface InterviewPrepBadgeProps {
  companySlug?: string;
  companyName: string;
  position?: string;
  className?: string;
}

export function InterviewPrepBadge({ companySlug, companyName, position, className }: InterviewPrepBadgeProps) {
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const params = new URLSearchParams({ limit: '1' });
        if (companySlug) {
          params.set('company_slug', companySlug);
        } else {
          params.set('search', companyName);
        }

        const res = await fetch(`/api/interview-questions?${params}`);
        if (res.ok) {
          const data = await res.json();
          setQuestionCount(data.total || 0);
        }
      } catch (err) {
        console.error('Failed to fetch question count:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCount();
  }, [companySlug, companyName]);

  if (loading || questionCount === null || questionCount === 0) {
    return null;
  }

  const prepUrl = `/interview-prep?company=${encodeURIComponent(companyName)}`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
        <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">Interview Prep</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{questionCount} question{questionCount !== 1 ? 's' : ''} from recent interviews</p>
      </div>
      <Link
        href={prepUrl}
        prefetch={true}
        className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
      >
        View →
      </Link>
    </div>
  );
}

interface InterviewQuestionsPanelProps {
  companySlug?: string;
  companyName: string;
  position?: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export function InterviewQuestionsPanel({
  companySlug,
  companyName,
  position,
  isExpanded,
  onToggle
}: InterviewQuestionsPanelProps) {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded) return;

    const fetchQuestions = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: '5' });
        if (companySlug) {
          params.set('company_slug', companySlug);
        } else {
          params.set('search', companyName);
        }

        const res = await fetch(`/api/interview-questions?${params}`);
        if (!res.ok) throw new Error('Failed to fetch');

        const data = await res.json();
        setQuestions(data.questions || []);
        setTotal(data.total || 0);
      } catch (err) {
        setError('Failed to load questions');
      } finally {
        setLoading(false);
      }
    };

    fetchQuestions();
  }, [isExpanded, companySlug, companyName]);

  const prepUrl = `/interview-prep?company=${encodeURIComponent(companyName)}`;

  const DIFFICULTY_COLORS: Record<string, string> = {
    easy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    hard: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  const TYPE_ICONS: Record<string, string> = {
    technical_coding: '💻',
    system_design: '🏗️',
    behavioral: '🗣️',
    oa: '📝',
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100/80 dark:border-slate-700/60">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full group"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Interview Prep</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {total > 0 ? `${total} recent questions` : 'View questions for this company'}
            </p>
          </div>
        </div>
        <svg
          className={cn(
            "w-4 h-4 text-gray-400 transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <svg className="w-5 h-5 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : error ? (
            <p className="text-sm text-red-500 dark:text-red-400 text-center py-2">{error}</p>
          ) : questions.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">No questions found yet</p>
              <Link
                href="/interview-prep"
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline mt-1 inline-block"
              >
                Browse all questions →
              </Link>
            </div>
          ) : (
            <>
              {questions.map((q) => (
                <div
                  key={q.id}
                  className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg"
                >
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-sm">{TYPE_ICONS[q.question_type] || '❓'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-2">
                        {q.question_title || q.question_text}
                      </p>
                    </div>
                    <span className={cn(
                      'px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0',
                      DIFFICULTY_COLORS[q.difficulty] || DIFFICULTY_COLORS.unknown
                    )}>
                      {q.difficulty}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500 pl-6">
                    <span className="capitalize">{q.question_type.replace(/_/g, ' ')}</span>
                    {q.interview_date && (
                      <>
                        <span>•</span>
                        <span>{new Date(q.interview_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {total > 5 && (
                <Link
                  href={prepUrl}
                  className="flex items-center justify-center gap-1 py-2 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                >
                  View all {total} questions
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
