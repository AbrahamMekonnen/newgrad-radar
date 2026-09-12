/**
 * EEO (Equal Employment Opportunity) field handling utilities
 *
 * Handles voluntary self-identification questions for:
 * - Gender identity
 * - Race/ethnicity
 * - Veteran status
 * - Disability status
 * - LGBTQ+ identification (less common)
 *
 * Privacy-first design: defaults to "decline" for all questions
 */

import fields from './fields.js';
import config from '../config.js';

/**
 * Label patterns for detecting EEO question types
 */
const EEO_PATTERNS = {
  gender: [
    'gender',
    'gender identity',
    'what is your gender',
    'sex',
    'how do you identify',
  ],
  race: [
    'race',
    'ethnicity',
    'race/ethnicity',
    'racial background',
    'ethnic background',
    'please identify your race',
  ],
  hispanic: [
    'hispanic',
    'latino',
    'latina',
    'latinx',
    'of hispanic or latino origin',
    'are you hispanic',
  ],
  veteran: [
    'veteran',
    'veteran status',
    'protected veteran',
    'military',
    'served in the military',
    'armed forces',
    'military service',
  ],
  disability: [
    'disability',
    'disabled',
    'voluntary self-identification of disability',
    'cc-305',
    'do you have a disability',
  ],
  lgbtq: [
    'sexual orientation',
    'lgbtq',
    'lgbt',
    'lgbtqia',
  ],
};

/**
 * Section header patterns that indicate EEO section
 */
const EEO_SECTION_PATTERNS = [
  'voluntary self-identification',
  'equal employment opportunity',
  'demographic information',
  'eeoc',
  'ofccp',
  'diversity',
  'u.s. equal opportunity',
];

/**
 * Value mappings per ATS platform
 */
const VALUE_MAPPINGS = {
  gender: {
    decline: {
      greenhouse: 'Decline to self-identify',
      lever: 'I do not wish to answer',
      workday: 'Prefer not to say',
      ashby: 'Decline',
      jobvite: 'Decline to Self Identify',
      default: 'Decline to self-identify',
    },
    male: {
      greenhouse: 'Male',
      lever: 'Male',
      workday: 'Male',
      ashby: 'Man',
      jobvite: 'Male',
      default: 'Male',
    },
    female: {
      greenhouse: 'Female',
      lever: 'Female',
      workday: 'Female',
      ashby: 'Woman',
      jobvite: 'Female',
      default: 'Female',
    },
    'non-binary': {
      greenhouse: 'Non-binary',
      lever: 'Non-binary',
      workday: 'Non-binary',
      ashby: 'Non-binary',
      jobvite: 'Non-Binary',
      default: 'Non-binary',
    },
  },
  race: {
    decline: {
      default: 'Decline to self-identify',
    },
    'asian': {
      default: 'Asian',
      workday: 'Asian (Not Hispanic or Latino)',
    },
    'black': {
      default: 'Black or African American',
      workday: 'Black or African American (Not Hispanic or Latino)',
    },
    'white': {
      default: 'White',
      workday: 'White (Not Hispanic or Latino)',
    },
    'hispanic': {
      default: 'Hispanic or Latino',
    },
    'native-american': {
      default: 'American Indian or Alaska Native',
    },
    'pacific-islander': {
      default: 'Native Hawaiian or Other Pacific Islander',
    },
    'two-or-more': {
      default: 'Two or More Races',
    },
  },
  veteran: {
    no: {
      greenhouse: 'I am not a protected veteran',
      lever: 'No',
      workday: 'I am not a protected veteran',
      default: 'I am not a protected veteran',
    },
    'yes-protected': {
      greenhouse: 'I identify as one or more of the classifications of protected veteran',
      lever: 'Yes',
      workday: 'I identify as one or more of the classifications of protected veteran',
      default: 'Yes',
    },
    decline: {
      greenhouse: 'I am a protected veteran, but choose not to self-identify the classifications',
      lever: 'Prefer not to answer',
      workday: 'Prefer not to say',
      default: 'Prefer not to answer',
    },
  },
  disability: {
    yes: {
      default: 'Yes, I have a disability, or have had one in the past',
    },
    no: {
      default: 'No, I do not have a disability',
    },
    decline: {
      default: 'I do not wish to answer',
    },
  },
  lgbtq: {
    decline: {
      default: 'Prefer not to answer',
    },
  },
};

/**
 * Get the ATS-specific value for an EEO answer
 * @param {string} fieldType - Type of EEO field (gender, race, etc.)
 * @param {string} userValue - User's configured value
 * @param {string} ats - ATS platform name
 * @returns {string} - ATS-specific value string
 */
export function getATSValue(fieldType, userValue, ats = 'default') {
  const fieldMappings = VALUE_MAPPINGS[fieldType];
  if (!fieldMappings) {
    console.log(`[eeo] Unknown field type: ${fieldType}`);
    return userValue;
  }

  const normalizedValue = normalizeUserValue(userValue);
  const valueMappings = fieldMappings[normalizedValue];

  if (!valueMappings) {
    // Try decline as fallback
    return fieldMappings.decline?.[ats] || fieldMappings.decline?.default || userValue;
  }

  return valueMappings[ats] || valueMappings.default || userValue;
}

/**
 * Normalize user input value to internal format
 * @param {string} value - User's value
 * @returns {string} - Normalized value
 */
function normalizeUserValue(value) {
  if (!value) return 'decline';

  const normalized = value.toLowerCase().trim();

  // Handle common decline variations
  if (normalized.includes('decline') ||
      normalized.includes('prefer not') ||
      normalized.includes('do not wish')) {
    return 'decline';
  }

  return normalized;
}

/**
 * Detect EEO field type from label text
 * @param {string} labelText - Label text to analyze
 * @returns {string|null} - EEO field type or null
 */
export function detectEEOFieldType(labelText) {
  const lowerLabel = labelText.toLowerCase();

  for (const [fieldType, patterns] of Object.entries(EEO_PATTERNS)) {
    if (patterns.some(pattern => lowerLabel.includes(pattern))) {
      return fieldType;
    }
  }

  return null;
}

/**
 * Check if page contains an EEO section
 * @param {Page} page - Playwright page
 * @returns {Promise<boolean>} - Whether EEO section exists
 */
export async function hasEEOSection(page) {
  try {
    const pageText = await page.textContent('body');
    const lowerText = pageText.toLowerCase();

    return EEO_SECTION_PATTERNS.some(pattern => lowerText.includes(pattern));
  } catch {
    return false;
  }
}

/**
 * Fill all EEO questions on the page
 * @param {Page} page - Playwright page
 * @param {Object} profile - User profile with eeo settings
 * @param {string} ats - ATS platform name (for value mapping)
 * @returns {Promise<Object>} - Fill results
 */
export async function fillEEOQuestions(page, profile, ats = 'default') {
  const results = {
    filled: 0,
    skipped: 0,
    errors: [],
  };

  // Check if EEO is enabled
  const eeoConfig = profile.eeo;
  if (!eeoConfig || eeoConfig.enabled === false) {
    console.log('[eeo] EEO filling disabled');
    return results;
  }

  // Check if page has EEO section
  const hasEEO = await hasEEOSection(page);
  if (!hasEEO) {
    console.log('[eeo] No EEO section detected on page');
    return results;
  }

  console.log('[eeo] EEO section detected, filling questions...');

  // Get default behavior
  const defaultBehavior = eeoConfig.defaultBehavior || 'decline';
  const answers = eeoConfig.answers || {};

  // Find all labels on the page
  const labels = await page.locator('label:visible').all();

  for (const label of labels) {
    try {
      const labelText = await label.textContent();
      if (!labelText) continue;

      const fieldType = detectEEOFieldType(labelText);
      if (!fieldType) continue;

      // Determine answer value
      let userValue;
      if (typeof answers === 'object' && answers[fieldType]) {
        // Use specific answer if provided
        userValue = typeof answers[fieldType] === 'object'
          ? answers[fieldType].value
          : answers[fieldType];
      } else if (defaultBehavior === 'decline') {
        userValue = 'decline';
      } else {
        // Skip if no answer configured and not defaulting to decline
        results.skipped++;
        continue;
      }

      // Get ATS-specific value
      const atsValue = getATSValue(fieldType, userValue, ats);

      // Try to fill the field
      const filled = await fields.selectByLabel(page, labelText.trim(), atsValue);

      if (filled) {
        console.log(`[eeo] Filled ${fieldType}: "${atsValue.substring(0, 40)}..."`);
        results.filled++;
      } else {
        results.skipped++;
      }
      // No delay needed - selectByLabel handles its own timing

    } catch (error) {
      results.errors.push(error.message);
    }
  }

  console.log(`[eeo] Completed: ${results.filled} filled, ${results.skipped} skipped`);
  return results;
}

/**
 * Get default EEO configuration
 * @returns {Object} - Default EEO config
 */
export function getDefaultEEOConfig() {
  return {
    enabled: true,
    defaultBehavior: 'decline',
    logActivity: false,
    answers: {
      gender: 'Decline to self-identify',
      race: 'Decline to self-identify',
      hispanic: 'Decline to self-identify',
      veteran: 'I am not a protected veteran',
      disability: 'I do not wish to answer',
      lgbtq: 'Prefer not to answer',
    },
  };
}

export default {
  fillEEOQuestions,
  getATSValue,
  detectEEOFieldType,
  hasEEOSection,
  getDefaultEEOConfig,
  EEO_PATTERNS,
  VALUE_MAPPINGS,
};
