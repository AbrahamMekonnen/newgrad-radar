import { UserProfile, Job } from '@/lib/types';
import { validateProfile } from './validator';
import { getATSRequirements, meetsATSRequirements } from './ats-requirements';
import { ATSType } from './types';

export interface PreApplyCheckResult {
  canProceed: boolean;
  atsType: ATSType | null;
  profileReady: boolean;
  atsCompatible: boolean;
  blockers: string[];
  warnings: string[];
  estimatedFillRate: number; // 0-100, how many fields we can auto-fill
}

/**
 * Check if a profile is ready to auto-apply to a specific job
 */
export function checkPreApply(
  profile: UserProfile,
  job: Job,
  atsType: ATSType | null
): PreApplyCheckResult {
  const validation = validateProfile(profile);
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check profile completeness
  const profileReady = validation.canAutoApply;
  if (!profileReady) {
    for (const blocker of validation.blockers) {
      blockers.push(`Missing: ${blocker.label}`);
    }
  }

  // Check ATS compatibility
  let atsCompatible = true;
  if (atsType) {
    atsCompatible = meetsATSRequirements(profile, atsType);
    if (!atsCompatible) {
      const atsReq = getATSRequirements(atsType);
      for (const field of atsReq.requiredFields) {
        const value = profile[field.field];
        if (!value) {
          blockers.push(`${atsReq.name} requires: ${field.label}`);
        }
      }
    }

    // Add ATS-specific warnings
    const atsStatus = validation.atsCompatibility.find(a => a.ats === atsType);
    if (atsStatus) {
      warnings.push(...atsStatus.warnings);
    }
  }

  // Estimate fill rate based on profile completeness
  const estimatedFillRate = Math.min(validation.completeness, 95);

  return {
    canProceed: profileReady && atsCompatible,
    atsType,
    profileReady,
    atsCompatible,
    blockers,
    warnings,
    estimatedFillRate,
  };
}

/**
 * Quick check if profile can apply to a job with a specific ATS
 */
export function canApplyToJob(
  profile: UserProfile,
  atsType: ATSType | null
): boolean {
  if (!atsType) {
    return validateProfile(profile).canAutoApply;
  }
  return meetsATSRequirements(profile, atsType);
}

/**
 * Get a summary of what's missing for a specific ATS
 */
export function getATSGaps(
  profile: UserProfile,
  atsType: ATSType
): { field: keyof UserProfile; label: string }[] {
  const requirements = getATSRequirements(atsType);
  const gaps: { field: keyof UserProfile; label: string }[] = [];

  for (const field of requirements.requiredFields) {
    const value = profile[field.field];
    if (value === null || value === undefined || value === '') {
      gaps.push({ field: field.field, label: field.label });
    }
  }

  return gaps;
}
