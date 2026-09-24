'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { UserProfile } from '@/lib/types';
import { mapResumeToProfile } from '@/lib/resumeToProfile';
import type { ResumeData } from '@/lib/resume-templates';

/**
 * Front-and-center onboarding: upload a resume once and we fill the whole
 * auto-apply profile automatically. Runs the full pipeline (upload -> parse ->
 * map -> save) and then points the user to review + complete the few fields a
 * resume can't provide.
 */
export function ResumeAutofill({ userId, email }: { userId: string; email: string }) {
  const supabase = createClient();
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'reading' | 'saving'>('idle');
  const [result, setResult] = useState<
    | { ok: true; filled: { field: string; label: string }[]; missing: { field: string; label: string }[]; filename: string }
    | { ok: false; error: string }
    | null
  >(null);

  const defaults = (): UserProfile => ({
    user_id: userId,
    first_name: null, last_name: null, email, phone: null, location: null,
    linkedin_url: null, portfolio_url: null, github_url: null,
    resume_url: null, resume_filename: null,
    auto_apply_enabled: true, auto_submit: false, auto_apply_all_jobs: false,
    work_authorization: null, require_sponsorship: null, years_experience: null,
    start_date: null, salary_expectation: null, salary_type: 'market_rate',
    salary_min: null, salary_max: null, salary_target: null,
    salary_display_strategy: 'show_range', willing_to_relocate: null,
    custom_answers: {},
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setResult(null);

    try {
      // 1) Upload the file to storage.
      setBusy('uploading');
      const ext = file.name.split('.').pop();
      const fileName = `${userId}/resume.${ext}`;
      await supabase.storage.from('resumes').remove([fileName]).catch(() => {});
      const { error: upErr } = await supabase.storage.from('resumes').upload(fileName, file);
      if (upErr) {
        throw new Error(
          upErr.message?.includes('not found') || upErr.message?.includes('does not exist')
            ? 'Storage isn’t set up for resumes yet. You can still build one in the Resume Builder.'
            : upErr.message || 'Upload failed',
        );
      }
      const resumeUrl = supabase.storage.from('resumes').getPublicUrl(fileName).data.publicUrl;

      // 2) Load any existing profile so we never overwrite what the user set.
      const { data: existing } = await supabase
        .from('user_profiles').select('*').eq('user_id', userId).single();
      const base: UserProfile = existing ? (existing as UserProfile) : defaults();

      // 3) Extract (LLM) + map (deterministic).
      setBusy('reading');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/parse-resume', { method: 'POST', body: fd });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        // Surface the real reason (extraction vs. AI-provider failure) instead
        // of a generic message, so problems are diagnosable.
        const reason = (payload && (payload.error as string)) || `parser returned ${res.status}`;
        throw new Error(reason);
      }
      const resume = payload as ResumeData;
      const { updates, filled, missing } = mapResumeToProfile(resume, base);

      // 4) Save the filled profile on the user's behalf.
      setBusy('saving');
      const { error: saveErr } = await supabase.from('user_profiles').upsert({
        ...base,
        ...updates,
        resume_url: resumeUrl,
        resume_filename: file.name,
        email: base.email || email,
        updated_at: new Date().toISOString(),
      });
      if (saveErr) throw new Error(saveErr.message || 'Could not save your profile');

      setResult({ ok: true, filled, missing, filename: file.name });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy('idle');
    }
  };

  const working = busy !== 'idle';
  const busyLabel =
    busy === 'uploading' ? 'Uploading…' : busy === 'reading' ? 'Reading your resume…' : busy === 'saving' ? 'Saving your profile…' : '';

  return (
    <div className="p-6 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-slate-900/40">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Set up in one step</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Upload your resume and we&apos;ll fill out your profile automatically — name, contact,
            links, education and work history. You just review and add a couple of things a resume
            can&apos;t tell us.
          </p>

          {!result && (
            <label className={`mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors ${working ? 'opacity-70 cursor-wait' : 'hover:bg-indigo-700 cursor-pointer'}`}>
              {working ? busyLabel : 'Upload resume & auto-fill'}
              <input type="file" accept=".pdf" onChange={handleFile} disabled={working} className="hidden" />
            </label>
          )}

          {result?.ok && (
            <div className="mt-4 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white/70 dark:bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                ✓ {result.filename} — filled {result.filled.length} field{result.filled.length === 1 ? '' : 's'} and saved.
              </p>
              {result.filled.length > 0 && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {result.filled.map((f) => f.label).join(', ')}.
                </p>
              )}
              {result.missing.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                  Still needed (a resume can&apos;t tell us these): {result.missing.map((f) => f.label).join(', ')}.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href="/settings/profile" className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                  Review &amp; complete profile
                </Link>
                <label className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
                  Upload a different resume
                  <input type="file" accept=".pdf" onChange={handleFile} disabled={working} className="hidden" />
                </label>
              </div>
            </div>
          )}

          {result && !result.ok && (
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{result.error}</p>
              <label className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 cursor-pointer">
                Try again
                <input type="file" accept=".pdf" onChange={handleFile} disabled={working} className="hidden" />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
