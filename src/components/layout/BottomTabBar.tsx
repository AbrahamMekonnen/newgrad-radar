'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { User } from '@supabase/supabase-js';

/**
 * Native-style bottom tab bar — the primary navigation on phones, so the app
 * feels like an app instead of a website with a hamburger. Shown only on small
 * screens (md:hidden) and only when signed in; desktop keeps its top navbar
 * untouched. Secondary destinations (Recruiters, Analytics, Settings, sign out)
 * stay in the ☰ menu as overflow.
 *
 * Icons are inline strokes (24px) to match the rest of the app. Each tab carries
 * a data-tour anchor so the guided tour can highlight the *real* mobile nav.
 */

type Tab = { href: string; label: string; tour: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
  </svg>
);

const TABS: Tab[] = [
  { href: '/', label: 'Jobs', tour: 'tab-jobs', icon: icon('M4 6h16M4 12h10M4 18h7') },
  { href: '/my-list', label: 'Watchlist', tour: 'tab-my-list', icon: icon('M11.48 3.5l2.2 4.46 4.92.72-3.56 3.47.84 4.9-4.4-2.31-4.4 2.31.84-4.9-3.56-3.47 4.92-.72 2.2-4.46z') },
  { href: '/applications', label: 'Apply', tour: 'tab-applications', icon: icon('M13 10V3L4 14h7v7l9-11h-7z') },
  { href: '/interview-prep', label: 'Prep', tour: 'tab-interview-prep', icon: icon('M12 14l9-5-9-5-9 5 9 5zm0 0v6m0-6l6.16-3.42A12 12 0 0112 20a12 12 0 01-6.16-9.42') },
  { href: '/profile', label: 'Profile', tour: 'tab-profile', icon: icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z') },
];

export function BottomTabBar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  // Only signed-in phone users get the app-style bar; keep auth screens clean.
  if (!user) return null;
  if (pathname?.startsWith('/auth')) return null;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : (pathname === href || pathname?.startsWith(`${href}/`));

  return (
    <nav
      data-app-chrome
      data-bottom-tabbar
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gray-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl app-safe-bottom"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                data-tour={t.tour}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                  active
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-500 dark:text-gray-400 active:text-gray-900 dark:active:text-white'
                )}
              >
                <span className={cn('transition-transform', active && 'scale-105')}>{t.icon}</span>
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
