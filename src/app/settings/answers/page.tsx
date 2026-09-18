'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// Answer length variants
type AnswerLength = 'short' | 'standard' | 'long';

// Answer quality score based on completeness and relevance
type QualityLevel = 'excellent' | 'good' | 'needs_improvement' | 'missing';

// Answer category types
interface AnswerCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  questions: string[];
}

// Individual answer with variants
interface GeneratedAnswer {
  id: string;
  user_id: string;
  category_id: string;
  question: string;
  answers: {
    short: string;
    standard: string;
    long: string;
  };
  company_slug: string | null;
  company_name: string | null;
  times_used: number;
  quality_score: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  source_type: 'bank' | 'company';
  storage_category: string;
  variant_ids: Partial<Record<AnswerLength, string>>;
}

// Define answer categories
const ANSWER_CATEGORIES: AnswerCategory[] = [
  {
    id: 'motivation',
    name: 'Motivation & Interest',
    description: 'Why you want this role or company',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    questions: [
      'Why are you interested in this role?',
      'Why do you want to work at this company?',
      'What motivates you in your career?',
      'Why did you choose software engineering?',
    ],
  },
  {
    id: 'experience',
    name: 'Experience & Skills',
    description: 'Your background and technical abilities',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    questions: [
      'Describe your most challenging project',
      'What is your experience with [technology]?',
      'How do you approach learning new technologies?',
      'Describe a time you solved a difficult bug',
    ],
  },
  {
    id: 'teamwork',
    name: 'Teamwork & Collaboration',
    description: 'How you work with others',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
    questions: [
      'Describe a time you had a conflict with a teammate',
      'How do you handle disagreements about technical decisions?',
      'Describe your experience working in a team',
      'How do you give and receive feedback?',
    ],
  },
  {
    id: 'leadership',
    name: 'Leadership & Initiative',
    description: 'Times you took charge or went above and beyond',
    icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    questions: [
      'Describe a time you led a project or initiative',
      'How do you prioritize tasks when everything is urgent?',
      'Tell me about a time you identified a problem and fixed it',
      'How do you stay organized and meet deadlines?',
    ],
  },
  {
    id: 'growth',
    name: 'Growth & Learning',
    description: 'Your approach to continuous improvement',
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    questions: [
      'What are you learning right now?',
      'How do you stay up to date with technology?',
      'Describe a failure and what you learned from it',
      'Where do you see yourself in 5 years?',
    ],
  },
  {
    id: 'values',
    name: 'Values & Culture',
    description: 'What matters to you in a workplace',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    questions: [
      'What kind of work environment do you thrive in?',
      'How do you handle work-life balance?',
      'What values are important to you in a company?',
      'How do you handle pressure and stress?',
    ],
  },
];

const LENGTH_LABELS: Record<AnswerLength, string> = {
  short: 'Short (1-2 sentences)',
  standard: 'Standard (1 paragraph)',
  long: 'Detailed (2-3 paragraphs)',
};

const LENGTH_COLORS: Record<AnswerLength, string> = {
  short: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  standard: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  long: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const QUALITY_CONFIG: Record<QualityLevel, { label: string; color: string; bgColor: string }> = {
  excellent: { label: 'Excellent', color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  good: { label: 'Good', color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  needs_improvement: { label: 'Needs Work', color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  missing: { label: 'Not Set', color: 'text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800' },
};

function getQualityLevel(score: number): QualityLevel {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 1) return 'needs_improvement';
  return 'missing';
}

export default function AnswerBankPage() {
  return (
    <AuthGuard>
      {(user) => <AnswerBankContent userId={user.id} />}
    </AuthGuard>
  );
}

function AnswerBankContent({ userId }: { userId: string }) {
  const [answers, setAnswers] = useState<GeneratedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLength, setSelectedLength] = useState<AnswerLength>('standard');
  const [editingAnswer, setEditingAnswer] = useState<GeneratedAnswer | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCompanyAnswers, setShowCompanyAnswers] = useState(false);

  const categoryFor = (category: string): string => {
    if (['why_company', 'why_role'].includes(category)) return 'motivation';
    if (['challenging_project', 'problem_solving', 'strengths', 'achievement'].includes(category)) return 'experience';
    if (['teamwork', 'conflict_resolution'].includes(category)) return 'teamwork';
    if (category === 'leadership') return 'leadership';
    if (['failure_learning', 'weaknesses', 'career_goals'].includes(category)) return 'growth';
    return 'values';
  };

  const questionFor = (category: string): string => ({
    why_company: 'Why do you want to work at this company?',
    why_role: 'Why are you interested in this role?',
    challenging_project: 'Describe your most challenging project',
    teamwork: 'Describe your experience working in a team',
    conflict_resolution: 'Describe a time you resolved a conflict',
    failure_learning: 'Describe a failure and what you learned from it',
    leadership: 'Describe a time you led a project or initiative',
    problem_solving: 'Describe a difficult problem you solved',
    strengths: 'What are your greatest strengths?',
    weaknesses: 'What is an area you are improving?',
    career_goals: 'Where do you see yourself in 5 years?',
    achievement: 'What is your proudest accomplishment?',
    generic: 'Reusable application answer',
  }[category] || 'Reusable application answer');

  const qualityForText = (text: string): number => {
    const length = text.trim().length;
    if (!length) return 0;
    if (length >= 300) return 95;
    if (length >= 150) return 85;
    if (length >= 75) return 75;
    return 60;
  };

  const fetchAnswers = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [bankResponse, companyResponse] = await Promise.all([
        fetch('/api/answers?limit=200'),
        fetch('/api/answers/company?limit=200'),
      ]);
      if (!bankResponse.ok) {
        const body = await bankResponse.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load answer bank');
      }
      if (!companyResponse.ok) {
        const body = await companyResponse.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load company answers');
      }

      const bankBody = await bankResponse.json();
      const companyBody = await companyResponse.json();
      const groupedBankAnswers = new Map<string, GeneratedAnswer>();
      for (const row of (bankBody.answers || []) as Record<string, unknown>[]) {
        const text = String(row.answer_text || '');
        const category = String(row.question_category || 'generic');
        const wordCount = Number(row.word_count_target || 150);
        const length: AnswerLength = wordCount <= 100 ? 'short' : wordCount <= 200 ? 'standard' : 'long';
        const key = `${String(row.story_id || row.id)}:${category}`;
        const existing = groupedBankAnswers.get(key) || {
          id: String(row.id),
          user_id: userId,
          category_id: categoryFor(category),
          question: questionFor(category),
          answers: { short: '', standard: '', long: '' },
          company_slug: null,
          company_name: null,
          times_used: 0,
          quality_score: 0,
          last_used_at: null,
          created_at: String(row.created_at || new Date().toISOString()),
          updated_at: String(row.updated_at || row.created_at || new Date().toISOString()),
          source_type: 'bank' as const,
          storage_category: category,
          variant_ids: {},
        };
        existing.answers[length] = text;
        existing.variant_ids[length] = String(row.id);
        existing.times_used += Number(row.times_used || 0);
        existing.quality_score = Math.max(existing.quality_score, qualityForText(text));
        if (row.last_used_at) existing.last_used_at = String(row.last_used_at);
        groupedBankAnswers.set(key, existing);
      }
      const bankAnswers = Array.from(groupedBankAnswers.values());
      const companyAnswers: GeneratedAnswer[] = (companyBody.answers || []).map((row: Record<string, unknown>) => {
        const short = String(row.why_company_short || '');
        const standard = String(row.why_company_standard || '');
        const long = String(row.why_company_long || '');
        return {
          id: String(row.id),
          user_id: userId,
          category_id: 'motivation',
          question: `Why do you want to work at ${String(row.company_name || 'this company')}?`,
          answers: { short, standard, long },
          company_slug: row.company_slug ? String(row.company_slug) : null,
          company_name: row.company_name ? String(row.company_name) : null,
          times_used: Number(row.times_used || 0),
          quality_score: Math.round((qualityForText(short) + qualityForText(standard) + qualityForText(long)) / 3),
          last_used_at: row.last_used_at ? String(row.last_used_at) : null,
          created_at: String(row.created_at || row.generated_at || new Date().toISOString()),
          updated_at: String(row.updated_at || row.generated_at || new Date().toISOString()),
          source_type: 'company',
          storage_category: 'why_company',
          variant_ids: {},
        };
      });
      setAnswers([...companyAnswers, ...bankAnswers]);
    } catch (err) {
      console.error('Error loading answers:', err);
      setAnswers([]);
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load answers' });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchAnswers(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchAnswers]);

  const handleEdit = (answer: GeneratedAnswer) => {
    setEditingAnswer(answer);
    setEditText(answer.answers[selectedLength] || '');
  };

  const handleSaveEdit = async () => {
    if (!editingAnswer || !editText.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = editingAnswer.source_type === 'company'
        ? await fetch('/api/answers/company', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editingAnswer.id,
              [`why_company_${selectedLength}`]: editText.trim(),
            }),
          })
        : editingAnswer.variant_ids[selectedLength]
          ? await fetch(`/api/answers/${editingAnswer.variant_ids[selectedLength]}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer_text: editText.trim() }),
            })
          : new Response(JSON.stringify({ error: `Generate the ${selectedLength} variation before editing it.` }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save answer');
      }
      const updatedAnswers = {
        ...editingAnswer.answers,
        [selectedLength]: editText.trim(),
      };
      setAnswers((prev) => prev.map((answer) => answer.id === editingAnswer.id
        ? { ...answer, answers: updatedAnswers, quality_score: qualityForText(editText) }
        : answer));
      setEditingAnswer(null);
      setMessage({ type: 'success', text: 'Answer saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save answer' });
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async (answerId: string) => {
    const answer = answers.find((item) => item.id === answerId);
    if (!answer) return;
    setRegenerating(answerId);
    setMessage(null);
    try {
      const response = answer.source_type === 'company'
        ? await fetch('/api/answers/company', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_slug: answer.company_slug,
              company_name: answer.company_name,
              regenerate: true,
            }),
          })
        : await fetch('/api/answers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              categories: [answer.storage_category],
              word_counts: [selectedLength === 'short' ? 75 : selectedLength === 'long' ? 350 : 150],
            }),
          });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to regenerate answer');
      }
      await fetchAnswers();
      setMessage({ type: 'success', text: 'Answer variations refreshed' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to regenerate answer' });
    } finally {
      setRegenerating(null);
    }
  };

  const handleGenerateAnswers = async () => {
    setMessage(null);
    try {
      const response = await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word_counts: [75, 150, 350] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Failed to generate answers');
      await fetchAnswers();
      setMessage({ type: 'success', text: 'Answer bank generated from your saved stories' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to generate answers' });
    }
  };

  // Calculate stats
  const totalAnswers = answers.length;
  const companySpecificCount = answers.filter((a) => a.company_slug).length;
  const totalUsage = answers.reduce((sum, a) => sum + a.times_used, 0);
  const avgQuality = totalAnswers > 0
    ? Math.round(answers.reduce((sum, a) => sum + a.quality_score, 0) / totalAnswers)
    : 0;

  // Filter answers
  const filteredAnswers = answers.filter((a) => {
    if (selectedCategory && a.category_id !== selectedCategory) return false;
    if (showCompanyAnswers && !a.company_slug) return false;
    if (!showCompanyAnswers && a.company_slug) return false;
    return true;
  });

  // Group by category
  const answersByCategory = ANSWER_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = filteredAnswers.filter((a) => a.category_id === cat.id);
    return acc;
  }, {} as Record<string, GeneratedAnswer[]>);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Settings
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Answer Bank</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          View and manage your generated application answers
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={cn(
            'mb-6 p-4 rounded-lg text-sm',
            message.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
          )}
        >
          {message.text}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalAnswers}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Answers</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{companySpecificCount}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Company-Specific</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{totalUsage}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Times Used</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{avgQuality}%</div>
            <QualityIndicator score={avgQuality} />
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Avg Quality</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          {/* Category filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category
            </label>
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {ANSWER_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Length selector */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Answer Length
            </label>
            <div className="flex gap-2">
              {(['short', 'standard', 'long'] as AnswerLength[]).map((length) => (
                <button
                  key={length}
                  onClick={() => setSelectedLength(length)}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                    selectedLength === length
                      ? LENGTH_COLORS[length] + ' border-transparent'
                      : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                  )}
                >
                  {length.charAt(0).toUpperCase() + length.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Company-specific toggle */}
          <div className="flex items-end">
            <button
              onClick={() => setShowCompanyAnswers(!showCompanyAnswers)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg border transition-colors',
                showCompanyAnswers
                  ? 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700'
                  : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
              )}
            >
              <svg className="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Company-Specific
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {filteredAnswers.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No answers yet
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            {showCompanyAnswers
              ? 'You have no company-specific answers. These are generated when you apply to specific companies.'
              : 'Generate answers by using the auto-apply feature or create them manually below.'}
          </p>
          {!showCompanyAnswers && (
            <Button onClick={handleGenerateAnswers}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Generate Answers
            </Button>
          )}
        </div>
      )}

      {/* Answers by Category */}
      {filteredAnswers.length > 0 && (
        <div className="space-y-6">
          {ANSWER_CATEGORIES.filter((cat) => !selectedCategory || cat.id === selectedCategory).map(
            (category) => {
              const categoryAnswers = answersByCategory[category.id] || [];
              if (categoryAnswers.length === 0) return null;

              return (
                <div
                  key={category.id}
                  className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden"
                >
                  {/* Category header */}
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-blue-600 dark:text-blue-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={category.icon} />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{category.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{category.description}</p>
                      </div>
                      <div className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                        {categoryAnswers.length} answer{categoryAnswers.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Answers list */}
                  <div className="divide-y divide-gray-200 dark:divide-slate-700">
                    {categoryAnswers.map((answer) => (
                      <AnswerCard
                        key={answer.id}
                        answer={answer}
                        selectedLength={selectedLength}
                        onEdit={() => handleEdit(answer)}
                        onRegenerate={() => handleRegenerate(answer.id)}
                        isRegenerating={regenerating === answer.id}
                      />
                    ))}
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingAnswer && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-end sm:items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={() => setEditingAnswer(null)} />
            <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Edit Answer
                  </h3>
                  <button
                    onClick={() => setEditingAnswer(null)}
                    className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Question
                  </label>
                  <p className="text-gray-900 dark:text-white">{editingAnswer.question}</p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Editing: <span className={LENGTH_COLORS[selectedLength] + ' px-2 py-0.5 rounded text-xs'}>{LENGTH_LABELS[selectedLength]}</span>
                  </label>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={selectedLength === 'long' ? 10 : selectedLength === 'standard' ? 6 : 3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Enter your answer..."
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {editText.length} characters
                  </p>
                </div>
                {editingAnswer.company_name && (
                  <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                    <p className="text-sm text-indigo-700 dark:text-indigo-300">
                      <span className="font-medium">Company-specific answer for:</span> {editingAnswer.company_name}
                    </p>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setEditingAnswer(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">About Answer Bank</p>
            <p className="text-blue-700 dark:text-blue-300">
              Your answers are stored in three lengths: short (quick response), standard (typical application),
              and long (detailed explanation). Edit any answer to improve quality, or regenerate using AI to
              get fresh variations. Company-specific answers are tailored to each company&apos;s culture and values.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Answer Card Component
function AnswerCard({
  answer,
  selectedLength,
  onEdit,
  onRegenerate,
  isRegenerating,
}: {
  answer: GeneratedAnswer;
  selectedLength: AnswerLength;
  onEdit: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  const currentAnswer = answer.answers[selectedLength];
  const hasAnswer = currentAnswer && currentAnswer.trim().length > 0;

  return (
    <div className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="font-medium text-gray-900 dark:text-white truncate">{answer.question}</h4>
            {answer.company_name && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                {answer.company_name}
              </span>
            )}
          </div>
          {hasAnswer ? (
            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{currentAnswer}</p>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No {selectedLength} answer set
            </p>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Used {answer.times_used} time{answer.times_used !== 1 ? 's' : ''}
            </span>
            {answer.last_used_at && (
              <span>Last used: {new Date(answer.last_used_at).toLocaleDateString()}</span>
            )}
            <QualityIndicator score={answer.quality_score} showLabel />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
            title="Regenerate answer"
          >
            {isRegenerating ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
          <button
            onClick={onEdit}
            className="p-2 text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
            title="Edit answer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Quality Indicator Component
function QualityIndicator({ score, showLabel = false }: { score: number; showLabel?: boolean }) {
  const quality = getQualityLevel(score);
  const config = QUALITY_CONFIG[quality];

  return (
    <div className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', config.bgColor, config.color)}>
      {quality === 'excellent' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )}
      {quality === 'good' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
        </svg>
      )}
      {quality === 'needs_improvement' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )}
      {showLabel && config.label}
    </div>
  );
}
