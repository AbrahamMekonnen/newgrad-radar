'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { MobileNav } from './MobileNav';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useStreak } from '@/hooks';
import type { User } from '@supabase/supabase-js';

// Command icon for search button
const CommandIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const navLinks = [
  { href: '/', label: 'All Jobs' },
  { href: '/interview-prep', label: 'Interview Prep' },
  { href: '/recruiters', label: 'Recruiters' },
  { href: '/my-list', label: 'Watchlist', protected: true },
  { href: '/applications', label: 'Applications', protected: true },
  { href: '/analytics', label: 'Analytics', protected: true },
];

export function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const supabase = createClient();
  const { days: streakDays } = useStreak();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setShowDropdown(false);
  };

  // Open command palette by dispatching keyboard event
  const openCommandPalette = useCallback(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, []);

  return (
    <>
      <nav className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-slate-700/50 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo and Desktop Nav */}
            <div className="flex items-center">
              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="xl:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <Link href="/" className="flex items-center gap-2 ml-2 lg:ml-0">
                <span className="text-xl font-bold text-gray-900 dark:text-white">HireRadar</span>
              </Link>

              {/* Desktop navigation */}
              <nav className="hidden xl:flex xl:ml-8 xl:gap-1" aria-label="Main navigation">
                {navLinks.map((link) => {
                  if (link.protected && !user) return null;
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={cn(
                        'px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset',
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70 dark:text-gray-400 dark:hover:text-white dark:hover:bg-slate-800/70'
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* User menu */}
            <div className="flex items-center gap-2">
              {/* Command Palette Button */}
              <button
                onClick={openCommandPalette}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg border border-gray-200 dark:border-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Open command palette"
              >
                <CommandIcon />
                <span className="text-xs">Search...</span>
                <kbd className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-slate-700 rounded border border-gray-300 dark:border-slate-500">
                  <span className="text-[10px]">Cmd</span>
                  <span>K</span>
                </kbd>
              </button>

              <ThemeToggle />
              {user && <NotificationBell userId={user.id} />}
              {user ? (
                <div className="relative flex items-center gap-2">
                  {/* Streak Badge - only show if streak > 0 */}
                  {streakDays > 0 && (
                    <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 text-orange-600 dark:text-orange-400 rounded-full text-sm font-medium border border-orange-200 dark:border-orange-800/50">
                      <span className="text-base leading-none">&#128293;</span>
                      <span>{streakDays}</span>
                    </div>
                  )}

                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 rounded-lg hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                    aria-expanded={showDropdown}
                    aria-haspopup="true"
                    aria-label="User menu"
                  >
                    <span className="hidden sm:block truncate max-w-[160px]">{user.email}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showDropdown && (
                    <div
                      className="absolute right-0 mt-2 w-48 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/50 dark:border-slate-700/50 py-1 animate-in fade-in zoom-in-95 duration-150"
                      role="menu"
                      aria-orientation="vertical"
                      aria-label="User actions"
                    >
                      <Link
                        href="/settings"
                        className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700/50 focus:outline-none focus:bg-gray-100 dark:focus:bg-slate-700/50 transition-colors"
                        onClick={() => setShowDropdown(false)}
                        role="menuitem"
                      >
                        Settings
                      </Link>
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700/50 focus:outline-none focus:bg-gray-100 dark:focus:bg-slate-700/50 transition-colors"
                        role="menuitem"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all"
                  >
                    Login
                  </Link>
                  <Link
                    href={`/auth/signup?redirect=${encodeURIComponent(pathname)}`}
                    className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 rounded-lg shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        user={user}
        onSignOut={handleSignOut}
      />
    </>
  );
}
