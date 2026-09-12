'use client';

import { useState, useEffect } from 'react';
import { ResumeData, SAMPLE_RESUME, generateLatex } from '@/lib/resume-templates';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface TweakResult {
  original: ResumeData;
  tweaked: ResumeData;
  tweaks: Array<{
    section: string;
    original: string;
    suggested: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    safetyFlag?: 'safe' | 'review' | 'risky';
    safetyNote?: string;
  }>;
  matchScore: number;
  keywordsAdded: string[];
  keywordsAlreadyPresent: string[];
}

export default function TweakDemoPage() {
  const [loading, setLoading] = useState(false);
  const [loadingResume, setLoadingResume] = useState(true);
  const [result, setResult] = useState<TweakResult | null>(null);
  const [showLatex, setShowLatex] = useState(false);
  const [selectedJob, setSelectedJob] = useState<'ml' | 'backend' | 'frontend'>('ml');
  const [userResume, setUserResume] = useState<ResumeData | null>(null);
  const supabase = createClient();

  // Fetch user's resume on load
  useEffect(() => {
    const fetchUserResume = async () => {
      setLoadingResume(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingResume(false);
        return;
      }

      // Try to get saved resume from user_resumes table
      const { data: savedResume } = await supabase
        .from('user_resumes')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_base', true)
        .single();

      // Try resume_data column first (proper JSONB), fall back to skills_listed (legacy)
      const resumeSource = savedResume?.resume_data || savedResume?.skills_listed;
      if (resumeSource) {
        try {
          const resumeContent = typeof resumeSource === 'string'
            ? JSON.parse(resumeSource)
            : resumeSource;
          if (resumeContent.experience?.length > 0 || resumeContent.projects?.length > 0) {
            setUserResume(resumeContent);
            setLoadingResume(false);
            return;
          }
        } catch {
          // Fall through
        }
      }

      // Check if user has uploaded a resume PDF
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profile?.resume_url) {
        // Parse the uploaded PDF resume
        try {
          const response = await fetch('/api/parse-resume', {
            method: 'POST',
            body: new URLSearchParams({ url: profile.resume_url }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.resume) {
              // Save parsed resume for future use - check if exists first
              const { data: existing } = await supabase
                .from('user_resumes')
                .select('id')
                .eq('user_id', user.id)
                .eq('name', 'Base Resume')
                .single();

              const resumeRecord = {
                user_id: user.id,
                name: 'Base Resume',
                is_base: true,
                resume_data: data.resume,  // Use proper JSONB column
                updated_at: new Date().toISOString(),
              };

              if (existing?.id) {
                await supabase.from('user_resumes').update(resumeRecord).eq('id', existing.id);
              } else {
                await supabase.from('user_resumes').insert(resumeRecord);
              }

              setUserResume(data.resume);
              setLoadingResume(false);
              return;
            }
          }
        } catch (err) {
          console.error('Error parsing uploaded resume:', err);
        }
      }

      // Fall back to building resume from profile info
      if (profile && profile.first_name) {
        setUserResume({
          name: `${profile.first_name} ${profile.last_name || ''}`.trim(),
          email: profile.email || '',
          phone: profile.phone || '',
          linkedin: profile.linkedin_url || '',
          github: profile.github_url || '',
          portfolio: profile.portfolio_url || '',
          location: profile.location || '',
          education: [],
          experience: [],
          projects: [],
          skills: [],
        });
      }

      setLoadingResume(false);
    };

    fetchUserResume();
  }, [supabase]);

  // Use user's resume if available, otherwise sample
  const activeResume = userResume || SAMPLE_RESUME;

  const jobExamples = {
    ml: {
      title: 'Machine Learning Engineer, New Grad',
      company: 'OpenAI',
      tier: 'ai',
      roleType: 'ml',
      keywords: ['Python', 'PyTorch', 'TensorFlow', 'NLP', 'transformers', 'deep learning', 'LLM'],
    },
    backend: {
      title: 'Backend Engineer, New Grad',
      company: 'Stripe',
      tier: 'unicorn',
      roleType: 'backend',
      keywords: ['Go', 'PostgreSQL', 'Redis', 'microservices', 'API design', 'distributed systems'],
    },
    frontend: {
      title: 'Frontend Engineer, New Grad',
      company: 'Figma',
      tier: 'unicorn',
      roleType: 'frontend',
      keywords: ['React', 'TypeScript', 'CSS', 'accessibility', 'performance', 'design systems'],
    },
  };

  const runTweak = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/tweak-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: activeResume,
          job: jobExamples[selectedJob],
          userLevel: 'new_grad',
        }),
      });

      if (!response.ok) throw new Error('Failed');

      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyLatex = () => {
    if (result) {
      navigator.clipboard.writeText(generateLatex(result.tweaked));
      alert('LaTeX copied! Paste into Overleaf to compile.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Resume Tweaker Demo</h1>
      <p className="text-gray-600 mb-8">
        See how AI tailors your resume for different job types. Output is Jake&apos;s Resume LaTeX format.
      </p>

      {/* Job selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Select a Job to Optimize For:</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {(Object.keys(jobExamples) as Array<'ml' | 'backend' | 'frontend'>).map(key => (
            <button
              key={key}
              onClick={() => setSelectedJob(key)}
              className={cn(
                'p-4 rounded-lg border-2 text-left transition-all',
                selectedJob === key
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <span className={cn(
                'inline-block px-2 py-0.5 rounded text-xs font-medium mb-2',
                key === 'ml' ? 'bg-red-100 text-red-700' :
                key === 'backend' ? 'bg-purple-100 text-purple-700' :
                'bg-cyan-100 text-cyan-700'
              )}>
                {jobExamples[key].tier.toUpperCase()}
              </span>
              <h3 className="font-medium text-gray-900">{jobExamples[key].title}</h3>
              <p className="text-sm text-gray-500">{jobExamples[key].company}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {jobExamples[key].keywords.slice(0, 4).map(k => (
                  <span key={k} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                    {k}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          <Button variant="primary" onClick={runTweak} disabled={loading}>
            {loading ? 'Analyzing & Tweaking...' : 'Run AI Tweak'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Match score and keywords */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-6">
              <div className={cn(
                'w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold',
                result.matchScore >= 80 ? 'bg-green-100 text-green-700' :
                result.matchScore >= 60 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              )}>
                {result.matchScore}%
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Match Score After Tweaks</h3>
                <p className="text-gray-500">Based on keyword coverage and relevance</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-6">
              <div className="p-4 bg-green-50 rounded-lg">
                <h4 className="font-medium text-green-800 mb-2">Already Had ({result.keywordsAlreadyPresent.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {result.keywordsAlreadyPresent.map(k => (
                    <span key={k} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-800 mb-2">Added by AI ({result.keywordsAdded.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {result.keywordsAdded.map(k => (
                    <span key={k} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                      + {k}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tweaks with Safety Flags */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              AI Suggested Changes ({result.tweaks.length})
            </h3>
            <div className="space-y-4">
              {result.tweaks.map((tweak, i) => (
                <div key={i} className={cn(
                  'p-4 rounded-lg border-2',
                  tweak.safetyFlag === 'risky' ? 'border-red-400 bg-red-50' :
                  tweak.safetyFlag === 'review' ? 'border-yellow-400 bg-yellow-50' :
                  'border-green-300 bg-green-50'
                )}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-500 uppercase">{tweak.section}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 text-xs font-medium rounded',
                      tweak.priority === 'high' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    )}>
                      {tweak.priority} priority
                    </span>
                    {tweak.safetyFlag === 'safe' && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-green-200 text-green-800">
                        ✓ SAFE
                      </span>
                    )}
                    {tweak.safetyFlag === 'review' && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-yellow-200 text-yellow-800">
                        👀 REVIEW
                      </span>
                    )}
                    {tweak.safetyFlag === 'risky' && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-red-200 text-red-800">
                        ⚠️ VERIFY
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-gray-500">Before: </span>
                      <span className="line-through text-gray-600">{tweak.original}</span>
                    </p>
                    <p>
                      <span className="text-gray-500">After: </span>
                      <span className="text-gray-900 font-medium">{tweak.suggested}</span>
                    </p>
                  </div>
                  {tweak.safetyNote && (
                    <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs text-yellow-800">
                      ⚠️ {tweak.safetyNote}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-2 italic">{tweak.reason}</p>
                </div>
              ))}
            </div>

            {/* Safety Legend */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs font-medium text-gray-700 mb-2">Safety Legend:</p>
              <div className="flex gap-4 text-xs">
                <span><span className="px-1.5 py-0.5 bg-green-200 text-green-800 rounded font-medium">✓ SAFE</span> = Only rephrasing</span>
                <span><span className="px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded font-medium">👀 REVIEW</span> = Check if accurate</span>
                <span><span className="px-1.5 py-0.5 bg-red-200 text-red-800 rounded font-medium">⚠️ VERIFY</span> = May add new claims</span>
              </div>
            </div>
          </div>

          {/* Visual Resume Preview */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Resume Preview</h3>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setShowLatex(false)}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                    !showLatex ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  )}
                >
                  Original
                </button>
                <button
                  onClick={() => setShowLatex(true)}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                    showLatex ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  )}
                >
                  AI Optimized
                </button>
              </div>
            </div>

            {/* Resume Visual Preview */}
            <div className="bg-gray-100 p-6 rounded-lg overflow-auto max-h-[800px]">
              <ResumePreview resume={showLatex ? result.tweaked : result.original} />
            </div>
          </div>

          {/* LaTeX code (collapsible) */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">LaTeX Code (for Overleaf)</h3>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={copyLatex}>
                  Copy for Overleaf
                </Button>
              </div>
            </div>

            <div className="p-4 bg-blue-50 rounded-lg mb-4">
              <h4 className="font-medium text-blue-800 mb-2">How to use with Overleaf:</h4>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Click &quot;Copy for Overleaf&quot;</li>
                <li>Go to <a href="https://overleaf.com" target="_blank" className="underline">overleaf.com</a> → New Project → Blank Project</li>
                <li>Delete default content, paste your LaTeX</li>
                <li>Click &quot;Recompile&quot; to download PDF</li>
              </ol>
            </div>

            {showLatex && (
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs max-h-96">
                {generateLatex(result.tweaked)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Resume Upload Section */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Your Resume</h3>

        {loadingResume ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : userResume && userResume.experience.length > 0 ? (
          <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
            <div>
              <p className="text-sm font-medium text-green-800">✓ Resume loaded: {userResume.name}</p>
              <p className="text-xs text-green-600 mt-1">
                {userResume.experience.length} experiences, {userResume.projects.length} projects, {userResume.skills.length} skill categories
              </p>
            </div>
            <button
              onClick={() => setUserResume(null)}
              className="text-sm text-green-700 hover:underline"
            >
              Upload Different
            </button>
          </div>
        ) : (
          <ResumeUploader onResumeParsed={(resume) => setUserResume(resume)} />
        )}
      </div>
    </div>
  );
}

// Resume uploader component
function ResumeUploader({ onResumeParsed }: { onResumeParsed: (resume: ResumeData) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [resumeText, setResumeText] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/parse-resume', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse resume');
      }

      onResumeParsed(data.resume);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse resume');
      setShowTextInput(true);
    } finally {
      setUploading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!resumeText.trim()) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('text', resumeText);

      const response = await fetch('/api/parse-resume', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse resume');
      }

      onResumeParsed(data.resume);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse resume');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!showTextInput ? (
        <>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileUpload}
              className="hidden"
              id="resume-upload"
              disabled={uploading}
            />
            <label
              htmlFor="resume-upload"
              className={cn(
                'cursor-pointer',
                uploading && 'opacity-50 cursor-not-allowed'
              )}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-gray-600">Parsing resume with AI...</p>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-gray-900 font-medium">Upload your resume</p>
                  <p className="text-sm text-gray-500 mt-1">PDF, DOC, DOCX, or TXT</p>
                </>
              )}
            </label>
          </div>

          <div className="text-center">
            <button
              onClick={() => setShowTextInput(true)}
              className="text-sm text-blue-600 hover:underline"
            >
              Or paste resume text instead
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste your entire resume text here...&#10;&#10;Include your name, contact info, education, experience, projects, and skills."
            className="w-full h-64 p-4 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={uploading}
          />
          <div className="flex gap-3">
            <button
              onClick={() => setShowTextInput(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              disabled={uploading}
            >
              Back to file upload
            </button>
            <Button
              variant="primary"
              onClick={handleTextSubmit}
              disabled={uploading || !resumeText.trim()}
            >
              {uploading ? 'Parsing...' : 'Parse Resume'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

// Visual resume preview component (looks like a real resume/PDF)
function ResumePreview({ resume }: { resume: ResumeData }) {
  return (
    <div className="bg-white shadow-lg mx-auto" style={{ width: '8.5in', minHeight: '11in', padding: '0.5in' }}>
      {/* Header */}
      <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">{resume.name}</h1>
        <p className="text-sm text-gray-600 mt-2">
          {[
            resume.phone,
            resume.email,
            resume.linkedin ? 'LinkedIn' : null,
            resume.github ? 'GitHub' : null,
            resume.portfolio ? 'Portfolio' : null,
          ].filter(Boolean).join(' | ')}
        </p>
      </div>

      {/* Education */}
      {resume.education.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
            Education
          </h2>
          {resume.education.map((edu, i) => (
            <div key={i} className="flex justify-between mb-2">
              <div>
                <span className="font-semibold text-gray-900">{edu.school}</span>
                <span className="text-gray-600 text-sm ml-2">{edu.location}</span>
                <p className="text-sm text-gray-700 italic">{edu.degree}{edu.gpa ? ` | GPA: ${edu.gpa}` : ''}</p>
              </div>
              <span className="text-sm text-gray-600 whitespace-nowrap">{edu.date}</span>
            </div>
          ))}
        </section>
      )}

      {/* Experience */}
      {resume.experience.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
            Experience
          </h2>
          {resume.experience.map((exp, i) => (
            <div key={i} className="mb-4">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-900">{exp.title}</span>
                <span className="text-sm text-gray-600">{exp.date}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700 italic">{exp.company}</span>
                <span className="text-gray-600">{exp.location}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {exp.bullets.map((bullet, j) => (
                  <li key={j} className="text-sm text-gray-700 flex">
                    <span className="mr-2">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Projects */}
      {resume.projects.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
            Projects
          </h2>
          {resume.projects.map((proj, i) => (
            <div key={i} className="mb-4">
              <div className="flex justify-between">
                <span>
                  <span className="font-semibold text-gray-900">{proj.name}</span>
                  <span className="text-gray-600 text-sm ml-2">| {proj.technologies}</span>
                </span>
                {proj.date && <span className="text-sm text-gray-600">{proj.date}</span>}
              </div>
              <ul className="mt-2 space-y-1">
                {proj.bullets.map((bullet, j) => (
                  <li key={j} className="text-sm text-gray-700 flex">
                    <span className="mr-2">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Skills */}
      {resume.skills.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
            Technical Skills
          </h2>
          <div className="space-y-1">
            {resume.skills.map((skill, i) => (
              <p key={i} className="text-sm">
                <span className="font-semibold text-gray-900">{skill.category}: </span>
                <span className="text-gray-700">{skill.items.join(', ')}</span>
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
