'use client';

import React, { useMemo, useState } from 'react';
import { UserProfile } from '@/lib/types';
import { validateProfile } from '@/lib/profile-validator/validator';
import { cn } from '@/lib/utils';

interface ProfileSectionProgressProps {
  profile: UserProfile;
  onEditField?: (field: keyof UserProfile) => void;
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  user: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  mail: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  'file-text': (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  link: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  briefcase: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

export function ProfileSectionProgress({
  profile,
  onEditField,
}: ProfileSectionProgressProps) {
  const validation = useMemo(() => validateProfile(profile), [profile]);
  const [expandedSection, setExpandedSection] = useState<string | null>(
    // Auto-expand first incomplete section
    validation.sections.find(s => s.completeness < 100)?.id || null
  );

  return (
    <div className="space-y-2">
      {validation.sections.map((section) => {
        const isExpanded = expandedSection === section.id;
        const isComplete = section.completeness === 100;

        return (
          <div
            key={section.id}
            className={cn(
              'border rounded-lg overflow-hidden transition-colors',
              isComplete ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
            )}
          >
            {/* Section Header */}
            <button
              onClick={() => setExpandedSection(isExpanded ? null : section.id)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
            >
              {/* Icon */}
              <div className={cn(
                'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
                isComplete ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
              )}>
                {SECTION_ICONS[section.icon] || SECTION_ICONS.user}
              </div>

              {/* Title & Progress */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={cn(
                    'text-sm font-medium',
                    isComplete ? 'text-green-700' : 'text-gray-900'
                  )}>
                    {section.title}
                  </span>
                  <span className={cn(
                    'text-sm font-medium',
                    isComplete ? 'text-green-600' :
                    section.completeness >= 50 ? 'text-yellow-600' : 'text-red-600'
                  )}>
                    {section.completeness}%
                  </span>
                </div>
                {/* Mini progress bar */}
                <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      isComplete ? 'bg-green-500' :
                      section.completeness >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                    )}
                    style={{ width: `${section.completeness}%` }}
                  />
                </div>
              </div>

              {/* Expand/Collapse Chevron */}
              <svg
                className={cn(
                  'w-5 h-5 text-gray-400 transition-transform',
                  isExpanded ? 'rotate-180' : ''
                )}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="px-3 pb-3 border-t border-gray-100">
                <div className="pt-3 space-y-2">
                  {section.fields.map((field) => (
                    <button
                      key={field.field}
                      onClick={() => onEditField?.(field.field)}
                      className={cn(
                        'w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors',
                        field.isValid && !field.isEmpty
                          ? 'bg-green-50 hover:bg-green-100'
                          : field.isEmpty
                          ? 'bg-gray-50 hover:bg-gray-100'
                          : 'bg-red-50 hover:bg-red-100'
                      )}
                    >
                      {/* Status Icon */}
                      {field.isValid && !field.isEmpty ? (
                        <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : field.isEmpty ? (
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}

                      {/* Field Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-sm font-medium',
                            field.isValid && !field.isEmpty ? 'text-green-700' :
                            field.isEmpty ? 'text-gray-700' : 'text-red-700'
                          )}>
                            {field.label}
                          </span>
                          {field.importance === 'critical' && (
                            <span className="text-xs text-red-500">*</span>
                          )}
                          {field.importance === 'required' && (
                            <span className="text-xs text-orange-500">*</span>
                          )}
                        </div>
                        {field.message && (
                          <p className={cn(
                            'text-xs mt-0.5',
                            field.isValid ? 'text-gray-500' : 'text-red-500'
                          )}>
                            {field.message}
                          </p>
                        )}
                      </div>

                      {/* Edit Arrow */}
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
