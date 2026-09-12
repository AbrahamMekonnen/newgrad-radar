'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

// =============================================================================
// TYPES
// =============================================================================

export type StoryType =
  | 'project'
  | 'teamwork'
  | 'leadership'
  | 'failure'
  | 'conflict'
  | 'challenge'
  | 'achievement'
  | 'initiative'
  | 'learning'
  | 'problem_solving';

export interface Story {
  id?: string;
  user_id?: string;
  title: string;
  story_type: StoryType;
  situation: string;
  task: string;
  action: string;
  result: string;
  technologies: string[];
  skills: string[];
  strength_rating: number;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STORY_TYPES: { value: StoryType; label: string; description: string; icon: string }[] = [
  {
    value: 'project',
    label: 'Technical Project',
    description: 'A significant project you built or contributed to',
    icon: 'code',
  },
  {
    value: 'teamwork',
    label: 'Teamwork',
    description: 'Working effectively with others to achieve a goal',
    icon: 'users',
  },
  {
    value: 'leadership',
    label: 'Leadership',
    description: 'Taking initiative and guiding others',
    icon: 'crown',
  },
  {
    value: 'failure',
    label: 'Failure & Learning',
    description: 'A setback and what you learned from it',
    icon: 'refresh',
  },
  {
    value: 'conflict',
    label: 'Conflict Resolution',
    description: 'Handling disagreements or difficult situations',
    icon: 'handshake',
  },
  {
    value: 'challenge',
    label: 'Challenge Overcome',
    description: 'A difficult obstacle you overcame',
    icon: 'mountain',
  },
  {
    value: 'achievement',
    label: 'Achievement',
    description: 'Something you are proud of accomplishing',
    icon: 'trophy',
  },
  {
    value: 'initiative',
    label: 'Initiative',
    description: 'Going above and beyond or starting something new',
    icon: 'rocket',
  },
  {
    value: 'learning',
    label: 'Rapid Learning',
    description: 'Quickly mastering a new skill or technology',
    icon: 'book',
  },
  {
    value: 'problem_solving',
    label: 'Problem Solving',
    description: 'Analyzing and solving a complex problem',
    icon: 'lightbulb',
  },
];

const COMMON_TECHNOLOGIES = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust',
  'React', 'Vue', 'Angular', 'Next.js', 'Node.js', 'Express',
  'Django', 'Flask', 'FastAPI', 'Spring Boot',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes',
  'Git', 'CI/CD', 'Linux', 'REST API', 'GraphQL',
  'Machine Learning', 'TensorFlow', 'PyTorch',
];

const COMMON_SKILLS = [
  'Communication', 'Problem Solving', 'Critical Thinking', 'Collaboration',
  'Time Management', 'Adaptability', 'Attention to Detail', 'Creativity',
  'Leadership', 'Decision Making', 'Conflict Resolution', 'Mentoring',
  'Project Management', 'Documentation', 'Debugging', 'Code Review',
  'Testing', 'Agile/Scrum', 'Technical Writing', 'Presentation',
];

const WIZARD_STEPS = [
  { id: 'type', title: 'Story Type', description: 'What kind of story is this?' },
  { id: 'situation', title: 'Situation', description: 'Set the scene' },
  { id: 'task', title: 'Task', description: 'What was your responsibility?' },
  { id: 'action', title: 'Action', description: 'What did you do?' },
  { id: 'result', title: 'Result', description: 'What was the outcome?' },
  { id: 'tags', title: 'Tags & Skills', description: 'Add technologies and skills' },
  { id: 'preview', title: 'Preview', description: 'Review your story' },
];

// =============================================================================
// COMPONENT
// =============================================================================

interface StoryBankWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (story: Story) => Promise<void>;
  existingStory?: Story | null;
}

export function StoryBankWizard({
  isOpen,
  onClose,
  onSave,
  existingStory,
}: StoryBankWizardProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Story data
  const [story, setStory] = useState<Story>(() => existingStory || {
    title: '',
    story_type: 'project',
    situation: '',
    task: '',
    action: '',
    result: '',
    technologies: [],
    skills: [],
    strength_rating: 3,
  });

  // Tag input state
  const [techInput, setTechInput] = useState('');
  const [skillInput, setSkillInput] = useState('');

  // Reset wizard when opened with different story
  const resetWizard = useCallback(() => {
    setCurrentStep(0);
    setError(null);
    setStory(existingStory || {
      title: '',
      story_type: 'project',
      situation: '',
      task: '',
      action: '',
      result: '',
      technologies: [],
      skills: [],
      strength_rating: 3,
    });
    setTechInput('');
    setSkillInput('');
  }, [existingStory]);

  // Handle close
  const handleClose = useCallback(() => {
    resetWizard();
    onClose();
  }, [resetWizard, onClose]);

  // Update story field
  const updateStory = useCallback(<K extends keyof Story>(field: K, value: Story[K]) => {
    setStory(prev => ({ ...prev, [field]: value }));
  }, []);

  // Navigation
  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 0: // Type selection
        return !!story.story_type;
      case 1: // Situation
        return story.situation.trim().length >= 20;
      case 2: // Task
        return story.task.trim().length >= 20;
      case 3: // Action
        return story.action.trim().length >= 30;
      case 4: // Result
        return story.result.trim().length >= 20;
      case 5: // Tags
        return true; // Optional step
      case 6: // Preview
        return story.title.trim().length > 0;
      default:
        return false;
    }
  }, [currentStep, story]);

  const goNext = useCallback(() => {
    if (canGoNext && currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  }, [canGoNext, currentStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Tag management
  const addTechnology = useCallback((tech: string) => {
    const trimmed = tech.trim();
    if (trimmed && !story.technologies.includes(trimmed)) {
      updateStory('technologies', [...story.technologies, trimmed]);
    }
    setTechInput('');
  }, [story.technologies, updateStory]);

  const removeTechnology = useCallback((tech: string) => {
    updateStory('technologies', story.technologies.filter(t => t !== tech));
  }, [story.technologies, updateStory]);

  const addSkill = useCallback((skill: string) => {
    const trimmed = skill.trim();
    if (trimmed && !story.skills.includes(trimmed)) {
      updateStory('skills', [...story.skills, trimmed]);
    }
    setSkillInput('');
  }, [story.skills, updateStory]);

  const removeSkill = useCallback((skill: string) => {
    updateStory('skills', story.skills.filter(s => s !== skill));
  }, [story.skills, updateStory]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!story.title.trim()) {
      setError('Please add a title for your story');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(story);
      handleClose();
    } catch (err) {
      console.error('Failed to save story:', err);
      setError('Failed to save story. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [story, onSave, handleClose]);

  // Filtered suggestions
  const filteredTechSuggestions = useMemo(() => {
    if (!techInput) return [];
    const lower = techInput.toLowerCase();
    return COMMON_TECHNOLOGIES
      .filter(t => t.toLowerCase().includes(lower) && !story.technologies.includes(t))
      .slice(0, 5);
  }, [techInput, story.technologies]);

  const filteredSkillSuggestions = useMemo(() => {
    if (!skillInput) return [];
    const lower = skillInput.toLowerCase();
    return COMMON_SKILLS
      .filter(s => s.toLowerCase().includes(lower) && !story.skills.includes(s))
      .slice(0, 5);
  }, [skillInput, story.skills]);

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Story Type Selection
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Choose the type of story you want to add. This helps match your stories to common interview questions.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2">
              {STORY_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => updateStory('story_type', type.value)}
                  className={cn(
                    'p-4 rounded-lg border-2 text-left transition-all hover:shadow-md',
                    story.story_type === type.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <StoryTypeIcon type={type.icon} selected={story.story_type === type.value} />
                    <div>
                      <div className={cn(
                        'font-medium',
                        story.story_type === type.value
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-gray-900 dark:text-white'
                      )}>
                        {type.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {type.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 1: // Situation
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Tips for Situation</h4>
              <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
                <li>Set the context - where, when, and what was happening</li>
                <li>Be specific about the project, team, or class</li>
                <li>Keep it concise - 2-3 sentences is ideal</li>
              </ul>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Describe the situation
              </label>
              <textarea
                value={story.situation}
                onChange={e => updateStory('situation', e.target.value)}
                placeholder="Example: During my final year at university, I was part of a 4-person team building a full-stack web application for a local nonprofit. The organization needed a volunteer management system, and we had 12 weeks to deliver..."
                className="w-full h-40 px-3 py-2 border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.situation.length < 20 ? `${20 - story.situation.length} more characters needed` : 'Good length!'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.situation.length} characters
                </p>
              </div>
            </div>
          </div>
        );

      case 2: // Task
        return (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-green-800 dark:text-green-300 mb-2">Tips for Task</h4>
              <ul className="text-sm text-green-700 dark:text-green-400 space-y-1 list-disc list-inside">
                <li>What was YOUR specific responsibility?</li>
                <li>What were you expected to deliver?</li>
                <li>Focus on your role, not the team&apos;s</li>
              </ul>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                What was your task or responsibility?
              </label>
              <textarea
                value={story.task}
                onChange={e => updateStory('task', e.target.value)}
                placeholder="Example: As the backend developer, my responsibility was to design and implement the REST API, set up the database schema, and integrate with the nonprofit's existing email system for sending volunteer notifications..."
                className="w-full h-40 px-3 py-2 border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.task.length < 20 ? `${20 - story.task.length} more characters needed` : 'Good length!'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.task.length} characters
                </p>
              </div>
            </div>
          </div>
        );

      case 3: // Action
        return (
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-purple-800 dark:text-purple-300 mb-2">Tips for Action</h4>
              <ul className="text-sm text-purple-700 dark:text-purple-400 space-y-1 list-disc list-inside">
                <li>Use &quot;I&quot; statements - this is about YOUR actions</li>
                <li>Be specific about what you did step-by-step</li>
                <li>Include technical details and decisions you made</li>
                <li>This should be the longest part of your story</li>
              </ul>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                What actions did you take?
              </label>
              <textarea
                value={story.action}
                onChange={e => updateStory('action', e.target.value)}
                placeholder="Example: First, I researched different API architectures and proposed using Node.js with Express for our backend due to its JSON-native handling and our team's JavaScript experience. I designed a RESTful API with 15 endpoints and wrote comprehensive documentation. When we hit a performance issue with large volunteer lists, I implemented pagination and database indexing which reduced query times by 80%..."
                className="w-full h-48 px-3 py-2 border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.action.length < 30 ? `${30 - story.action.length} more characters needed` : 'Good length!'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.action.length} characters
                </p>
              </div>
            </div>
          </div>
        );

      case 4: // Result
        return (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-amber-800 dark:text-amber-300 mb-2">Tips for Result</h4>
              <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-1 list-disc list-inside">
                <li>Quantify your impact when possible (%, $, time saved)</li>
                <li>Include what you learned or how you grew</li>
                <li>Mention any recognition or positive feedback received</li>
              </ul>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                What was the result?
              </label>
              <textarea
                value={story.result}
                onChange={e => updateStory('result', e.target.value)}
                placeholder="Example: We delivered the system on time and the nonprofit has been using it for over a year. They've managed 500+ volunteers through the platform. Our professor gave us an A+ and highlighted our project in the department showcase. I learned the importance of early performance testing and gained experience with production deployments..."
                className="w-full h-40 px-3 py-2 border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.result.length < 20 ? `${20 - story.result.length} more characters needed` : 'Good length!'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {story.result.length} characters
                </p>
              </div>
            </div>
          </div>
        );

      case 5: // Tags & Skills
        return (
          <div className="space-y-6">
            {/* Technologies */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Technologies Used
              </label>
              <div className="relative">
                <Input
                  value={techInput}
                  onChange={e => setTechInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTechnology(techInput);
                    }
                  }}
                  placeholder="Type to search or add custom..."
                />
                {filteredTechSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg">
                    {filteredTechSuggestions.map(tech => (
                      <button
                        key={tech}
                        type="button"
                        onClick={() => addTechnology(tech)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-900 dark:text-white first:rounded-t-lg last:rounded-b-lg"
                      >
                        {tech}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {story.technologies.map(tech => (
                  <span
                    key={tech}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                  >
                    {tech}
                    <button
                      type="button"
                      onClick={() => removeTechnology(tech)}
                      className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
                      aria-label={`Remove ${tech}`}
                    >
                      <XIcon />
                    </button>
                  </span>
                ))}
              </div>
              {/* Quick add common technologies */}
              <div className="mt-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Quick add:</p>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_TECHNOLOGIES.slice(0, 12).filter(t => !story.technologies.includes(t)).map(tech => (
                    <button
                      key={tech}
                      type="button"
                      onClick={() => addTechnology(tech)}
                      className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      + {tech}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Skills */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Skills Demonstrated
              </label>
              <div className="relative">
                <Input
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSkill(skillInput);
                    }
                  }}
                  placeholder="Type to search or add custom..."
                />
                {filteredSkillSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg">
                    {filteredSkillSuggestions.map(skill => (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => addSkill(skill)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-900 dark:text-white first:rounded-t-lg last:rounded-b-lg"
                      >
                        {skill}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {story.skills.map(skill => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="hover:bg-green-200 dark:hover:bg-green-800 rounded-full p-0.5"
                      aria-label={`Remove ${skill}`}
                    >
                      <XIcon />
                    </button>
                  </span>
                ))}
              </div>
              {/* Quick add common skills */}
              <div className="mt-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Quick add:</p>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_SKILLS.slice(0, 8).filter(s => !story.skills.includes(s)).map(skill => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => addSkill(skill)}
                      className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      + {skill}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Strength Rating */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Story Strength Rating
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                How confident are you in telling this story? (1 = needs practice, 5 = ready to nail it)
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(rating => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => updateStory('strength_rating', rating)}
                    className={cn(
                      'w-12 h-12 rounded-lg font-medium transition-all',
                      story.strength_rating === rating
                        ? 'bg-blue-600 text-white ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-slate-800'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    )}
                  >
                    {rating}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 6: // Preview
        return (
          <div className="space-y-4">
            {/* Title input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Story Title *
              </label>
              <Input
                value={story.title}
                onChange={e => updateStory('title', e.target.value)}
                placeholder="Give your story a memorable title (e.g., 'Nonprofit Volunteer System')"
                error={story.title.length === 0 ? 'Title is required' : undefined}
              />
            </div>

            {/* Story preview */}
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium',
                  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                )}>
                  {STORY_TYPES.find(t => t.value === story.story_type)?.label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Strength: {story.strength_rating}/5
                </span>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Situation</h4>
                  <p className="text-gray-700 dark:text-gray-300">{story.situation || <span className="italic text-gray-400">(not filled)</span>}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Task</h4>
                  <p className="text-gray-700 dark:text-gray-300">{story.task || <span className="italic text-gray-400">(not filled)</span>}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Action</h4>
                  <p className="text-gray-700 dark:text-gray-300">{story.action || <span className="italic text-gray-400">(not filled)</span>}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Result</h4>
                  <p className="text-gray-700 dark:text-gray-300">{story.result || <span className="italic text-gray-400">(not filled)</span>}</p>
                </div>
              </div>

              {/* Tags */}
              {(story.technologies.length > 0 || story.skills.length > 0) && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-600">
                  {story.technologies.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {story.technologies.map(tech => (
                        <span
                          key={tech}
                          className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                  {story.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {story.skills.map(skill => (
                        <span
                          key={skill}
                          className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sample interview question */}
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
              <h4 className="font-medium text-purple-800 dark:text-purple-300 mb-2">
                This story could answer:
              </h4>
              <ul className="text-sm text-purple-700 dark:text-purple-400 space-y-1">
                {getMatchingQuestions(story.story_type).map((q, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">-</span>
                    <span>&quot;{q}&quot;</span>
                  </li>
                ))}
              </ul>
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
      onClose={handleClose}
      title={existingStory ? 'Edit Story' : 'Add New STAR Story'}
      className="max-w-2xl"
    >
      <div className="space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center gap-1">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <button
                type="button"
                onClick={() => index < currentStep && setCurrentStep(index)}
                disabled={index > currentStep}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                  index === currentStep
                    ? 'bg-blue-600 text-white'
                    : index < currentStep
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 cursor-pointer'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                )}
              >
                {index + 1}
              </button>
              {index < WIZARD_STEPS.length - 1 && (
                <div className={cn(
                  'w-4 sm:w-8 h-0.5 mx-1',
                  index < currentStep ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step title */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {WIZARD_STEPS[currentStep].title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {WIZARD_STEPS[currentStep].description}
          </p>
        </div>

        {/* Step content */}
        <div className="min-h-[300px]">
          {renderStepContent()}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-slate-600">
          <Button
            variant="outline"
            onClick={currentStep === 0 ? handleClose : goBack}
          >
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </Button>
          <div className="flex gap-2">
            {currentStep < WIZARD_STEPS.length - 1 ? (
              <Button
                variant="primary"
                onClick={goNext}
                disabled={!canGoNext}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving || !story.title.trim()}
              >
                {saving ? 'Saving...' : existingStory ? 'Update Story' : 'Save Story'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function StoryTypeIcon({ type, selected }: { type: string; selected: boolean }) {
  const className = cn(
    'w-6 h-6',
    selected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
  );

  switch (type) {
    case 'code':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      );
    case 'users':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    case 'crown':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l3.5 4L12 3l3.5 4L19 3v13a2 2 0 01-2 2H7a2 2 0 01-2-2V3z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case 'handshake':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
        </svg>
      );
    case 'mountain':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21l6-9 4 4 5-7 6 12H3z" />
        </svg>
      );
    case 'trophy':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'rocket':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      );
    case 'book':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );
    case 'lightbulb':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    default:
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getMatchingQuestions(storyType: StoryType): string[] {
  const questions: Record<StoryType, string[]> = {
    project: [
      'Tell me about a technical project you worked on',
      'Describe something you built that you are proud of',
      'Walk me through a project from start to finish',
    ],
    teamwork: [
      'Tell me about a time you worked on a team',
      'Describe a successful collaboration',
      'How do you work with others to achieve goals?',
    ],
    leadership: [
      'Tell me about a time you led a team or project',
      'Describe a situation where you took charge',
      'Have you ever mentored someone?',
    ],
    failure: [
      'Tell me about a time you failed',
      'Describe a mistake you made and what you learned',
      'What is your biggest professional regret?',
    ],
    conflict: [
      'Tell me about a time you disagreed with a coworker',
      'How do you handle conflict?',
      'Describe a difficult working relationship',
    ],
    challenge: [
      'Tell me about a time you overcame a significant challenge',
      'Describe a difficult problem you solved',
      'What is the hardest thing you have accomplished?',
    ],
    achievement: [
      'What is your proudest achievement?',
      'Tell me about a time you exceeded expectations',
      'Describe your greatest success',
    ],
    initiative: [
      'Tell me about a time you went above and beyond',
      'Describe something you started on your own',
      'Have you ever identified and solved a problem no one asked you to?',
    ],
    learning: [
      'Tell me about a time you had to learn something quickly',
      'How do you approach learning new technologies?',
      'Describe a steep learning curve you overcame',
    ],
    problem_solving: [
      'Walk me through how you solve complex problems',
      'Tell me about a time you debugged a difficult issue',
      'Describe your problem-solving process',
    ],
  };

  return questions[storyType] || ['Tell me about yourself'];
}

// =============================================================================
// DATABASE HELPER
// =============================================================================

export async function saveStoryToDatabase(userId: string, story: Story): Promise<Story> {
  const supabase = createClient();

  const storyData = {
    user_id: userId,
    title: story.title,
    story_type: story.story_type,
    situation: story.situation,
    task: story.task,
    action: story.action,
    result: story.result,
    technologies: story.technologies,
    skills: story.skills,
    strength_rating: story.strength_rating,
  };

  if (story.id) {
    // Update existing story
    const { data, error } = await supabase
      .from('user_story_bank')
      .update(storyData)
      .eq('id', story.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } else {
    // Insert new story
    const { data, error } = await supabase
      .from('user_story_bank')
      .insert(storyData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export async function loadUserStories(userId: string): Promise<Story[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('user_story_bank')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function deleteStory(userId: string, storyId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('user_story_bank')
    .delete()
    .eq('id', storyId)
    .eq('user_id', userId);

  if (error) throw error;
}
