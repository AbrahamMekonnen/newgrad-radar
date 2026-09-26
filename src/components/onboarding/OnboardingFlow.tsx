'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ResumeAutofill } from '@/components/autoapply';
import { GettingStartedChecklist, type OnboardStateFlags } from './GettingStarted';
import { startProductTour } from './ProductTour';

const DONE_KEY = 'hr_onboarded_v1';
const PERSONA_KEY = 'hr_persona';

type Persona = 'new_grad' | 'intern' | 'experienced' | 'browsing';

const PERSONAS: { value: Persona; label: string; blurb: string }[] = [
  { value: 'new_grad', label: 'New grad', blurb: 'Full-time entry-level roles' },
  { value: 'intern', label: 'Student', blurb: 'Internships & co-ops' },
  { value: 'experienced', label: 'Experienced', blurb: 'Mid-level and up' },
  { value: 'browsing', label: 'Just browsing', blurb: 'Show me around' },
];

/**
 * First-run guided onboarding. Self-gating: shows once per browser for a signed-in
 * user who hasn't completed it. Action-first (resume upload is the activation
 * event) and smart — the final checklist reflects the user's real state.
 */
export function OnboardingFlow() {
  const supabase = createClient();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [flags, setFlags] = useState<OnboardStateFlags>({
    resume: false, profile: false, track: false, alert: false, notify: false, applied: false,
  });

  const loadFlags = useCallback(async (userId: string) => {
    try {
      const [prof, lists, alerts, apps] = await Promise.all([
        supabase.from('user_profiles').select('resume_url, work_authorization, require_sponsorship').eq('user_id', userId).single(),
        supabase.from('user_lists').select('id', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('job_alerts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('application_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      ]);
      const p = prof.data as { resume_url?: string; work_authorization?: string; require_sponsorship?: boolean | null } | null;
      let notify = false;
      try { notify = typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch { /* ignore */ }
      setFlags({
        resume: !!p?.resume_url,
        profile: !!(p?.work_authorization && p?.require_sponsorship !== null && p?.require_sponsorship !== undefined),
        track: (lists.count || 0) > 0,
        alert: (alerts.count || 0) > 0,
        notify,
        applied: (apps.count || 0) > 0,
      });
    } catch { /* best-effort */ }
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled || !u) return;
      setUser({ id: u.id, email: u.email || '' });
      loadFlags(u.id);
      let doneFlag = true;
      try { doneFlag = localStorage.getItem(DONE_KEY) === '1'; } catch { /* ignore */ }
      if (!doneFlag) setOpen(true);
    });
    return () => { cancelled = true; };
  }, [supabase, loadFlags]);

  // Re-read live state whenever a step changes (so the checklist reflects the
  // resume the user just uploaded, etc.).
  useEffect(() => { if (user && open) loadFlags(user.id); }, [step, user, open, loadFlags]);

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };
  const choosePersona = (p: Persona) => {
    // Persisted so the app can tailor defaults (e.g. experience filter) later.
    try { localStorage.setItem(PERSONA_KEY, p); } catch { /* ignore */ }
    setStep(1);
  };

  // Expose a global opener so a "Take the tour" button anywhere can re-open it.
  useEffect(() => {
    (window as unknown as { __openOnboarding?: () => void }).__openOnboarding = () => { setStep(0); setOpen(true); };
  }, []);

  if (!open || !user) return null;

  const steps = ['Welcome', 'Your resume', 'How it works', 'You’re set'];
  const firstName = user.email.split('@')[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={finish} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto">
        {/* header: progress dots + skip */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-indigo-600' : i < step ? 'w-3 bg-indigo-400' : 'w-3 bg-gray-200 dark:bg-slate-700'}`} />
            ))}
          </div>
          <button onClick={finish} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            {step === steps.length - 1 ? 'Done' : 'Skip'}
          </button>
        </div>

        <div className="p-5 sm:p-6">
          {/* STEP 0 — welcome + routing question */}
          {step === 0 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Welcome to HireRadar 👋</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                We track new-grad & tech roles across thousands of companies, auto-fill your applications, and surface recruiter contacts and interview questions. First — where are you in your search?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {PERSONAS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => choosePersona(p.value)}
                    className="text-left rounded-xl border border-gray-200 dark:border-slate-700 p-3 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{p.label}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{p.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 1 — resume upload (activation event) */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Set up in one step</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Upload your resume and we’ll fill your whole profile automatically — then auto-apply can use it. You can also skip and do this later.
              </p>
              <div className="mt-4 -mx-1 rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700">
                <ResumeAutofill userId={user.id} email={user.email} />
              </div>
            </div>
          )}

          {/* STEP 2 — how it works (value cards) */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Here’s how HireRadar works</h2>
              <div className="mt-4 space-y-3">
                {[
                  { icon: '🔔', title: 'Track companies → get pinged', body: 'Add companies to your Watchlist and we notify you the moment they post.', href: '/my-list' },
                  { icon: '⚡', title: 'Auto-apply fills applications', body: 'We prep applications with your profile so you apply in one tap.', href: '/' },
                  { icon: '🎯', title: 'Interview prep + recruiter emails', body: 'Real interview questions per company, plus recruiter contacts to reach out.', href: '/recruiters' },
                ].map((c) => (
                  <Link key={c.title} href={c.href} onClick={finish} className="flex gap-3 rounded-xl border border-gray-200 dark:border-slate-700 p-3 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <span className="text-xl">{c.icon}</span>
                    <span>
                      <span className="block text-sm font-semibold text-gray-900 dark:text-white">{c.title}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{c.body}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3 — smart getting-started checklist */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">You’re set, {firstName} 🎉</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Here’s your personalized checklist — it updates itself as you go. You can reopen it anytime from My Profile.
              </p>
              <div className="mt-4 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                <GettingStartedChecklist flags={flags} onItemClick={finish} />
              </div>
            </div>
          )}
        </div>

        {/* footer nav */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm font-medium text-gray-500 disabled:opacity-0 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              {step === 1 ? 'Next' : 'Continue'}
            </button>
          ) : (
            <button
              onClick={() => { finish(); setTimeout(startProductTour, 300); }}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Take the tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
