'use client';

import { useMemo, useState } from 'react';
import { UserProfile } from '@/lib/types';
import { validateProfile } from '@/lib/profile-validator/validator';

interface ProfileGapsAlertProps {
  profile: UserProfile;
  onComplete?: () => void;
  dismissible?: boolean;
}

export function ProfileGapsAlert({
  profile,
  onComplete,
  dismissible = true,
}: ProfileGapsAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const validation = useMemo(() => validateProfile(profile), [profile]);

  // Don't show if no blockers or dismissed
  if (validation.blockers.length === 0 || dismissed) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-800">
            Complete your profile to enable auto-apply
          </h3>
          <p className="mt-1 text-sm text-amber-700">
            {validation.blockers.length === 1
              ? '1 required field is missing'
              : `${validation.blockers.length} required fields are missing`}
          </p>

          {/* Missing fields list */}
          <div className="mt-2 flex flex-wrap gap-2">
            {validation.blockers.map((blocker) => (
              <span
                key={blocker.field}
                className="inline-flex items-center px-2 py-1 rounded bg-amber-100 text-xs font-medium text-amber-800"
              >
                {blocker.label}
              </span>
            ))}
          </div>

          {/* Action button */}
          <button
            onClick={onComplete}
            className="mt-3 inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
          >
            Complete Profile
            <svg className="ml-1.5 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>

        {/* Dismiss button */}
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
