'use client';

import { useEffect } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';

/**
 * Interactive, animated spotlight walkthrough of the real UI (driver.js).
 * Anchors to [data-tour="…"] elements in the global navbar, so it runs on any
 * page. Only visible anchors are included, so it adapts to desktop vs mobile.
 *
 * Exposes window.__startTour(); the onboarding modal and the "Replay tour" button
 * call it. driver.js is React-19-safe (framework-agnostic) unlike react-joyride.
 */

const ANCHORS: { sel: string; title: string; description: string; side: 'top' | 'bottom' | 'left' | 'right' }[] = [
  { sel: '[data-tour="search"]', title: '🔍 Search anything', description: 'Jump to any company or role instantly — press ⌘K / Ctrl-K anywhere.', side: 'bottom' },
  { sel: '[data-tour="menu"]', title: '📂 Your menu', description: 'Tap here for Watchlist, Applications, Interview Prep and Recruiters.', side: 'bottom' },
  { sel: '[data-tour="nav-jobs"]', title: '📋 All Jobs', description: 'Every new-grad & tech role, filterable by role, level, sponsorship and more.', side: 'bottom' },
  { sel: '[data-tour="nav-my-list"]', title: '⭐ Watchlist', description: 'Track companies you love — we notify you the moment they post a new role.', side: 'bottom' },
  { sel: '[data-tour="nav-applications"]', title: '⚡ Applications', description: 'Auto-apply prepares applications with your profile so you apply in one tap.', side: 'bottom' },
  { sel: '[data-tour="nav-interview-prep"]', title: '🎯 Interview Prep', description: 'Real interview questions asked at each company.', side: 'bottom' },
  { sel: '[data-tour="nav-recruiters"]', title: '📧 Recruiters', description: 'Find recruiters at any company and email them in one click.', side: 'bottom' },
  { sel: '[data-tour="bell"]', title: '🔔 Your alerts', description: 'New matches from your watchlist and job alerts show up right here.', side: 'left' },
];

function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const he = el as HTMLElement;
  if (he.offsetParent === null && getComputedStyle(he).position !== 'fixed') return false;
  const r = he.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function ProductTour() {
  useEffect(() => {
    const start = () => {
      const steps: DriveStep[] = ANCHORS
        .filter((a) => isVisible(document.querySelector(a.sel)))
        .map((a) => ({
          element: a.sel,
          popover: { title: a.title, description: a.description, side: a.side, align: 'start' },
        }));

      // Always end on an actionable closing step (no element = centered card).
      steps.push({
        popover: {
          title: "You're all set 🎉",
          description: 'Start by uploading your resume — we build your whole profile from it. Everything else you can explore anytime from this menu.',
        },
      });

      const d = driver({
        showProgress: true,
        animate: true,
        overlayOpacity: 0.7,
        stagePadding: 6,
        stageRadius: 10,
        popoverClass: 'hr-tour',
        nextBtnText: 'Next →',
        prevBtnText: '← Back',
        doneBtnText: 'Done',
        steps,
      });
      d.drive();
    };

    (window as unknown as { __startTour?: () => void }).__startTour = start;

    // Auto-start if redirected here with ?tour=1 (from another page).
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('tour') === '1') {
        u.searchParams.delete('tour');
        window.history.replaceState({}, '', u.toString());
        setTimeout(start, 600); // let the page paint first
      }
    } catch { /* ignore */ }
  }, []);

  return null;
}

/** Start the tour from anywhere; navigates home first if needed. */
export function startProductTour() {
  const w = window as unknown as { __startTour?: () => void };
  if (window.location.pathname !== '/') {
    window.location.href = '/?tour=1';
    return;
  }
  w.__startTour?.();
}
