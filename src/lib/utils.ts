export function formatTimeAgo(date: string | null): string {
  if (!date) return 'Unknown';

  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return past.toLocaleDateString();
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Debounce function - delays execution until after wait ms have elapsed since last call
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Throttle function - ensures function is called at most once per wait ms
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - lastTime);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastTime = now;
      func(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        func(...args);
      }, remaining);
    }
  };
}

/**
 * Batch operations together for parallel execution
 * Collects operations over debounce period then executes all at once
 */
export function batchOperations<T, R>(
  executor: (items: T[]) => Promise<R[]>,
  debounceMs: number = 50
): (item: T) => Promise<R> {
  let batch: { item: T; resolve: (result: R) => void; reject: (error: Error) => void }[] = [];
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    const currentBatch = batch;
    batch = [];
    timeoutId = null;

    if (currentBatch.length === 0) return;

    try {
      const items = currentBatch.map(b => b.item);
      const results = await executor(items);

      currentBatch.forEach((b, i) => {
        if (results[i] !== undefined) {
          b.resolve(results[i]);
        } else {
          b.reject(new Error('No result returned for batch item'));
        }
      });
    } catch (error) {
      currentBatch.forEach(b => b.reject(error as Error));
    }
  };

  return (item: T): Promise<R> => {
    return new Promise((resolve, reject) => {
      batch.push({ item, resolve, reject });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(flush, debounceMs);
    });
  };
}
