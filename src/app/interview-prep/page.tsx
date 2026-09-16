'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import { INTERVIEW_SOURCE_OPTIONS } from '@/lib/interview-sources';

interface InterviewQuestion {
  id: string;
  company_slug: string | null;
  company_name: string;
  position: string | null;
  position_level: string | null;
  question_type: 'technical_coding' | 'technical_conceptual' | 'system_design' | 'behavioral' | 'case_study' | 'take_home' | 'oa' | 'brain_teaser' | 'other';
  question_text: string;
  question_title: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | 'unknown';
  interview_date: string | null;
  interview_round: string | null;
  source_name: string | null;
  source_url: string | null;
  is_verified: boolean;
  upvotes: number;
  scraped_at: string;
}

const QUESTION_TYPES = [
  { value: 'all', label: 'All Questions' },
  { value: 'technical_coding', label: 'Coding' },
  { value: 'technical_conceptual', label: 'Conceptual' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system_design', label: 'System Design' },
  { value: 'oa', label: 'Online Assessment' },
  { value: 'brain_teaser', label: 'Brain Teaser' },
];

const ROLES = [
  { value: '', label: 'All Roles' },
  { value: 'swe', label: 'Software Engineer' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'fullstack', label: 'Full Stack' },
  { value: 'ml', label: 'ML/AI Engineer' },
  { value: 'data', label: 'Data Engineer' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'infra', label: 'Infrastructure' },
];

// Keyword that actually appears in raw scraped `position` text for each role
// code. Selecting a role matches these PLUS untagged/generic questions.
const ROLE_KEYWORDS: Record<string, string> = {
  swe: 'software',
  frontend: 'front',
  backend: 'back',
  fullstack: 'full stack',
  ml: 'machine learning',
  data: 'data',
  mobile: 'mobile',
  infra: 'infrastructure',
};

// We only scrape ~6 months of recent history, so longer windows (year, all
// time) would return the identical set. Keep only windows that differentiate.
const DATE_RANGES = [
  { value: 1, label: 'Last Month' },
  { value: 3, label: 'Last 3 Months' },
  { value: 6, label: 'Last 6 Months' },
];

// Seniority levels. "" = All Levels (everything, including level-less
// company-frequency data). Picking a specific level returns ONLY questions
// tagged for that level — accurate for the user's position.
const LEVELS = [
  { value: '', label: 'All Levels' },
  { value: 'intern', label: 'Intern' },
  { value: 'new_grad', label: 'New Grad' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff', label: 'Staff' },
  { value: 'principal', label: 'Principal' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  hard: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  unknown: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

const TYPE_COLORS: Record<string, string> = {
  technical_coding: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  technical_conceptual: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  behavioral: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  system_design: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  oa: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  brain_teaser: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  case_study: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  take_home: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

function QuestionCard({ question }: { question: InterviewQuestion }) {
  const formattedDate = question.interview_date
    ? new Date(question.interview_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : question.scraped_at
    ? new Date(question.scraped_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const typeLabel = question.question_type.replace(/_/g, ' ');
  const difficultyColor = DIFFICULTY_COLORS[question.difficulty] || DIFFICULTY_COLORS.medium;
  const typeColor = TYPE_COLORS[question.question_type] || TYPE_COLORS.other;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 dark:text-white">{question.company_name}</span>
          {question.position && (
            <span className="text-sm text-gray-500 dark:text-gray-400">• {question.position}</span>
          )}
          {question.position_level && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
              {question.position_level.replace('_', ' ')}
            </span>
          )}
          {question.interview_round && (
            <span className="text-xs text-gray-400 dark:text-gray-500">({question.interview_round})</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full capitalize', typeColor)}>
            {typeLabel}
          </span>
          {question.difficulty !== 'unknown' && (
            <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', difficultyColor)}>
              {question.difficulty}
            </span>
          )}
        </div>
      </div>

      {question.question_title && (
        <h3 className="font-medium text-gray-900 dark:text-white mb-1">{question.question_title}</h3>
      )}
      <p className="text-gray-800 dark:text-gray-200 mb-3">{question.question_text}</p>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          {formattedDate && <span>{formattedDate}</span>}
          {question.source_name && <span className="capitalize">{question.source_name.replace(/_/g, ' ')}</span>}
          {question.is_verified && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified
            </span>
          )}
        </div>
        {question.source_url && (
          <a
            href={question.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Source
          </a>
        )}
      </div>
    </div>
  );
}

function QuestionSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-3/4 mb-3" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

function SubmitQuestionModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [position, setPosition] = useState('');
  const [questionType, setQuestionType] = useState<string>('technical_coding');
  const [questionText, setQuestionText] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [sourceUrl, setSourceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/interview-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          position: position || null,
          question_type: questionType,
          question_text: questionText,
          difficulty,
          source_url: sourceUrl || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit');
      }

      // Reset form
      setCompanyName('');
      setPosition('');
      setQuestionType('technical_coding');
      setQuestionText('');
      setDifficulty('medium');
      setSourceUrl('');
      onSubmit();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit question');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Interview Question" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        <Input
          label="Company *"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g., Google, Meta, Amazon"
          required
        />

        <Input
          label="Position/Role"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="e.g., Software Engineer, ML Engineer"
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Question Type *
          </label>
          <select
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="technical_coding">Technical Coding</option>
            <option value="technical_conceptual">Technical Conceptual</option>
            <option value="behavioral">Behavioral</option>
            <option value="system_design">System Design</option>
            <option value="oa">Online Assessment</option>
            <option value="brain_teaser">Brain Teaser</option>
            <option value="case_study">Case Study</option>
            <option value="take_home">Take Home</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Question *
          </label>
          <textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="Enter the interview question..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 min-h-[100px]"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Difficulty
          </label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <Input
          label="Source URL (optional)"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
          type="url"
        />

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? 'Submitting...' : 'Submit Question'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function InterviewPrepPage() {
  return (
    <Suspense fallback={<InterviewPrepSkeleton />}>
      <InterviewPrepContent />
    </Suspense>
  );
}

function InterviewPrepSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-48 mb-4" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-64 mb-8" />
          <div className="h-24 bg-gray-200 dark:bg-slate-700 rounded mb-6" />
          <div className="space-y-4">
            <div className="h-32 bg-gray-200 dark:bg-slate-700 rounded" />
            <div className="h-32 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InterviewPrepContent() {
  const searchParams = useSearchParams();
  const urlCompany = searchParams.get('company') || '';

  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters - initialize from URL if present
  const [companySearch, setCompanySearch] = useState(urlCompany);
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [dateRange, setDateRange] = useState(6);

  // Keep state in sync if URL changes (client-side navigation)
  useEffect(() => {
    setCompanySearch(urlCompany);
  }, [urlCompany]);

  // Pagination
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const limit = 20;

  // Modal
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        offset: (page * limit).toString(),
        limit: limit.toString(),
        months_back: dateRange.toString(),
      });

      // Always use company name search (more reliable than slug matching)
      // Use URL param as fallback if state hasn't synced yet
      const searchTerm = companySearch || urlCompany;
      if (searchTerm) {
        params.set('search', searchTerm);
      }
      // Map the role code to a keyword that actually appears in the raw scraped
      // `position` text (the code "swe" never matches "Software Engineer"). The
      // API also includes untagged/generic questions, so the list won't be empty.
      if (selectedRole && ROLE_KEYWORDS[selectedRole]) {
        params.set('position', ROLE_KEYWORDS[selectedRole]);
      }
      if (selectedType !== 'all') params.set('question_type', selectedType);
      if (selectedLevel) params.set('position_level', selectedLevel);
      if (selectedSource !== 'all') params.set('source', selectedSource);

      const res = await fetch(`/api/interview-questions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch questions');

      const data = await res.json();
      setQuestions(data.questions || []);
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  }, [companySearch, selectedRole, selectedType, selectedLevel, selectedSource, dateRange, page, urlCompany]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [companySearch, selectedRole, selectedType, selectedLevel, selectedSource, dateRange]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Interview Prep</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {total.toLocaleString()} questions from recent interviews
            </p>
          </div>
          <Button onClick={() => setShowSubmitModal(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Submit Question
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {/* Company Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Company
              </label>
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Search company..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Role Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Role
              </label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Seniority Level */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Level
              </label>
              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {LEVELS.map((lvl) => (
                  <option key={lvl.value} value={lvl.value}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Source Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Source
              </label>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {INTERVIEW_SOURCE_OPTIONS.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Time Period
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {DATE_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Filters */}
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setCompanySearch('');
                  setSelectedRole('');
                  setSelectedType('all');
                  setSelectedLevel('');
                  setSelectedSource('all');
                  setDateRange(6);
                }}
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </div>

        {/* Question Type Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {QUESTION_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => setSelectedType(type.value)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                selectedType === type.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              )}
            >
              {type.label}
            </button>
          ))}
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchQuestions} className="mt-2">
              Retry
            </Button>
          </div>
        )}

        {/* Questions List */}
        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <QuestionSkeleton key={i} />)
          ) : questions.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
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
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                No questions found
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Try adjusting your filters or be the first to submit a question.
              </p>
              <Button onClick={() => setShowSubmitModal(true)}>Submit a Question</Button>
            </div>
          ) : (
            questions.map((question) => <QuestionCard key={question.id} question={question} />)
          )}
        </div>

        {/* Pagination */}
        {!loading && questions.length > 0 && (
          <div className="flex items-center justify-between mt-8">
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {page + 1} of {Math.ceil(total / limit)}
            </span>
            <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={!hasMore}>
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Submit Modal */}
      <SubmitQuestionModal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmit={fetchQuestions}
      />
    </div>
  );
}
