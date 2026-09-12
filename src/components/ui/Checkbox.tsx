'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  className,
  id: providedId,
  'aria-describedby': ariaDescribedBy,
}: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = providedId || `checkbox-${generatedId}`;

  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        'flex items-center gap-3 cursor-pointer min-h-[44px] py-1 -mx-1 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 active:bg-gray-100 dark:active:bg-slate-600 transition-colors',
        className
      )}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 text-blue-600 border-gray-300 dark:border-slate-500 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 cursor-pointer"
        aria-describedby={ariaDescribedBy}
      />
      <span className="text-sm text-gray-700 dark:text-gray-300 select-none">{label}</span>
    </label>
  );
}
