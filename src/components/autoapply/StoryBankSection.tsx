'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { StoryBankWizard } from './StoryBankWizard';
import {
  UserStory,
  StoryType,
  QuestionCategory,
  CompanyAnswer,
  GeneratedAnswer,
  STORY_TYPE_LABELS,
  STORY_TYPE_ICONS,
  QUESTION_CATEGORY_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface StoryBankSectionProps {
  userId: string;
}

interface StoryStats {
  total: number;
  byType: Record<StoryType, number>;
  completeness: number;
  generatedAnswers: number;
  companyAnswers: number;
}

type GenerationStatus = 'idle' | 'generating' | 'complete' | 'error';

const RECOMMENDED_STORY_TYPES: StoryType[] = [
  'project',
  'teamwork',
  'conflict',
  'leadership',
  'failure',
  'achievement',
];

export function StoryBankSection({ userId }: StoryBankSectionProps) {
  const [stories, setStories] = useState<UserStory[]>([]);
  const [generatedAnswers, setGeneratedAnswers] = useState<GeneratedAnswer[]>([]);
  const [companyAnswers, setCompanyAnswers] = useState<CompanyAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<UserStory | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [previewAnswer, setPreviewAnswer] = useState<GeneratedAnswer | null>(null);

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [storiesRes, answersRes, companyRes] = await Promise.all([
        supabase.from('user_story_bank').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('answer_bank').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('company_answers').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      ]);

      if (storiesRes.data) setStories(storiesRes.data);
      if (answersRes.data) setGeneratedAnswers(answersRes.data);
      if (companyRes.data) setCompanyAnswers(companyRes.data);
    } catch (error) {
      console.error('Error fetching story bank data:', error);
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveStory = async (story: Partial<UserStory>) => {
    const storyData = {
      ...story,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    if (story.id) {
      const { error } = await supabase
        .from('user_story_bank')
        .update(storyData)
        .eq('id', story.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('user_story_bank').insert({
        ...storyData,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
    }

    await fetchData();
    setEditingStory(null);
  };

  const handleDeleteStory = async (storyId: string) => {
    if (!confirm('Are you sure you want to delete this story?')) return;

    const { error } = await supabase.from('user_story_bank').delete().eq('id', storyId);
    if (error) {
      console.error('Error deleting story:', error);
      return;
    }

    await fetchData();
  };

  const handleGenerateAnswers = async () => {
    if (stories.length === 0) {
      alert('Please add at least one story before generating answers.');
      return;
    }

    setGenerationStatus('generating');
    setGenerationProgress(0);

    try {
      // Simulate generation progress (in real implementation, this would call an API)
      const categories: QuestionCategory[] = [
        'challenging_project',
        'teamwork',
        'conflict_resolution',
        'failure_learning',
        'leadership',
        'problem_solving',
        'achievement',
      ];

      for (let i = 0; i < categories.length; i++) {
        // Simulate API call delay
        await new Promise((resolve) => setTimeout(resolve, 500));
        setGenerationProgress(Math.round(((i + 1) / categories.length) * 100));
      }

      setGenerationStatus('complete');
      await fetchData();
    } catch (error) {
      console.error('Error generating answers:', error);
      setGenerationStatus('error');
    }
  };

  const calculateStats = (): StoryStats => {
    const byType: Record<StoryType, number> = {
      project: 0,
      teamwork: 0,
      conflict: 0,
      leadership: 0,
      failure: 0,
      achievement: 0,
      technical: 0,
      growth: 0,
    };

    stories.forEach((story) => {
      byType[story.story_type]++;
    });

    const coveredTypes = RECOMMENDED_STORY_TYPES.filter((type) => byType[type] > 0).length;
    const completeness = Math.round((coveredTypes / RECOMMENDED_STORY_TYPES.length) * 100);

    return {
      total: stories.length,
      byType,
      completeness,
      generatedAnswers: generatedAnswers.length,
      companyAnswers: companyAnswers.length,
    };
  };

  const stats = calculateStats();

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-1/3" />
        <div className="h-20 bg-gray-200 dark:bg-slate-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-slate-700 rounded" />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Story Bank</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add your experiences to power AI-generated interview answers
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditingStory(null);
            setWizardOpen(true);
          }}
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Story
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Stories</div>
        </div>
        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.completeness}%</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Coverage</div>
        </div>
        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.generatedAnswers}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Answers</div>
        </div>
        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.companyAnswers}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Companies</div>
        </div>
      </div>

      {/* Completeness Indicator */}
      <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Story Type Coverage</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {RECOMMENDED_STORY_TYPES.filter((t) => stats.byType[t] > 0).length} / {RECOMMENDED_STORY_TYPES.length} types
          </span>
        </div>
        <div className="flex gap-1 mb-3">
          {RECOMMENDED_STORY_TYPES.map((type) => (
            <div
              key={type}
              className={cn(
                'flex-1 h-2 rounded-full',
                stats.byType[type] > 0 ? 'bg-green-500' : 'bg-gray-200 dark:bg-slate-700'
              )}
              title={`${STORY_TYPE_LABELS[type]}: ${stats.byType[type]} stories`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {RECOMMENDED_STORY_TYPES.map((type) => (
            <span
              key={type}
              className={cn(
                'px-2 py-1 rounded-full',
                stats.byType[type] > 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
              )}
            >
              {STORY_TYPE_LABELS[type]}
              {stats.byType[type] > 0 && ` (${stats.byType[type]})`}
            </span>
          ))}
        </div>
      </div>

      {/* Story List */}
      {stories.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Your Stories</h3>
          <div className="space-y-2">
            {stories.slice(0, 5).map((story) => (
              <div
                key={story.id}
                className="p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-blue-600 dark:text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={STORY_TYPE_ICONS[story.story_type]}
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white text-sm">{story.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {STORY_TYPE_LABELS[story.story_type]}
                      {story.organization && ` - ${story.organization}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Used {story.times_used}x
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingStory(story);
                      setWizardOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteStory(story.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {stories.length > 5 && (
              <Link
                href="/settings/stories"
                className="block text-center text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 py-2"
              >
                View all {stories.length} stories
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Generate Answers Section */}
      <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-700/50 rounded-lg">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-gray-900 dark:text-white">Generate Interview Answers</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Use AI to create polished answers for common interview questions based on your stories.
            </p>

            {generationStatus === 'generating' && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-purple-700 dark:text-purple-400">Generating answers...</span>
                  <span className="text-gray-500">{generationProgress}%</span>
                </div>
                <div className="h-2 bg-purple-100 dark:bg-purple-900/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 transition-all duration-300"
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
              </div>
            )}

            {generationStatus === 'complete' && (
              <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium">Answers generated successfully!</span>
                </div>
              </div>
            )}

            {generationStatus === 'error' && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-sm font-medium">Error generating answers. Please try again.</span>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                onClick={handleGenerateAnswers}
                disabled={stories.length === 0 || generationStatus === 'generating'}
              >
                {generationStatus === 'generating' ? 'Generating...' : 'Generate Answers'}
              </Button>
              {stats.generatedAnswers > 0 && (
                <Link
                  href="/settings/answers"
                  className="text-sm text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
                >
                  View {stats.generatedAnswers} generated answers
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Company-Specific Answers */}
      {companyAnswers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Company-Specific Answers</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {companyAnswers.slice(0, 6).map((answer) => (
              <div
                key={answer.id}
                className="p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg"
              >
                <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                  {answer.company_name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {[
                    answer.why_company_short && 'Short',
                    answer.why_company_standard && 'Standard',
                    answer.why_company_long && 'Long',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              </div>
            ))}
          </div>
          {companyAnswers.length > 6 && (
            <Link
              href="/settings/company-answers"
              className="block text-center text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View all {companyAnswers.length} company answers
            </Link>
          )}
        </div>
      )}

      {/* Preview Modal for Generated Answers */}
      {previewAnswer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900 dark:text-white">
                {QUESTION_CATEGORY_LABELS[previewAnswer.question_category]}
              </h3>
              <button onClick={() => setPreviewAnswer(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p className="whitespace-pre-wrap">{previewAnswer.answer_text}</p>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 text-xs text-gray-500 dark:text-gray-400">
              ~{previewAnswer.word_count_target} words | Used {previewAnswer.times_used}x
            </div>
          </div>
        </div>
      )}

      {/* Wizard Modal */}
      <StoryBankWizard
        isOpen={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          setEditingStory(null);
        }}
        onSave={handleSaveStory}
        editingStory={editingStory}
      />
    </section>
  );
}
