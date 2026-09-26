'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';

/**
 * Full multi-page guided walkthrough (driver.js, React-19-safe).
 *
 * Unlike a single-page tour, this actually NAVIGATES the user section to section
 * — All Jobs → Watchlist → Applications → Interview Prep → Recruiters → Profile →
 * every Settings page — landing them on each real screen and explaining it with an
 * animated spotlight. Progress is kept in sessionStorage so the tour resumes after
 * each navigation. Anchors to the active nav item when visible, otherwise shows a
 * centered card, so it works on desktop and mobile.
 */

interface Stop {
  path: string;
  sel?: string;
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

const STOPS: Stop[] = [
  { path: '/', sel: '[data-tour="search"]', title: '🔍 Search anything', description: 'Jump to any company or role instantly — press ⌘K / Ctrl-K from anywhere in the app.', side: 'bottom' },
  { path: '/', title: '📋 All Jobs — your home feed', description: 'Every new-grad & tech role lives here. Scroll down to filter by role, experience level, sponsorship, work mode, salary and more.' },
  { path: '/my-list', sel: '[data-tour="nav-my-list"]', title: '⭐ Watchlist', description: 'Track the companies you care about. The moment one posts a new role, we notify you — no more refreshing career pages.', side: 'bottom' },
  { path: '/applications', sel: '[data-tour="nav-applications"]', title: '⚡ Applications', description: 'Your application pipeline. Auto-apply prepares applications with your profile so you submit in one tap, and everything you apply to is tracked here.', side: 'bottom' },
  { path: '/interview-prep', sel: '[data-tour="nav-interview-prep"]', title: '🎯 Interview Prep', description: 'Real interview questions asked at each company — filter by company, type and difficulty to prep for exactly who you’re interviewing with.', side: 'bottom' },
  { path: '/recruiters', sel: '[data-tour="nav-recruiters"]', title: '📧 Recruiters', description: 'Search any company to find its recruiters, then email all of them in one click with a ready-to-send message.', side: 'bottom' },
  { path: '/profile', title: '👤 My Profile — start here', description: 'Upload your resume once and we auto-fill your entire profile. Your progress checklist also lives here.' },
  { path: '/settings/profile', title: '🧩 Auto-Apply Profile', description: 'The details we use to fill out applications for you — name, contact, links, education, work authorization and sponsorship.' },
  { path: '/settings/resume', title: '📄 Resume Builder', description: 'Build a base resume that our AI tailors to each job you apply to.' },
  { path: '/settings/answers', title: '💬 Answer Bank', description: 'Your saved answers to common application questions, generated and reused so you never retype them.' },
  { path: '/settings/alerts', title: '🔔 Job Alerts', description: 'Create alerts for specific roles, companies or locations and get pinged the instant a match is posted.' },
  { path: '/settings', title: '⚙️ Settings', description: 'Turn on notifications (so alerts reach you), manage auto-apply, and set your preferences. That’s the whole app — you’re ready!' },
];

const AK = 'hr_tour_active';
const IK = 'hr_tour_i';

function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el as HTMLElement);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const dRef = useRef<Driver | null>(null);

  useEffect(() => {
    const active = () => { try { return sessionStorage.getItem(AK) === '1'; } catch { return false; } };
    const getI = () => { try { return parseInt(sessionStorage.getItem(IK) || '0', 10) || 0; } catch { return 0; } };
    const setI = (n: number) => { try { sessionStorage.setItem(IK, String(n)); } catch { /* ignore */ } };
    const end = () => {
      try { sessionStorage.removeItem(AK); sessionStorage.removeItem(IK); } catch { /* ignore */ }
      dRef.current?.destroy();
      dRef.current = null;
    };

    // The contiguous run of stops that live on the current path, starting at i.
    const segmentFrom = (i: number): number[] => {
      const out: number[] = [];
      let j = i;
      while (j < STOPS.length && STOPS[j].path === pathname) { out.push(j); j++; }
      return out;
    };

    const run = (attempt = 0) => {
      if (!active()) return;
      const i = getI();
      if (i >= STOPS.length) { end(); return; }
      if (!pathname) { if (attempt < 8) setTimeout(() => run(attempt + 1), 200); return; }
      if (STOPS[i].path !== pathname) { router.push(STOPS[i].path); return; }

      const idxs = segmentFrom(i);
      if (idxs.length === 0) { end(); return; }
      const lastGlobal = idxs[idxs.length - 1];

      // Wait for anchor elements to paint (page just navigated).
      const specificReady = idxs.every((k) => !STOPS[k].sel || document.querySelector(STOPS[k].sel!));
      if (!specificReady && attempt < 8) { setTimeout(() => run(attempt + 1), 250); return; }

      // Every step MUST have an element: driver.js won't render a LEADING
      // element-less (centered) step when a config callback is present. Fall back
      // to the always-present main content region so a page with no specific
      // anchor still gets a framed spotlight.
      const fallback = document.querySelector('#main-content') ? '#main-content' : 'body';
      const steps: DriveStep[] = idxs.map((k) => {
        const s = STOPS[k];
        const anchored = s.sel && isVisible(document.querySelector(s.sel));
        const el = anchored ? s.sel! : fallback;
        const popover: DriveStep['popover'] = { title: s.title, description: s.description };
        if (anchored) { popover!.side = s.side; popover!.align = 'start'; }
        return { element: el, popover };
      });

      try { dRef.current?.destroy(); } catch { /* ignore */ }
      dRef.current = null;
      document.documentElement.classList.remove('driver-active', 'driver-fade');
      const d = driver({
        showProgress: true,
        animate: true,
        overlayOpacity: 0.7,
        stagePadding: 6,
        stageRadius: 10,
        popoverClass: 'hr-tour',
        prevBtnText: '← Back',
        nextBtnText: 'Next →',
        doneBtnText: lastGlobal === STOPS.length - 1 ? 'Finish' : 'Next →',
        onNextClick: (_el, _step, { driver: dv }) => {
          if (!dv.isLastStep()) { dv.moveNext(); return; }
          const next = lastGlobal + 1;
          dv.destroy(); dRef.current = null;
          if (next >= STOPS.length) { end(); return; }
          setI(next);
          if (STOPS[next].path !== pathname) router.push(STOPS[next].path);
          else setTimeout(() => run(), 250);
        },
        onCloseClick: (_el, _step, { driver: dv }) => { dv.destroy(); end(); },
      });
      dRef.current = d;
      setI(i);
      d.drive();
    };

    // Resume the tour whenever the page (pathname) changes while active.
    const t = setTimeout(() => { if (active()) run(); }, 350);

    // Manual start (from the welcome modal / "Replay tour" button).
    const onStart = () => { setI(0); try { sessionStorage.setItem(AK, '1'); } catch { /* ignore */ } run(); };
    window.addEventListener('hr-tour-start', onStart);

    // Auto-start via ?tour=1 link.
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('tour') === '1') {
        u.searchParams.delete('tour');
        window.history.replaceState({}, '', u.toString());
        try { sessionStorage.setItem(AK, '1'); sessionStorage.setItem(IK, '0'); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    return () => { clearTimeout(t); window.removeEventListener('hr-tour-start', onStart); dRef.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}

/** Begin the full guided walkthrough from step 1. */
export function startProductTour() {
  try {
    sessionStorage.setItem(AK, '1');
    sessionStorage.setItem(IK, '0');
  } catch { /* ignore */ }
  if (window.location.pathname !== STOPS[0].path) {
    window.location.href = `${STOPS[0].path}?tour=1`;
    return;
  }
  window.dispatchEvent(new Event('hr-tour-start'));
}
