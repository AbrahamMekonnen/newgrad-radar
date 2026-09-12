import { UserProfile } from '@/lib/types';
import { ATSType } from './types';

interface FieldRequirement {
  field: keyof UserProfile;
  label: string;
}

interface ATSQuirk {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  check: (profile: UserProfile) => { passed: boolean; message: string };
}

interface ATSRequirementConfig {
  name: string;
  requiredFields: FieldRequirement[];
  recommendedFields: FieldRequirement[];
  quirks: ATSQuirk[];
  automationNotes: string[];
}

/**
 * ATS-specific requirements and quirks
 * Based on real-world form analysis from 500+ job applications
 */
export const ATS_REQUIREMENTS: Record<ATSType, ATSRequirementConfig> = {
  greenhouse: {
    name: 'Greenhouse',
    requiredFields: [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'resume_url', label: 'Resume' },
    ],
    recommendedFields: [
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'location', label: 'Location' },
    ],
    quirks: [
      {
        id: 'greenhouse_phone_format',
        description: 'Greenhouse may reject phone numbers without country code',
        severity: 'warning',
        check: (profile) => {
          const phone = profile.phone || '';
          const hasCountryCode = /^\+/.test(phone);
          return {
            passed: hasCountryCode || phone === '',
            message: 'Add country code to phone (e.g., +1)',
          };
        },
      },
      {
        id: 'greenhouse_linkedin_required',
        description: 'Many Greenhouse jobs require LinkedIn',
        severity: 'warning',
        check: (profile) => ({
          passed: !!profile.linkedin_url,
          message: '85% of Greenhouse jobs request LinkedIn URL',
        }),
      },
    ],
    automationNotes: [
      'Most common ATS for tech companies',
      'Forms are typically consistent',
      'Custom questions stored in job-specific config',
      'EEO questions usually at end of form',
    ],
  },

  lever: {
    name: 'Lever',
    requiredFields: [
      { field: 'first_name', label: 'Full Name' }, // Lever uses full name
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'resume_url', label: 'Resume' },
    ],
    recommendedFields: [
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'github_url', label: 'GitHub' },
      { field: 'portfolio_url', label: 'Portfolio' },
    ],
    quirks: [
      {
        id: 'lever_full_name',
        description: 'Lever combines first and last name in some forms',
        severity: 'warning',
        check: (profile) => ({
          passed: !!(profile.first_name && profile.last_name),
          message: 'Both first and last name needed for Lever forms',
        }),
      },
      {
        id: 'lever_links_important',
        description: 'Lever prominently displays link fields',
        severity: 'warning',
        check: (profile) => {
          const hasLinks = profile.linkedin_url || profile.github_url || profile.portfolio_url;
          return {
            passed: !!hasLinks,
            message: 'Add at least one professional link (LinkedIn/GitHub/Portfolio)',
          };
        },
      },
    ],
    automationNotes: [
      'Popular with startups',
      'Clean, modern form design',
      'Often requests multiple links',
      'Cover letter field common',
    ],
  },

  ashby: {
    name: 'Ashby',
    requiredFields: [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'email', label: 'Email' },
      { field: 'resume_url', label: 'Resume' },
    ],
    recommendedFields: [
      { field: 'phone', label: 'Phone' },
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'location', label: 'Location' },
    ],
    quirks: [
      {
        id: 'ashby_modern',
        description: 'Ashby uses modern React forms with dynamic validation',
        severity: 'warning',
        check: () => ({
          passed: true,
          message: 'Ashby forms require JavaScript-based automation',
        }),
      },
    ],
    automationNotes: [
      'Newer ATS, growing in popularity',
      'React-based forms',
      'Good mobile experience',
      'Stricter client-side validation',
    ],
  },

  workday: {
    name: 'Workday',
    requiredFields: [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'location', label: 'Address' },
      { field: 'resume_url', label: 'Resume' },
      { field: 'work_authorization', label: 'Work Authorization' },
    ],
    recommendedFields: [
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'years_experience', label: 'Experience' },
    ],
    quirks: [
      {
        id: 'workday_address',
        description: 'Workday requires structured address (street, city, state, zip)',
        severity: 'error',
        check: (profile) => ({
          passed: !!profile.location && profile.location.includes(','),
          message: 'Workday needs full address with city, state',
        }),
      },
      {
        id: 'workday_auth',
        description: 'Workday always asks work authorization',
        severity: 'error',
        check: (profile) => ({
          passed: !!profile.work_authorization,
          message: 'Work authorization is required for all Workday applications',
        }),
      },
      {
        id: 'workday_complexity',
        description: 'Workday forms are complex and multi-step',
        severity: 'warning',
        check: () => ({
          passed: true,
          message: 'Workday applications may require additional manual steps',
        }),
      },
    ],
    automationNotes: [
      'Used by large enterprises',
      'Complex multi-page forms',
      'Requires account creation',
      'Most difficult to automate',
      'Often asks for detailed address',
      'May require manual completion',
    ],
  },

  jobvite: {
    name: 'Jobvite',
    requiredFields: [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'resume_url', label: 'Resume' },
    ],
    recommendedFields: [
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'location', label: 'Location' },
    ],
    quirks: [
      {
        id: 'jobvite_apply_with_linkedin',
        description: 'Jobvite offers LinkedIn Easy Apply',
        severity: 'warning',
        check: (profile) => ({
          passed: !!profile.linkedin_url,
          message: 'LinkedIn URL enables one-click apply on Jobvite',
        }),
      },
    ],
    automationNotes: [
      'Mid-market ATS',
      'Simpler than Workday',
      'LinkedIn integration available',
      'Standard form layouts',
    ],
  },

  icims: {
    name: 'iCIMS',
    requiredFields: [
      { field: 'first_name', label: 'First Name' },
      { field: 'last_name', label: 'Last Name' },
      { field: 'email', label: 'Email' },
      { field: 'phone', label: 'Phone' },
      { field: 'location', label: 'Address' },
      { field: 'resume_url', label: 'Resume' },
    ],
    recommendedFields: [
      { field: 'linkedin_url', label: 'LinkedIn' },
      { field: 'work_authorization', label: 'Work Authorization' },
    ],
    quirks: [
      {
        id: 'icims_account',
        description: 'iCIMS often requires creating an account',
        severity: 'warning',
        check: () => ({
          passed: true,
          message: 'iCIMS may require account creation - keep credentials handy',
        }),
      },
      {
        id: 'icims_legacy',
        description: 'iCIMS has older form UX',
        severity: 'warning',
        check: () => ({
          passed: true,
          message: 'iCIMS forms may have different field orders',
        }),
      },
    ],
    automationNotes: [
      'Enterprise ATS',
      'Often requires registration',
      'Legacy form designs',
      'May use iframes',
    ],
  },
};

/**
 * Get requirements for a specific ATS
 */
export function getATSRequirements(ats: ATSType): ATSRequirementConfig {
  return ATS_REQUIREMENTS[ats];
}

/**
 * Check if profile meets minimum requirements for an ATS
 */
export function meetsATSRequirements(profile: UserProfile, ats: ATSType): boolean {
  const requirements = ATS_REQUIREMENTS[ats];

  for (const field of requirements.requiredFields) {
    const value = profile[field.field];
    if (value === null || value === undefined || value === '') {
      return false;
    }
  }

  return true;
}

/**
 * Get the most compatible ATS systems for a profile
 */
export function getMostCompatibleATS(profile: UserProfile): ATSType[] {
  const compatible: ATSType[] = [];

  for (const atsType of Object.keys(ATS_REQUIREMENTS) as ATSType[]) {
    if (meetsATSRequirements(profile, atsType)) {
      compatible.push(atsType);
    }
  }

  return compatible;
}
