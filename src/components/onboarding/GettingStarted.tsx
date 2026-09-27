'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
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
  key: string;
  label: string;
  desc: string;
  href: string;
  done: boolean;
}

export function buildChecklist(s: OnboardStateFlags): ChecklistItem[] {
  return [
    // Endowed progress: the account already exists, so the user starts the list
    // partway done — a well-established nudge that measurably lifts completion.
    { key: 'account', label: 'Create your account', desc: 'Done — welcome aboard!', href: '/profile', done: true },
    { key: 'resume', label: 'Upload your resume', desc: 'We auto-fill your whole profile from it.', href: '/settings/profile', done: s.resume },
    { key: 'profile', label: 'Finish your Auto-Apply profile', desc: 'Add work authorization & sponsorship — so we can apply on your behalf.', href: '/settings/profile', done: s.profile },
    { key: 'track', label: 'Track a company', desc: 'Get notified the moment it posts a new role.', href: '/my-list', done: s.track },
    { key: 'alert', label: 'Create a job alert', desc: 'Get pinged when a matching role goes live.', href: '/settings/alerts', done: s.alert },
    { key: 'notify', label: 'Turn on notifications', desc: 'So alerts actually reach you.', href: '/settings', done: s.notify },
    { key: 'applied', label: 'Apply to your first job', desc: 'Auto-apply can fill the application for you.', href: '/', done: s.applied },
  ];
}

/** Animated SVG progress ring (goal-gradient cue). */
function ProgressRing({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-gray-200 dark:stroke-slate-700" />
        <motion.circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          className="stroke-indigo-600 dark:stroke-indigo-400"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c - (c * pct) / 100 }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-gray-900 dark:text-white">{pct}%</span>
      </div>
    </div>
  );
}

/** Gamified adaptive checklist with an animated ring + celebration at 100%. */
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
  const remaining = items.length - done;

  // Confetti once, the moment the list first hits 100%.
  const celebrated = useRef(false);
  useEffect(() => {
    if (pct >= 100 && !celebrated.current) {
      celebrated.current = true;
      try {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.4 }, colors: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899'] });
      } catch { /* best-effort */ }
    }
  }, [pct]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <ProgressRing pct={pct} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {pct >= 100 ? 'You’re fully set up! 🎉' : 'Getting started'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {pct >= 100
              ? 'Every step complete — we’re working for you.'
              : `${done} of ${items.length} done · ${remaining} to go`}
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {items.map((it, idx) => (
          <motion.li
            key={it.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
          >
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
                <AnimatePresence>
                  {it.done && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    >
                      ✓
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${it.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                  {it.label}
                </span>
                {!it.done && <span className="block text-xs text-gray-500 dark:text-gray-400">{it.desc}</span>}
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Self-loading Getting-Started card for the My Profile hub: reads the user's real
 * state, shows the gamified checklist, and offers to (re)play the guided tour.
 * Stays visible even at 100% (shows the celebration state) for one session, but
 * collapses on next load once complete.
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
    <div className="p-6" data-tour="gs-card">
      <GettingStartedChecklist flags={flags} />
      <button
        onClick={() => startProductTour()}
        className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        ▸ Replay the guided tour
      </button>
    </div>
  );
}
