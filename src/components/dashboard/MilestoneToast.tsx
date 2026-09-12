'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MILESTONES, type MilestoneType, type MilestoneInfo } from '@/hooks/useMilestones';
import { useConfetti } from '@/components/ui/Confetti';

interface MilestoneToastProps {
  /** The milestone to celebrate */
  milestone: MilestoneType | null;
  /** Callback when toast is dismissed */
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss (default: 6000) */
  duration?: number;
  /** Whether to trigger confetti (default: true) */
  showConfetti?: boolean;
}

/**
 * Category-specific colors for milestones
 */
const CATEGORY_COLORS: Record<MilestoneInfo['category'], { bg: string; border: string; badge: string }> = {
  applications: {
    bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-800',
  },
  interviews: {
    bg: 'bg-gradient-to-r from-purple-50 to-pink-50',
    border: 'border-purple-200',
    badge: 'bg-purple-100 text-purple-800',
  },
  offers: {
    bg: 'bg-gradient-to-r from-green-50 to-emerald-50',
    border: 'border-green-200',
    badge: 'bg-green-100 text-green-800',
  },
  streaks: {
    bg: 'bg-gradient-to-r from-amber-50 to-orange-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-800',
  },
  engagement: {
    bg: 'bg-gradient-to-r from-teal-50 to-cyan-50',
    border: 'border-teal-200',
    badge: 'bg-teal-100 text-teal-800',
  },
};

/**
 * Special toast component for milestone celebrations
 * Shows achievement badge, emoji, and message with confetti
 */
export function MilestoneToast({
  milestone,
  onDismiss,
  duration = 6000,
  showConfetti = true,
}: MilestoneToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const { fireSides } = useConfetti();

  const handleDismiss = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsAnimatingOut(false);
      onDismiss();
    }, 300);
  }, [onDismiss]);

  useEffect(() => {
    if (milestone) {
      setIsVisible(true);

      // Fire confetti
      if (showConfetti) {
        // Small delay to let toast appear first
        setTimeout(() => {
          fireSides({
            particleCount: 150,
            spread: 60,
            colors: ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96e6a1', '#dda0dd'],
          });
        }, 100);
      }

      // Auto-dismiss
      const timer = setTimeout(handleDismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [milestone, duration, showConfetti, fireSides, handleDismiss]);

  if (!milestone || !isVisible) {
    return null;
  }

  const info = MILESTONES[milestone];
  const colors = CATEGORY_COLORS[info.category];

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 max-w-sm w-full',
        'transform transition-all duration-300 ease-out',
        isAnimatingOut ? 'opacity-0 translate-y-4 scale-95' : 'opacity-100 translate-y-0 scale-100'
      )}
      role="alert"
      aria-live="polite"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border-2 shadow-2xl',
          colors.bg,
          colors.border
        )}
      >
        {/* Animated shine effect */}
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_ease-in-out]">
          <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12" />
        </div>

        <div className="relative p-5">
          {/* Header with badge and close button */}
          <div className="flex items-start justify-between mb-3">
            <span
              className={cn(
                'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide',
                colors.badge
              )}
            >
              Achievement Unlocked
            </span>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-full hover:bg-black/5 transition-colors -mr-1 -mt-1"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Main content */}
          <div className="flex items-center gap-4">
            {/* Emoji badge */}
            <div className="flex-shrink-0">
              <div className="w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center text-3xl animate-bounce">
                {info.emoji}
              </div>
            </div>

            {/* Text content */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-gray-900 truncate">
                {info.title}
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">
                {info.message}
              </p>
            </div>
          </div>

          {/* Progress bar animation */}
          <div className="mt-4 h-1 bg-black/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"
              style={{
                animation: `shrink ${duration}ms linear forwards`,
              }}
            />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Hook to manage milestone toast state
 */
export function useMilestoneToast() {
  const [currentMilestone, setCurrentMilestone] = useState<MilestoneType | null>(null);

  const showMilestoneToast = useCallback((milestone: MilestoneType) => {
    setCurrentMilestone(milestone);
  }, []);

  const dismissMilestoneToast = useCallback(() => {
    setCurrentMilestone(null);
  }, []);

  return {
    currentMilestone,
    showMilestoneToast,
    dismissMilestoneToast,
  };
}

export default MilestoneToast;
