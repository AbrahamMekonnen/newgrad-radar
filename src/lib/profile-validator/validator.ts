import { UserProfile } from '@/lib/types';
import {
  FieldValidation,
  SectionValidation,
  ProfileValidationResult,
  ATSCompatibility,
} from './types';
import {
  FieldConfig,
  FieldValidator,
  PROFILE_FIELD_SCHEMA,
  PROFILE_SECTIONS,
} from './schema';
import { ATS_REQUIREMENTS } from './ats-requirements';

/**
 * Validates a single field value
 */
function validateFieldValue(
  value: unknown,
  validators: FieldValidator[],
  profile: UserProfile
): { isValid: boolean; message: string | null } {
  for (const validator of validators) {
    switch (validator.type) {
      case 'required':
        if (value === null || value === undefined || value === '') {
          return { isValid: false, message: null }; // Empty, not invalid
        }
        break;

      case 'email': {
        if (!value) break;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(value))) {
          return { isValid: false, message: 'Invalid email format' };
        }
        break;
      }

      case 'phone': {
        if (!value) break;
        // Flexible phone validation - allows various formats
        const phoneRegex = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;
        const cleaned = String(value).replace(/[\s\-\(\)\.]/g, '');
        if (cleaned.length < 10 || !phoneRegex.test(String(value))) {
          return { isValid: false, message: 'Invalid phone format' };
        }
        break;
      }

      case 'url': {
        if (!value) break;
        try {
          const url = new URL(String(value));
          if (validator.allowedHosts?.length) {
            const host = url.hostname.replace(/^www\./, '');
            if (!validator.allowedHosts.some(h => h.replace(/^www\./, '') === host)) {
              return {
                isValid: false,
                message: `URL must be from: ${validator.allowedHosts.join(', ')}`,
              };
            }
          }
        } catch {
          return { isValid: false, message: 'Invalid URL format' };
        }
        break;
      }

      case 'minLength': {
        if (!value) break;
        if (String(value).trim().length < validator.length) {
          return {
            isValid: false,
            message: `Must be at least ${validator.length} characters`,
          };
        }
        break;
      }

      case 'pattern': {
        if (!value) break;
        if (!validator.pattern.test(String(value))) {
          return { isValid: false, message: validator.message };
        }
        break;
      }

      case 'custom': {
        if (!validator.validate(value, profile)) {
          return { isValid: false, message: validator.message };
        }
        break;
      }
    }
  }

  return { isValid: true, message: null };
}

/**
 * Checks if a field value is empty
 */
function isFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean') return false; // booleans are never "empty"
  return false;
}

/**
 * Validates a single field against its schema
 */
function validateField(
  profile: UserProfile,
  fieldConfig: FieldConfig
): FieldValidation {
  const value = profile[fieldConfig.field];
  const isEmpty = isFieldEmpty(value);

  // If empty, check if required
  if (isEmpty) {
    const isRequired = fieldConfig.validators.some(v => v.type === 'required');
    return {
      field: fieldConfig.field,
      label: fieldConfig.label,
      isValid: !isRequired,
      isEmpty: true,
      importance: fieldConfig.importance,
      message: fieldConfig.emptyMessage,
      suggestion: fieldConfig.suggestion,
    };
  }

  // Validate non-empty value
  const validation = validateFieldValue(value, fieldConfig.validators, profile);

  return {
    field: fieldConfig.field,
    label: fieldConfig.label,
    isValid: validation.isValid,
    isEmpty: false,
    importance: fieldConfig.importance,
    message: validation.isValid ? null : (validation.message || fieldConfig.invalidMessage || null),
    suggestion: validation.isValid ? null : fieldConfig.suggestion,
  };
}

/**
 * Calculates weighted completeness score
 */
function calculateCompleteness(
  fields: FieldValidation[],
  schema: FieldConfig[]
): number {
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const fieldConfig of schema) {
    const fieldValidation = fields.find(f => f.field === fieldConfig.field);
    if (!fieldValidation) continue;

    totalWeight += fieldConfig.weight;

    if (fieldValidation.isValid && !fieldValidation.isEmpty) {
      earnedWeight += fieldConfig.weight;
    } else if (fieldValidation.isValid && fieldValidation.isEmpty) {
      // Optional empty fields don't count against you
      if (fieldConfig.importance === 'optional') {
        totalWeight -= fieldConfig.weight;
      }
    }
  }

  if (totalWeight === 0) return 100;
  return Math.round((earnedWeight / totalWeight) * 100);
}

/**
 * Groups fields by section for UI display
 */
function groupBySection(
  fields: FieldValidation[],
  schema: FieldConfig[]
): SectionValidation[] {
  const sections: SectionValidation[] = [];
  const sectionFields: Record<string, FieldValidation[]> = {};

  // Group fields by section
  for (const fieldConfig of schema) {
    const fieldValidation = fields.find(f => f.field === fieldConfig.field);
    if (!fieldValidation) continue;

    const sectionId = fieldConfig.section;
    if (!sectionFields[sectionId]) {
      sectionFields[sectionId] = [];
    }
    sectionFields[sectionId].push(fieldValidation);
  }

  // Build section validations
  for (const [sectionId, sectionFieldList] of Object.entries(sectionFields)) {
    const sectionMeta = PROFILE_SECTIONS[sectionId as keyof typeof PROFILE_SECTIONS];
    const sectionSchema = schema.filter(f => f.section === sectionId);

    sections.push({
      id: sectionId,
      title: sectionMeta.title,
      icon: sectionMeta.icon,
      fields: sectionFieldList,
      completeness: calculateCompleteness(sectionFieldList, sectionSchema),
      hasErrors: sectionFieldList.some(f => !f.isValid && (
        schema.find(s => s.field === f.field)?.importance === 'critical' ||
        schema.find(s => s.field === f.field)?.importance === 'required'
      )),
      hasWarnings: sectionFieldList.some(f => f.isEmpty &&
        schema.find(s => s.field === f.field)?.importance === 'recommended'
      ),
    });
  }

  // Sort sections by completeness (lowest first) for priority
  return sections.sort((a, b) => a.completeness - b.completeness);
}

/**
 * Checks ATS-specific compatibility
 */
function checkATSCompatibility(
  fields: FieldValidation[],
  profile: UserProfile
): ATSCompatibility[] {
  const results: ATSCompatibility[] = [];

  for (const [atsType, requirements] of Object.entries(ATS_REQUIREMENTS)) {
    const missingFields: string[] = [];
    const warnings: string[] = [];

    // Check required fields for this ATS
    for (const requiredField of requirements.requiredFields) {
      const fieldValidation = fields.find(f => f.field === requiredField.field);
      if (!fieldValidation || fieldValidation.isEmpty || !fieldValidation.isValid) {
        missingFields.push(requiredField.label);
      }
    }

    // Check recommended fields
    for (const recommendedField of requirements.recommendedFields) {
      const fieldValidation = fields.find(f => f.field === recommendedField.field);
      if (!fieldValidation || fieldValidation.isEmpty) {
        warnings.push(`${recommendedField.label} is commonly requested`);
      }
    }

    // Check ATS-specific quirks
    for (const quirk of requirements.quirks) {
      const quirkResult = quirk.check(profile);
      if (!quirkResult.passed) {
        if (quirk.severity === 'error') {
          missingFields.push(quirkResult.message);
        } else {
          warnings.push(quirkResult.message);
        }
      }
    }

    const requiredCount = requirements.requiredFields.length;
    const filledCount = requiredCount - missingFields.length;
    const completeness = requiredCount > 0
      ? Math.round((filledCount / requiredCount) * 100)
      : 100;

    results.push({
      ats: atsType as ATSCompatibility['ats'],
      name: requirements.name,
      compatible: missingFields.length === 0,
      completeness,
      missingFields,
      warnings,
    });
  }

  return results.sort((a, b) => b.completeness - a.completeness);
}

/**
 * Main validation function - validates entire profile
 */
export function validateProfile(profile: UserProfile): ProfileValidationResult {
  // Validate all fields
  const fieldValidations = PROFILE_FIELD_SCHEMA.map(config =>
    validateField(profile, config)
  );

  // Calculate overall completeness
  const completeness = calculateCompleteness(fieldValidations, PROFILE_FIELD_SCHEMA);

  // Group by section
  const sections = groupBySection(fieldValidations, PROFILE_FIELD_SCHEMA);

  // Identify blockers (critical/required fields that are invalid or empty)
  const blockers = fieldValidations.filter(f => {
    const config = PROFILE_FIELD_SCHEMA.find(c => c.field === f.field);
    if (!config) return false;
    return (config.importance === 'critical' || config.importance === 'required') &&
           (!f.isValid || f.isEmpty);
  });

  // Identify warnings (recommended fields that are empty)
  const warnings = fieldValidations.filter(f => {
    const config = PROFILE_FIELD_SCHEMA.find(c => c.field === f.field);
    if (!config) return false;
    return config.importance === 'recommended' && f.isEmpty;
  });

  // Identify suggestions (optional fields)
  const suggestions = fieldValidations.filter(f => {
    const config = PROFILE_FIELD_SCHEMA.find(c => c.field === f.field);
    if (!config) return false;
    return config.importance === 'optional' && f.isEmpty;
  });

  // Check ATS compatibility
  const atsCompatibility = checkATSCompatibility(fieldValidations, profile);

  // Determine if auto-apply/auto-submit are safe
  const criticalComplete = fieldValidations
    .filter(f => PROFILE_FIELD_SCHEMA.find(c => c.field === f.field)?.importance === 'critical')
    .every(f => f.isValid && !f.isEmpty);

  const requiredComplete = fieldValidations
    .filter(f => {
      const config = PROFILE_FIELD_SCHEMA.find(c => c.field === f.field);
      return config?.importance === 'critical' || config?.importance === 'required';
    })
    .every(f => f.isValid && !f.isEmpty);

  return {
    isValid: blockers.length === 0,
    completeness,
    canAutoApply: criticalComplete,
    canAutoSubmit: requiredComplete && completeness >= 80,
    sections,
    blockers,
    warnings,
    suggestions,
    atsCompatibility,
  };
}

/**
 * Quick check for minimum auto-apply requirements
 */
export function canAutoApply(profile: UserProfile): boolean {
  return validateProfile(profile).canAutoApply;
}

/**
 * Quick check for auto-submit safety
 */
export function canAutoSubmit(profile: UserProfile): boolean {
  return validateProfile(profile).canAutoSubmit;
}

/**
 * Get completeness score (0-100)
 */
export function getCompletenessScore(profile: UserProfile): number {
  return validateProfile(profile).completeness;
}

/**
 * Get human-readable completeness description
 */
export function getCompletenessLabel(completeness: number): {
  label: string;
  color: string;
  description: string;
} {
  if (completeness >= 95) {
    return {
      label: 'Excellent',
      color: 'text-green-600',
      description: 'Your profile is fully complete and ready for auto-submit',
    };
  }
  if (completeness >= 80) {
    return {
      label: 'Good',
      color: 'text-green-500',
      description: 'Ready for most applications. Consider adding optional fields.',
    };
  }
  if (completeness >= 60) {
    return {
      label: 'Fair',
      color: 'text-yellow-500',
      description: 'Can auto-apply but some fields are missing',
    };
  }
  if (completeness >= 40) {
    return {
      label: 'Incomplete',
      color: 'text-orange-500',
      description: 'Please fill in required fields before auto-applying',
    };
  }
  return {
    label: 'Minimal',
    color: 'text-red-500',
    description: 'Profile needs significant completion before use',
  };
}
