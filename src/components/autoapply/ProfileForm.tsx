'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { UserProfile, ProfileExperience, ProfileEducation } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn } from '@/lib/utils';
import { useBatchedState } from '@/lib/hooks';
import { mapResumeToProfile } from '@/lib/resumeToProfile';
import type { ResumeData } from '@/lib/resume-templates';

interface ProfileFormProps {
  profile: UserProfile;
  onSave: (profile: UserProfile) => Promise<void>;
  onResumeUpload?: (file: File) => Promise<string>;
}

const WORK_AUTH_OPTIONS = [
  { value: 'us_citizen', label: 'US Citizen' },
  { value: 'permanent_resident', label: 'Permanent Resident' },
  { value: 'visa_holder', label: 'Visa Holder (H1B, L1, etc.)' },
  { value: 'student_visa', label: 'Student Visa (F1, OPT, CPT)' },
  { value: 'other', label: 'Other' },
];

const EXPERIENCE_OPTIONS = [
  { value: '0', label: '0 years (New Grad)' },
  { value: '1', label: '1 year' },
  { value: '2', label: '2 years' },
  { value: '3-5', label: '3-5 years' },
  { value: '5+', label: '5+ years' },
];

// Debounce delay for text inputs (ms)
const INPUT_DEBOUNCE_MS = 150;

// Memoized input component for performance
const DebouncedInput = memo(function DebouncedInput({
  field,
  value,
  onChange,
  ...inputProps
}: {
  field: keyof UserProfile;
  value: string;
  onChange: (field: keyof UserProfile, value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local value with prop when it changes externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Debounce the actual state update
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        onChange(field, newValue);
      }, INPUT_DEBOUNCE_MS);
    },
    [field, onChange]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return <Input {...inputProps} value={localValue} onChange={handleChange} />;
});

export function ProfileForm({ profile, onSave, onResumeUpload }: ProfileFormProps) {
  // Use batched state for form data to reduce re-renders
  const [formData, batchFormUpdate, flushFormUpdates] = useBatchedState<UserProfile>(profile, 50);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Result of auto-filling from a resume: which fields we filled (to review) and
  // which important ones a resume can't provide (to prompt the user for).
  const [autofill, setAutofill] = useState<{ filled: { field: string; label: string }[]; updated: { field: string; label: string }[]; missing: { field: string; label: string }[] } | null>(null);
  // On-demand "does this sound like me?" preview of the captured writing voice.
  // One LLM call, only when the user clicks, so there's no token-burning chatbot.
  const [voicePreview, setVoicePreview] = useState<{ loading: boolean; answer?: string; error?: string } | null>(null);
  const runVoicePreview = useCallback(async (sample: string, notes: string) => {
    setVoicePreview({ loading: true });
    try {
      const res = await fetch('/api/auto-apply/voice-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writing_sample: sample, voice_notes: notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setVoicePreview({ loading: false, error: data?.error || 'Preview failed. Try again.' });
      else setVoicePreview({ loading: false, answer: data?.answer || '' });
    } catch {
      setVoicePreview({ loading: false, error: 'Preview failed. Try again.' });
    }
  }, []);

  // Stable callback for field changes (memoized to prevent child re-renders)
  const handleChange = useCallback((field: keyof UserProfile, value: UserProfile[keyof UserProfile]) => {
    batchFormUpdate({ [field]: value } as Partial<UserProfile>);
  }, [batchFormUpdate]);

  const customFact = (key: string) => formData.custom_answers?.['__fact:' + key] || '';
  const handleFactChange = (key: string, value: string) => {
    handleChange('custom_answers', {
      ...(formData.custom_answers || {}),
      ['__fact:' + key]: value,
    });
  };
  // Structured work history / education (full detail for ATS "re-enter each job"
  // sections). Edited as arrays on the profile; bullets use one-per-line textareas.
  const experiences: ProfileExperience[] = formData.work_experience || [];
  const educations: ProfileEducation[] = formData.education_history || [];
  const updateExp = (i: number, patch: Partial<ProfileExperience>) =>
    handleChange('work_experience', experiences.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const addExp = () =>
    handleChange('work_experience', [...experiences, { company: '', title: '', location: '', start_date: '', end_date: '', current: false, bullets: [] }]);
  const removeExp = (i: number) =>
    handleChange('work_experience', experiences.filter((_, idx) => idx !== i));
  const updateEdu = (i: number, patch: Partial<ProfileEducation>) =>
    handleChange('education_history', educations.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const addEdu = () =>
    handleChange('education_history', [...educations, { school: '', degree: '', major: '', location: '', start_date: '', end_date: '', gpa: '' }]);
  const removeEdu = (i: number) =>
    handleChange('education_history', educations.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Flush any pending batched updates before saving
    const latestFormData = flushFormUpdates();

    setSaving(true);
    setMessage(null);

    try {
      await onSave(latestFormData);
      setMessage({ type: 'success', text: 'Profile saved successfully!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onResumeUpload) return;

    setUploading(true);
    setAutofill(null);
    try {
      const url = await onResumeUpload(file);
      // Batch update resume fields
      batchFormUpdate({
        resume_url: url,
        resume_filename: file.name,
      });
      const latestFormData = flushFormUpdates();

      // Auto-save the profile with new resume (the file link should persist)
      const updatedProfile = {
        ...latestFormData,
        resume_url: url,
        resume_filename: file.name,
      };
      await onSave(updatedProfile);
      setMessage({ type: 'success', text: 'Resume uploaded and saved!' });

      // Now extract the resume's contents and PRE-FILL the empty profile fields
      // for the user to review (we don't auto-save these — they confirm & Save).
      setParsing(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/parse-resume', { method: 'POST', body: fd });
        if (res.ok) {
          const resume = (await res.json()) as ResumeData;
          const { updates, filled, updated, missing } = mapResumeToProfile(resume, updatedProfile);
          if (filled.length > 0 || updated.length > 0) {
            batchFormUpdate(updates);
            flushFormUpdates();
          }
          setAutofill({ filled, updated, missing });
          const changed = filled.length + updated.length;
          setMessage(
            changed > 0
              ? { type: 'success', text: `Filled ${filled.length}${updated.length > 0 ? `, updated ${updated.length}` : ''} field${changed === 1 ? '' : 's'} from your resume — review below and click Save.` }
              : { type: 'success', text: 'Resume uploaded. Nothing new to change — add any remaining details below.' },
          );
        }
      } catch (parseErr) {
        // Extraction is best-effort; the upload already succeeded.
        console.error('Resume parse error:', parseErr);
      } finally {
        setParsing(false);
      }
    } catch (err) {
      console.error('Resume upload error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to upload resume';
      setMessage({ type: 'error', text: `Upload failed: ${errorMsg}` });
    } finally {
      setUploading(false);
    }
  };

  // The important fields the résumé/AI couldn't fill — surfaced in red up top so
  // the user knows exactly what still needs them. Each carries a scroll anchor to
  // the field below. Recomputes live as they type, so the list shrinks to zero.
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v ? String(v) : '');
  const incomplete: { label: string; anchor: string }[] = [];
  const need = (cond: boolean, label: string, anchor: string) => { if (cond) incomplete.push({ label, anchor }); };
  need(!str(formData.first_name), 'First name', 'need-personal');
  need(!str(formData.last_name), 'Last name', 'need-personal');
  need(!str(formData.email), 'Email', 'need-personal');
  need(!str(formData.phone), 'Phone', 'need-personal');
  need(!str(formData.location) && !(str(formData.city) && str(formData.state)), 'Location', 'need-personal');
  need(!str(formData.linkedin_url) && !str(formData.github_url), 'LinkedIn or GitHub', 'need-links');
  need(!str(formData.work_authorization), 'Work authorization', 'need-workauth');
  need(!str(formData.years_experience), 'Years of experience', 'need-years');
  need(!(formData.work_experience?.length), 'Work experience', 'need-work-experience');
  need(!(formData.education_history?.length), 'Education', 'need-education');
  need(!str(formData.writing_sample), 'Writing sample (big quality boost)', 'need-writing-sample');
  const needsAnchor = (a: string) => incomplete.some((i) => i.anchor === a);
  // Red outline + scroll offset for a flagged container (empty) vs a normal one.
  const flag = (a: string, base = '') => `${base} scroll-mt-24 ${needsAnchor(a) ? 'rounded-lg ring-2 ring-red-300 ring-offset-2 dark:ring-red-700' : ''}`.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
      {incomplete.length > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            {incomplete.length} {incomplete.length === 1 ? 'thing needs' : 'things need'} your input — the résumé couldn&apos;t fill {incomplete.length === 1 ? 'it' : 'these'}. Tap one to jump to it.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {incomplete.map((f) => (
              <li key={f.label}>
                <button type="button"
                  onClick={() => document.getElementById(f.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-800/40 text-red-800 dark:text-red-200 text-xs font-medium px-2.5 py-1 hover:bg-red-200 dark:hover:bg-red-800/70 cursor-pointer">
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">Fill these in below, then click Save. Everything else was filled or defaulted for you — review and adjust anything.</p>
        </div>
      )}
      {/* Personal Information */}
      <section id="need-personal" className={flag('need-personal')}>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DebouncedInput
            field="first_name"
            label="First Name"
            value={formData.first_name || ''}
            onChange={handleChange}
            placeholder="John"
          />
          <DebouncedInput
            field="last_name"
            label="Last Name"
            value={formData.last_name || ''}
            onChange={handleChange}
            placeholder="Doe"
          />
          <DebouncedInput
            field="email"
            label="Email"
            type="email"
            value={formData.email || ''}
            onChange={handleChange}
            placeholder="john@example.com"
          />
          <DebouncedInput
            field="phone"
            label="Phone"
            type="tel"
            value={formData.phone || ''}
            onChange={handleChange}
            placeholder="+1 (555) 123-4567"
          />
          <DebouncedInput
            field="location"
            label="Location"
            value={formData.location || ''}
            onChange={handleChange}
            placeholder="San Francisco, CA"
            className="md:col-span-2"
          />
        </div>
      </section>

      {/* Application identity and address */}
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-1">Application Identity</h2>
        <p className="text-sm text-gray-500 mb-4">Used only when an application asks for these details.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DebouncedInput field="preferred_name" label="Preferred Name" value={formData.preferred_name || ''} onChange={handleChange} />
          <DebouncedInput field="pronouns" label="Pronouns" value={formData.pronouns || ''} onChange={handleChange} placeholder="e.g., she/her" />
          <DebouncedInput field="address_line1" label="Street Address" value={formData.address_line1 || ''} onChange={handleChange} className="md:col-span-2" />
          <DebouncedInput field="address_line2" label="Apartment / Suite" value={formData.address_line2 || ''} onChange={handleChange} className="md:col-span-2" />
          <DebouncedInput field="city" label="City" value={formData.city || ''} onChange={handleChange} />
          <DebouncedInput field="state" label="State / Province" value={formData.state || ''} onChange={handleChange} />
          <DebouncedInput field="zip_code" label="ZIP / Postal Code" value={formData.zip_code || ''} onChange={handleChange} />
          <DebouncedInput field="country" label="Country" value={formData.country || ''} onChange={handleChange} />
        </div>
      </section>

      {/* Employment and education */}
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-1">Background</h2>
        <p className="text-sm text-gray-500 mb-4">This lets the agent answer employment and education questions without guessing.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DebouncedInput field="current_company" label="Current Company" value={formData.current_company || ''} onChange={handleChange} />
          <DebouncedInput field="current_title" label="Current Title" value={formData.current_title || ''} onChange={handleChange} />
          <Input
            label="Prior Employers"
            value={(formData.prior_employers || []).join(', ')}
            onChange={(e) => handleChange('prior_employers', e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="Company A, Company B"
            className="md:col-span-2"
          />
          <DebouncedInput field="education_school" label="School" value={formData.education_school || ''} onChange={handleChange} />
          <DebouncedInput field="education_degree" label="Degree" value={formData.education_degree || ''} onChange={handleChange} placeholder="B.S." />
          <DebouncedInput field="education_major" label="Major" value={formData.education_major || ''} onChange={handleChange} />
          <DebouncedInput field="education_graduation_date" label="Graduation Date" type="date" value={formData.education_graduation_date || ''} onChange={handleChange} />
          <DebouncedInput field="education_gpa" label="GPA (optional)" value={formData.education_gpa || ''} onChange={handleChange} />
        </div>
      </section>

      {/* Work Experience — full detail for ATS sections that ask you to re-enter each job */}
      <section id="need-work-experience" className={flag('need-work-experience')}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-medium text-gray-900">Work Experience</h2>
          <button type="button" onClick={addExp} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add role</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Your full history, so auto-apply can fill the detailed experience sections some applications require. Auto-filled from your résumé; edit anything.</p>
        <div className="space-y-4">
          {experiences.length === 0 && (
            <p className="text-sm text-gray-400">No roles yet. Upload a résumé to auto-fill, or add one.</p>
          )}
          {experiences.map((exp, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input placeholder="Company" value={exp.company || ''} onChange={(e) => updateExp(i, { company: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <input placeholder="Title" value={exp.title || ''} onChange={(e) => updateExp(i, { title: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <input placeholder="Location" value={exp.location || ''} onChange={(e) => updateExp(i, { location: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <div className="flex gap-2">
                  <input placeholder="Start (e.g. Jun 2025)" value={exp.start_date || ''} onChange={(e) => updateExp(i, { start_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                  <input placeholder="End / Present" value={exp.end_date || ''} onChange={(e) => updateExp(i, { end_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
              </div>
              <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                <input type="checkbox" checked={!!exp.current} onChange={(e) => updateExp(i, { current: e.target.checked })} />
                I currently work here
              </label>
              <textarea rows={3} placeholder="What you did — one bullet per line" value={(exp.bullets || []).join('\n')}
                onChange={(e) => updateExp(i, { bullets: e.target.value.split('\n') })}
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button type="button" onClick={() => removeExp(i)} className="mt-2 text-xs text-red-500 hover:text-red-700">Remove role</button>
            </div>
          ))}
        </div>
      </section>

      {/* Education — full detail */}
      <section id="need-education" className={flag('need-education')}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-medium text-gray-900">Education</h2>
          <button type="button" onClick={addEdu} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add school</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Every school/degree, for applications that ask for your full education history.</p>
        <div className="space-y-4">
          {educations.length === 0 && (
            <p className="text-sm text-gray-400">No schools yet. Upload a résumé to auto-fill, or add one.</p>
          )}
          {educations.map((ed, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input placeholder="School" value={ed.school || ''} onChange={(e) => updateEdu(i, { school: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <input placeholder="Degree (e.g. B.S.)" value={ed.degree || ''} onChange={(e) => updateEdu(i, { degree: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <input placeholder="Major / field" value={ed.major || ''} onChange={(e) => updateEdu(i, { major: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <input placeholder="Location" value={ed.location || ''} onChange={(e) => updateEdu(i, { location: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
                <div className="flex gap-2">
                  <input placeholder="Start" value={ed.start_date || ''} onChange={(e) => updateEdu(i, { start_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                  <input placeholder="End / Expected" value={ed.end_date || ''} onChange={(e) => updateEdu(i, { end_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
                <input placeholder="GPA (optional)" value={ed.gpa || ''} onChange={(e) => updateEdu(i, { gpa: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
              <button type="button" onClick={() => removeEdu(i)} className="mt-2 text-xs text-red-500 hover:text-red-700">Remove school</button>
            </div>
          ))}
        </div>
      </section>

      {/* Links */}
      <section id="need-links" className={flag('need-links')}>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DebouncedInput
            field="linkedin_url"
            label="LinkedIn URL"
            type="url"
            value={formData.linkedin_url || ''}
            onChange={handleChange}
            placeholder="https://linkedin.com/in/johndoe"
          />
          <DebouncedInput
            field="github_url"
            label="GitHub URL"
            type="url"
            value={formData.github_url || ''}
            onChange={handleChange}
            placeholder="https://github.com/johndoe"
          />
          <DebouncedInput
            field="portfolio_url"
            label="Portfolio URL"
            type="url"
            value={formData.portfolio_url || ''}
            onChange={handleChange}
            placeholder="https://johndoe.dev"
            className="md:col-span-2"
          />
        </div>
      </section>

      {/* Resume */}
      <section data-tour="ap-resume">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Resume</h2>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            {formData.resume_filename ? (
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm text-gray-700">{formData.resume_filename}</span>
                <button
                  type="button"
                  onClick={() => {
                    // Clear both resume_filename and resume_url to maintain consistency
                    handleChange('resume_filename', null);
                    handleChange('resume_url', null);
                  }}
                  className="ml-auto min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  aria-label="Remove resume"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <label className="flex flex-col sm:flex-row items-center justify-center gap-2 p-6 sm:p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 active:bg-blue-50 transition-colors min-h-[80px]">
                <svg className="w-6 h-6 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm sm:text-sm text-gray-600 dark:text-gray-300 text-center">
                  {uploading ? 'Uploading…' : parsing ? 'Reading your resume…' : 'Tap to upload resume (PDF) — we’ll fill in your profile'}
                </span>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={uploading || parsing}
                />
              </label>
            )}
          </div>
        </div>

        {/* Auto-fill review: what we pulled from the resume + what's still needed */}
        {autofill && (autofill.filled.length > 0 || autofill.updated.length > 0 || autofill.missing.length > 0) && (
          <div className="mt-4 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
            {autofill.filled.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                  Filled {autofill.filled.length} field{autofill.filled.length === 1 ? '' : 's'} from your resume
                </p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
                  {autofill.filled.map((f) => f.label).join(', ')}. Please review them below, then click Save.
                </p>
              </div>
            )}
            {autofill.updated.length > 0 && (
              <div className={autofill.filled.length > 0 ? 'mt-3' : ''}>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Updated {autofill.updated.length} field{autofill.updated.length === 1 ? '' : 's'} from your newer resume
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  {autofill.updated.map((f) => f.label).join(', ')}. Review the changes below before saving.
                </p>
              </div>
            )}
            {autofill.missing.length > 0 && (
              <div className={(autofill.filled.length > 0 || autofill.updated.length > 0) ? 'mt-3' : ''}>
                <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                  Still needed (a resume can&apos;t tell us these)
                </p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
                  {autofill.missing.map((f) => f.label).join(', ')} — fill these in below so auto-apply works everywhere.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Auto-Apply Settings */}
      <section data-tour="ap-autoapply">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Auto-Apply Settings</h2>
        <div className="space-y-4">
          <Checkbox
            label="Enable Auto-Apply"
            checked={formData.auto_apply_enabled}
            onChange={(checked) => handleChange('auto_apply_enabled', checked)}
          />
          <p className="text-sm text-gray-500 ml-6 -mt-2">
            Show auto-apply button on job cards to fill out applications automatically
          </p>

          <div className="mt-4">
            <Checkbox
              label="Auto-Submit Applications"
              checked={formData.auto_submit}
              onChange={(checked) => handleChange('auto_submit', checked)}
            />
            {formData.auto_submit && (
              <div className="ml-6 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-700">
                  <span className="font-medium">Warning:</span> Applications will be submitted automatically without your review.
                  Make sure your profile is complete and accurate.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <Checkbox
              label="Auto-apply to ALL new jobs"
              checked={formData.auto_apply_all_jobs}
              onChange={(checked) => handleChange('auto_apply_all_jobs', checked)}
            />
            <p className="text-sm text-gray-500 ml-6 mt-1">
              Automatically apply to every new job posting, not just from tracked companies
            </p>
            {formData.auto_apply_all_jobs && (
              <div className="ml-6 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">
                  <span className="font-medium">Caution:</span> This will auto-apply to ALL new jobs that match your profile.
                  This can result in many applications. Make sure this is what you want.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Pre-filled Answers */}
      <section data-tour="ap-work-auth">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Pre-filled Answers</h2>
        <p className="text-sm text-gray-500 mb-4">
          These answers will be used to auto-fill common application questions
        </p>

        <div className="space-y-4">
          <div id="need-workauth" className={flag('need-workauth')}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Work Authorization
            </label>
            <select
              value={formData.work_authorization || ''}
              onChange={(e) => {
                const authorization = e.target.value || null;
                handleChange('work_authorization', authorization);
                if (authorization === 'us_citizen' || authorization === 'permanent_resident') {
                  handleChange('require_sponsorship', false);
                } else if (authorization === 'visa_holder' || authorization === 'student_visa') {
                  handleChange('require_sponsorship', true);
                }
              }}
              className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-lg shadow-sm text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select...</option>
              {WORK_AUTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <Checkbox
              label="Do you require visa sponsorship?"
              checked={formData.require_sponsorship ?? false}
              onChange={(checked) => handleChange('require_sponsorship', checked)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default answer source</label>
              <select value={formData.default_source || 'Company careers page'}
                onChange={(e) => handleChange('default_source', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option>Company careers page</option><option>LinkedIn</option><option>Referral</option><option>Social media</option><option>Other</option>
              </select>
            </div>
            <DebouncedInput field="referral_name" label="Referrer Name (if any)" value={formData.referral_name || ''} onChange={handleChange} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Are you 18 or older?</label>
              <select value={formData.is_adult == null ? '' : String(formData.is_adult)}
                onChange={(e) => handleChange('is_adult', e.target.value === '' ? null : e.target.value === 'true')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Not answered</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Do you live in the SF Bay Area?</label>
              <select value={formData.bay_area_resident == null ? '' : String(formData.bay_area_resident)}
                onChange={(e) => handleChange('bay_area_resident', e.target.value === '' ? null : e.target.value === 'true')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Infer from address</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </div>
          </div>

          <div id="need-years" className={flag('need-years')}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Years of Experience
            </label>
            <select
              value={formData.years_experience || ''}
              onChange={(e) => handleChange('years_experience', e.target.value || null)}
              className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-lg shadow-sm text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select...</option>
              {EXPERIENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <DebouncedInput
            field="start_date"
            label="Earliest Start Date"
            type="date"
            value={formData.start_date || ''}
            onChange={handleChange}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Salary strategy</label>
            <select value={formData.salary_type || 'market_rate'}
              onChange={(e) => handleChange('salary_type', e.target.value as UserProfile['salary_type'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="market_rate">Use job and company market data (recommended)</option>
              <option value="range">Use my range</option><option value="specific">Use my target</option>
              <option value="negotiable">Say negotiable</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Posted salary ranges are used first, then company market data, then your fallback.</p>
          </div>
          {formData.salary_type === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Minimum salary" type="number" value={formData.salary_min ?? ''}
                onChange={(e) => handleChange('salary_min', e.target.value ? Number(e.target.value) : null)} />
              <Input label="Maximum salary" type="number" value={formData.salary_max ?? ''}
                onChange={(e) => handleChange('salary_max', e.target.value ? Number(e.target.value) : null)} />
            </div>
          )}
          {formData.salary_type === 'specific' && (
            <Input label="Target salary" type="number" value={formData.salary_target ?? ''}
              onChange={(e) => handleChange('salary_target', e.target.value ? Number(e.target.value) : null)} />
          )}

          <Checkbox
            label="Willing to Relocate"
            checked={formData.willing_to_relocate ?? false}
            onChange={(checked) => handleChange('willing_to_relocate', checked)}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-1">Reusable Application Facts</h2>
        <p className="text-sm text-gray-500 mb-4">
          These answers are reused only when you provide them. HireRadar will not infer sensitive facts.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ['government_current', 'Current government employee?', ['Yes', 'No']],
            ['government_past_10_years', 'Government employee in the past 10 years?', ['Yes', 'No']],
            ['reserve_or_guard', 'Serving in the Reserves or National Guard?', ['Yes', 'No']],
            ['military_service', 'Current or former military service?', ['Yes', 'No']],
            ['foreign_government_service', 'Worked for a foreign government or military?', ['Yes', 'No']],
            ['onsite_five_days', 'Available onsite five days per week?', ['Yes', 'No']],
            ['remote_work', 'Comfortable working remotely?', ['Yes', 'No']],
            ['travel', 'Willing to travel for work?', ['Yes', 'No']],
            ['sms_consent', 'Allow recruiting text messages?', ['Yes', 'No']],
            ['whatsapp_consent', 'Allow recruiting messages on WhatsApp?', ['Yes', 'No']],
            ['interview_recording_consent', 'Allow interview recording?', ['Yes', 'No']],
            ['marketing_communications', 'Receive optional recruiting or training marketing?', ['Yes', 'No']],
            ['privacy_acknowledgement', 'Acknowledge applicant privacy notices?', ['Yes', 'No']],
            ['demographic_data_consent', 'Consent to processing voluntary demographic responses?', ['Yes', 'No']],
            ['arbitration_acknowledgement', 'Accept application arbitration agreements?', ['Yes', 'No']],
            ['truthfulness_certification', 'Certify submitted application information is truthful?', ['Yes', 'No']],
            ['ai_notetaker_consent', 'Allow AI notetakers to transcribe interviews?', ['Yes', 'No']],
            ['interview_assistance_policy_acknowledgement', 'Acknowledge employer interview-assistance policies?', ['Yes', 'No']],
            ['ai_use_policy_acknowledgement', 'Acknowledge employer responsible-AI-use policies?', ['Yes', 'No']],
            ['english_level', 'English proficiency', ['A1 (Beginner)', 'A2 (Pre-Intermediate)', 'B1 (Intermediate)', 'B2 (Upper-Intermediate)', 'C1 (Advanced)', 'C2 (Native)']],
            ['citizenship_status', 'Citizenship / residency status', ['U.S. citizen', 'Lawful U.S. permanent resident', 'Other']],
            ['gender_preference', 'Default gender response', ['Decline to self-identify', 'Female', 'Male', 'Non-binary']],
            ['gender_identity_preference', 'Default gender identity response', ['Decline to self-identify', 'Woman', 'Man', 'Non-binary', 'Other']],
            ['ethnicity_preference', 'Default Hispanic/Latino response', ['Decline to self-identify', 'Hispanic or Latino', 'Not Hispanic or Latino']],
            ['race_preference', 'Default race response', ['Decline to self-identify', 'American Indian or Alaska Native', 'Asian', 'Black or African American', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or more races']],
            ['sexual_orientation_preference', 'Default sexual orientation response', ['Decline to self-identify', 'Straight / Heterosexual', 'Gay / Lesbian', 'Bisexual', 'Other']],
            ['veteran_preference', 'Default veteran response', ['Decline to self-identify', 'Protected veteran', 'Not a protected veteran']],
            ['disability_preference', 'Default disability response', ['Decline to self-identify', 'Yes', 'No']],
          ].map(([key, label, options]) => (
            <div key={key as string}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label as string}</label>
              <select
                value={customFact(key as string)}
                onChange={(e) => handleFactChange(key as string, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Ask me when needed</option>
                {(options as string[]).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          ))}
          <Input
            label="Earliest available start date"
            value={customFact('available_start_date')}
            onChange={(e) => handleFactChange('available_start_date', e.target.value)}
            placeholder="Immediately, two weeks after offer, or 2027-06-01"
          />
          <Input
            label="High school name"
            value={customFact('high_school_name')}
            onChange={(e) => handleFactChange('high_school_name', e.target.value)}
            placeholder="Your high school"
          />
          <Input
            label="High school graduation year"
            value={customFact('high_school_graduation_year')}
            onChange={(e) => handleFactChange('high_school_graduation_year', e.target.value)}
            placeholder="2022"
          />
          <Input
            label="Typical summer location"
            value={customFact('summer_location')}
            onChange={(e) => handleFactChange('summer_location', e.target.value)}
            placeholder="San Francisco, CA"
          />
          <Input
            label="Other languages and proficiency"
            value={customFact('other_languages')}
            onChange={(e) => handleFactChange('other_languages', e.target.value)}
            placeholder="e.g., Amharic — native; Spanish — B1, or None"
          />
          <Input
            label="Preferred coding language"
            value={customFact('coding_language')}
            onChange={(e) => handleFactChange('coding_language', e.target.value)}
            placeholder="Python 3"
          />
          <Input
            label="Security clearance"
            value={customFact('security_clearance')}
            onChange={(e) => handleFactChange('security_clearance', e.target.value)}
            placeholder="Leave blank if none or unknown"
          />
          <Input label="Maximum travel percentage" value={customFact('travel_percentage')}
            onChange={(e) => handleFactChange('travel_percentage', e.target.value)} placeholder="e.g., 25%" />
          <Input label="Relocation locations" value={customFact('relocation_locations')}
            onChange={(e) => handleFactChange('relocation_locations', e.target.value)} placeholder="e.g., New York, Seattle, anywhere in the U.S." />
          <Input label="Current or most recent job title" value={customFact('recent_job_title')}
            onChange={(e) => handleFactChange('recent_job_title', e.target.value)} placeholder="Software Engineer Intern" />
          <Input label="Number of internships or co-ops" value={customFact('internship_count')}
            onChange={(e) => handleFactChange('internship_count', e.target.value)} placeholder="e.g., 2" />
          <Input label="Prior interview history" value={customFact('prior_interviews')}
            onChange={(e) => handleFactChange('prior_interviews', e.target.value)} placeholder="e.g., Stripe: 2025; Anthropic: never" />
          <Input label="Current offer deadline" value={customFact('offer_deadline')}
            onChange={(e) => handleFactChange('offer_deadline', e.target.value)} placeholder="Date, or None" />
          <Input label="SAT score" value={customFact('sat_score')}
            onChange={(e) => handleFactChange('sat_score', e.target.value)} placeholder="Score, or Not taken" />
          <Input label="ACT score" value={customFact('act_score')}
            onChange={(e) => handleFactChange('act_score', e.target.value)} placeholder="Score, or Not taken" />
          <Input label="GRE score" value={customFact('gre_score')}
            onChange={(e) => handleFactChange('gre_score', e.target.value)} placeholder="Score, or Not taken" />
          <Input label="Export-control / U.S.-person status" value={customFact('export_control_status')}
            onChange={(e) => handleFactChange('export_control_status', e.target.value)} placeholder="Use the exact status you can truthfully certify" />
          <Input label="Government access card (CAC/PIV)" value={customFact('government_access_card')}
            onChange={(e) => handleFactChange('government_access_card', e.target.value)} placeholder="Yes, No, or card type" />
          <Input label="Standard internship availability" value={customFact('internship_availability')}
            onChange={(e) => handleFactChange('internship_availability', e.target.value)} placeholder="e.g., May 18–August 21, 2027" />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-1">AI Writing Context</h2>
        <p className="text-sm text-gray-500 mb-4">Give the agent facts and a sample of your voice so open-ended answers sound like you.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proudest project or accomplishment</label>
            <textarea rows={4} value={formData.proud_project || ''} onChange={(e) => handleChange('proud_project', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="What you built, why it mattered, and the result" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Career goals and roles you want</label>
            <textarea rows={3} value={formData.career_goals || ''} onChange={(e) => handleChange('career_goals', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div id="need-writing-sample" className={flag('need-writing-sample')}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Writing sample <span className="text-indigo-600 font-semibold">(biggest quality boost)</span>
            </label>
            <p className="text-xs text-gray-500 mb-1">
              This is the single most important field for making written answers sound like you and not like AI.
              Paste <span className="font-medium">two or three</span> things you actually wrote in your normal voice, a Slack message, an
              email, a Reddit comment, anything unedited. More real writing locks the voice in; one thin paragraph
              drifts back to generic. The agent copies your rhythm and word choices, not the facts.
            </p>
            <textarea rows={7} value={formData.writing_sample || ''} onChange={(e) => handleChange('writing_sample', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder={"Paste a few real snippets, separated by a blank line. e.g.\n\nhonestly I got into building stuff because I hate doing the same thing twice. my first app renamed my messy download folder. it broke constantly. I kept fixing it anyway.\n\nspent way too long last spring sure a bug was mine when it was the API quietly changing. check the boring explanation first."} />
            {(formData.writing_sample || '').trim().length > 0 && (formData.writing_sample || '').trim().length < 300 && (
              <p className="text-xs text-amber-600 mt-1">Add one or two more snippets, the more real writing here, the more it sounds like you (and the less you&apos;ll need to retry).</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">How you want to come across <span className="text-gray-400 font-normal">(optional, in your own words)</span></label>
            <p className="text-xs text-gray-500 mb-1">
              The most direct way to steer the voice. Say it plainly, this overrides the sample where they differ.
              e.g. &ldquo;keep it casual but a notch more polished than my texts&rdquo;, &ldquo;direct, no fluff&rdquo;, &ldquo;warm and a little self-deprecating&rdquo;.
            </p>
            <input type="text" value={customFact('voice_notes')} onChange={(e) => handleFactChange('voice_notes', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="e.g. friendly and concrete, never salesy" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <button type="button"
                onClick={() => runVoicePreview((formData.writing_sample || '').trim(), customFact('voice_notes').trim())}
                disabled={voicePreview?.loading || ((formData.writing_sample || '').trim().length < 40 && customFact('voice_notes').trim().length < 8)}
                className="text-sm px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {voicePreview?.loading ? 'Writing a sample…' : 'Preview how this sounds'}
              </button>
              <span className="text-xs text-gray-400">One sample answer in your voice. If it&apos;s off, add another snippet or edit the note above, then preview again, don&apos;t just re-click.</span>
            </div>
            {voicePreview?.error && <p className="text-xs text-red-600 mt-2">{voicePreview.error}</p>}
            {voicePreview?.answer && (
              <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Sample answer to &ldquo;Tell us about a project you&apos;re proud of&rdquo; &mdash; does this sound like you?</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{voicePreview.answer}</p>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Preferred tone</label>
            <select value={formData.preferred_tone || 'natural'} onChange={(e) => handleChange('preferred_tone', e.target.value as UserProfile['preferred_tone'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="natural">Natural</option><option value="concise">Concise</option>
              <option value="warm">Warm</option><option value="technical">Technical</option>
            </select>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="pt-4 border-t border-gray-200">
        {message && (
          <div
            className={cn(
              'mb-4 p-3 rounded-lg text-sm',
              message.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            )}
          >
            {message.text}
          </div>
        )}
        <span data-tour="ap-save" className="inline-block w-full sm:w-auto">
          <Button type="submit" variant="primary" disabled={saving} className="w-full sm:w-auto min-h-[48px] sm:min-h-0">
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>
        </span>
      </div>
    </form>
  );
}
