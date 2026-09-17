'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { User } from '@supabase/supabase-js';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSignOut: () => void;
}

const navLinks = [
  { href: '/', label: 'All Jobs' },
  { href: '/interview-prep', label: 'Interview Prep', protected: true },
  { href: '/recruiters', label: 'Recruiters', protected: true },
  { href: '/my-list', label: 'Watchlist', protected: true },
  { href: '/applications', label: 'Applications', protected: true },
  { href: '/analytics', label: 'Analytics', protected: true },
  { href: '/settings', label: 'Settings', protected: true },
];

export function MobileNav({ isOpen, onClose, user, onSignOut }: MobileNavProps) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Handle keyboard events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }

    // Trap focus within drawer
    if (event.key === 'Tab' && drawerRef.current) {
      const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
        'a, button, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      // Store currently focused element
      previousFocusRef.current = document.activeElement as HTMLElement;

      // Focus the close button when drawer opens
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);

      // Add keyboard event listener
      document.addEventListener('keydown', handleKeyDown);
    } else {
      // Restore focus to previously focused element
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-slate-800 shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <span className="text-lg font-bold text-gray-900 dark:text-white">Menu</span>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-3 -m-1 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 rounded-lg transition-colors"
            aria-label="Close navigation menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="p-4 space-y-1" aria-label="Main navigation">
          {navLinks.map((link) => {
            if (link.protected && !user) return null;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className={cn(
                  'block px-4 py-3 rounded-lg text-base font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset',
                  isActive
                    ? 'bg-gray-100 text-gray-900 dark:bg-slate-700 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-white dark:hover:bg-slate-700'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-slate-700">
          {user ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate" aria-label="Logged in as">{user.email}</p>
              <button
                onClick={() => {
                  onSignOut();
                  onClose();
                }}
                className="w-full px-4 py-3 min-h-[48px] text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 active:bg-gray-100 dark:active:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
              onClick={onClose}
              className="block w-full px-4 py-3 min-h-[48px] text-center text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
