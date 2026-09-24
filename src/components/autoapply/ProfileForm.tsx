'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { UserProfile } from '@/lib/types';
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
  const [autofill, setAutofill] = useState<{ filled: { field: string; label: string }[]; missing: { field: string; label: string }[] } | null>(null);

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
          const { updates, filled, missing } = mapResumeToProfile(resume, updatedProfile);
          if (filled.length > 0) {
            batchFormUpdate(updates);
            flushFormUpdates();
          }
          setAutofill({ filled, missing });
          setMessage(
            filled.length > 0
              ? { type: 'success', text: `Filled ${filled.length} field${filled.length === 1 ? '' : 's'} from your resume — review below and click Save.` }
              : { type: 'success', text: 'Resume uploaded. Add the remaining details below.' },
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
      {/* Personal Information */}
      <section>
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

      {/* Links */}
      <section>
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
      <section>
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
        {autofill && (autofill.filled.length > 0 || autofill.missing.length > 0) && (
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
            {autofill.missing.length > 0 && (
              <div className={autofill.filled.length > 0 ? 'mt-3' : ''}>
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
      <section>
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
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Pre-filled Answers</h2>
        <p className="text-sm text-gray-500 mb-4">
          These answers will be used to auto-fill common application questions
        </p>

        <div className="space-y-4">
          <div>
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

          <div>
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
            ['onsite_five_days', 'Available onsite five days per week?', ['Yes', 'No']],
            ['travel', 'Willing to travel for work?', ['Yes', 'No']],
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
            ['ethnicity_preference', 'Default ethnicity response', ['Decline to self-identify', 'Hispanic or Latino', 'Not Hispanic or Latino']],
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Writing sample</label>
            <textarea rows={5} value={formData.writing_sample || ''} onChange={(e) => handleChange('writing_sample', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Paste a paragraph you wrote naturally. The agent uses its style, not its facts." />
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
        <Button type="submit" variant="primary" disabled={saving} className="w-full sm:w-auto min-h-[48px] sm:min-h-0">
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </form>
  );
}
