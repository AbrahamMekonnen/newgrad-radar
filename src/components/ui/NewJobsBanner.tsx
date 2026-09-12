'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface NewJobsBannerProps {
  newJobCount?: number;
  onRefresh?: () => void;
  className?: string;
}

export function NewJobsBanner({ newJobCount = 0, onRefresh, className }: NewJobsBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Show banner when there are new jobs
  useEffect(() => {
    if (newJobCount > 0) {
      setIsVisible(true);
    }
  }, [newJobCount]);

  // Show scroll-to-top when scrolled down
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleClick = useCallback(() => {
    // Scroll to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // If there's a refresh callback, call it
    if (onRefresh) {
      onRefresh();
    }

    // Hide the new jobs banner after clicking
    setIsVisible(false);
  }, [onRefresh]);

  if (!isVisible && !showScrollTop) return null;

  return (
    <button
      onClick={handleClick}
      aria-label={isVisible && newJobCount > 0 ? `View ${newJobCount} new job${newJobCount !== 1 ? 's' : ''}` : 'Scroll back to top'}
      className={cn(
        'fixed z-40 transition-all duration-300 ease-out',
        'px-4 py-2.5 rounded-full shadow-lg',
        'bg-gradient-to-r from-indigo-500 to-blue-500 text-white',
        'hover:from-indigo-600 hover:to-blue-600',
        'hover:shadow-xl hover:scale-105',
        'flex items-center gap-2 font-medium text-sm',
        'focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2',
        'dark:focus:ring-offset-slate-900',
        // Position at bottom center on mobile, bottom right on desktop
        'left-1/2 -translate-x-1/2 bottom-6',
        'sm:left-auto sm:right-6 sm:translate-x-0',
        // Animation
        isVisible || showScrollTop
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none',
        className
      )}
    >
      {isVisible && newJobCount > 0 ? (
        <>
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          <span>{newJobCount} new job{newJobCount !== 1 ? 's' : ''}</span>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          <span>Back to top</span>
        </>
      )}
    </button>
  );
}

// Floating action button variant for mobile
export function ScrollTopButton({ className }: { className?: string }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > 400);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className={cn(
        'fixed bottom-6 right-6 z-40',
        'w-12 h-12 rounded-full shadow-lg',
        'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700',
        'flex items-center justify-center',
        'text-gray-600 dark:text-gray-300',
        'hover:bg-gray-50 dark:hover:bg-slate-700',
        'hover:shadow-xl hover:scale-110',
        'transition-all duration-300 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2',
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none',
        className
      )}
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 10l7-7m0 0l7 7m-7-7v18"
        />
      </svg>
    </button>
  );
}
