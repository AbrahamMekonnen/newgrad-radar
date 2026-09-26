'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startProductTour } from './ProductTour';

export interface OnboardStateFlags {
  resume: boolean;      // resume uploaded
  profile: boolean;     // work auth + sponsorship set
  track: boolean;       // tracks >= 1 company
  alert: boolean;       // has >= 1 job alert
  notify: boolean;      // notifications granted
  applied: boolean;     // >= 1 application
}

export interface ChecklistItem {
  key: keyof OnboardStateFlags;
  label: string;
  desc: string;
  href: string;
  done: boolean;
}

export function buildChecklist(s: OnboardStateFlags): ChecklistItem[] {
  return [
    { key: 'resume', label: 'Upload your resume', desc: 'We auto-fill your whole profile from it.', href: '/settings/profile', done: s.resume },
    { key: 'profile', label: 'Finish your profile', desc: 'Add work authorization & sponsorship — the two things a resume can’t tell us.', href: '/settings/profile', done: s.profile },
    { key: 'track', label: 'Track a company', desc: 'Get notified the moment it posts a new role.', href: '/my-list', done: s.track },
    { key: 'alert', label: 'Create a job alert', desc: 'Get pinged when a matching role goes live.', href: '/settings/alerts', done: s.alert },
    { key: 'notify', label: 'Turn on notifications', desc: 'So alerts actually reach you.', href: '/settings', done: s.notify },
    { key: 'applied', label: 'Apply to your first job', desc: 'Auto-apply can fill the application for you.', href: '/', done: s.applied },
  ];
}

/** Compact adaptive checklist with a progress bar. Auto-reflects real state. */
export function GettingStartedChecklist({
  flags,
  onItemClick,
}: {
  flags: OnboardStateFlags;
  onItemClick?: () => void;
}) {
  const items = buildChecklist(flags);
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Getting started</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{done}/{items.length} done</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden mb-3">
        <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              onClick={onItemClick}
              className={`flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${
                it.done ? 'opacity-60' : 'hover:bg-gray-100 dark:hover:bg-slate-700/60'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                  it.done
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'border-gray-300 dark:border-slate-600 text-transparent'
                }`}
                aria-hidden="true"
              >
                {it.done ? '✓' : ''}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${it.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                  {it.label}
                </span>
                {!it.done && <span className="block text-xs text-gray-500 dark:text-gray-400">{it.desc}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Self-loading Getting-Started card for the My Profile hub: reads the user's real
 * state, shows the adaptive checklist, and offers to replay the guided tour.
 * Hides itself once every step is complete.
 */
export function GettingStartedCard({ userId }: { userId: string }) {
  const supabase = createClient();
  const [flags, setFlags] = useState<OnboardStateFlags | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        if (!cancelled) setFlags({
          resume: !!p?.resume_url,
          profile: !!(p?.work_authorization && p?.require_sponsorship !== null && p?.require_sponsorship !== undefined),
          track: (lists.count || 0) > 0,
          alert: (alerts.count || 0) > 0,
          notify,
          applied: (apps.count || 0) > 0,
        });
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [supabase, userId]);

  if (!flags) return null;
  const allDone = Object.values(flags).every(Boolean);
  if (allDone) return null; // nothing left to nudge

  return (
    <div className="p-6">
      <GettingStartedChecklist flags={flags} />
      <button
        onClick={() => startProductTour()}
        className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Replay the guided tour
      </button>
    </div>
  );
}
