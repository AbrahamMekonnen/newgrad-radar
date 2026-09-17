'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ResumeData } from '@/lib/resume-templates';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { cn } from '@/lib/utils';

export default function ResumeBuilderPage() {
  return (
    <AuthGuard>
      {(user) => <ResumeBuilderContent userId={user.id} />}
    </AuthGuard>
  );
}

function ResumeBuilderContent({ userId }: { userId: string }) {
  const [resume, setResume] = useState<ResumeData>({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    github: '',
    portfolio: '',
    location: '',
    education: [],
    experience: [],
    projects: [],
    skills: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeSection, setActiveSection] = useState<'contact' | 'education' | 'experience' | 'projects' | 'skills'>('contact');
  const supabase = createClient();

  const fetchResume = useCallback(async () => {
    setLoading(true);

    // Get user profile for basic info
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_name, last_name, email, phone, linkedin_url, github_url, portfolio_url, location')
      .eq('user_id', userId)
      .single();

    // Get saved resume data
    const { data: savedResume } = await supabase
      .from('user_resumes')
      .select('*')
      .eq('user_id', userId)
      .eq('is_base', true)
      .single();

    // Try resume_data column first (proper JSONB), fall back to skills_listed (legacy)
    const resumeSource = savedResume?.resume_data || savedResume?.skills_listed;
    if (resumeSource) {
      // Parse saved resume
      try {
        const resumeContent = typeof resumeSource === 'string'
          ? JSON.parse(resumeSource)
          : resumeSource;
        setResume(resumeContent);
      } catch {
        // If parsing fails, initialize from profile
        if (profile) {
          setResume(prev => ({
            ...prev,
            name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
            email: profile.email || '',
            phone: profile.phone || '',
            linkedin: profile.linkedin_url || '',
            github: profile.github_url || '',
            portfolio: profile.portfolio_url || '',
            location: profile.location || '',
          }));
        }
      }
    } else if (profile) {
      setResume(prev => ({
        ...prev,
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
        email: profile.email || '',
        phone: profile.phone || '',
        linkedin: profile.linkedin_url || '',
        github: profile.github_url || '',
        portfolio: profile.portfolio_url || '',
        location: profile.location || '',
      }));
    }

    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchResume();
  }, [fetchResume]);

  const handleSave = async () => {
    setMessage(null);

    const missing: string[] = [];
    if (!resume.name.trim()) missing.push('full name');
    if (!resume.email.trim()) {
      missing.push('email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resume.email.trim())) {
      setActiveSection('contact');
      setMessage({ type: 'error', text: 'Enter a valid email address before saving.' });
      return;
    }
    const hasContent = resume.education.length > 0 || resume.experience.length > 0
      || resume.projects.length > 0 || resume.skills.length > 0;
    if (!hasContent) missing.push('at least one education, experience, project, or skills entry');
    if (missing.length > 0) {
      setActiveSection(missing.some((field) => field === 'full name' || field === 'email') ? 'contact' : activeSection);
      setMessage({ type: 'error', text: 'Complete ' + missing.join(' and ') + ' before saving.' });
      return;
    }

    setSaving(true);
    try {
      // Check if base resume already exists. maybeSingle treats a missing row
      // as the expected first-save case instead of an error.
      const { data: existing, error: lookupError } = await supabase
        .from('user_resumes')
        .select('id')
        .eq('user_id', userId)
        .eq('name', 'Base Resume')
        .maybeSingle();

      if (lookupError) throw lookupError;

      const resumeRecord = {
        user_id: userId,
        name: 'Base Resume',
        is_base: true,
        resume_data: resume,  // Use proper JSONB column
        word_count: JSON.stringify(resume).length,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (existing?.id) {
        // Update existing
        ({ error } = await supabase
          .from('user_resumes')
          .update(resumeRecord)
          .eq('id', existing.id));
      } else {
        // Insert new
        ({ error } = await supabase
          .from('user_resumes')
          .insert(resumeRecord));
      }

      if (error) throw error;

      setMessage({ type: 'success', text: 'Resume saved!' });
    } catch (err) {
      const detail = err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : '';
      const text = /relation .*user_resumes.* does not exist|schema cache/i.test(detail)
        ? 'Resume storage is not configured yet. Run the latest Supabase migrations and try again.'
        : /row-level security|permission denied/i.test(detail)
          ? 'Your session cannot save this resume. Sign out, sign back in, and try again.'
          : detail
            ? 'Could not save resume: ' + detail
            : 'Could not save resume. Check your connection and try again.';
      setMessage({ type: 'error', text });
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Education handlers
  const addEducation = () => {
    setResume(prev => ({
      ...prev,
      education: [...prev.education, { school: '', degree: '', location: '', date: '', gpa: '' }],
    }));
  };

  const updateEducation = (index: number, field: string, value: string) => {
    setResume(prev => ({
      ...prev,
      education: prev.education.map((edu, i) =>
        i === index ? { ...edu, [field]: value } : edu
      ),
    }));
  };

  const removeEducation = (index: number) => {
    setResume(prev => ({
      ...prev,
      education: prev.education.filter((_, i) => i !== index),
    }));
  };

  // Experience handlers
  const addExperience = () => {
    setResume(prev => ({
      ...prev,
      experience: [...prev.experience, { company: '', title: '', location: '', date: '', bullets: [''] }],
    }));
  };

  const updateExperience = (index: number, field: string, value: string | string[]) => {
    setResume(prev => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i === index ? { ...exp, [field]: value } : exp
      ),
    }));
  };

  const removeExperience = (index: number) => {
    setResume(prev => ({
      ...prev,
      experience: prev.experience.filter((_, i) => i !== index),
    }));
  };

  // Project handlers
  const addProject = () => {
    setResume(prev => ({
      ...prev,
      projects: [...prev.projects, { name: '', technologies: '', date: '', bullets: [''] }],
    }));
  };

  const updateProject = (index: number, field: string, value: string | string[]) => {
    setResume(prev => ({
      ...prev,
      projects: prev.projects.map((proj, i) =>
        i === index ? { ...proj, [field]: value } : proj
      ),
    }));
  };

  const removeProject = (index: number) => {
    setResume(prev => ({
      ...prev,
      projects: prev.projects.filter((_, i) => i !== index),
    }));
  };

  // Skills handlers
  const addSkillCategory = () => {
    setResume(prev => ({
      ...prev,
      skills: [...prev.skills, { category: '', items: [] }],
    }));
  };

  const updateSkillCategory = (index: number, field: string, value: string | string[]) => {
    setResume(prev => ({
      ...prev,
      skills: prev.skills.map((skill, i) =>
        i === index ? { ...skill, [field]: value } : skill
      ),
    }));
  };

  const removeSkillCategory = (index: number) => {
    setResume(prev => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto px-4 py-6 text-gray-900 dark:text-gray-100">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const sections = [
    { id: 'contact', label: 'Contact' },
    { id: 'education', label: 'Education' },
    { id: 'experience', label: 'Experience' },
    { id: 'projects', label: 'Projects' },
    { id: 'skills', label: 'Skills' },
  ] as const;

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-6 text-gray-900 dark:text-gray-100">
      <div className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 mb-2 inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Resume Builder</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Build your base resume. AI will tweak it for each job application.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {sections.map(section => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              activeSection === section.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700'
            )}
          >
            {section.label}
            {section.id === 'education' && resume.education.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded text-xs">{resume.education.length}</span>
            )}
            {section.id === 'experience' && resume.experience.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded text-xs">{resume.experience.length}</span>
            )}
            {section.id === 'projects' && resume.projects.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded text-xs">{resume.projects.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        {/* Contact Section */}
        {activeSection === 'contact' && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">Contact Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Input
                label="Full Name"
                value={resume.name}
                onChange={e => setResume(prev => ({ ...prev, name: e.target.value }))}
                placeholder="John Doe"
              />
              <Input
                label="Email"
                type="email"
                value={resume.email}
                onChange={e => setResume(prev => ({ ...prev, email: e.target.value }))}
                placeholder="john@example.com"
              />
              <Input
                label="Phone"
                value={resume.phone || ''}
                onChange={e => setResume(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
              <Input
                label="Location"
                value={resume.location || ''}
                onChange={e => setResume(prev => ({ ...prev, location: e.target.value }))}
                placeholder="San Francisco, CA"
              />
              <Input
                label="LinkedIn URL"
                value={resume.linkedin || ''}
                onChange={e => setResume(prev => ({ ...prev, linkedin: e.target.value }))}
                placeholder="https://linkedin.com/in/johndoe"
              />
              <Input
                label="GitHub URL"
                value={resume.github || ''}
                onChange={e => setResume(prev => ({ ...prev, github: e.target.value }))}
                placeholder="https://github.com/johndoe"
              />
              <Input
                label="Portfolio URL"
                value={resume.portfolio || ''}
                onChange={e => setResume(prev => ({ ...prev, portfolio: e.target.value }))}
                placeholder="https://johndoe.com"
              />
            </div>
          </div>
        )}

        {/* Education Section */}
        {activeSection === 'education' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Education</h2>
              <Button variant="outline" size="sm" onClick={addEducation}>+ Add Education</Button>
            </div>

            {resume.education.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">No education added yet. Click &quot;Add Education&quot; to start.</p>
            ) : (
              <div className="space-y-6">
                {resume.education.map((edu, index) => (
                  <div key={index} className="p-4 border border-gray-200 dark:border-slate-700 dark:bg-slate-800/50 rounded-lg space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Education #{index + 1}</span>
                      <button onClick={() => removeEducation(index)} className="text-red-500 hover:text-red-700 text-sm">
                        Remove
                      </button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Input
                        label="School"
                        value={edu.school}
                        onChange={e => updateEducation(index, 'school', e.target.value)}
                        placeholder="Stanford University"
                      />
                      <Input
                        label="Degree"
                        value={edu.degree}
                        onChange={e => updateEducation(index, 'degree', e.target.value)}
                        placeholder="B.S. Computer Science"
                      />
                      <Input
                        label="Location"
                        value={edu.location}
                        onChange={e => updateEducation(index, 'location', e.target.value)}
                        placeholder="Stanford, CA"
                      />
                      <Input
                        label="Date"
                        value={edu.date}
                        onChange={e => updateEducation(index, 'date', e.target.value)}
                        placeholder="Aug 2020 - May 2024"
                      />
                      <Input
                        label="GPA (optional)"
                        value={edu.gpa || ''}
                        onChange={e => updateEducation(index, 'gpa', e.target.value)}
                        placeholder="3.8"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Experience Section */}
        {activeSection === 'experience' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Experience</h2>
              <Button variant="outline" size="sm" onClick={addExperience}>+ Add Experience</Button>
            </div>

            {resume.experience.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">No experience added yet. Click &quot;Add Experience&quot; to start.</p>
            ) : (
              <div className="space-y-6">
                {resume.experience.map((exp, index) => (
                  <div key={index} className="p-4 border border-gray-200 dark:border-slate-700 dark:bg-slate-800/50 rounded-lg space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Experience #{index + 1}</span>
                      <button onClick={() => removeExperience(index)} className="text-red-500 hover:text-red-700 text-sm">
                        Remove
                      </button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Input
                        label="Company"
                        value={exp.company}
                        onChange={e => updateExperience(index, 'company', e.target.value)}
                        placeholder="Google"
                      />
                      <Input
                        label="Title"
                        value={exp.title}
                        onChange={e => updateExperience(index, 'title', e.target.value)}
                        placeholder="Software Engineering Intern"
                      />
                      <Input
                        label="Location"
                        value={exp.location}
                        onChange={e => updateExperience(index, 'location', e.target.value)}
                        placeholder="Mountain View, CA"
                      />
                      <Input
                        label="Date"
                        value={exp.date}
                        onChange={e => updateExperience(index, 'date', e.target.value)}
                        placeholder="Jun 2023 - Aug 2023"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Bullet Points</label>
                      {exp.bullets.map((bullet, bulletIndex) => (
                        <div key={bulletIndex} className="flex gap-2 mb-2">
                          <span className="text-gray-400 mt-2">•</span>
                          <textarea
                            value={bullet}
                            onChange={e => {
                              const newBullets = [...exp.bullets];
                              newBullets[bulletIndex] = e.target.value;
                              updateExperience(index, 'bullets', newBullets);
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm resize-none bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                            rows={2}
                            placeholder="Describe your accomplishment..."
                          />
                          <button
                            onClick={() => {
                              const newBullets = exp.bullets.filter((_, i) => i !== bulletIndex);
                              updateExperience(index, 'bullets', newBullets);
                            }}
                            className="text-red-400 hover:text-red-600"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => updateExperience(index, 'bullets', [...exp.bullets, ''])}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        + Add bullet point
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Projects Section */}
        {activeSection === 'projects' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Projects</h2>
              <Button variant="outline" size="sm" onClick={addProject}>+ Add Project</Button>
            </div>

            {resume.projects.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">No projects added yet. Click &quot;Add Project&quot; to start.</p>
            ) : (
              <div className="space-y-6">
                {resume.projects.map((proj, index) => (
                  <div key={index} className="p-4 border border-gray-200 dark:border-slate-700 dark:bg-slate-800/50 rounded-lg space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Project #{index + 1}</span>
                      <button onClick={() => removeProject(index)} className="text-red-500 hover:text-red-700 text-sm">
                        Remove
                      </button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Input
                        label="Project Name"
                        value={proj.name}
                        onChange={e => updateProject(index, 'name', e.target.value)}
                        placeholder="AI Chat App"
                      />
                      <Input
                        label="Technologies"
                        value={proj.technologies}
                        onChange={e => updateProject(index, 'technologies', e.target.value)}
                        placeholder="React, Python, OpenAI API"
                      />
                      <Input
                        label="Date (optional)"
                        value={proj.date || ''}
                        onChange={e => updateProject(index, 'date', e.target.value)}
                        placeholder="Jan 2024 - Present"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Bullet Points</label>
                      {proj.bullets.map((bullet, bulletIndex) => (
                        <div key={bulletIndex} className="flex gap-2 mb-2">
                          <span className="text-gray-400 mt-2">•</span>
                          <textarea
                            value={bullet}
                            onChange={e => {
                              const newBullets = [...proj.bullets];
                              newBullets[bulletIndex] = e.target.value;
                              updateProject(index, 'bullets', newBullets);
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm resize-none bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                            rows={2}
                            placeholder="Describe what you built..."
                          />
                          <button
                            onClick={() => {
                              const newBullets = proj.bullets.filter((_, i) => i !== bulletIndex);
                              updateProject(index, 'bullets', newBullets);
                            }}
                            className="text-red-400 hover:text-red-600"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => updateProject(index, 'bullets', [...proj.bullets, ''])}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        + Add bullet point
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Skills Section */}
        {activeSection === 'skills' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Technical Skills</h2>
              <Button variant="outline" size="sm" onClick={addSkillCategory}>+ Add Category</Button>
            </div>

            {resume.skills.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400 mb-4">No skills added yet.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {['Languages', 'Frameworks', 'Tools', 'Libraries'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setResume(prev => ({
                        ...prev,
                        skills: [...prev.skills, { category: cat, items: [] }],
                      }))}
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded-lg text-sm hover:bg-blue-100 dark:hover:bg-blue-900/50"
                    >
                      + {cat}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {resume.skills.map((skill, index) => (
                  <div key={index} className="p-4 border border-gray-200 dark:border-slate-700 dark:bg-slate-800/50 rounded-lg space-y-3">
                    <div className="flex justify-between items-start">
                      <Input
                        label="Category"
                        value={skill.category}
                        onChange={e => updateSkillCategory(index, 'category', e.target.value)}
                        placeholder="Languages"
                        className="w-48"
                      />
                      <button onClick={() => removeSkillCategory(index)} className="text-red-500 hover:text-red-700 text-sm mt-6">
                        Remove
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Skills (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={skill.items.join(', ')}
                        onChange={e => updateSkillCategory(index, 'items', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        placeholder="Python, JavaScript, TypeScript, Go"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="mt-6 flex items-center justify-between">
        {message && (
          <span className={cn(
            'text-sm',
            message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          )}>
            {message.text}
          </span>
        )}
        <div className="ml-auto">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Resume'}
          </Button>
        </div>
      </div>
    </div>
  );
}
