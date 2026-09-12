'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

interface SubmitQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: QuestionSubmission) => Promise<void>;
  companies?: { id: string; name: string }[];
}

export interface QuestionSubmission {
  company: string;
  position?: string;
  question_type: 'technical' | 'behavioral' | 'system_design' | 'oa';
  question_text: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  interview_date?: string;
  source_url?: string;
  tags?: string[];
}

const questionTypes = [
  { value: 'technical', label: 'Technical', description: 'Coding, algorithms, data structures' },
  { value: 'behavioral', label: 'Behavioral', description: 'STAR format, leadership, teamwork' },
  { value: 'system_design', label: 'System Design', description: 'Architecture, scalability' },
  { value: 'oa', label: 'Online Assessment', description: 'Take-home, timed coding tests' },
] as const;

const difficultyLevels = [
  { value: 'easy', label: 'Easy', color: 'bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-400' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400' },
  { value: 'hard', label: 'Hard', color: 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-400' },
] as const;

export function SubmitQuestionModal({
  isOpen,
  onClose,
  onSubmit,
  companies = [],
}: SubmitQuestionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [company, setCompany] = useState('');
  const [customCompany, setCustomCompany] = useState('');
  const [position, setPosition] = useState('');
  const [questionType, setQuestionType] = useState<QuestionSubmission['question_type']>('technical');
  const [questionText, setQuestionText] = useState('');
  const [difficulty, setDifficulty] = useState<QuestionSubmission['difficulty']>();
  const [interviewDate, setInterviewDate] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const resetForm = () => {
    setCompany('');
    setCustomCompany('');
    setPosition('');
    setQuestionType('technical');
    setQuestionText('');
    setDifficulty(undefined);
    setInterviewDate('');
    setSourceUrl('');
    setTagsInput('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalCompany = company === 'other' ? customCompany.trim() : company;

    if (!finalCompany) {
      setError('Please select or enter a company');
      return;
    }

    if (!questionText.trim()) {
      setError('Please enter the interview question');
      return;
    }

    if (questionText.trim().length < 10) {
      setError('Question must be at least 10 characters');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const submission: QuestionSubmission = {
      company: finalCompany,
      position: position.trim() || undefined,
      question_type: questionType,
      question_text: questionText.trim(),
      difficulty: difficulty,
      interview_date: interviewDate || undefined,
      source_url: sourceUrl.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    };

    setIsSubmitting(true);

    try {
      await onSubmit(submission);
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit question');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Submit Interview Question" className="max-w-lg">
      {success ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Question Submitted!
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Thanks for contributing to the community.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Company */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Company *
            </label>
            <select
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select a company</option>
              {companies.map(c => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="other">Other (enter manually)</option>
            </select>
            {company === 'other' && (
              <Input
                value={customCompany}
                onChange={e => setCustomCompany(e.target.value)}
                placeholder="Enter company name"
                className="mt-2"
                required
              />
            )}
          </div>

          {/* Position */}
          <Input
            label="Position / Role"
            value={position}
            onChange={e => setPosition(e.target.value)}
            placeholder="e.g., Software Engineer, ML Engineer"
          />

          {/* Question Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Question Type *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {questionTypes.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setQuestionType(type.value)}
                  className={cn(
                    'p-3 text-left rounded-lg border-2 transition-colors',
                    questionType === type.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500'
                  )}
                >
                  <div className="font-medium text-gray-900 dark:text-white text-sm">
                    {type.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Question Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Interview Question *
            </label>
            <textarea
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
              placeholder="Describe the interview question in detail..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              required
            />
          </div>

          {/* Difficulty */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Difficulty (optional)
            </label>
            <div className="flex gap-2">
              {difficultyLevels.map(level => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setDifficulty(difficulty === level.value ? undefined : level.value)}
                  className={cn(
                    'px-4 py-1.5 rounded-full border text-sm font-medium transition-colors',
                    difficulty === level.value ? level.color : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                  )}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interview Date */}
          <Input
            label="Interview Date (optional)"
            type="date"
            value={interviewDate}
            onChange={e => setInterviewDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
          />

          {/* Tags */}
          <Input
            label="Tags (optional)"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder="e.g., arrays, dynamic programming, SQL (comma separated)"
          />

          {/* Source URL */}
          <Input
            label="Source URL (optional)"
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="Link to Glassdoor, Blind, LeetCode, etc."
          />

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Submitting...' : 'Submit Question'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
