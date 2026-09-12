'use client';

import { useMemo } from 'react';
import { UserProfile } from '@/lib/types';
import { validateProfile, getCompletenessLabel } from '@/lib/profile-validator/validator';
import { cn } from '@/lib/utils';

interface ProfileCompletenessProps {
  profile: UserProfile;
  className?: string;
  showDetails?: boolean;
  onEditField?: (field: keyof UserProfile) => void;
}

export function ProfileCompleteness({
  profile,
  className,
  showDetails = true,
  onEditField,
}: ProfileCompletenessProps) {
  const validation = useMemo(() => validateProfile(profile), [profile]);
  const completenessInfo = useMemo(
    () => getCompletenessLabel(validation.completeness),
    [validation.completeness]
  );

  return (
    <div className={cn('bg-white rounded-lg border border-gray-200 p-4', className)}>
      {/* Header with Score */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Profile Completeness</h3>
          <p className={cn('text-xs', completenessInfo.color)}>
            {completenessInfo.description}
          </p>
        </div>
        <div className="text-right">
          <div className={cn('text-2xl font-bold', completenessInfo.color)}>
            {validation.completeness}%
          </div>
          <div className={cn('text-xs font-medium', completenessInfo.color)}>
            {completenessInfo.label}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            validation.completeness >= 80 ? 'bg-green-500' :
            validation.completeness >= 60 ? 'bg-yellow-500' :
            validation.completeness >= 40 ? 'bg-orange-500' : 'bg-red-500'
          )}
          style={{ width: `${validation.completeness}%` }}
        />
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {validation.canAutoApply ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Can Auto-Apply
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Cannot Auto-Apply
          </span>
        )}

        {validation.canAutoSubmit && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
            </svg>
            Safe for Auto-Submit
          </span>
        )}
      </div>

      {/* Blockers */}
      {validation.blockers.length > 0 && showDetails && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">
            Required ({validation.blockers.length})
          </h4>
          <div className="space-y-2">
            {validation.blockers.map((blocker) => (
              <button
                key={blocker.field}
                onClick={() => onEditField?.(blocker.field)}
                className="w-full flex items-start gap-2 p-2 text-left bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
              >
                <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-800">{blocker.label}</p>
                  <p className="text-xs text-red-600">{blocker.message}</p>
                </div>
                <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && showDetails && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">
            Recommended ({validation.warnings.length})
          </h4>
          <div className="space-y-2">
            {validation.warnings.slice(0, 3).map((warning) => (
              <button
                key={warning.field}
                onClick={() => onEditField?.(warning.field)}
                className="w-full flex items-start gap-2 p-2 text-left bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors"
              >
                <svg className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-yellow-800">{warning.label}</p>
                  <p className="text-xs text-yellow-600">{warning.message}</p>
                </div>
                <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
            {validation.warnings.length > 3 && (
              <p className="text-xs text-yellow-600 text-center">
                +{validation.warnings.length - 3} more recommendations
              </p>
            )}
          </div>
        </div>
      )}

      {/* ATS Compatibility */}
      {showDetails && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            ATS Compatibility
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {validation.atsCompatibility.slice(0, 6).map((ats) => (
              <div
                key={ats.ats}
                className={cn(
                  'p-2 rounded text-center',
                  ats.compatible ? 'bg-green-50' : 'bg-gray-50'
                )}
              >
                <div className={cn(
                  'text-xs font-medium',
                  ats.compatible ? 'text-green-700' : 'text-gray-500'
                )}>
                  {ats.name}
                </div>
                <div className={cn(
                  'text-lg font-bold',
                  ats.compatible ? 'text-green-600' : 'text-gray-400'
                )}>
                  {ats.completeness}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
