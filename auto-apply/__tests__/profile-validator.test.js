/**
 * Profile Validator Integration Tests
 *
 * Tests validation of user profile data to ensure required fields
 * are present and properly formatted before form filling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Profile validation errors
 */
class ProfileValidationError extends Error {
  constructor(message, field, details = null) {
    super(message);
    this.name = 'ProfileValidationError';
    this.field = field;
    this.details = details;
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (flexible - allows various formats)
 */
function isValidPhone(phone) {
  // Remove all non-numeric characters except + for country code
  const cleaned = phone.replace(/[^\d+]/g, '');
  // Should have at least 10 digits
  return cleaned.replace(/\D/g, '').length >= 10;
}

/**
 * Validate URL format
 */
function isValidURL(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate skill proficiency (1-5 scale)
 */
function isValidProficiency(level) {
  return Number.isInteger(level) && level >= 1 && level <= 5;
}

/**
 * Validate a user profile
 * @param {Object} profile - The profile to validate
 * @returns {{ valid: boolean, errors: ProfileValidationError[] }}
 */
function validateProfile(profile) {
  const errors = [];

  // Required fields
  const requiredFields = ['firstName', 'lastName', 'email'];
  for (const field of requiredFields) {
    if (!profile[field] || profile[field].trim() === '') {
      errors.push(new ProfileValidationError(`${field} is required`, field));
    }
  }

  // Email format
  if (profile.email && !isValidEmail(profile.email)) {
    errors.push(new ProfileValidationError('Invalid email format', 'email'));
  }

  // Phone format (if provided)
  if (profile.phone && !isValidPhone(profile.phone)) {
    errors.push(new ProfileValidationError('Invalid phone format', 'phone'));
  }

  // URL validations (if provided)
  const urlFields = ['linkedin', 'github', 'website'];
  for (const field of urlFields) {
    if (profile[field] && !isValidURL(profile[field])) {
      errors.push(new ProfileValidationError(`Invalid URL format for ${field}`, field));
    }
  }

  // Resume path (if provided)
  if (profile.resumePath && !existsSync(join(__dirname, '..', profile.resumePath))) {
    // Only warn, don't error - resume might be in different location
    console.warn(`Warning: Resume file not found at ${profile.resumePath}`);
  }

  // Skills validation (if provided)
  if (profile.skills) {
    for (const [category, skills] of Object.entries(profile.skills)) {
      if (!Array.isArray(skills)) {
        errors.push(new ProfileValidationError(
          `Skills.${category} should be an array`,
          `skills.${category}`
        ));
        continue;
      }

      for (const skill of skills) {
        if (!skill.name) {
          errors.push(new ProfileValidationError(
            'Skill must have a name',
            `skills.${category}`
          ));
        }
        if (skill.proficiency !== undefined && !isValidProficiency(skill.proficiency)) {
          errors.push(new ProfileValidationError(
            `Invalid proficiency for ${skill.name}: must be 1-5`,
            `skills.${category}.${skill.name}.proficiency`
          ));
        }
        if (skill.years !== undefined && (typeof skill.years !== 'number' || skill.years < 0)) {
          errors.push(new ProfileValidationError(
            `Invalid years for ${skill.name}: must be a non-negative number`,
            `skills.${category}.${skill.name}.years`
          ));
        }
      }
    }
  }

  // EEO config validation (if provided)
  if (profile.eeo) {
    if (typeof profile.eeo.enabled !== 'boolean' && profile.eeo.enabled !== undefined) {
      errors.push(new ProfileValidationError(
        'eeo.enabled must be a boolean',
        'eeo.enabled'
      ));
    }
    const validBehaviors = ['decline', 'answer', 'skip'];
    if (profile.eeo.defaultBehavior && !validBehaviors.includes(profile.eeo.defaultBehavior)) {
      errors.push(new ProfileValidationError(
        `Invalid eeo.defaultBehavior: must be one of ${validBehaviors.join(', ')}`,
        'eeo.defaultBehavior'
      ));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get required fields that are missing from profile
 */
function getMissingFields(profile) {
  const requiredForBasicApply = ['firstName', 'lastName', 'email'];
  const recommended = ['phone', 'linkedin', 'resumePath'];

  const missing = [];
  const missingRecommended = [];

  for (const field of requiredForBasicApply) {
    if (!profile[field]) {
      missing.push(field);
    }
  }

  for (const field of recommended) {
    if (!profile[field]) {
      missingRecommended.push(field);
    }
  }

  return { required: missing, recommended: missingRecommended };
}

/**
 * Estimate form fill completeness
 */
function estimateCompleteness(profile) {
  const fields = {
    basic: ['firstName', 'lastName', 'email', 'phone', 'location'],
    links: ['linkedin', 'github', 'website'],
    experience: ['yearsExperience', 'currentCompany'],
    files: ['resumePath', 'coverLetterPath'],
    skills: ['skills'],
    education: ['education'],
    eeo: ['eeo'],
  };

  const scores = {};
  let totalScore = 0;
  let totalWeight = 0;

  const weights = {
    basic: 3,
    links: 2,
    experience: 2,
    files: 2,
    skills: 1,
    education: 1,
    eeo: 1,
  };

  for (const [category, fieldList] of Object.entries(fields)) {
    const weight = weights[category];
    let filled = 0;

    for (const field of fieldList) {
      if (profile[field]) {
        filled++;
      }
    }

    const categoryScore = fieldList.length > 0 ? filled / fieldList.length : 0;
    scores[category] = Math.round(categoryScore * 100);
    totalScore += categoryScore * weight;
    totalWeight += weight;
  }

  return {
    overall: Math.round((totalScore / totalWeight) * 100),
    categories: scores,
  };
}

describe('Profile Validator', () => {
  describe('Email Validation', () => {
    it('accepts valid email formats', () => {
      const validEmails = [
        'user@example.com',
        'first.last@company.org',
        'user+tag@domain.co.uk',
        'test123@test.io',
      ];

      for (const email of validEmails) {
        assert.ok(isValidEmail(email), `${email} should be valid`);
      }
    });

    it('rejects invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        '@nodomain.com',
        'no@',
        'spaces in@email.com',
        '',
      ];

      for (const email of invalidEmails) {
        assert.ok(!isValidEmail(email), `${email} should be invalid`);
      }
    });
  });

  describe('Phone Validation', () => {
    it('accepts valid phone formats', () => {
      const validPhones = [
        '+1-555-123-4567',
        '555-123-4567',
        '(555) 123-4567',
        '5551234567',
        '+44 20 7946 0958',
      ];

      for (const phone of validPhones) {
        assert.ok(isValidPhone(phone), `${phone} should be valid`);
      }
    });

    it('rejects too short phone numbers', () => {
      const invalidPhones = [
        '123',
        '555-1234',
        'abc',
      ];

      for (const phone of invalidPhones) {
        assert.ok(!isValidPhone(phone), `${phone} should be invalid`);
      }
    });
  });

  describe('URL Validation', () => {
    it('accepts valid URLs', () => {
      const validURLs = [
        'https://linkedin.com/in/janedoe',
        'https://github.com/janedoe',
        'http://example.com',
        'https://www.company.io/page',
      ];

      for (const url of validURLs) {
        assert.ok(isValidURL(url), `${url} should be valid`);
      }
    });

    it('rejects invalid URLs', () => {
      const invalidURLs = [
        'not-a-url',
        'www.missing-protocol.com',
        '://no-protocol.com',
      ];

      for (const url of invalidURLs) {
        assert.ok(!isValidURL(url), `${url} should be invalid`);
      }
    });
  });

  describe('Proficiency Validation', () => {
    it('accepts proficiency levels 1-5', () => {
      for (let level = 1; level <= 5; level++) {
        assert.ok(isValidProficiency(level), `${level} should be valid`);
      }
    });

    it('rejects invalid proficiency levels', () => {
      const invalid = [0, 6, -1, 3.5, 'high', null];
      for (const level of invalid) {
        assert.ok(!isValidProficiency(level), `${level} should be invalid`);
      }
    });
  });

  describe('Full Profile Validation', () => {
    it('validates a complete valid profile', () => {
      const validProfile = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: '+1-555-123-4567',
        linkedin: 'https://linkedin.com/in/janedoe',
        github: 'https://github.com/janedoe',
        skills: {
          languages: [
            { name: 'Python', proficiency: 4, years: 3 },
          ],
        },
        eeo: {
          enabled: true,
          defaultBehavior: 'decline',
        },
      };

      const result = validateProfile(validProfile);
      assert.ok(result.valid, 'Profile should be valid');
      assert.strictEqual(result.errors.length, 0);
    });

    it('fails validation for missing required fields', () => {
      const incompleteProfile = {
        firstName: 'Jane',
        // missing lastName and email
      };

      const result = validateProfile(incompleteProfile);
      assert.ok(!result.valid);
      assert.ok(result.errors.length >= 2);

      const missingFields = result.errors.map(e => e.field);
      assert.ok(missingFields.includes('lastName'));
      assert.ok(missingFields.includes('email'));
    });

    it('fails validation for invalid email', () => {
      const profileWithBadEmail = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'not-an-email',
      };

      const result = validateProfile(profileWithBadEmail);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.field === 'email'));
    });

    it('fails validation for invalid URLs', () => {
      const profileWithBadURL = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        linkedin: 'not-a-url',
      };

      const result = validateProfile(profileWithBadURL);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.field === 'linkedin'));
    });

    it('fails validation for invalid skill proficiency', () => {
      const profileWithBadSkill = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        skills: {
          languages: [
            { name: 'Python', proficiency: 10 }, // Invalid: > 5
          ],
        },
      };

      const result = validateProfile(profileWithBadSkill);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.field.includes('proficiency')));
    });

    it('fails validation for invalid EEO config', () => {
      const profileWithBadEEO = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        eeo: {
          defaultBehavior: 'invalid-behavior',
        },
      };

      const result = validateProfile(profileWithBadEEO);
      assert.ok(!result.valid);
      assert.ok(result.errors.some(e => e.field === 'eeo.defaultBehavior'));
    });
  });

  describe('Missing Fields Detection', () => {
    it('identifies missing required fields', () => {
      const profile = {
        email: 'jane@example.com',
        // missing firstName and lastName
      };

      const missing = getMissingFields(profile);
      assert.ok(missing.required.includes('firstName'));
      assert.ok(missing.required.includes('lastName'));
      assert.ok(!missing.required.includes('email'));
    });

    it('identifies missing recommended fields', () => {
      const profile = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        // missing phone, linkedin, resumePath
      };

      const missing = getMissingFields(profile);
      assert.strictEqual(missing.required.length, 0);
      assert.ok(missing.recommended.includes('phone'));
      assert.ok(missing.recommended.includes('linkedin'));
      assert.ok(missing.recommended.includes('resumePath'));
    });
  });

  describe('Completeness Estimation', () => {
    it('calculates completeness for minimal profile', () => {
      const minimalProfile = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      };

      const result = estimateCompleteness(minimalProfile);
      assert.ok(result.overall > 0);
      assert.ok(result.overall < 100);
      assert.ok(result.categories.basic > 0);
    });

    it('calculates high completeness for full profile', () => {
      const fullProfile = {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '555-1234',
        location: 'SF, CA',
        linkedin: 'https://linkedin.com/in/jane',
        github: 'https://github.com/jane',
        website: 'https://jane.dev',
        yearsExperience: '1-2',
        currentCompany: 'University',
        resumePath: './resume.pdf',
        coverLetterPath: './cover.pdf',
        skills: { languages: [{ name: 'Python', proficiency: 4 }] },
        education: { school: 'UC Berkeley', degree: 'BS' },
        eeo: { enabled: true },
      };

      const result = estimateCompleteness(fullProfile);
      assert.ok(result.overall >= 80, `Expected >= 80%, got ${result.overall}%`);
    });

    it('returns 0% for empty profile', () => {
      const result = estimateCompleteness({});
      assert.strictEqual(result.overall, 0);
    });
  });

  describe('Example Profile File Validation', () => {
    it('validates the example profile file', () => {
      const profilePath = join(__dirname, '..', 'profile.example.json');

      if (existsSync(profilePath)) {
        const profileContent = readFileSync(profilePath, 'utf-8');
        const profile = JSON.parse(profileContent);

        const result = validateProfile(profile);

        // Example profile should be valid
        assert.ok(result.valid, `Example profile should be valid. Errors: ${result.errors.map(e => e.message).join(', ')}`);
      } else {
        // Skip if file doesn't exist
        console.log('Skipping: profile.example.json not found');
      }
    });
  });
});

// Export for use in other modules
export {
  validateProfile,
  isValidEmail,
  isValidPhone,
  isValidURL,
  isValidProficiency,
  getMissingFields,
  estimateCompleteness,
  ProfileValidationError,
};
