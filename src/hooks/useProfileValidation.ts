import { useMemo, useCallback } from 'react';
import { UserProfile } from '@/lib/types';
import {
  validateProfile,
  canAutoApply,
  canAutoSubmit,
  getCompletenessScore,
} from '@/lib/profile-validator/validator';
import { ATSType, FieldValidation } from '@/lib/profile-validator/types';

/**
 * Hook for real-time profile validation
 *
 * Provides computed validation state and helper functions for
 * checking profile completeness and ATS compatibility.
 *
 * @example
 * ```tsx
 * const { validation, isAutoApplyReady, getFieldValidation } = useProfileValidation(profile);
 *
 * if (!isAutoApplyReady) {
 *   console.log('Missing fields:', validation.blockers.map(b => b.label));
 * }
 * ```
 */
export function useProfileValidation(profile: UserProfile) {
  // Main validation result - memoized for performance
  const validation = useMemo(() => validateProfile(profile), [profile]);

  // Quick boolean checks
  const isAutoApplyReady = useMemo(() => canAutoApply(profile), [profile]);
  const isAutoSubmitSafe = useMemo(() => canAutoSubmit(profile), [profile]);
  const completenessScore = useMemo(() => getCompletenessScore(profile), [profile]);

  /**
   * Get validation state for a specific field
   */
  const getFieldValidation = useCallback(
    (field: keyof UserProfile): FieldValidation | null => {
      for (const section of validation.sections) {
        const fieldValidation = section.fields.find(f => f.field === field);
        if (fieldValidation) return fieldValidation;
      }
      return null;
    },
    [validation]
  );

  /**
   * Get ATS compatibility status for a specific ATS
   */
  const getATSStatus = useCallback(
    (ats: ATSType) => {
      return validation.atsCompatibility.find(a => a.ats === ats) || null;
    },
    [validation]
  );

  /**
   * Check if profile is compatible with a specific ATS
   */
  const isATSCompatible = useCallback(
    (ats: ATSType): boolean => {
      const status = getATSStatus(ats);
      return status?.compatible ?? false;
    },
    [getATSStatus]
  );

  /**
   * Get list of fields that need attention (blockers + warnings)
   */
  const fieldsNeedingAttention = useMemo(() => {
    return [...validation.blockers, ...validation.warnings];
  }, [validation]);

  /**
   * Get the next most important field to fill
   */
  const nextFieldToFill = useMemo(() => {
    // Priority: critical blockers > required blockers > recommended
    if (validation.blockers.length > 0) {
      const critical = validation.blockers.find(b => b.importance === 'critical');
      if (critical) return critical;
      return validation.blockers[0];
    }
    if (validation.warnings.length > 0) {
      return validation.warnings[0];
    }
    return null;
  }, [validation]);

  return {
    // Full validation result
    validation,

    // Quick status checks
    completeness: validation.completeness,
    completenessScore,
    isAutoApplyReady,
    isAutoSubmitSafe,
    isValid: validation.isValid,

    // Field arrays
    blockers: validation.blockers,
    warnings: validation.warnings,
    suggestions: validation.suggestions,
    sections: validation.sections,
    atsCompatibility: validation.atsCompatibility,

    // Helper functions
    getFieldValidation,
    getATSStatus,
    isATSCompatible,

    // Computed helpers
    fieldsNeedingAttention,
    nextFieldToFill,
    hasBlockers: validation.blockers.length > 0,
    hasWarnings: validation.warnings.length > 0,
  };
}

/**
 * Simplified hook that just returns completeness percentage
 */
export function useProfileCompleteness(profile: UserProfile): number {
  return useMemo(() => getCompletenessScore(profile), [profile]);
}

/**
 * Simplified hook that just checks if auto-apply is ready
 */
export function useCanAutoApply(profile: UserProfile): boolean {
  return useMemo(() => canAutoApply(profile), [profile]);
}
