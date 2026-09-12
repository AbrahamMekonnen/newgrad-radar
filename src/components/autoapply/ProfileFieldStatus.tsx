'use client';

import { cn } from '@/lib/utils';

interface ProfileFieldStatusProps {
  isValid: boolean;
  isEmpty: boolean;
  importance: 'critical' | 'required' | 'recommended' | 'optional';
  message?: string | null;
  suggestion?: string | null;
  showTooltip?: boolean;
}

export function ProfileFieldStatus({
  isValid,
  isEmpty,
  importance,
  message,
  suggestion,
  showTooltip = true,
}: ProfileFieldStatusProps) {
  if (isValid && !isEmpty) {
    return (
      <div className="flex items-center gap-1 text-green-500">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </div>
    );
  }

  if (isEmpty && (importance === 'optional' || importance === 'recommended')) {
    return (
      <div className="group relative flex items-center gap-1 text-gray-400">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
        {showTooltip && suggestion && (
          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
            <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
              {suggestion}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Error state
  return (
    <div className="group relative flex items-center gap-1 text-red-500">
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      {showTooltip && (message || suggestion) && (
        <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
          <div className="bg-red-800 text-white text-xs rounded px-2 py-1 max-w-xs">
            {message || suggestion}
          </div>
        </div>
      )}
    </div>
  );
}
