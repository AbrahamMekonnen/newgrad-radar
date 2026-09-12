import { UserProfile } from '@/lib/types';

/**
 * Field importance levels determine scoring weight
 */
export type FieldImportance = 'critical' | 'required' | 'recommended' | 'optional';

/**
 * Validation severity for error display
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Individual field validation result
 */
export interface FieldValidation {
  field: keyof UserProfile;
  label: string;
  isValid: boolean;
  isEmpty: boolean;
  importance: FieldImportance;
  message: string | null;
  suggestion: string | null;
}

/**
 * Section grouping for UI display
 */
export interface SectionValidation {
  id: string;
  title: string;
  icon: string;
  fields: FieldValidation[];
  completeness: number; // 0-100
  hasErrors: boolean;
  hasWarnings: boolean;
}

/**
 * Complete profile validation result
 */
export interface ProfileValidationResult {
  isValid: boolean;
  completeness: number; // 0-100
  canAutoApply: boolean;
  canAutoSubmit: boolean;
  sections: SectionValidation[];
  blockers: FieldValidation[];
  warnings: FieldValidation[];
  suggestions: FieldValidation[];
  atsCompatibility: ATSCompatibility[];
}

/**
 * Per-ATS compatibility assessment
 */
export interface ATSCompatibility {
  ats: ATSType;
  name: string;
  compatible: boolean;
  completeness: number;
  missingFields: string[];
  warnings: string[];
}

export type ATSType = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'jobvite' | 'icims';
