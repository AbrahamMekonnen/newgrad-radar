/**
 * Hook that animates a number from 0 to a target value using requestAnimationFrame
 */

import { useState, useEffect, useRef } from 'react';

export interface UseAnimatedNumberOptions {
  /** Animation duration in milliseconds (default: 800) */
  duration?: number;
  /** Easing function (default: easeOutCubic) */
  easing?: (t: number) => number;
  /** Delay before animation starts in milliseconds (default: 0) */
  delay?: number;
  /** Number of decimal places (default: 0) */
  decimals?: number;
  /** Whether to animate on value change (default: true) */
  animateOnChange?: boolean;
}

// Easing functions
export const easings = {
  linear: (t: number) => t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeOutQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  spring: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * Animates a number from 0 to the target value
 *
 * @param target - The target number to animate to
 * @param options - Configuration options
 * @returns The current animated value
 *
 * @example
 * ```tsx
 * const animatedCount = useAnimatedNumber(jobCount, { duration: 1000 });
 * return <span>{animatedCount}</span>;
 * ```
 */
export function useAnimatedNumber(
  target: number,
  options: UseAnimatedNumberOptions = {}
): number {
  const {
    duration = 800,
    easing = easings.easeOutCubic,
    delay = 0,
    decimals = 0,
    animateOnChange = true,
  } = options;

  const [currentValue, setCurrentValue] = useState(0);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(0);
  const previousTargetRef = useRef<number>(target);

  useEffect(() => {
    // Determine the starting value
    const fromValue = animateOnChange ? currentValue : 0;
    startValueRef.current = fromValue;
    previousTargetRef.current = target;

    // Cancel any existing animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    // Handle delay
    const timeoutId = setTimeout(() => {
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) {
          startTimeRef.current = timestamp;
        }

        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easing(progress);

        const newValue =
          startValueRef.current +
          (target - startValueRef.current) * easedProgress;

        // Apply decimal rounding
        const roundedValue =
          decimals > 0
            ? Math.round(newValue * Math.pow(10, decimals)) /
              Math.pow(10, decimals)
            : Math.round(newValue);

        setCurrentValue(roundedValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [target, duration, easing, delay, decimals, animateOnChange]);

  return currentValue;
}

/**
 * Hook variant that returns additional animation state
 */
export function useAnimatedNumberWithState(
  target: number,
  options: UseAnimatedNumberOptions = {}
): {
  value: number;
  isAnimating: boolean;
  progress: number;
} {
  const {
    duration = 800,
    easing = easings.easeOutCubic,
    delay = 0,
    decimals = 0,
    animateOnChange = true,
  } = options;

  const [state, setState] = useState({
    value: 0,
    isAnimating: false,
    progress: 0,
  });

  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(0);

  useEffect(() => {
    const fromValue = animateOnChange ? state.value : 0;
    startValueRef.current = fromValue;

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    const timeoutId = setTimeout(() => {
      startTimeRef.current = null;
      setState(prev => ({ ...prev, isAnimating: true }));

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) {
          startTimeRef.current = timestamp;
        }

        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easing(progress);

        const newValue =
          startValueRef.current +
          (target - startValueRef.current) * easedProgress;

        const roundedValue =
          decimals > 0
            ? Math.round(newValue * Math.pow(10, decimals)) /
              Math.pow(10, decimals)
            : Math.round(newValue);

        setState({
          value: roundedValue,
          isAnimating: progress < 1,
          progress,
        });

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [target, duration, easing, delay, decimals, animateOnChange]);

  return state;
}

export default useAnimatedNumber;
