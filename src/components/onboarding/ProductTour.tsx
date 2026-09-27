'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import './product-tour.css';

/**
 * Premium, interactive, resilient product walkthrough.
 *
 * Design goals (from user research):
 *  - INTERACTIVE ("do it", not "watch"): the user clicks the *real* controls to
 *    move between sections, so they learn how to navigate — not just that a
 *    section exists. Every step is skippable.
 *  - RESILIENT: the tour is resumable state in localStorage, not an in-memory
 *    sequence. If the user wanders off (clicks a real button, reloads, closes a
 *    tab), it PAUSES rather than dying, and a floating "Resume tour" pill brings
 *    them back to the exact step.
 *  - DEEP where it matters: Watchlist and (especially) the Auto-Apply profile
 *    get multi-step, hands-on walkthroughs; the rest is a lighter pass.
 *  - GAMIFIED FINISH: a confetti + celebration moment on completion.
 */

type Side = 'top' | 'bottom' | 'left' | 'right';
type Kind = 'spot' | 'nav' | 'navmenu';

interface Stop {
  page: string;          // pathname this stop is shown on
  kind: Kind;            // spot = explain; nav = click a top-nav link; navmenu = via account menu
  sel: string;           // selector to anchor to
  title: string;
  desc: string;
  side?: Side;
  to?: string;           // nav/navmenu: destination route
  label?: string;        // nav: human name of the destination (for mobile fallback copy)
}

// The linear walkthrough. Cross-page hops always end a page's segment with a
// nav/navmenu stop, so movement happens by the user clicking a real control.
const STOPS: Stop[] = [
  // ---- Home / All Jobs (public) ----
  { page: '/', kind: 'spot', sel: '[data-tour="search"]', side: 'bottom',
    title: '🔍 Search anything',
    desc: 'Jump to any company or role instantly — or press ⌘K / Ctrl-K from anywhere in the app.' },
  { page: '/', kind: 'spot', sel: '#main-content',
    title: '📋 All Jobs — your home feed',
    desc: 'Every new-grad & tech role lives here. Scroll down to filter by role, experience level, sponsorship, work mode and salary.' },
  { page: '/', kind: 'nav', to: '/my-list', label: 'Watchlist', sel: '[data-tour="nav-my-list"]', side: 'bottom',
    title: '⭐ Open your Watchlist',
    desc: 'Click Watchlist in the nav — that’s how you’ll come back to it anytime.' },

  // ---- Watchlist (CRITICAL: deep-dive) ----
  { page: '/my-list', kind: 'spot', sel: '[data-tour="wl-add-tab"]', side: 'bottom',
    title: '➕ Track a company',
    desc: 'Open “+ Add Companies”, search for any company, and track it. The moment it posts a new role, we notify you — no more refreshing career pages.' },
  { page: '/my-list', kind: 'nav', to: '/applications', label: 'Applications', sel: '[data-tour="nav-applications"]', side: 'bottom',
    title: '⚡ Open Applications',
    desc: 'Click Applications to see everything you’ve applied to.' },

  // ---- Applications ----
  { page: '/applications', kind: 'spot', sel: '#main-content',
    title: '⚡ Your application pipeline',
    desc: 'Every application — manual or auto-applied — is tracked here with its live status.' },
  { page: '/applications', kind: 'nav', to: '/interview-prep', label: 'Interview Prep', sel: '[data-tour="nav-interview-prep"]', side: 'bottom',
    title: '🎯 Open Interview Prep',
    desc: 'Click Interview Prep.' },

  // ---- Interview Prep ----
  { page: '/interview-prep', kind: 'spot', sel: '#main-content',
    title: '🎯 Real interview questions',
    desc: 'Actual questions asked at each company — filter by company, type and difficulty to prep for exactly who you’re interviewing with.' },
  { page: '/interview-prep', kind: 'nav', to: '/recruiters', label: 'Recruiters', sel: '[data-tour="nav-recruiters"]', side: 'bottom',
    title: '📧 Open Recruiters',
    desc: 'Click Recruiters.' },

  // ---- Recruiters ----
  { page: '/recruiters', kind: 'spot', sel: '#main-content',
    title: '📧 Reach recruiters',
    desc: 'Search any company to find its recruiters, then email all of them in one click with a ready-to-send message.' },
  { page: '/recruiters', kind: 'navmenu', to: '/profile', label: 'My Profile', sel: '[data-tour="usermenu"]', side: 'bottom',
    title: '👤 Your account menu',
    desc: 'Your profile, settings and sign-out all live in this menu. Click Next and we’ll open your Profile — your setup hub.' },

  // ---- My Profile (hub) ----
  { page: '/profile', kind: 'spot', sel: '[data-tour="gs-card"]',
    title: '✅ Your setup checklist',
    desc: 'This lives here on My Profile and fills up as you go. Finishing it is the fastest way to get fully set up.' },
  { page: '/profile', kind: 'nav', to: '/settings/profile', label: 'Auto-Apply Profile', sel: '[data-tour="pf-autoapply-card"]',
    title: '⚡ Set up Auto-Apply — the big one',
    desc: 'This is what lets us apply on your behalf. Click “Configure Auto-Apply Profile”.' },

  // ---- Auto-Apply Profile (MOST CRITICAL: deep-dive) ----
  { page: '/settings/profile', kind: 'spot', sel: '[data-tour="ap-resume"]',
    title: '📄 Upload your resume',
    desc: 'Upload it once and we auto-fill your whole profile from it — the single fastest way to be ready to apply.' },
  { page: '/settings/profile', kind: 'spot', sel: '[data-tour="ap-work-auth"]',
    title: '🛂 Work authorization & sponsorship',
    desc: 'The two things a resume can’t tell us. Set these so we only apply where you’re a fit — and answer these questions correctly for you.' },
  { page: '/settings/profile', kind: 'spot', sel: '[data-tour="ap-autoapply"]',
    title: '⚡ Turn on Auto-Apply',
    desc: 'With this on, we prepare each application with your profile so you can submit in one tap.' },
  { page: '/settings/profile', kind: 'spot', sel: '[data-tour="ap-save"]', side: 'top',
    title: '💾 Save your profile',
    desc: 'Click Save — once this is filled in, we can start applying to the roles you want on your behalf.' },
  { page: '/settings/profile', kind: 'navmenu', to: '/settings', label: 'Settings', sel: '[data-tour="usermenu"]', side: 'bottom',
    title: '⚙️ One last stop',
    desc: 'Open your account menu again — Click Next and we’ll take you to Settings to turn on notifications.' },

  // ---- Settings (notifications) — finish ----
  { page: '/settings', kind: 'spot', sel: '#main-content',
    title: '🔔 Turn on notifications',
    desc: 'Enable notifications so job alerts actually reach you. That’s the whole app — you’re ready to go! 🎉' },
];

const TOTAL = STOPS.length;
const AK = 'hr_tour_active';
const IK = 'hr_tour_i';

function qs(sel: string): HTMLElement | null {
  try { return document.querySelector(sel) as HTMLElement | null; } catch { return null; }
}
function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el as HTMLElement);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
}

function fireConfetti() {
  try {
    const end = Date.now() + 900;
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899'];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.35 }, colors });
  } catch { /* confetti is best-effort */ }
}

export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const dRef = useRef<Driver | null>(null);
  const navigatingRef = useRef(false);
  const cleanupRef = useRef<Array<() => void>>([]);
  const [paused, setPaused] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const getI = () => { try { return parseInt(localStorage.getItem(IK) || '0', 10) || 0; } catch { return 0; } };
  const setI = (n: number) => { try { localStorage.setItem(IK, String(n)); } catch { /* ignore */ } };
  const isActive = () => { try { return localStorage.getItem(AK) === '1'; } catch { return false; } };

  const runClean = () => { cleanupRef.current.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanupRef.current = []; };

  const destroyTour = useCallback((silent = true) => {
    navigatingRef.current = silent;
    runClean();
    try { dRef.current?.destroy(); } catch { /* ignore */ }
    dRef.current = null;
    navigatingRef.current = false;
  }, []);

  const endTour = useCallback(() => {
    try { localStorage.removeItem(AK); localStorage.removeItem(IK); } catch { /* ignore */ }
    destroyTour(true);
    setPaused(false);
  }, [destroyTour]);

  const markOnboarded = useCallback(async () => {
    // Best-effort: flip the per-user onboarding flag so the welcome modal won't
    // reappear. We read the user id lazily to avoid importing supabase eagerly.
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const { data } = await createClient().auth.getUser();
      const uid = data.user?.id;
      if (uid) localStorage.setItem(`hr_onboarded_v1_${uid}`, '1');
    } catch { /* ignore */ }
  }, []);

  const finishTour = useCallback(() => {
    try { localStorage.removeItem(AK); localStorage.removeItem(IK); } catch { /* ignore */ }
    destroyTour(true);
    setPaused(false);
    setCelebrate(true);
    fireConfetti();
    markOnboarded();
  }, [destroyTour, markOnboarded]);

  // The contiguous run of stops that live on the current page, starting at i.
  const segmentFrom = useCallback((i: number): Stop[] => {
    const out: Stop[] = [];
    let j = i;
    while (j < STOPS.length && STOPS[j].page === pathname) { out.push(STOPS[j]); j++; }
    return out;
  }, [pathname]);

  const run = useCallback((attempt = 0) => {
    if (!isActive()) { setPaused(false); return; }
    const i = getI();
    if (i >= TOTAL) { finishTour(); return; }
    if (!pathname) { if (attempt < 10) setTimeout(() => run(attempt + 1), 150); return; }

    const stop = STOPS[i];

    // Off-script: user is somewhere the current step doesn't live (wandered off,
    // got bounced to login, reloaded elsewhere). Pause — never kill — and let the
    // floating pill bring them back.
    if (stop.page !== pathname) {
      destroyTour(true);
      setPaused(true);
      return;
    }

    const segment = segmentFrom(i);
    if (segment.length === 0) { destroyTour(true); setPaused(true); return; }
    const nextGlobal = i + segment.length;

    // Wait for the first anchor to paint (page may have just navigated / be
    // hydrating). #main-content always exists, so those resolve immediately.
    const first = segment[0];
    if (first.sel !== '#main-content' && !qs(first.sel)) {
      if (attempt < 12) { setTimeout(() => run(attempt + 1), 200); return; }
    }

    destroyTour(true);
    document.documentElement.classList.remove('driver-active', 'driver-fade');

    // Resolve each stop to a concrete driver step. Every step gets an element so
    // driver.js always renders (a leading element-less step silently no-ops).
    const fallback = qs('#main-content') ? '#main-content' : 'body';
    const steps: DriveStep[] = segment.map((s) => {
      let elSel = s.sel;
      let title = s.title;
      let desc = s.desc;

      if (s.kind === 'nav') {
        // Prefer the real, visible top-nav link so the user learns the path by
        // clicking it. On narrow screens the nav collapses to a hamburger.
        if (!isVisible(qs(s.sel))) {
          elSel = isVisible(qs('[data-tour="menu"]')) ? '[data-tour="menu"]' : (qs(s.sel) ? s.sel : fallback);
          title = `☰ Open the menu`;
          desc = `${s.label} lives in the menu — open it, then tap ${s.label}. (Click Next and we’ll take you there.)`;
        }
      } else if (s.kind === 'navmenu') {
        if (!isVisible(qs(s.sel))) elSel = fallback;
      } else if (!isVisible(qs(s.sel))) {
        elSel = fallback;
      }

      const anchored = elSel !== fallback && !!qs(elSel);
      const popover: DriveStep['popover'] = { title, description: desc };
      if (anchored && s.side) { popover!.side = s.side; popover!.align = 'start'; }
      return { element: elSel, popover };
    });

    // Never hand driver.js an empty step list (it logs "No steps to drive
    // through"). Should never happen given the guards above, but stay safe.
    if (steps.length === 0) { setPaused(true); return; }

    const advance = () => {
      const s = segment[segment.length - 1];
      setI(nextGlobal);
      if (nextGlobal >= TOTAL) { finishTour(); return; }
      const dest = STOPS[nextGlobal].page;
      if (s.kind === 'navmenu') {
        // Teach where it lives: flash the account menu open, then navigate.
        const btn = qs('[data-tour="usermenu"]');
        try { btn?.click(); } catch { /* ignore */ }
        destroyTour(true);
        setTimeout(() => router.push(s.to || dest), 450);
        return;
      }
      if (s.kind === 'nav') {
        const menuBtn = qs('[data-tour="menu"]');
        if (menuBtn && !isVisible(qs(s.sel))) { try { menuBtn.click(); } catch { /* ignore */ } }
        destroyTour(true);
        setTimeout(() => router.push(s.to || dest), menuBtn && !isVisible(qs(s.sel)) ? 400 : 0);
        return;
      }
      // spot that ends a segment but next stop is elsewhere (shouldn't normally
      // happen, but stay safe)
      destroyTour(true);
      if (dest !== pathname) router.push(dest); else setTimeout(() => run(), 150);
    };

    const goBack = (dv: Driver) => {
      const gi = dv.getActiveIndex() ?? 0;
      if (gi > 0) { dv.movePrevious(); return; }
      const prev = i - 1;
      if (prev < 0) return;
      setI(prev);
      destroyTour(true);
      if (STOPS[prev].page !== pathname) router.push(STOPS[prev].page);
      else setTimeout(() => run(), 150);
    };

    const d = driver({
      steps,
      showProgress: segment.length > 1,
      progressText: '{{current}} of {{total}} on this page',
      animate: true,
      overlayColor: '#0f172a',
      overlayOpacity: 0.72,
      stagePadding: 6,
      stageRadius: 12,
      popoverClass: 'hr-tour',
      prevBtnText: '← Back',
      nextBtnText: 'Next →',
      doneBtnText: nextGlobal >= TOTAL ? '🎉 Finish' : 'Next →',
      onNextClick: (_el, _step, { driver: dv }) => {
        if (!dv.isLastStep()) { dv.moveNext(); return; }
        advance();
      },
      onPrevClick: (_el, _step, { driver: dv }) => goBack(dv),
      onCloseClick: () => endTour(),
    });
    dRef.current = d;
    setI(i);
    setPaused(false);
    d.drive();

    // If the last step of a segment is a real top-nav link, also let the user's
    // OWN click on it advance the tour (so they truly learn the path). We save
    // progress in capture phase, then let the link navigate naturally.
    const last = segment[segment.length - 1];
    if (last.kind === 'nav' && isVisible(qs(last.sel))) {
      const link = qs(last.sel);
      if (link) {
        const onClick = () => { setI(nextGlobal); destroyTour(true); };
        link.addEventListener('click', onClick, { capture: true, once: true });
        cleanupRef.current.push(() => link.removeEventListener('click', onClick, { capture: true } as EventListenerOptions));
      }
    } else if (last.kind === 'nav') {
      // Mobile: real link is hidden. Let a click on the hamburger progress + open.
      const ham = qs('[data-tour="menu"]');
      if (ham) {
        const onClick = () => { setI(nextGlobal); destroyTour(true); setTimeout(() => router.push(last.to || STOPS[nextGlobal]?.page || '/'), 300); };
        ham.addEventListener('click', onClick, { capture: true, once: true });
        cleanupRef.current.push(() => ham.removeEventListener('click', onClick, { capture: true } as EventListenerOptions));
      }
    }
  }, [pathname, router, destroyTour, finishTour, endTour, segmentFrom]);

  // Resume on every pathname change while active.
  useEffect(() => {
    // Auto-start via ?tour=1 link.
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('tour') === '1') {
        u.searchParams.delete('tour');
        window.history.replaceState({}, '', u.toString());
        localStorage.setItem(AK, '1');
        localStorage.setItem(IK, '0');
      }
    } catch { /* ignore */ }

    const t = setTimeout(() => { if (isActive()) run(); else setPaused(false); }, 350);
    const onStart = () => { setI(0); try { localStorage.setItem(AK, '1'); } catch { /* ignore */ } setCelebrate(false); run(); };
    window.addEventListener('hr-tour-start', onStart);
    return () => {
      clearTimeout(t);
      window.removeEventListener('hr-tour-start', onStart);
      destroyTour(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const resume = () => {
    if (!isActive()) { setPaused(false); return; }
    const i = getI();
    const dest = STOPS[i]?.page || '/';
    setPaused(false);
    if (dest !== pathname) router.push(dest);
    else setTimeout(() => run(), 100);
  };

  const stepNum = Math.min(getI() + 1, TOTAL);

  return (
    <>
      {/* Floating resume pill — the "way back" when the tour is paused. */}
      <AnimatePresence>
        {paused && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="fixed bottom-5 right-5 z-[95] flex items-center gap-2 rounded-full bg-white dark:bg-slate-800 shadow-2xl border border-indigo-200 dark:border-indigo-500/40 pl-4 pr-2 py-2"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
            </span>
            <button onClick={resume} className="text-sm font-semibold text-gray-900 dark:text-white">
              Resume tour <span className="text-gray-400 dark:text-gray-500">· {stepNum}/{TOTAL}</span>
            </button>
            <button
              onClick={endTour}
              aria-label="End tour"
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-slate-700 transition-colors"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Completion celebration. */}
      <AnimatePresence>
        {celebrate && (
          <motion.div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCelebrate(false)} />
            <motion.div
              initial={{ scale: 0.85, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 10, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-2xl p-6 text-center"
            >
              <div className="text-5xl">🎉</div>
              <h2 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">You’re all set!</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                You’ve seen the whole app. Finish your setup checklist on My Profile and we’ll start working for you.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => { setCelebrate(false); router.push('/profile'); }}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
                >
                  Go to My Profile
                </button>
                <button
                  onClick={() => setCelebrate(false)}
                  className="rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Begin the full guided walkthrough from step 1. */
export function startProductTour() {
  try {
    localStorage.setItem(AK, '1');
    localStorage.setItem(IK, '0');
  } catch { /* ignore */ }
  if (window.location.pathname !== STOPS[0].page) {
    window.location.href = `${STOPS[0].page}?tour=1`;
    return;
  }
  window.dispatchEvent(new Event('hr-tour-start'));
}
