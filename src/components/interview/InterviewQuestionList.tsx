'use client';

import { useState, useMemo } from 'react';
import { InterviewQuestionCard, InterviewQuestion } from './InterviewQuestionCard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface InterviewQuestionListProps {
  questions: InterviewQuestion[];
  companies?: string[];
  onUpvote?: (id: string) => void;
  upvotedIds?: Set<string>;
  onSubmitClick?: () => void;
  isLoading?: boolean;
  className?: string;
}

type QuestionType = 'all' | 'technical' | 'behavioral' | 'system_design' | 'oa';
type SortOption = 'recent' | 'popular';

const questionTypes: { value: QuestionType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'technical', label: 'Technical' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system_design', label: 'System Design' },
  { value: 'oa', label: 'OA' },
];

export function InterviewQuestionList({
  questions,
  companies = [],
  onUpvote,
  upvotedIds = new Set(),
  onSubmitClick,
  isLoading = false,
  className,
}: InterviewQuestionListProps) {
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<QuestionType>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract unique companies and roles from questions
  const uniqueCompanies = useMemo(() => {
    const companySet = new Set(questions.map(q => q.company));
    return Array.from(companySet).sort();
  }, [questions]);

  const uniqueRoles = useMemo(() => {
    const roleSet = new Set(questions.map(q => q.position).filter(Boolean) as string[]);
    return Array.from(roleSet).sort();
  }, [questions]);

  // Filter and sort questions
  const filteredQuestions = useMemo(() => {
    let filtered = questions;

    // Filter by company
    if (selectedCompany !== 'all') {
      filtered = filtered.filter(q => q.company === selectedCompany);
    }

    // Filter by type
    if (selectedType !== 'all') {
      filtered = filtered.filter(q => q.question_type === selectedType);
    }

    // Filter by role
    if (selectedRole !== 'all') {
      filtered = filtered.filter(q => q.position === selectedRole);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        q =>
          q.question_text.toLowerCase().includes(query) ||
          q.company.toLowerCase().includes(query) ||
          q.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Sort
    if (sortBy === 'recent') {
      filtered = [...filtered].sort((a, b) => {
        const dateA = a.interview_date ? new Date(a.interview_date).getTime() : 0;
        const dateB = b.interview_date ? new Date(b.interview_date).getTime() : 0;
        return dateB - dateA;
      });
    } else {
      filtered = [...filtered].sort((a, b) => b.upvotes - a.upvotes);
    }

    return filtered;
  }, [questions, selectedCompany, selectedType, selectedRole, sortBy, searchQuery]);

  const clearFilters = () => {
    setSelectedCompany('all');
    setSelectedType('all');
    setSelectedRole('all');
    setSearchQuery('');
  };

  const hasActiveFilters =
    selectedCompany !== 'all' ||
    selectedType !== 'all' ||
    selectedRole !== 'all' ||
    searchQuery.trim() !== '';

  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 animate-pulse"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/4" />
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filters */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search questions..."
            className="w-full px-4 py-2 pl-10 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Company filter */}
          <select
            value={selectedCompany}
            onChange={e => setSelectedCompany(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Companies</option>
            {uniqueCompanies.map(company => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>

          {/* Role filter */}
          <select
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Roles</option>
            {uniqueRoles.map(role => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          {/* Type tabs */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-slate-700 rounded-lg">
            {questionTypes.map(type => (
              <button
                key={type.value}
                onClick={() => setSelectedType(type.value)}
                className={cn(
                  'px-3 py-1 text-sm font-medium rounded-md transition-colors',
                  selectedType === type.value
                    ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                {type.label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="recent">Most Recent</option>
            <option value="popular">Most Popular</option>
          </select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Clear filters
            </button>
          )}

          {/* Submit button */}
          {onSubmitClick && (
            <Button onClick={onSubmitClick} variant="primary" size="sm" className="ml-auto">
              + Submit Question
            </Button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {filteredQuestions.length} question{filteredQuestions.length !== 1 ? 's' : ''} found
      </div>

      {/* Question list */}
      {filteredQuestions.length > 0 ? (
        <div className="space-y-3">
          {filteredQuestions.map(question => (
            <InterviewQuestionCard
              key={question.id}
              question={question}
              onUpvote={onUpvote}
              hasUpvoted={upvotedIds.has(question.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
          <svg
            className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
            No questions found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Try adjusting your filters or search query
          </p>
          {onSubmitClick && (
            <Button onClick={onSubmitClick} variant="outline" size="sm">
              Be the first to submit a question
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
