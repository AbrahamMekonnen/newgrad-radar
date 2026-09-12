'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import {
  UserStory,
  StoryType,
  StoryContext,
  QuestionCategory,
  StoryResult,
  STORY_TYPE_LABELS,
  STORY_CONTEXT_LABELS,
  QUESTION_CATEGORY_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface StoryBankWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (story: Partial<UserStory>) => Promise<void>;
  editingStory?: UserStory | null;
}

type WizardStep = 'type' | 'context' | 'star' | 'details' | 'categories';

const WIZARD_STEPS: { id: WizardStep; title: string; description: string }[] = [
  { id: 'type', title: 'Story Type', description: 'What kind of experience is this?' },
  { id: 'context', title: 'Context', description: 'Where did this happen?' },
  { id: 'star', title: 'STAR Format', description: 'Describe the situation, task, actions, and results' },
  { id: 'details', title: 'Details', description: 'Add additional context' },
  { id: 'categories', title: 'Categories', description: 'Which questions can this answer?' },
];

const STORY_TYPES: StoryType[] = [
  'project',
  'teamwork',
  'conflict',
  'leadership',
  'failure',
  'achievement',
  'technical',
  'growth',
];

const STORY_CONTEXTS: StoryContext[] = [
  'internship',
  'work',
  'class',
  'hackathon',
  'personal',
  'research',
  'volunteer',
];

const QUESTION_CATEGORIES: QuestionCategory[] = [
  'challenging_project',
  'teamwork',
  'conflict_resolution',
  'failure_learning',
  'leadership',
  'problem_solving',
  'achievement',
  'strengths',
  'career_goals',
  'generic',
];

export function StoryBankWizard({ isOpen, onClose, onSave, editingStory }: StoryBankWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('type');
  const [saving, setSaving] = useState(false);

  // Form state
  const [storyType, setStoryType] = useState<StoryType | null>(editingStory?.story_type || null);
  const [context, setContext] = useState<StoryContext | null>(editingStory?.context || null);
  const [title, setTitle] = useState(editingStory?.title || '');
  const [organization, setOrganization] = useState(editingStory?.organization || '');
  const [situation, setSituation] = useState(editingStory?.situation || '');
  const [task, setTask] = useState(editingStory?.task || '');
  const [actions, setActions] = useState<string[]>(editingStory?.actions || ['']);
  const [results, setResults] = useState<StoryResult[]>(
    editingStory?.results || [{ metric: '', value: '', description: '' }]
  );
  const [teamSize, setTeamSize] = useState<string>(editingStory?.team_size?.toString() || '');
  const [duration, setDuration] = useState(editingStory?.duration || '');
  const [technologies, setTechnologies] = useState<string>(editingStory?.technologies?.join(', ') || '');
  const [skills, setSkills] = useState<string>(editingStory?.skills_demonstrated?.join(', ') || '');
  const [applicableCategories, setApplicableCategories] = useState<QuestionCategory[]>(
    editingStory?.applicable_categories || []
  );
  const [strengthRating, setStrengthRating] = useState<number>(editingStory?.strength_rating || 3);

  const currentStepIndex = WIZARD_STEPS.findIndex((s) => s.id === currentStep);

  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 'type':
        return storyType !== null;
      case 'context':
        return true; // Context is optional
      case 'star':
        return title.trim() && situation.trim() && task.trim() && actions.some((a) => a.trim());
      case 'details':
        return true; // Details are optional
      case 'categories':
        return applicableCategories.length > 0;
      default:
        return false;
    }
  }, [currentStep, storyType, title, situation, task, actions, applicableCategories]);

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      setCurrentStep(WIZARD_STEPS[nextIndex].id);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(WIZARD_STEPS[prevIndex].id);
    }
  };

  const handleSubmit = async () => {
    if (!storyType || !canProceed()) return;

    setSaving(true);
    try {
      const story: Partial<UserStory> = {
        ...(editingStory?.id && { id: editingStory.id }),
        story_type: storyType,
        context,
        title: title.trim(),
        organization: organization.trim() || null,
        situation: situation.trim(),
        task: task.trim(),
        actions: actions.filter((a) => a.trim()),
        results: results.filter((r) => r.description.trim()),
        team_size: teamSize ? parseInt(teamSize, 10) : null,
        duration: duration.trim() || null,
        technologies: technologies.split(',').map((t) => t.trim()).filter(Boolean),
        skills_demonstrated: skills.split(',').map((s) => s.trim()).filter(Boolean),
        applicable_categories: applicableCategories,
        strength_rating: strengthRating,
      };
      await onSave(story);
      onClose();
    } catch (error) {
      console.error('Error saving story:', error);
    } finally {
      setSaving(false);
    }
  };

  const addAction = () => setActions([...actions, '']);
  const removeAction = (index: number) => setActions(actions.filter((_, i) => i !== index));
  const updateAction = (index: number, value: string) => {
    const newActions = [...actions];
    newActions[index] = value;
    setActions(newActions);
  };

  const addResult = () => setResults([...results, { metric: '', value: '', description: '' }]);
  const removeResult = (index: number) => setResults(results.filter((_, i) => i !== index));
  const updateResult = (index: number, field: keyof StoryResult, value: string) => {
    const newResults = [...results];
    newResults[index] = { ...newResults[index], [field]: value };
    setResults(newResults);
  };

  const toggleCategory = (category: QuestionCategory) => {
    if (applicableCategories.includes(category)) {
      setApplicableCategories(applicableCategories.filter((c) => c !== category));
    } else {
      setApplicableCategories([...applicableCategories, category]);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'type':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select the type of experience that best describes this story.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {STORY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setStoryType(type)}
                  className={cn(
                    'p-4 rounded-lg border-2 text-left transition-all',
                    storyType === type
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                  )}
                >
                  <span className="font-medium text-gray-900 dark:text-white">
                    {STORY_TYPE_LABELS[type]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );

      case 'context':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Where did this experience take place? (Optional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {STORY_CONTEXTS.map((ctx) => (
                <button
                  key={ctx}
                  type="button"
                  onClick={() => setContext(context === ctx ? null : ctx)}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    context === ctx
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                  )}
                >
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {STORY_CONTEXT_LABELS[ctx]}
                  </span>
                </button>
              ))}
            </div>
            <Input
              label="Organization Name (Optional)"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="e.g., Google, Stanford University"
            />
          </div>
        );

      case 'star':
        return (
          <div className="space-y-5">
            <Input
              label="Story Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Led migration to microservices"
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Situation <span className="text-red-500">*</span>
              </label>
              <textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="Describe the context and background..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm text-gray-900 dark:text-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Task <span className="text-red-500">*</span>
              </label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="What was your specific responsibility?"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm text-gray-900 dark:text-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Actions <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                {actions.map((action, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={action}
                      onChange={(e) => updateAction(index, e.target.value)}
                      placeholder={`Action ${index + 1}`}
                      className="flex-1"
                    />
                    {actions.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAction(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addAction}>
                  + Add Action
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Results (with metrics)
              </label>
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div key={index} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={result.metric}
                        onChange={(e) => updateResult(index, 'metric', e.target.value)}
                        placeholder="Metric (e.g., Response time)"
                        className="flex-1"
                      />
                      <Input
                        value={result.value}
                        onChange={(e) => updateResult(index, 'value', e.target.value)}
                        placeholder="Value (e.g., 40%)"
                        className="w-24"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={result.description}
                        onChange={(e) => updateResult(index, 'description', e.target.value)}
                        placeholder="Description (e.g., Reduced API response time by 40%)"
                        className="flex-1"
                      />
                      {results.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeResult(index)}
                          className="text-red-500"
                        >
                          X
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addResult}>
                  + Add Result
                </Button>
              </div>
            </div>
          </div>
        );

      case 'details':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Team Size"
                type="number"
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                placeholder="e.g., 5"
                min="1"
              />
              <Input
                label="Duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g., 3 months"
              />
            </div>

            <Input
              label="Technologies Used"
              value={technologies}
              onChange={(e) => setTechnologies(e.target.value)}
              placeholder="e.g., React, Node.js, PostgreSQL (comma-separated)"
            />

            <Input
              label="Skills Demonstrated"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g., Problem solving, Communication (comma-separated)"
            />
          </div>
        );

      case 'categories':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select the types of interview questions this story can answer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUESTION_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all text-sm',
                    applicableCategories.includes(category)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                  )}
                >
                  {QUESTION_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Story Strength Rating
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => setStrengthRating(rating)}
                    className={cn(
                      'w-10 h-10 rounded-lg border-2 font-medium transition-all',
                      strengthRating >= rating
                        ? 'border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
                        : 'border-gray-200 dark:border-slate-700 text-gray-400'
                    )}
                  >
                    {rating}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Rate how compelling this story is (1 = weak, 5 = very strong)
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingStory ? 'Edit Story' : 'Add New Story'}
      className="max-w-2xl"
    >
      <div className="min-h-[400px] flex flex-col">
        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            {WIZARD_STEPS.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  'flex-1 h-1 rounded-full mx-0.5',
                  index <= currentStepIndex ? 'bg-blue-500' : 'bg-gray-200 dark:bg-slate-700'
                )}
              />
            ))}
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {WIZARD_STEPS[currentStepIndex].title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {WIZARD_STEPS[currentStepIndex].description}
          </p>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto">{renderStep()}</div>

        {/* Navigation */}
        <div className="flex justify-between pt-6 mt-6 border-t border-gray-200 dark:border-slate-700">
          <Button
            type="button"
            variant="ghost"
            onClick={currentStepIndex === 0 ? onClose : handleBack}
          >
            {currentStepIndex === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canProceed() || saving}
            onClick={currentStepIndex === WIZARD_STEPS.length - 1 ? handleSubmit : handleNext}
          >
            {currentStepIndex === WIZARD_STEPS.length - 1
              ? saving
                ? 'Saving...'
                : 'Save Story'
              : 'Next'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
