import { UserProfile } from '@/lib/types';
import { FieldImportance } from './types';

/**
 * Field configuration for validation
 */
export interface FieldConfig {
  field: keyof UserProfile;
  label: string;
  importance: FieldImportance;
  section: 'personal' | 'contact' | 'links' | 'resume' | 'work' | 'preferences';
  weight: number; // 1-10, affects score calculation
  validators: FieldValidator[];
  emptyMessage: string;
  invalidMessage?: string;
  suggestion: string;
}

export type FieldValidator =
  | { type: 'required' }
  | { type: 'email' }
  | { type: 'phone' }
  | { type: 'url'; allowedHosts?: string[] }
  | { type: 'minLength'; length: number }
  | { type: 'pattern'; pattern: RegExp; message: string }
  | { type: 'custom'; validate: (value: unknown, profile: UserProfile) => boolean; message: string };

/**
 * Complete field schema with validation rules and weights
 */
export const PROFILE_FIELD_SCHEMA: FieldConfig[] = [
  // === PERSONAL INFORMATION (CRITICAL) ===
  {
    field: 'first_name',
    label: 'First Name',
    importance: 'critical',
    section: 'personal',
    weight: 10,
    validators: [
      { type: 'required' },
      { type: 'minLength', length: 1 },
    ],
    emptyMessage: 'First name is required for all applications',
    suggestion: 'Enter your legal first name as it appears on official documents',
  },
  {
    field: 'last_name',
    label: 'Last Name',
    importance: 'critical',
    section: 'personal',
    weight: 10,
    validators: [
      { type: 'required' },
      { type: 'minLength', length: 1 },
    ],
    emptyMessage: 'Last name is required for all applications',
    suggestion: 'Enter your legal last name as it appears on official documents',
  },

  // === CONTACT INFORMATION (CRITICAL) ===
  {
    field: 'email',
    label: 'Email Address',
    importance: 'critical',
    section: 'contact',
    weight: 10,
    validators: [
      { type: 'required' },
      { type: 'email' },
    ],
    emptyMessage: 'Email is required - recruiters need to contact you',
    invalidMessage: 'Please enter a valid email address',
    suggestion: 'Use a professional email address you check regularly',
  },
  {
    field: 'phone',
    label: 'Phone Number',
    importance: 'required',
    section: 'contact',
    weight: 8,
    validators: [
      { type: 'required' },
      { type: 'phone' },
    ],
    emptyMessage: 'Phone number is required by most ATS systems',
    invalidMessage: 'Please enter a valid phone number with country code',
    suggestion: 'Include country code (e.g., +1 555-123-4567)',
  },
  {
    field: 'location',
    label: 'Location',
    importance: 'required',
    section: 'contact',
    weight: 7,
    validators: [
      { type: 'required' },
      { type: 'minLength', length: 3 },
    ],
    emptyMessage: 'Location helps match you with local opportunities',
    suggestion: 'Format: City, State (e.g., San Francisco, CA)',
  },

  // === RESUME (CRITICAL) ===
  {
    field: 'resume_url',
    label: 'Resume',
    importance: 'critical',
    section: 'resume',
    weight: 10,
    validators: [
      { type: 'required' },
      { type: 'url' },
    ],
    emptyMessage: 'Resume is required for all job applications',
    suggestion: 'Upload a PDF resume (recommended) or Word document',
  },

  // === LINKS (RECOMMENDED) ===
  {
    field: 'linkedin_url',
    label: 'LinkedIn Profile',
    importance: 'recommended',
    section: 'links',
    weight: 6,
    validators: [
      { type: 'url', allowedHosts: ['linkedin.com', 'www.linkedin.com'] },
    ],
    emptyMessage: 'LinkedIn is requested by 80%+ of applications',
    invalidMessage: 'Please enter a valid LinkedIn URL',
    suggestion: 'Format: https://linkedin.com/in/yourname',
  },
  {
    field: 'github_url',
    label: 'GitHub Profile',
    importance: 'recommended',
    section: 'links',
    weight: 5,
    validators: [
      { type: 'url', allowedHosts: ['github.com', 'www.github.com'] },
    ],
    emptyMessage: 'GitHub shows your coding activity and projects',
    invalidMessage: 'Please enter a valid GitHub URL',
    suggestion: 'Format: https://github.com/yourusername',
  },
  {
    field: 'portfolio_url',
    label: 'Portfolio Website',
    importance: 'optional',
    section: 'links',
    weight: 4,
    validators: [
      { type: 'url' },
    ],
    emptyMessage: 'A portfolio showcases your best work',
    invalidMessage: 'Please enter a valid URL',
    suggestion: 'Include projects, case studies, or blog posts',
  },

  // === WORK INFORMATION (REQUIRED) ===
  {
    field: 'work_authorization',
    label: 'Work Authorization',
    importance: 'required',
    section: 'work',
    weight: 8,
    validators: [
      { type: 'required' },
    ],
    emptyMessage: 'Work authorization is asked on nearly every application',
    suggestion: 'Select your current work authorization status',
  },
  {
    field: 'require_sponsorship',
    label: 'Sponsorship Requirement',
    importance: 'required',
    section: 'work',
    weight: 7,
    validators: [],
    emptyMessage: 'Indicate if you need visa sponsorship',
    suggestion: 'Be honest - this affects which jobs match you',
  },
  {
    field: 'years_experience',
    label: 'Years of Experience',
    importance: 'required',
    section: 'work',
    weight: 6,
    validators: [
      { type: 'required' },
    ],
    emptyMessage: 'Experience level helps filter relevant roles',
    suggestion: 'Select your total years of professional experience',
  },

  // === PREFERENCES (OPTIONAL) ===
  {
    field: 'start_date',
    label: 'Earliest Start Date',
    importance: 'optional',
    section: 'preferences',
    weight: 3,
    validators: [],
    emptyMessage: 'Some applications ask for availability',
    suggestion: 'When can you start a new position?',
  },
  {
    field: 'salary_expectation',
    label: 'Salary Expectation',
    importance: 'optional',
    section: 'preferences',
    weight: 2,
    validators: [],
    emptyMessage: 'Optional - leave blank to keep negotiating power',
    suggestion: 'Format: $XXX,XXX or range like $120K-$150K',
  },
  {
    field: 'willing_to_relocate',
    label: 'Relocation Preference',
    importance: 'optional',
    section: 'preferences',
    weight: 2,
    validators: [],
    emptyMessage: 'Some positions require relocation',
    suggestion: 'Indicates flexibility for on-site roles',
  },
];

/**
 * Section metadata for UI grouping
 */
export const PROFILE_SECTIONS = {
  personal: {
    id: 'personal',
    title: 'Personal Information',
    icon: 'user',
    description: 'Basic identification',
  },
  contact: {
    id: 'contact',
    title: 'Contact Information',
    icon: 'mail',
    description: 'How recruiters reach you',
  },
  resume: {
    id: 'resume',
    title: 'Resume',
    icon: 'file-text',
    description: 'Your application document',
  },
  links: {
    id: 'links',
    title: 'Professional Links',
    icon: 'link',
    description: 'Online presence',
  },
  work: {
    id: 'work',
    title: 'Work Details',
    icon: 'briefcase',
    description: 'Authorization & experience',
  },
  preferences: {
    id: 'preferences',
    title: 'Preferences',
    icon: 'settings',
    description: 'Job preferences',
  },
} as const;
