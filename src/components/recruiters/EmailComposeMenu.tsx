'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface EmailComposeMenuProps {
  /** Recipient addresses. Deduped + capped internally. */
  emails: string[];
  subject: string;
  body: string;
  /** Button label, e.g. "Email all 16" or "Email all versions". */
  label: string;
  /** 'primary' = filled indigo button; 'subtle' = small link-style button. */
  variant?: 'primary' | 'subtle';
  className?: string;
}

/**
 * A dropdown that composes one email to many recipients across the mail client
 * the user actually has. A bare mailto: is unreliable on desktop (no registered
 * handler -> OS app-chooser -> dead end), so we offer Gmail/Outlook WEB compose
 * (open a pre-filled draft right in the browser) plus mailto and copy fallbacks.
 */
export function EmailComposeMenu({
  emails,
  subject,
  body,
  label,
  variant = 'primary',
  className,
}: EmailComposeMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const to = Array.from(new Set(emails.map((e) => (e || '').trim()).filter(Boolean))).slice(0, 25);
  if (to.length === 0) return null;

  const eTo = encodeURIComponent(to.join(','));
  const eSub = encodeURIComponent(subject);
  const eBody = encodeURIComponent(body);
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${eTo}&su=${eSub}&body=${eBody}`;
  const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${eTo}&subject=${eSub}&body=${eBody}`;
  const mailto = `mailto:${to.join(',')}?subject=${eSub}&body=${eBody}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(to.join(', '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  const trigger =
    variant === 'primary'
      ? 'inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors'
      : 'inline-flex items-center gap-1.5 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors';

  return (
    <div className={cn('relative', className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={trigger}>
        <svg className={variant === 'primary' ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75l9.75 6.75 9.75-6.75M3.75 5.25h16.5a1.5 1.5 0 011.5 1.5v10.5a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5z" />
        </svg>
        {label}
        <svg className="w-3.5 h-3.5 opacity-80" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
            <a href={gmail} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700">
              Open in Gmail
            </a>
            <a href={outlook} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700">
              Open in Outlook
            </a>
            <a href={mailto} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700">
              Default mail app
            </a>
            <button type="button" onClick={() => { copy(); setOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700">
              {copied ? 'Copied!' : 'Copy address' + (to.length > 1 ? 'es' : '')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
