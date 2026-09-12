'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { UserProfile } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn } from '@/lib/utils';
import { useDebouncedCallback, useBatchedState } from '@/lib/hooks';

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
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Stable callback for field changes (memoized to prevent child re-renders)
  const handleChange = useCallback((field: keyof UserProfile, value: string | boolean | null) => {
    batchFormUpdate({ [field]: value } as Partial<UserProfile>);
  }, [batchFormUpdate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Flush any pending batched updates before saving
    flushFormUpdates();

    setSaving(true);
    setMessage(null);

    try {
      await onSave(formData);
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
    try {
      const url = await onResumeUpload(file);
      // Batch update resume fields
      batchFormUpdate({
        resume_url: url,
        resume_filename: file.name,
      });
      flushFormUpdates();

      // Auto-save the profile with new resume
      const updatedProfile = {
        ...formData,
        resume_url: url,
        resume_filename: file.name,
      };
      await onSave(updatedProfile);
      setMessage({ type: 'success', text: 'Resume uploaded and saved!' });
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
                <span className="text-sm sm:text-sm text-gray-600 text-center">
                  {uploading ? 'Uploading...' : 'Tap to upload resume (PDF)'}
                </span>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
            )}
          </div>
        </div>
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
              onChange={(e) => handleChange('work_authorization', e.target.value || null)}
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

          <DebouncedInput
            field="salary_expectation"
            label="Salary Expectation"
            value={formData.salary_expectation || ''}
            onChange={handleChange}
            placeholder="e.g., $120,000 - $150,000"
          />

          <Checkbox
            label="Willing to Relocate"
            checked={formData.willing_to_relocate ?? false}
            onChange={(checked) => handleChange('willing_to_relocate', checked)}
          />
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
