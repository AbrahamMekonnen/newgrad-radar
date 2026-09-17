/**
 * Custom React hooks for performance optimization
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Debounce a value - returns the value only after it has stopped changing for delay ms
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced version of the callback
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const callbackRef = useRef<T>(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  ) as T;

  return debouncedCallback;
}

/**
 * Throttle a callback - ensure it runs at most once per delay ms
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const lastRunRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef<T>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastRun = now - lastRunRef.current;

      if (timeSinceLastRun >= delay) {
        lastRunRef.current = now;
        callbackRef.current(...args);
      } else {
        // Schedule for remaining time
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastRunRef.current = Date.now();
          callbackRef.current(...args);
        }, delay - timeSinceLastRun);
      }
    },
    [delay]
  ) as T;

  return throttledCallback;
}

/**
 * Batch state updates to reduce re-renders
 * Returns [state, batchedSetter, flush] where batchedSetter collects updates and applies them together
 */
export function useBatchedState<T extends object>(
  initialState: T,
  batchDelay: number = 16 // ~1 frame at 60fps
): [T, (updates: Partial<T>) => void, () => T] {
  const [state, setState] = useState<T>(initialState);
  const stateRef = useRef<T>(initialState);
  const pendingUpdates = useRef<Partial<T>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushUpdates = useCallback((): T => {
    if (Object.keys(pendingUpdates.current).length > 0) {
      const next = { ...stateRef.current, ...pendingUpdates.current };
      stateRef.current = next;
      setState(next);
      pendingUpdates.current = {};
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    return stateRef.current;
  }, []);

  const batchedSetter = useCallback(
    (updates: Partial<T>) => {
      pendingUpdates.current = { ...pendingUpdates.current, ...updates };

      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(flushUpdates, batchDelay);
      }
    },
    [batchDelay, flushUpdates]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [state, batchedSetter, flushUpdates];
}

/**
 * Memoize a value with custom comparison
 */
export function useDeepMemo<T>(value: T, compare: (a: T, b: T) => boolean): T {
  const ref = useRef<T>(value);

  if (!compare(ref.current, value)) {
    ref.current = value;
  }

  return ref.current;
}

/**
 * Track component render count for debugging
 */
export function useRenderCount(componentName: string): number {
  const count = useRef(0);
  count.current++;

  useEffect(() => {
    console.log(`[Render] ${componentName}: ${count.current}`);
  });

  return count.current;
}

/**
 * Measure component render time
 */
export function useRenderTime(componentName: string): void {
  const startTime = useRef(performance.now());

  useEffect(() => {
    const duration = performance.now() - startTime.current;
    if (duration > 16) {
      // Warn if render takes more than 1 frame
      console.warn(`[Slow Render] ${componentName}: ${duration.toFixed(2)}ms`);
    }
    startTime.current = performance.now();
  });
}

/**
 * Cache async results with expiration
 */
export function useAsyncCache<K extends string, V>(
  fetcher: (key: K) => Promise<V>,
  ttlMs: number = 5 * 60 * 1000 // 5 minutes default
): {
  get: (key: K) => Promise<V>;
  invalidate: (key: K) => void;
  clear: () => void;
} {
  const cache = useRef<Map<K, { value: V; expiresAt: number }>>(new Map());
  const pending = useRef<Map<K, Promise<V>>>(new Map());

  const get = useCallback(
    async (key: K): Promise<V> => {
      const now = Date.now();
      const cached = cache.current.get(key);

      if (cached && cached.expiresAt > now) {
        return cached.value;
      }

      // Check if there's a pending request
      const pendingRequest = pending.current.get(key);
      if (pendingRequest) {
        return pendingRequest;
      }

      // Fetch and cache
      const promise = fetcher(key).then(value => {
        cache.current.set(key, { value, expiresAt: now + ttlMs });
        pending.current.delete(key);
        return value;
      });

      pending.current.set(key, promise);
      return promise;
    },
    [fetcher, ttlMs]
  );

  const invalidate = useCallback((key: K) => {
    cache.current.delete(key);
  }, []);

  const clear = useCallback(() => {
    cache.current.clear();
  }, []);

  return useMemo(() => ({ get, invalidate, clear }), [get, invalidate, clear]);
}
