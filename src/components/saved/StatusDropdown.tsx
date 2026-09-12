'use client';

import { useState, useRef, useEffect } from 'react';
import { JobStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StatusDropdownProps {
  value: JobStatus;
  onChange: (status: JobStatus) => void;
}

const ALL_STATUSES: JobStatus[] = ['saved', 'applied', 'in_review', 'interviewing', 'rejected', 'offer'];

export function StatusDropdown({ value, onChange }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium',
          STATUS_COLORS[value]
        )}
      >
        {STATUS_LABELS[value]}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-10">
          {ALL_STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => {
                onChange(status);
                setIsOpen(false);
              }}
              className={cn(
                'w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700',
                status === value && 'bg-gray-50 dark:bg-slate-700'
              )}
            >
              <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs', STATUS_COLORS[status])}>
                {STATUS_LABELS[status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
