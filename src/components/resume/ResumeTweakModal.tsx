'use client';

import { useState, useEffect } from 'react';
import { ResumeData, TweakedResume, ResumeTweak } from '@/lib/resume-templates';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface ResumeTweakModalProps {
  isOpen: boolean;
  onClose: () => void;
  resume: ResumeData;
  jobId: string;
  jobTitle: string;
  companyName: string;
  companyTier: string;
  roleType: string;
  onApply: (resume: ResumeData, resumeVersion: string) => void;
  onAutoApply?: (jobId: string, optimized: boolean) => Promise<void>;
  jobUrl?: string;
}

export function ResumeTweakModal({
  isOpen,
  onClose,
  resume,
  jobId,
  jobTitle,
  companyName,
  companyTier,
  roleType,
  onApply,
  onAutoApply,
  jobUrl,
}: ResumeTweakModalProps) {
  const [loading, setLoading] = useState(true);
  const [compilingPdf, setCompilingPdf] = useState(false);
  const [result, setResult] = useState<TweakedResume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<'original' | 'tweaked'>('tweaked');
  const [originalPdfUrl, setOriginalPdfUrl] = useState<string | null>(null);
  const [tweakedPdfUrl, setTweakedPdfUrl] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(true);

  useEffect(() => {
    if (isOpen && resume) {
      runTweakAndCompile();
    }

    return () => {
      // Cleanup blob URLs
      if (originalPdfUrl) URL.revokeObjectURL(originalPdfUrl);
      if (tweakedPdfUrl) URL.revokeObjectURL(tweakedPdfUrl);
    };
  }, [isOpen]);

  const runTweakAndCompile = async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: AI tweaks the resume
      const tweakResponse = await fetch('/api/tweak-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume,
          job: { title: jobTitle, company: companyName, tier: companyTier, roleType },
          userLevel: 'new_grad',
        }),
      });

      if (!tweakResponse.ok) throw new Error('Failed to generate tweaks');
      const tweakData: TweakedResume = await tweakResponse.json();
      setResult(tweakData);

      // Step 2: Compile both versions to PDF
      setCompilingPdf(true);

      const [originalPdf, tweakedPdf] = await Promise.all([
        compileToPdf(tweakData.original),
        compileToPdf(tweakData.tweaked),
      ]);

      setOriginalPdfUrl(originalPdf);
      setTweakedPdfUrl(tweakedPdf);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
      setCompilingPdf(false);
    }
  };

  const compileToPdf = async (resumeData: ResumeData): Promise<string | null> => {
    try {
      const response = await fetch('/api/compile-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: resumeData }),
      });

      if (!response.ok) return null;

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  };

  const handleApply = () => {
    if (!result) return;

    const chosenResume = selectedVersion === 'tweaked' ? result.tweaked : result.original;
    const versionName = selectedVersion === 'tweaked'
      ? `${companyName}-optimized-${new Date().toISOString().split('T')[0]}`
      : 'original';

    onApply(chosenResume, versionName);
    onClose();
  };

  const downloadPdf = () => {
    const pdfUrl = selectedVersion === 'tweaked' ? tweakedPdfUrl : originalPdfUrl;
    if (!pdfUrl) return;

    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `resume-${companyName.toLowerCase().replace(/\s+/g, '-')}.pdf`;
    a.click();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative min-h-screen flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="relative bg-white rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-6xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50 flex-shrink-0">
            <div className="min-w-0 flex-1 pr-2">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">AI Resume Optimizer</h2>
              <p className="text-xs sm:text-sm text-gray-600 truncate">
                For <span className="font-medium">{jobTitle}</span> at <span className="font-medium">{companyName}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-3 -m-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/50 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-lg font-medium text-gray-900">
                  {compilingPdf ? 'Compiling PDF previews...' : 'AI is optimizing your resume...'}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Analyzing job requirements and tailoring your content
                </p>
              </div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-red-600 mb-4">{error}</p>
                <Button variant="outline" onClick={runTweakAndCompile}>Try Again</Button>
              </div>
            ) : result && (
              <>
                {/* Left side: Changes summary - hidden on mobile, collapsible on desktop */}
                <div className={cn(
                  'border-r border-gray-200 bg-gray-50 transition-all overflow-y-auto overscroll-contain hidden sm:block',
                  showChanges ? 'sm:w-80' : 'w-0'
                )}>
                  {showChanges && (
                    <div className="p-4 space-y-4">
                      {/* Match score */}
                      <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold',
                            result.matchScore >= 80 ? 'bg-green-100 text-green-700' :
                            result.matchScore >= 60 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          )}>
                            {result.matchScore}%
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">Match Score</p>
                            <p className="text-xs text-gray-500">After optimization</p>
                          </div>
                        </div>
                      </div>

                      {/* Keywords added */}
                      {result.keywordsAdded.length > 0 && (
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                          <h4 className="text-sm font-medium text-gray-900 mb-2">Keywords Added</h4>
                          <div className="flex flex-wrap gap-1">
                            {result.keywordsAdded.map(k => (
                              <span key={k} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                                +{k}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Changes list with safety flags */}
                      <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">
                          Changes Made ({result.tweaks.length})
                        </h4>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                          {result.tweaks.map((tweak, i) => (
                            <div
                              key={i}
                              className={cn(
                                'text-xs border-l-2 pl-2 rounded-r',
                                tweak.safetyFlag === 'risky' ? 'border-red-500 bg-red-50' :
                                tweak.safetyFlag === 'review' ? 'border-yellow-500 bg-yellow-50' :
                                'border-green-400'
                              )}
                            >
                              <div className="flex items-center gap-1 mb-1">
                                <span className="font-medium text-gray-700">{tweak.section}</span>
                                {tweak.safetyFlag === 'risky' && (
                                  <span className="px-1 py-0.5 bg-red-100 text-red-700 text-[10px] rounded">
                                    VERIFY
                                  </span>
                                )}
                                {tweak.safetyFlag === 'review' && (
                                  <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] rounded">
                                    REVIEW
                                  </span>
                                )}
                              </div>
                              <p className="text-gray-500 line-through">{tweak.original.slice(0, 50)}...</p>
                              <p className="text-gray-900">{tweak.suggested.slice(0, 50)}...</p>
                              {tweak.safetyNote && (
                                <p className="text-yellow-700 mt-1 italic">{tweak.safetyNote}</p>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Safety warning if any risky tweaks */}
                        {result.tweaks.some(t => t.safetyFlag === 'risky' || t.safetyFlag === 'review') && (
                          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                            <strong>Important:</strong> Review flagged changes carefully.
                            Never include experiences or skills you don't actually have.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right side: PDF preview */}
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Version toggle */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 sm:py-3 bg-white border-b border-gray-200 gap-2 flex-shrink-0">
                    <div className="hidden sm:flex items-center gap-2">
                      <button
                        onClick={() => setShowChanges(!showChanges)}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title={showChanges ? 'Hide changes' : 'Show changes'}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                      </button>
                      <span className="text-sm text-gray-500">Preview:</span>
                    </div>

                    <div className="flex bg-gray-100 rounded-lg p-1 w-full sm:w-auto">
                      <button
                        onClick={() => setSelectedVersion('original')}
                        className={cn(
                          'flex-1 sm:flex-initial px-3 sm:px-4 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-all min-h-[44px] sm:min-h-0',
                          selectedVersion === 'original'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        )}
                      >
                        Original
                      </button>
                      <button
                        onClick={() => setSelectedVersion('tweaked')}
                        className={cn(
                          'flex-1 sm:flex-initial px-3 sm:px-4 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-all min-h-[44px] sm:min-h-0',
                          selectedVersion === 'tweaked'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        )}
                      >
                        <span className="hidden sm:inline">AI Optimized</span>
                        <span className="sm:hidden">Optimized</span>
                        <span className="ml-1 sm:ml-1.5 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                          +{result.matchScore - 50}%
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* PDF viewer */}
                  <div className="flex-1 bg-gray-100 p-2 sm:p-4 overflow-auto overscroll-contain">
                    {(selectedVersion === 'tweaked' ? tweakedPdfUrl : originalPdfUrl) ? (
                      <iframe
                        src={selectedVersion === 'tweaked' ? tweakedPdfUrl! : originalPdfUrl!}
                        className="w-full h-full min-h-[400px] sm:min-h-[600px] bg-white rounded-lg shadow-lg"
                        title="Resume Preview"
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center min-h-[300px]">
                        <div className="text-center px-4">
                          <p className="text-gray-500 mb-4">PDF preview unavailable</p>
                          <ResumePreviewFallback resume={selectedVersion === 'tweaked' ? result.tweaked : result.original} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          {!loading && !error && result && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0 pb-safe">
              <p className="text-xs sm:text-sm text-gray-600 text-center sm:text-left">
                {selectedVersion === 'tweaked' ? (
                  <span className="flex items-center justify-center sm:justify-start gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    Using AI-optimized version
                  </span>
                ) : (
                  <span className="flex items-center justify-center sm:justify-start gap-2">
                    <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                    Using original resume
                  </span>
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <Button variant="outline" onClick={downloadPdf} className="min-h-[48px] sm:min-h-0 justify-center">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PDF
                </Button>
                {onAutoApply ? (
                  <Button
                    variant="primary"
                    onClick={async () => {
                      await onAutoApply(jobId, selectedVersion === 'tweaked');
                      onClose();
                    }}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 min-h-[48px] sm:min-h-0 justify-center"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden sm:inline">Auto-Apply with {selectedVersion === 'tweaked' ? 'Optimized' : 'Original'}</span>
                    <span className="sm:hidden">Auto-Apply</span>
                  </Button>
                ) : (
                  <Button variant="primary" onClick={handleApply} className="min-h-[48px] sm:min-h-0 justify-center">
                    <span className="hidden sm:inline">Apply with {selectedVersion === 'tweaked' ? 'Optimized' : 'Original'} Resume</span>
                    <span className="sm:hidden">Apply Now</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Fallback preview if PDF compilation fails
function ResumePreviewFallback({ resume }: { resume: ResumeData }) {
  return (
    <div className="bg-white border border-gray-300 p-8 shadow-sm max-w-[8.5in] mx-auto text-left">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{resume.name}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {[resume.phone, resume.email].filter(Boolean).join(' | ')}
        </p>
      </div>

      {resume.experience.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-bold text-gray-900 uppercase border-b border-gray-900 pb-1 mb-2">
            Experience
          </h2>
          {resume.experience.map((exp, i) => (
            <div key={i} className="mb-3">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{exp.title}</span>
                <span className="text-gray-600">{exp.date}</span>
              </div>
              <p className="text-sm text-gray-600">{exp.company}</p>
              <ul className="list-disc list-inside text-sm mt-1">
                {exp.bullets.slice(0, 3).map((b, j) => (
                  <li key={j} className="text-gray-700">{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {resume.skills.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 uppercase border-b border-gray-900 pb-1 mb-2">
            Skills
          </h2>
          {resume.skills.map((skill, i) => (
            <p key={i} className="text-sm">
              <span className="font-semibold">{skill.category}:</span> {skill.items.join(', ')}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
