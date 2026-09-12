/**
 * ATS Registry - Applicant Tracking System Detection & Field Mapping
 *
 * This file provides comprehensive patterns for detecting and interacting with
 * various ATS (Applicant Tracking Systems) used by tech companies.
 *
 * Supported Systems:
 * - Greenhouse (most common for tech/startups)
 * - Lever (popular with startups)
 * - Ashby (newer, growing in popularity)
 * - Workday (enterprise, complex)
 * - Jobvite (mid-market)
 * - ICIMS (enterprise)
 * - Taleo (legacy enterprise)
 * - SmartRecruiters (mid-market)
 * - BambooHR (SMB)
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ATSType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'jobvite'
  | 'icims'
  | 'taleo'
  | 'smartrecruiters'
  | 'bamboohr'
  | 'breezyhr'
  | 'jazzhr'
  | 'recruitee'
  | 'unknown';

// ============================================================================
// DETECTION TYPES
// ============================================================================

export type DetectionMethod = 'url' | 'dom' | 'meta' | 'script' | 'api';

export interface ATSDetectionResult {
  /** Detected ATS type */
  atsType: ATSType;
  /** Confidence score 0-100 */
  confidence: number;
  /** Primary method used for detection */
  method: DetectionMethod;
  /** Signals that contributed to detection */
  signals: string[];
}

export interface ATSFieldMapping {
  /** Standard field name */
  standard: string;
  /** Selector patterns for finding the field (CSS selectors) */
  selectors: string[];
  /** Input name patterns (regex) */
  namePatterns: RegExp[];
  /** Label text patterns to match (case-insensitive) */
  labelPatterns: string[];
  /** Whether this field is typically required */
  required: boolean;
  /** Expected input type */
  inputType: 'text' | 'email' | 'tel' | 'url' | 'file' | 'select' | 'radio' | 'checkbox' | 'textarea';
}

export interface ATSConfig {
  /** ATS identifier */
  type: ATSType;
  /** Human-readable name */
  name: string;
  /** URL patterns for detection (regex strings) */
  urlPatterns: string[];
  /** DOM element signatures for detection */
  domSignatures: {
    /** Elements that must exist */
    required?: string[];
    /** Elements where at least one must exist */
    anyOf?: string[];
    /** Data attributes to check */
    dataAttributes?: string[];
  };
  /** API endpoints if available */
  api?: {
    /** Base URL pattern */
    baseUrl: string;
    /** Job listing endpoint */
    jobsEndpoint?: string;
    /** Single job endpoint */
    jobEndpoint?: string;
    /** Application submit endpoint */
    applyEndpoint?: string;
  };
  /** Field mappings specific to this ATS */
  fieldMappings: ATSFieldMapping[];
  /** Form submission patterns */
  formPatterns: {
    /** Form selector */
    formSelector: string;
    /** Submit button selector */
    submitSelector: string;
    /** Success indicators */
    successIndicators: string[];
    /** Error indicators */
    errorIndicators: string[];
  };
  /** Speed optimization notes */
  speedNotes: string[];
  /** Automation difficulty (1-5, 1 being easiest) */
  automationDifficulty: 1 | 2 | 3 | 4 | 5;
  /** Known issues or quirks */
  quirks: string[];
}

// ============================================================================
// COMMON FIELD PATTERNS (shared across ATS)
// ============================================================================

const COMMON_FIELDS = {
  firstName: {
    labelPatterns: ['first name', 'given name', 'first'],
    namePatterns: [
      /first[_-]?name/i,
      /given[_-]?name/i,
      /fname/i,
      /name\[first\]/i,
      /applicant.*first/i,
    ],
  },
  lastName: {
    labelPatterns: ['last name', 'family name', 'surname', 'last'],
    namePatterns: [
      /last[_-]?name/i,
      /family[_-]?name/i,
      /surname/i,
      /lname/i,
      /name\[last\]/i,
      /applicant.*last/i,
    ],
  },
  email: {
    labelPatterns: ['email', 'e-mail', 'email address'],
    namePatterns: [
      /email/i,
      /e-mail/i,
      /mail/i,
      /applicant.*email/i,
    ],
  },
  phone: {
    labelPatterns: ['phone', 'telephone', 'mobile', 'cell', 'phone number'],
    namePatterns: [
      /phone/i,
      /telephone/i,
      /mobile/i,
      /cell/i,
      /tel/i,
      /contact.*number/i,
    ],
  },
  resume: {
    labelPatterns: ['resume', 'cv', 'curriculum vitae', 'upload resume'],
    namePatterns: [
      /resume/i,
      /cv/i,
      /attachment/i,
      /file/i,
      /document/i,
    ],
  },
  linkedIn: {
    labelPatterns: ['linkedin', 'linkedin url', 'linkedin profile'],
    namePatterns: [
      /linkedin/i,
      /linked[_-]?in/i,
      /social.*linkedin/i,
    ],
  },
  github: {
    labelPatterns: ['github', 'github url', 'github profile'],
    namePatterns: [
      /github/i,
      /git[_-]?hub/i,
    ],
  },
  portfolio: {
    labelPatterns: ['portfolio', 'website', 'personal site', 'portfolio url'],
    namePatterns: [
      /portfolio/i,
      /website/i,
      /personal[_-]?site/i,
      /url/i,
    ],
  },
  location: {
    labelPatterns: ['location', 'city', 'address', 'where are you located'],
    namePatterns: [
      /location/i,
      /city/i,
      /address/i,
      /current[_-]?location/i,
    ],
  },
  workAuthorization: {
    labelPatterns: [
      'work authorization',
      'authorized to work',
      'legally authorized',
      'work eligibility',
      'right to work',
    ],
    namePatterns: [
      /work[_-]?auth/i,
      /authorization/i,
      /eligibility/i,
      /legal.*work/i,
    ],
  },
  sponsorship: {
    labelPatterns: [
      'visa sponsorship',
      'require sponsorship',
      'need sponsorship',
      'immigration sponsorship',
      'sponsor',
    ],
    namePatterns: [
      /sponsor/i,
      /visa/i,
      /immigration/i,
    ],
  },
  startDate: {
    labelPatterns: [
      'start date',
      'available start date',
      'earliest start',
      'when can you start',
      'availability',
    ],
    namePatterns: [
      /start[_-]?date/i,
      /availability/i,
      /available[_-]?date/i,
      /earliest/i,
    ],
  },
  yearsExperience: {
    labelPatterns: [
      'years of experience',
      'experience',
      'years experience',
      'work experience',
    ],
    namePatterns: [
      /experience/i,
      /years/i,
      /yoe/i,
    ],
  },
  salary: {
    labelPatterns: [
      'salary expectation',
      'expected salary',
      'compensation',
      'salary requirements',
    ],
    namePatterns: [
      /salary/i,
      /compensation/i,
      /pay/i,
    ],
  },
  coverLetter: {
    labelPatterns: [
      'cover letter',
      'letter of interest',
      'motivation letter',
    ],
    namePatterns: [
      /cover[_-]?letter/i,
      /motivation/i,
    ],
  },
  relocate: {
    labelPatterns: [
      'willing to relocate',
      'relocation',
      'open to relocation',
    ],
    namePatterns: [
      /relocat/i,
      /move/i,
    ],
  },
  gender: {
    labelPatterns: ['gender', 'sex'],
    namePatterns: [/gender/i, /sex/i],
  },
  ethnicity: {
    labelPatterns: ['race', 'ethnicity', 'ethnic background'],
    namePatterns: [/race/i, /ethnic/i],
  },
  veteran: {
    labelPatterns: ['veteran', 'military', 'protected veteran'],
    namePatterns: [/veteran/i, /military/i],
  },
  disability: {
    labelPatterns: ['disability', 'disabled'],
    namePatterns: [/disab/i],
  },
};

// ============================================================================
// ATS CONFIGURATIONS
// ============================================================================

export const GREENHOUSE_CONFIG: ATSConfig = {
  type: 'greenhouse',
  name: 'Greenhouse',
  urlPatterns: [
    'boards\\.greenhouse\\.io',
    'job-boards\\.greenhouse\\.io',
    'grnh\\.se',
    '/jobs/\\d+\\?gh_jid=',
    '/greenhouse/',
  ],
  domSignatures: {
    required: ['#application-form', '#application'],
    anyOf: [
      '[data-greenhouse]',
      '.greenhouse-form',
      '#greenhouse-jobboard',
      'input[name*="job_application"]',
    ],
    dataAttributes: ['data-job-id', 'data-token'],
  },
  api: {
    baseUrl: 'https://boards-api.greenhouse.io/v1/boards/{board_token}',
    jobsEndpoint: '/jobs',
    jobEndpoint: '/jobs/{job_id}',
    applyEndpoint: '/jobs/{job_id}/applications',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: [
        '#first_name',
        'input[name="job_application[first_name]"]',
        'input[name*="first_name"]',
      ],
      namePatterns: [/job_application\[first_name\]/i, ...COMMON_FIELDS.firstName.namePatterns],
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: [
        '#last_name',
        'input[name="job_application[last_name]"]',
        'input[name*="last_name"]',
      ],
      namePatterns: [/job_application\[last_name\]/i, ...COMMON_FIELDS.lastName.namePatterns],
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: [
        '#email',
        'input[name="job_application[email]"]',
        'input[type="email"]',
      ],
      namePatterns: [/job_application\[email\]/i, ...COMMON_FIELDS.email.namePatterns],
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: [
        '#phone',
        'input[name="job_application[phone]"]',
        'input[type="tel"]',
      ],
      namePatterns: [/job_application\[phone\]/i, ...COMMON_FIELDS.phone.namePatterns],
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: [
        '#resume',
        'input[name="job_application[resume]"]',
        'input[type="file"][accept*="pdf"]',
      ],
      namePatterns: [/job_application\[resume\]/i, ...COMMON_FIELDS.resume.namePatterns],
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
    {
      standard: 'coverLetter',
      selectors: [
        '#cover_letter',
        'input[name="job_application[cover_letter]"]',
      ],
      namePatterns: [/job_application\[cover_letter\]/i, ...COMMON_FIELDS.coverLetter.namePatterns],
      labelPatterns: COMMON_FIELDS.coverLetter.labelPatterns,
      required: false,
      inputType: 'file',
    },
    {
      standard: 'linkedIn',
      selectors: [
        'input[name*="linkedin"]',
        'input[name*="answers_attributes"][placeholder*="linkedin"]',
      ],
      namePatterns: [...COMMON_FIELDS.linkedIn.namePatterns],
      labelPatterns: COMMON_FIELDS.linkedIn.labelPatterns,
      required: false,
      inputType: 'url',
    },
  ],
  formPatterns: {
    formSelector: '#application-form, #application form, form[action*="application"]',
    submitSelector: 'input[type="submit"], button[type="submit"], button:contains("Submit")',
    successIndicators: [
      '.application-confirmation',
      '#application_confirmation',
      '.thank-you',
      'text*="Thank you"',
      'text*="application has been received"',
    ],
    errorIndicators: [
      '.field-error',
      '.error-message',
      '.field_with_errors',
      '[class*="error"]',
    ],
  },
  speedNotes: [
    'Greenhouse forms load quickly - typically under 2s',
    'Use API to pre-fetch job data and custom questions',
    'Custom questions use indexed answers_attributes format',
    'Resume can be pre-parsed via API upload',
    'CORS enabled for API calls from whitelisted origins',
  ],
  automationDifficulty: 2,
  quirks: [
    'Custom questions use dynamic IDs: job_application[answers_attributes][N][text_value]',
    'Some companies require CAPTCHA (reCAPTCHA v2)',
    'File uploads may require specific content-type headers',
    'Location questions often use typeahead/autocomplete',
    'EEOC questions are typically at the end and optional',
  ],
};

export const LEVER_CONFIG: ATSConfig = {
  type: 'lever',
  name: 'Lever',
  urlPatterns: [
    'jobs\\.lever\\.co',
    'lever\\.co/jobs',
    '/lever/',
    'apply\\.lever\\.co',
  ],
  domSignatures: {
    required: ['.application-form', '.lever-form'],
    anyOf: [
      '[data-lever]',
      '.lever-application',
      '.posting-application',
      'form[action*="lever"]',
    ],
    dataAttributes: ['data-posting-id'],
  },
  api: {
    baseUrl: 'https://api.lever.co/v0/postings/{company}',
    jobsEndpoint: '',
    jobEndpoint: '/{posting_id}',
    applyEndpoint: '/{posting_id}/apply',
  },
  fieldMappings: [
    {
      standard: 'fullName',
      selectors: [
        'input[name="name"]',
        '#name-input',
      ],
      namePatterns: [/^name$/i, /full[_-]?name/i],
      labelPatterns: ['full name', 'name', 'your name'],
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: [
        'input[name="email"]',
        'input[type="email"]',
      ],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: [
        'input[name="phone"]',
        'input[type="tel"]',
      ],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: [
        'input[name="resume"]',
        '.resume-upload input[type="file"]',
        'input[accept*="pdf"]',
      ],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
    {
      standard: 'linkedIn',
      selectors: [
        'input[name="urls[LinkedIn]"]',
        'input[name*="linkedin"]',
      ],
      namePatterns: [/urls\[LinkedIn\]/i, ...COMMON_FIELDS.linkedIn.namePatterns],
      labelPatterns: COMMON_FIELDS.linkedIn.labelPatterns,
      required: false,
      inputType: 'url',
    },
    {
      standard: 'github',
      selectors: [
        'input[name="urls[GitHub]"]',
        'input[name*="github"]',
      ],
      namePatterns: [/urls\[GitHub\]/i, ...COMMON_FIELDS.github.namePatterns],
      labelPatterns: COMMON_FIELDS.github.labelPatterns,
      required: false,
      inputType: 'url',
    },
    {
      standard: 'portfolio',
      selectors: [
        'input[name="urls[Portfolio]"]',
        'input[name="urls[Website]"]',
        'input[name*="portfolio"]',
      ],
      namePatterns: [/urls\[(Portfolio|Website|Other)\]/i, ...COMMON_FIELDS.portfolio.namePatterns],
      labelPatterns: COMMON_FIELDS.portfolio.labelPatterns,
      required: false,
      inputType: 'url',
    },
    {
      standard: 'coverLetter',
      selectors: [
        'textarea[name="comments"]',
        '.cover-letter textarea',
      ],
      namePatterns: [/comments/i, ...COMMON_FIELDS.coverLetter.namePatterns],
      labelPatterns: ['additional information', ...COMMON_FIELDS.coverLetter.labelPatterns],
      required: false,
      inputType: 'textarea',
    },
  ],
  formPatterns: {
    formSelector: '.application-form form, .lever-form, form.application',
    submitSelector: 'button[type="submit"], button.postings-btn-submit',
    successIndicators: [
      '.application-complete',
      '.success-page',
      'text*="Thanks for applying"',
      'text*="Application submitted"',
    ],
    errorIndicators: [
      '.application-error',
      '.field-error',
      '[class*="invalid"]',
    ],
  },
  speedNotes: [
    'Lever uses React - wait for hydration before interacting',
    'Public API available without authentication for job data',
    'Forms are relatively simple with predictable structure',
    'Custom questions appear as cards in the form',
    'Resume parsing is automatic after upload',
  ],
  automationDifficulty: 2,
  quirks: [
    'Uses full name instead of first/last name split',
    'URLs field uses indexed format: urls[LinkedIn], urls[GitHub], etc.',
    'Some companies use custom domains (jobs.company.com redirects to Lever)',
    'Confidential mode hides company info until application',
    'Resume can be auto-parsed from LinkedIn URL',
  ],
};

export const ASHBY_CONFIG: ATSConfig = {
  type: 'ashby',
  name: 'Ashby',
  urlPatterns: [
    'jobs\\.ashbyhq\\.com',
    '\\.ashbyhq\\.com',
    '/ashby/',
    'app\\.ashbyhq\\.com',
  ],
  domSignatures: {
    required: ['.ashby-application-form'],
    anyOf: [
      '[data-ashby]',
      '.ashby-job-posting',
      'form[data-form-type="application"]',
      '#ashby-embed',
    ],
    dataAttributes: ['data-job-posting-id', 'data-ashby-job-posting-id'],
  },
  api: {
    baseUrl: 'https://api.ashbyhq.com/posting-api/job-board/{company}',
    jobsEndpoint: '/jobs',
    jobEndpoint: '/jobs/{job_id}',
    applyEndpoint: '/application/submit',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: [
        'input[name="firstName"]',
        'input[name="_systemfield_first_name"]',
      ],
      namePatterns: [/_systemfield_first_name/i, ...COMMON_FIELDS.firstName.namePatterns],
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: [
        'input[name="lastName"]',
        'input[name="_systemfield_last_name"]',
      ],
      namePatterns: [/_systemfield_last_name/i, ...COMMON_FIELDS.lastName.namePatterns],
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: [
        'input[name="email"]',
        'input[name="_systemfield_email"]',
        'input[type="email"]',
      ],
      namePatterns: [/_systemfield_email/i, ...COMMON_FIELDS.email.namePatterns],
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: [
        'input[name="phone"]',
        'input[name="_systemfield_phone"]',
        'input[type="tel"]',
      ],
      namePatterns: [/_systemfield_phone/i, ...COMMON_FIELDS.phone.namePatterns],
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: [
        'input[name="resume"]',
        'input[name="_systemfield_resume"]',
        '[data-field-type="file"] input',
      ],
      namePatterns: [/_systemfield_resume/i, ...COMMON_FIELDS.resume.namePatterns],
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
    {
      standard: 'linkedIn',
      selectors: [
        'input[name="linkedInUrl"]',
        'input[name="_systemfield_linkedin"]',
      ],
      namePatterns: [/_systemfield_linkedin/i, ...COMMON_FIELDS.linkedIn.namePatterns],
      labelPatterns: COMMON_FIELDS.linkedIn.labelPatterns,
      required: false,
      inputType: 'url',
    },
    {
      standard: 'currentCompany',
      selectors: [
        'input[name="currentCompany"]',
        'input[name="_systemfield_current_company"]',
      ],
      namePatterns: [/_systemfield_current_company/i, /current[_-]?company/i],
      labelPatterns: ['current company', 'company'],
      required: false,
      inputType: 'text',
    },
  ],
  formPatterns: {
    formSelector: '.ashby-application-form form, form[data-form-type="application"]',
    submitSelector: 'button[type="submit"], button.submit-application',
    successIndicators: [
      '.application-success',
      '.confirmation-message',
      'text*="Application received"',
    ],
    errorIndicators: [
      '.field-error',
      '.error-message',
      '[aria-invalid="true"]',
    ],
  },
  speedNotes: [
    'Modern React-based forms with good performance',
    'GraphQL API available for advanced integrations',
    'System fields use _systemfield_ prefix',
    'Custom fields have UUIDs as identifiers',
    'Supports drag-and-drop file upload',
  ],
  automationDifficulty: 2,
  quirks: [
    'Uses _systemfield_ prefix for standard fields',
    'Custom questions use UUID-based field names',
    'Some forms use multi-step wizard layout',
    'Location fields may use Google Places autocomplete',
    'Growing in popularity - expect API changes',
  ],
};

export const WORKDAY_CONFIG: ATSConfig = {
  type: 'workday',
  name: 'Workday',
  urlPatterns: [
    '\\.myworkdayjobs\\.com',
    '\\.wd\\d+\\.myworkdayjobs\\.com',
    'workday\\.com/.*careers',
    '/workday/',
  ],
  domSignatures: {
    required: ['[data-automation-id]'],
    anyOf: [
      '.WGDC',
      '.WPF',
      '[data-automation-id="jobPostingPage"]',
      '[data-automation-id="applyButton"]',
    ],
    dataAttributes: ['data-automation-id', 'data-uxi-widget-type'],
  },
  api: {
    baseUrl: 'https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}',
    jobsEndpoint: '/jobs',
    jobEndpoint: '/job/{job_id}',
    applyEndpoint: '/job/{job_id}/apply',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: [
        '[data-automation-id="legalNameSection_firstName"]',
        'input[data-automation-id*="firstName"]',
      ],
      namePatterns: [/legalNameSection_firstName/i, ...COMMON_FIELDS.firstName.namePatterns],
      labelPatterns: ['legal first name', ...COMMON_FIELDS.firstName.labelPatterns],
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: [
        '[data-automation-id="legalNameSection_lastName"]',
        'input[data-automation-id*="lastName"]',
      ],
      namePatterns: [/legalNameSection_lastName/i, ...COMMON_FIELDS.lastName.namePatterns],
      labelPatterns: ['legal last name', ...COMMON_FIELDS.lastName.labelPatterns],
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: [
        '[data-automation-id="email"]',
        'input[data-automation-id*="email"]',
      ],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: [
        '[data-automation-id="phone-number"]',
        '[data-automation-id="phoneNumber"]',
      ],
      namePatterns: [/phone-number/i, ...COMMON_FIELDS.phone.namePatterns],
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: [
        '[data-automation-id="file-upload-input-ref"]',
        'input[data-automation-id*="resume"]',
      ],
      namePatterns: [/file-upload/i, ...COMMON_FIELDS.resume.namePatterns],
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
    {
      standard: 'address',
      selectors: [
        '[data-automation-id="addressSection_addressLine1"]',
        'input[data-automation-id*="address"]',
      ],
      namePatterns: [/addressSection/i, /address/i],
      labelPatterns: ['street address', 'address line 1', 'address'],
      required: false,
      inputType: 'text',
    },
    {
      standard: 'country',
      selectors: [
        '[data-automation-id="addressSection_countryRegion"]',
        '[data-automation-id*="country"]',
      ],
      namePatterns: [/country/i, /countryRegion/i],
      labelPatterns: ['country', 'country/region'],
      required: false,
      inputType: 'select',
    },
  ],
  formPatterns: {
    formSelector: '[data-automation-id="jobApplicationForm"]',
    submitSelector: '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="submitButton"]',
    successIndicators: [
      '[data-automation-id="applicationSubmittedPage"]',
      'text*="Application submitted"',
      'text*="Thank you for applying"',
    ],
    errorIndicators: [
      '[data-automation-id="errorMessage"]',
      '.validation-error',
      '[role="alert"]',
    ],
  },
  speedNotes: [
    'HEAVY JavaScript - requires full page load (3-8 seconds)',
    'Multi-step wizard - plan for 3-5 page transitions',
    'Uses custom web components - standard selectors may not work',
    'Consider using Puppeteer/Playwright over simple fetch',
    'Session management required - cookies critical',
    'Rate limiting is aggressive - add delays between actions',
  ],
  automationDifficulty: 5,
  quirks: [
    'Single Page Application with complex state management',
    'data-automation-id attributes are your best friends',
    'Requires account creation before applying (usually)',
    'Multi-page wizard flow - must complete all steps',
    'Heavy CSRF protection - extract tokens from page',
    'May require solving CAPTCHA on login',
    'Resume parsing can take 30+ seconds',
    'Dropdowns use custom components, not native select',
    'Date pickers use custom calendar widgets',
    'Country/State are dependent dropdowns',
  ],
};

export const JOBVITE_CONFIG: ATSConfig = {
  type: 'jobvite',
  name: 'Jobvite',
  urlPatterns: [
    'jobs\\.jobvite\\.com',
    '\\.jobvite\\.com/.*apply',
    '/jobvite/',
  ],
  domSignatures: {
    required: ['#jv-application-form'],
    anyOf: [
      '.jv-page-body',
      '.jv-header',
      '[class*="jobvite"]',
    ],
    dataAttributes: ['data-jv-app', 'data-jv-job-id'],
  },
  api: {
    baseUrl: 'https://jobs.jobvite.com/{company}',
    jobsEndpoint: '/search',
    jobEndpoint: '/job/{job_id}',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['#jv-firstName', 'input[name="firstName"]'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['#jv-lastName', 'input[name="lastName"]'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['#jv-email', 'input[name="email"]'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['#jv-phone', 'input[name="phone"]'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['#jv-resume', 'input[name="resume"]'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '#jv-application-form, form.jv-apply-form',
    submitSelector: '#jv-submit-btn, button[type="submit"]',
    successIndicators: [
      '.jv-confirmation',
      '.jv-success',
      'text*="Application submitted"',
    ],
    errorIndicators: [
      '.jv-error',
      '.jv-field-error',
      '[class*="error"]',
    ],
  },
  speedNotes: [
    'Moderate complexity - loads within 2-4 seconds',
    'Standard HTML forms with jQuery',
    'Custom questions rendered dynamically',
    'File upload uses standard multipart',
  ],
  automationDifficulty: 3,
  quirks: [
    'Uses jv- prefix for IDs and classes',
    'May require phone country code selection',
    'Some companies enable social sign-in only',
    'Referral codes may be required',
  ],
};

export const ICIMS_CONFIG: ATSConfig = {
  type: 'icims',
  name: 'iCIMS',
  urlPatterns: [
    'careers-.*\\.icims\\.com',
    '\\.icims\\.com',
    '/icims/',
  ],
  domSignatures: {
    required: ['#icims_content'],
    anyOf: [
      '.iCIMS_MainWrapper',
      '.iCIMS_JobContent',
      '[class*="icims"]',
    ],
    dataAttributes: [],
  },
  api: {
    baseUrl: 'https://careers-{company}.icims.com',
    jobsEndpoint: '/jobs/search',
    jobEndpoint: '/jobs/{job_id}/job',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="firstName"]', '#firstName'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="lastName"]', '#lastName'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', '#email'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'resume',
      selectors: ['input[type="file"]', '#resume'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '#icims_content form, form.iCIMS_Form',
    submitSelector: 'input[type="submit"], button[type="submit"]',
    successIndicators: [
      '.iCIMS_Confirmation',
      'text*="Thank you"',
    ],
    errorIndicators: [
      '.iCIMS_Error',
      '[class*="error"]',
    ],
  },
  speedNotes: [
    'Legacy system - can be slow (3-6 seconds)',
    'May use iframes for certain sections',
    'Often requires account creation',
    'CAPTCHA common on application forms',
  ],
  automationDifficulty: 4,
  quirks: [
    'Heavy use of iframes',
    'Session cookies required',
    'Some forms split across multiple pages',
    'Login often required before applying',
    'Profile completion may be required',
  ],
};

export const TALEO_CONFIG: ATSConfig = {
  type: 'taleo',
  name: 'Taleo',
  urlPatterns: [
    '\\.taleo\\.net',
    'taleo\\.com',
    '/taleo/',
  ],
  domSignatures: {
    required: ['#requisitionDescriptionInterface'],
    anyOf: [
      '.ftlEditFormWrapper',
      '.contentTitle',
      '[class*="taleo"]',
    ],
    dataAttributes: [],
  },
  api: {
    baseUrl: 'https://{company}.taleo.net',
    jobsEndpoint: '/careersection/jobsearch.ftl',
    jobEndpoint: '/careersection/jobdetail.ftl',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[id*="FirstName"]', 'input[name*="FirstName"]'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[id*="LastName"]', 'input[name*="LastName"]'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[id*="Email"]', 'input[name*="Email"]'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
  ],
  formPatterns: {
    formSelector: '#requisitionDescriptionInterface form',
    submitSelector: 'input[type="submit"], .submitBtn',
    successIndicators: [
      '.confirmationMessage',
      'text*="Application submitted"',
    ],
    errorIndicators: [
      '.errorText',
      '.ftlValidationError',
    ],
  },
  speedNotes: [
    'LEGACY system - very slow (5-10+ seconds)',
    'Heavy server-side rendering',
    'Multiple page refreshes during application',
    'Consider this system low-priority for automation',
  ],
  automationDifficulty: 5,
  quirks: [
    'Ancient system - inconsistent HTML',
    'IDs change between deployments',
    'Requires full profile creation',
    'Multi-page wizard with server roundtrips',
    'Session timeout issues common',
    'Often requires answering many screening questions',
  ],
};

export const SMARTRECRUITERS_CONFIG: ATSConfig = {
  type: 'smartrecruiters',
  name: 'SmartRecruiters',
  urlPatterns: [
    'jobs\\.smartrecruiters\\.com',
    '\\.smartrecruiters\\.com',
    '/smartrecruiters/',
  ],
  domSignatures: {
    required: ['.sr-job-application'],
    anyOf: [
      '[data-sr]',
      '.sr-job-details',
      '#smart-recruiters-frame',
    ],
    dataAttributes: ['data-job-id', 'data-company-id'],
  },
  api: {
    baseUrl: 'https://api.smartrecruiters.com/v1/companies/{companyId}',
    jobsEndpoint: '/postings',
    jobEndpoint: '/postings/{postingId}',
    applyEndpoint: '/postings/{postingId}/candidates',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="firstName"]', 'input[id="firstName"]'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="lastName"]', 'input[id="lastName"]'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', 'input[type="email"]'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['input[name="phoneNumber"]', 'input[type="tel"]'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['input[name="resume"]', '.resume-upload input'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '.sr-job-application form, form.application-form',
    submitSelector: 'button[type="submit"], .apply-button',
    successIndicators: [
      '.application-success',
      '.confirmation-screen',
      'text*="Thank you"',
    ],
    errorIndicators: [
      '.error-message',
      '.validation-error',
    ],
  },
  speedNotes: [
    'Modern React SPA - moderate load time (2-4 seconds)',
    'REST API available for programmatic access',
    'OAuth2 authentication for API',
    'Good documentation available',
  ],
  automationDifficulty: 3,
  quirks: [
    'Uses React with predictable component structure',
    'May embed forms in iframes',
    'Some companies require LinkedIn sign-in',
    'Screening questions can be extensive',
  ],
};

export const BAMBOOHR_CONFIG: ATSConfig = {
  type: 'bamboohr',
  name: 'BambooHR',
  urlPatterns: [
    '\\.bamboohr\\.com/careers',
    '\\.bamboohr\\.com/jobs',
    '/bamboohr/',
  ],
  domSignatures: {
    required: ['.BambooHR-ATS-board'],
    anyOf: [
      '[data-bamboo]',
      '.bhr-application',
      '#BambooHR-ATS',
    ],
    dataAttributes: [],
  },
  api: {
    baseUrl: 'https://{company}.bamboohr.com',
    jobsEndpoint: '/careers/list',
    jobEndpoint: '/careers/{job_id}',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="first_name"]', '#first_name'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="last_name"]', '#last_name'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', '#email'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['input[name="phone"]', '#phone'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['input[name="resume"]', '.resume-upload'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '.bhr-application form, form.application-form',
    submitSelector: 'button[type="submit"], .submit-btn',
    successIndicators: [
      '.thank-you',
      '.success-message',
      'text*="Thank you"',
    ],
    errorIndicators: [
      '.error',
      '.validation-error',
    ],
  },
  speedNotes: [
    'Simple, lightweight forms (1-2 seconds load)',
    'Standard HTML - easy to parse',
    'Limited API access',
    'Good for SMB companies',
  ],
  automationDifficulty: 2,
  quirks: [
    'Simple form structure',
    'Limited customization options means predictable layout',
    'May use embedded widgets',
    'Often minimal screening questions',
  ],
};

export const BREEZYHR_CONFIG: ATSConfig = {
  type: 'breezyhr',
  name: 'BreezyHR',
  urlPatterns: [
    '[\w-]+\\.breezy\\.hr',
    'app\\.breezy\\.hr',
    '/breezy/',
  ],
  domSignatures: {
    required: ['.breezy-application'],
    anyOf: [
      '[data-breezy]',
      '.breezy-jobs',
      '#breezy-application-form',
      'form[action*="breezy"]',
    ],
    dataAttributes: ['data-position-id'],
  },
  api: {
    baseUrl: 'https://{company}.breezy.hr',
    jobsEndpoint: '/api/v1/positions',
    jobEndpoint: '/api/v1/positions/{position_id}',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="first_name"]', '#first_name'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="last_name"]', '#last_name'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', '#email'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['input[name="phone"]', '#phone'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['input[name="resume"]', '.resume-upload'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '.breezy-application form, #breezy-application-form',
    submitSelector: 'button[type="submit"], .submit-btn',
    successIndicators: [
      '.thank-you',
      '.success-message',
      'text*="Thank you"',
    ],
    errorIndicators: [
      '.error',
      '.validation-error',
    ],
  },
  speedNotes: [
    'Modern React-based forms',
    'Fast load times (1-2 seconds)',
    'Clean API for job data',
  ],
  automationDifficulty: 2,
  quirks: [
    'Simple form structure',
    'May use custom question widgets',
    'Growing in startup space',
  ],
};

export const JAZZHR_CONFIG: ATSConfig = {
  type: 'jazzhr',
  name: 'JazzHR',
  urlPatterns: [
    '[\w-]+\\.applytojob\\.com',
    'app\\.jazz\\.co',
    '[\w-]+\\.jazz\\.co',
    '/jazzhr/',
  ],
  domSignatures: {
    required: ['.jazz-application'],
    anyOf: [
      '[data-jazz]',
      '.jazz-jobs',
      '#jazz-application-form',
      'form[action*="jazz"]',
      '.applytojob-form',
    ],
    dataAttributes: ['data-job-id', 'data-jazz-job'],
  },
  api: {
    baseUrl: 'https://{company}.applytojob.com',
    jobsEndpoint: '/apply',
    jobEndpoint: '/apply/{job_id}',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="first_name"]', '#first_name', 'input[name="fname"]'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="last_name"]', '#last_name', 'input[name="lname"]'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', '#email'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['input[name="phone"]', '#phone'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['input[name="resume"]', '.resume-upload', 'input[type="file"]'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
  ],
  formPatterns: {
    formSelector: '.jazz-application form, #jazz-application-form, .applytojob-form',
    submitSelector: 'button[type="submit"], input[type="submit"]',
    successIndicators: [
      '.confirmation',
      '.thank-you',
      'text*="Thank you"',
      'text*="Application submitted"',
    ],
    errorIndicators: [
      '.error',
      '.field-error',
    ],
  },
  speedNotes: [
    'Standard HTML forms',
    'Moderate load times (2-3 seconds)',
    'May require account creation',
  ],
  automationDifficulty: 3,
  quirks: [
    'Uses applytojob.com subdomain',
    'Standard form elements',
    'Popular with mid-market companies',
  ],
};

export const RECRUITEE_CONFIG: ATSConfig = {
  type: 'recruitee',
  name: 'Recruitee',
  urlPatterns: [
    '[\w-]+\\.recruitee\\.com',
    'careers\\.recruitee\\.com',
    '/recruitee/',
  ],
  domSignatures: {
    required: ['.recruitee-careers'],
    anyOf: [
      '[data-recruitee]',
      '.recruitee-application',
      '#recruitee-form',
      'form[action*="recruitee"]',
    ],
    dataAttributes: ['data-offer-id'],
  },
  api: {
    baseUrl: 'https://{company}.recruitee.com',
    jobsEndpoint: '/api/offers',
    jobEndpoint: '/api/offers/{offer_id}',
  },
  fieldMappings: [
    {
      standard: 'firstName',
      selectors: ['input[name="first_name"]', '#first_name'],
      namePatterns: COMMON_FIELDS.firstName.namePatterns,
      labelPatterns: COMMON_FIELDS.firstName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'lastName',
      selectors: ['input[name="last_name"]', '#last_name'],
      namePatterns: COMMON_FIELDS.lastName.namePatterns,
      labelPatterns: COMMON_FIELDS.lastName.labelPatterns,
      required: true,
      inputType: 'text',
    },
    {
      standard: 'email',
      selectors: ['input[name="email"]', '#email'],
      namePatterns: COMMON_FIELDS.email.namePatterns,
      labelPatterns: COMMON_FIELDS.email.labelPatterns,
      required: true,
      inputType: 'email',
    },
    {
      standard: 'phone',
      selectors: ['input[name="phone"]', '#phone'],
      namePatterns: COMMON_FIELDS.phone.namePatterns,
      labelPatterns: COMMON_FIELDS.phone.labelPatterns,
      required: false,
      inputType: 'tel',
    },
    {
      standard: 'resume',
      selectors: ['input[name="resume"]', '.resume-upload'],
      namePatterns: COMMON_FIELDS.resume.namePatterns,
      labelPatterns: COMMON_FIELDS.resume.labelPatterns,
      required: true,
      inputType: 'file',
    },
    {
      standard: 'linkedIn',
      selectors: ['input[name="linkedin"]', '#linkedin'],
      namePatterns: COMMON_FIELDS.linkedIn.namePatterns,
      labelPatterns: COMMON_FIELDS.linkedIn.labelPatterns,
      required: false,
      inputType: 'url',
    },
  ],
  formPatterns: {
    formSelector: '.recruitee-application form, #recruitee-form',
    submitSelector: 'button[type="submit"], .apply-button',
    successIndicators: [
      '.success',
      '.thank-you',
      'text*="Thank you"',
    ],
    errorIndicators: [
      '.error',
      '.validation-error',
    ],
  },
  speedNotes: [
    'Modern web application',
    'Fast load times (1-2 seconds)',
    'Well-structured API',
  ],
  automationDifficulty: 2,
  quirks: [
    'European ATS, growing globally',
    'Clean form structure',
    'Good API documentation',
  ],
};

// ============================================================================
// REGISTRY OBJECT
// ============================================================================

export const ATS_REGISTRY: Record<ATSType, ATSConfig> = {
  greenhouse: GREENHOUSE_CONFIG,
  lever: LEVER_CONFIG,
  ashby: ASHBY_CONFIG,
  workday: WORKDAY_CONFIG,
  jobvite: JOBVITE_CONFIG,
  icims: ICIMS_CONFIG,
  taleo: TALEO_CONFIG,
  smartrecruiters: SMARTRECRUITERS_CONFIG,
  bamboohr: BAMBOOHR_CONFIG,
  breezyhr: BREEZYHR_CONFIG,
  jazzhr: JAZZHR_CONFIG,
  recruitee: RECRUITEE_CONFIG,
  unknown: {
    type: 'unknown',
    name: 'Unknown ATS',
    urlPatterns: [],
    domSignatures: { required: [], anyOf: [] },
    fieldMappings: [],
    formPatterns: {
      formSelector: 'form',
      submitSelector: 'button[type="submit"], input[type="submit"]',
      successIndicators: ['text*="Thank you"', 'text*="submitted"'],
      errorIndicators: ['.error', '.invalid'],
    },
    speedNotes: ['Manual detection required'],
    automationDifficulty: 5,
    quirks: ['Unknown system - requires manual analysis'],
  },
};

// ============================================================================
// DETECTION UTILITIES
// ============================================================================

/**
 * URL pattern definitions with confidence scores
 */
const URL_DETECTION_PATTERNS: Array<{
  ats: ATSType;
  patterns: RegExp[];
  confidence: number;
}> = [
  {
    ats: 'greenhouse',
    patterns: [
      /boards\.greenhouse\.io\/[\w-]+/i,
      /job-boards\.greenhouse\.io/i,
      /grnh\.se\//i,
      /\?gh_jid=\d+/i,
      /greenhouse\.io\/embed\/job_board/i,
    ],
    confidence: 95,
  },
  {
    ats: 'lever',
    patterns: [
      /jobs\.lever\.co\/[\w-]+/i,
      /apply\.lever\.co/i,
      /lever\.co\/[\w-]+\/[\w-]+/i,
    ],
    confidence: 95,
  },
  {
    ats: 'ashby',
    patterns: [
      /jobs\.ashbyhq\.com\/[\w-]+/i,
      /[\w-]+\.ashbyhq\.com/i,
      /app\.ashbyhq\.com/i,
    ],
    confidence: 95,
  },
  {
    ats: 'workday',
    patterns: [
      /[\w-]+\.wd\d+\.myworkdayjobs\.com/i,
      /[\w-]+\.myworkdayjobs\.com/i,
      /workdayjobs\.com\/[\w-]+/i,
    ],
    confidence: 95,
  },
  {
    ats: 'jobvite',
    patterns: [
      /jobs\.jobvite\.com\/[\w-]+/i,
      /[\w-]+\.jobvite\.com\/apply/i,
      /hire\.jobvite\.com/i,
    ],
    confidence: 95,
  },
  {
    ats: 'icims',
    patterns: [
      /careers-[\w-]+\.icims\.com/i,
      /[\w-]+\.icims\.com\/jobs/i,
      /icims\.com\/[\w-]+\/jobs/i,
    ],
    confidence: 95,
  },
  {
    ats: 'taleo',
    patterns: [
      /[\w-]+\.taleo\.net/i,
      /taleo\.com\/careersection/i,
      /recruiter\.taleo/i,
    ],
    confidence: 95,
  },
  {
    ats: 'smartrecruiters',
    patterns: [
      /jobs\.smartrecruiters\.com\/[\w-]+/i,
      /careers\.smartrecruiters\.com/i,
      /[\w-]+\.smartrecruiters\.com/i,
    ],
    confidence: 95,
  },
  {
    ats: 'bamboohr',
    patterns: [
      /[\w-]+\.bamboohr\.com\/careers/i,
      /[\w-]+\.bamboohr\.com\/jobs/i,
    ],
    confidence: 95,
  },
  {
    ats: 'breezyhr',
    patterns: [
      /[\w-]+\.breezy\.hr/i,
      /app\.breezy\.hr/i,
    ],
    confidence: 95,
  },
  {
    ats: 'jazzhr',
    patterns: [
      /[\w-]+\.applytojob\.com/i,
      /app\.jazz\.co/i,
      /[\w-]+\.jazz\.co/i,
    ],
    confidence: 95,
  },
  {
    ats: 'recruitee',
    patterns: [
      /[\w-]+\.recruitee\.com/i,
      /careers\.recruitee\.com/i,
    ],
    confidence: 95,
  },
];

/**
 * Detect ATS type from a URL (simple version - returns ATSType)
 */
export function detectATSFromURL(url: string): ATSType {
  const result = detectATSFromURLWithConfidence(url);
  return result.atsType;
}

/**
 * Primary URL-based ATS detection with confidence scoring
 * Executes first - no DOM access required
 */
export function detectATSFromURLWithConfidence(url: string): ATSDetectionResult {
  const normalizedUrl = url.toLowerCase();

  for (const { ats, patterns, confidence } of URL_DETECTION_PATTERNS) {
    for (const regex of patterns) {
      if (regex.test(normalizedUrl)) {
        return {
          atsType: ats,
          confidence,
          method: 'url',
          signals: [`URL matches ${regex.source}`],
        };
      }
    }
  }

  // Fallback to registry patterns for any not in optimized list
  for (const [atsType, config] of Object.entries(ATS_REGISTRY)) {
    if (atsType === 'unknown') continue;

    for (const pattern of config.urlPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(url)) {
        return {
          atsType: atsType as ATSType,
          confidence: 90,
          method: 'url',
          signals: [`URL matches registry pattern: ${pattern}`],
        };
      }
    }
  }

  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'url',
    signals: ['No URL pattern matched'],
  };
}

/**
 * Get all URL patterns for quick detection
 */
export function getAllURLPatterns(): { atsType: ATSType; pattern: RegExp }[] {
  const patterns: { atsType: ATSType; pattern: RegExp }[] = [];

  for (const [atsType, config] of Object.entries(ATS_REGISTRY)) {
    if (atsType === 'unknown') continue;

    for (const patternStr of config.urlPatterns) {
      patterns.push({
        atsType: atsType as ATSType,
        pattern: new RegExp(patternStr, 'i'),
      });
    }
  }

  return patterns;
}

/**
 * Get supported ATS types (those with low automation difficulty)
 */
export function getSupportedATSTypes(): ATSType[] {
  return Object.entries(ATS_REGISTRY)
    .filter(([_, config]) => config.automationDifficulty <= 3)
    .map(([type, _]) => type as ATSType);
}

/**
 * Get field mapping for a standard field across all ATS types
 */
export function getFieldMapping(atsType: ATSType, standardField: string): ATSFieldMapping | undefined {
  const config = ATS_REGISTRY[atsType];
  return config?.fieldMappings.find(m => m.standard === standardField);
}

/**
 * Find a field by label text in any ATS
 */
export function findFieldByLabel(atsType: ATSType, labelText: string): ATSFieldMapping | undefined {
  const config = ATS_REGISTRY[atsType];
  const normalizedLabel = labelText.toLowerCase().trim();

  return config?.fieldMappings.find(m =>
    m.labelPatterns.some(p => normalizedLabel.includes(p.toLowerCase()))
  );
}

/**
 * Priority order for automation (easiest first)
 */
export const ATS_AUTOMATION_PRIORITY: ATSType[] = [
  'lever',
  'greenhouse',
  'ashby',
  'bamboohr',
  'breezyhr',
  'recruitee',
  'smartrecruiters',
  'jazzhr',
  'jobvite',
  'icims',
  'workday',
  'taleo',
];

// ============================================================================
// DOM FINGERPRINTING DETECTION
// ============================================================================

/**
 * Individual DOM detector for Greenhouse
 */
function detectGreenhouseDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('#application-form')) {
    signals.push('Found #application-form');
  }
  if (doc.querySelector('[data-greenhouse]')) {
    signals.push('Found [data-greenhouse] attribute');
  }
  if (doc.querySelector('.greenhouse-form')) {
    signals.push('Found .greenhouse-form class');
  }
  if (doc.querySelector('#greenhouse-jobboard')) {
    signals.push('Found #greenhouse-jobboard');
  }
  if (doc.querySelector('input[name*="job_application"]')) {
    signals.push('Found job_application input pattern');
  }
  const dataJobId = doc.querySelector('[data-job-id]');
  const dataToken = doc.querySelector('[data-token]');
  if (dataJobId) signals.push('Found [data-job-id]');
  if (dataToken) signals.push('Found [data-token]');

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Lever
 */
function detectLeverDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.application-form')) {
    signals.push('Found .application-form');
  }
  if (doc.querySelector('.lever-form')) {
    signals.push('Found .lever-form class');
  }
  if (doc.querySelector('[data-lever]')) {
    signals.push('Found [data-lever] attribute');
  }
  if (doc.querySelector('.lever-application')) {
    signals.push('Found .lever-application');
  }
  if (doc.querySelector('.posting-application')) {
    signals.push('Found .posting-application');
  }
  if (doc.querySelector('form[action*="lever"]')) {
    signals.push('Found form with lever action');
  }
  if (doc.querySelector('[data-posting-id]')) {
    signals.push('Found [data-posting-id]');
  }
  if (doc.querySelector('input[name*="urls["]')) {
    signals.push('Found Lever URLs field pattern');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Ashby
 */
function detectAshbyDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.ashby-application-form')) {
    signals.push('Found .ashby-application-form');
  }
  if (doc.querySelector('[data-ashby]')) {
    signals.push('Found [data-ashby] attribute');
  }
  if (doc.querySelector('.ashby-job-posting')) {
    signals.push('Found .ashby-job-posting');
  }
  if (doc.querySelector('#ashby-embed')) {
    signals.push('Found #ashby-embed');
  }
  if (doc.querySelector('form[data-form-type="application"]')) {
    signals.push('Found application form type');
  }
  if (doc.querySelector('[data-job-posting-id]')) {
    signals.push('Found [data-job-posting-id]');
  }
  if (doc.querySelector('[data-ashby-job-posting-id]')) {
    signals.push('Found [data-ashby-job-posting-id]');
  }
  if (doc.querySelector('input[name*="_systemfield_"]')) {
    signals.push('Found _systemfield_ input pattern');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Workday
 */
function detectWorkdayDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  const automationIds = doc.querySelectorAll('[data-automation-id]');
  if (automationIds.length > 5) {
    signals.push(`Found ${automationIds.length} data-automation-id elements`);
  }
  if (doc.querySelector('.WGDC')) {
    signals.push('Found .WGDC class');
  }
  if (doc.querySelector('.WPF')) {
    signals.push('Found .WPF class');
  }
  if (doc.querySelector('[data-automation-id="jobPostingPage"]')) {
    signals.push('Found jobPostingPage automation id');
  }
  if (doc.querySelector('[data-automation-id="applyButton"]')) {
    signals.push('Found applyButton automation id');
  }
  if (doc.querySelector('[data-uxi-widget-type]')) {
    signals.push('Found Workday UXI widget');
  }
  if (doc.querySelector('[data-automation-id="legalNameSection_firstName"]')) {
    signals.push('Found Workday firstName field');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Jobvite
 */
function detectJobviteDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('#jv-application-form')) {
    signals.push('Found #jv-application-form');
  }
  if (doc.querySelector('.jv-page-body')) {
    signals.push('Found .jv-page-body');
  }
  if (doc.querySelector('.jv-header')) {
    signals.push('Found .jv-header');
  }
  if (doc.querySelector('[class*="jobvite"]')) {
    signals.push('Found jobvite class pattern');
  }
  if (doc.querySelector('[data-jv-app]')) {
    signals.push('Found [data-jv-app]');
  }
  if (doc.querySelector('[data-jv-job-id]')) {
    signals.push('Found [data-jv-job-id]');
  }
  if (doc.querySelector('#jv-firstName')) {
    signals.push('Found jv-prefixed form fields');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for iCIMS
 */
function detectICIMSDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('#icims_content')) {
    signals.push('Found #icims_content');
  }
  if (doc.querySelector('.iCIMS_MainWrapper')) {
    signals.push('Found .iCIMS_MainWrapper');
  }
  if (doc.querySelector('.iCIMS_JobContent')) {
    signals.push('Found .iCIMS_JobContent');
  }
  if (doc.querySelector('[class*="icims"]')) {
    signals.push('Found icims class pattern');
  }

  const iframes = Array.from(doc.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    if (iframe.src?.includes('icims')) {
      signals.push('Found iCIMS iframe');
      break;
    }
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Taleo
 */
function detectTaleoDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('#requisitionDescriptionInterface')) {
    signals.push('Found #requisitionDescriptionInterface');
  }
  if (doc.querySelector('.ftlEditFormWrapper')) {
    signals.push('Found .ftlEditFormWrapper');
  }
  if (doc.querySelector('.contentTitle')) {
    signals.push('Found .contentTitle');
  }
  if (doc.querySelector('[class*="taleo"]')) {
    signals.push('Found taleo class pattern');
  }
  if (doc.querySelector('input[id*="FirstName"]')) {
    signals.push('Found Taleo FirstName pattern');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for SmartRecruiters
 */
function detectSmartRecruitersDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.sr-job-application')) {
    signals.push('Found .sr-job-application');
  }
  if (doc.querySelector('[data-sr]')) {
    signals.push('Found [data-sr] attribute');
  }
  if (doc.querySelector('.sr-job-details')) {
    signals.push('Found .sr-job-details');
  }
  if (doc.querySelector('#smart-recruiters-frame')) {
    signals.push('Found #smart-recruiters-frame');
  }
  if (doc.querySelector('[data-company-id]')) {
    signals.push('Found [data-company-id]');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for BambooHR
 */
function detectBambooHRDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.BambooHR-ATS-board')) {
    signals.push('Found .BambooHR-ATS-board');
  }
  if (doc.querySelector('[data-bamboo]')) {
    signals.push('Found [data-bamboo] attribute');
  }
  if (doc.querySelector('.bhr-application')) {
    signals.push('Found .bhr-application');
  }
  if (doc.querySelector('#BambooHR-ATS')) {
    signals.push('Found #BambooHR-ATS');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for BreezyHR
 */
function detectBreezyHRDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.breezy-application')) {
    signals.push('Found .breezy-application');
  }
  if (doc.querySelector('[data-breezy]')) {
    signals.push('Found [data-breezy] attribute');
  }
  if (doc.querySelector('.breezy-jobs')) {
    signals.push('Found .breezy-jobs');
  }
  if (doc.querySelector('#breezy-application-form')) {
    signals.push('Found #breezy-application-form');
  }
  if (doc.querySelector('[data-position-id]')) {
    signals.push('Found [data-position-id]');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for JazzHR
 */
function detectJazzHRDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.jazz-application')) {
    signals.push('Found .jazz-application');
  }
  if (doc.querySelector('[data-jazz]')) {
    signals.push('Found [data-jazz] attribute');
  }
  if (doc.querySelector('.jazz-jobs')) {
    signals.push('Found .jazz-jobs');
  }
  if (doc.querySelector('#jazz-application-form')) {
    signals.push('Found #jazz-application-form');
  }
  if (doc.querySelector('.applytojob-form')) {
    signals.push('Found .applytojob-form');
  }
  if (doc.querySelector('[data-jazz-job]')) {
    signals.push('Found [data-jazz-job]');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * Individual DOM detector for Recruitee
 */
function detectRecruiteeDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];

  if (doc.querySelector('.recruitee-careers')) {
    signals.push('Found .recruitee-careers');
  }
  if (doc.querySelector('[data-recruitee]')) {
    signals.push('Found [data-recruitee] attribute');
  }
  if (doc.querySelector('.recruitee-application')) {
    signals.push('Found .recruitee-application');
  }
  if (doc.querySelector('#recruitee-form')) {
    signals.push('Found #recruitee-form');
  }
  if (doc.querySelector('[data-offer-id]')) {
    signals.push('Found [data-offer-id]');
  }

  return { found: signals.length >= 2, signals };
}

/**
 * DOM-based ATS detection
 * Requires page to be loaded in browser context
 */
export function detectATSFromDOM(doc: Document): ATSDetectionResult {
  const detectors: Array<{
    ats: ATSType;
    detect: () => { found: boolean; signals: string[] };
    confidence: number;
  }> = [
    { ats: 'greenhouse', detect: () => detectGreenhouseDOM(doc), confidence: 90 },
    { ats: 'lever', detect: () => detectLeverDOM(doc), confidence: 90 },
    { ats: 'ashby', detect: () => detectAshbyDOM(doc), confidence: 90 },
    { ats: 'workday', detect: () => detectWorkdayDOM(doc), confidence: 90 },
    { ats: 'jobvite', detect: () => detectJobviteDOM(doc), confidence: 90 },
    { ats: 'icims', detect: () => detectICIMSDOM(doc), confidence: 90 },
    { ats: 'taleo', detect: () => detectTaleoDOM(doc), confidence: 90 },
    { ats: 'smartrecruiters', detect: () => detectSmartRecruitersDOM(doc), confidence: 90 },
    { ats: 'bamboohr', detect: () => detectBambooHRDOM(doc), confidence: 90 },
    { ats: 'breezyhr', detect: () => detectBreezyHRDOM(doc), confidence: 90 },
    { ats: 'jazzhr', detect: () => detectJazzHRDOM(doc), confidence: 90 },
    { ats: 'recruitee', detect: () => detectRecruiteeDOM(doc), confidence: 90 },
  ];

  for (const { ats, detect, confidence } of detectors) {
    const result = detect();
    if (result.found) {
      return {
        atsType: ats,
        confidence,
        method: 'dom',
        signals: result.signals,
      };
    }
  }

  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'dom',
    signals: ['No DOM signature matched'],
  };
}

// ============================================================================
// META TAG DETECTION
// ============================================================================

/**
 * ATS-specific meta tag patterns
 */
const META_PATTERNS: Array<{ ats: ATSType; patterns: string[]; confidence: number }> = [
  { ats: 'greenhouse', patterns: ['greenhouse', 'grnh'], confidence: 85 },
  { ats: 'lever', patterns: ['lever'], confidence: 85 },
  { ats: 'ashby', patterns: ['ashby', 'ashbyhq'], confidence: 85 },
  { ats: 'workday', patterns: ['workday', 'myworkdayjobs'], confidence: 85 },
  { ats: 'jobvite', patterns: ['jobvite'], confidence: 85 },
  { ats: 'icims', patterns: ['icims'], confidence: 85 },
  { ats: 'taleo', patterns: ['taleo', 'oracle recruiting'], confidence: 85 },
  { ats: 'smartrecruiters', patterns: ['smartrecruiters'], confidence: 85 },
  { ats: 'bamboohr', patterns: ['bamboohr', 'bamboo hr'], confidence: 85 },
  { ats: 'breezyhr', patterns: ['breezy', 'breezyhr'], confidence: 85 },
  { ats: 'jazzhr', patterns: ['jazz', 'jazzhr', 'applytojob'], confidence: 85 },
  { ats: 'recruitee', patterns: ['recruitee'], confidence: 85 },
];

/**
 * Meta tag based ATS detection
 * Fast and reliable when meta tags are present
 */
export function detectATSFromMeta(doc: Document): ATSDetectionResult {
  const signals: string[] = [];

  // Check generator meta tag
  const generator = doc.querySelector('meta[name="generator"]');
  const generatorContent = generator?.getAttribute('content')?.toLowerCase() || '';

  // Check application-name
  const appName = doc.querySelector('meta[name="application-name"]');
  const appNameContent = appName?.getAttribute('content')?.toLowerCase() || '';

  // Check og:site_name
  const siteName = doc.querySelector('meta[property="og:site_name"]');
  const siteNameContent = siteName?.getAttribute('content')?.toLowerCase() || '';

  // Check all meta tags for ATS hints
  const allMeta = doc.querySelectorAll('meta');
  const metaStrings = Array.from(allMeta)
    .map((m) => `${m.getAttribute('name')} ${m.getAttribute('property')} ${m.getAttribute('content')}`)
    .join(' ')
    .toLowerCase();

  for (const { ats, patterns, confidence } of META_PATTERNS) {
    for (const pattern of patterns) {
      if (
        generatorContent.includes(pattern) ||
        appNameContent.includes(pattern) ||
        siteNameContent.includes(pattern) ||
        metaStrings.includes(pattern)
      ) {
        signals.push(`Meta tag contains "${pattern}"`);
        return {
          atsType: ats,
          confidence,
          method: 'meta',
          signals,
        };
      }
    }
  }

  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'meta',
    signals: ['No ATS meta tags found'],
  };
}

// ============================================================================
// SCRIPT/ASSET FINGERPRINTING
// ============================================================================

/**
 * Asset patterns for script/CSS fingerprinting
 */
const ASSET_PATTERNS: Array<{ ats: ATSType; patterns: string[]; confidence: number }> = [
  {
    ats: 'greenhouse',
    patterns: ['boards.greenhouse.io', 'greenhouse-assets', 'greenhouse_embed', 'greenhouse_jobs', 'ghJobBoard'],
    confidence: 88,
  },
  {
    ats: 'lever',
    patterns: ['lever-analytics', 'lever.co/embed', 'lever_jobs', 'LeverApplication', 'postings.lever.co'],
    confidence: 88,
  },
  {
    ats: 'ashby',
    patterns: ['ashbyhq.com', 'ashby-embed', 'ashby-application', 'AshbyApplication'],
    confidence: 88,
  },
  {
    ats: 'workday',
    patterns: ['myworkdayjobs', 'wd-resources', 'workday-cdn', 'wday/cxs', 'WDAY_APPLICATION'],
    confidence: 88,
  },
  {
    ats: 'jobvite',
    patterns: ['jobs.jobvite.com', 'jobvite-assets', 'jv-assets', 'JobviteClient'],
    confidence: 88,
  },
  {
    ats: 'icims',
    patterns: ['icims.com', 'icims-assets', 'iCIMS_'],
    confidence: 88,
  },
  {
    ats: 'taleo',
    patterns: ['taleo.net', 'taleo-assets', 'OracleRecruiting'],
    confidence: 88,
  },
  {
    ats: 'smartrecruiters',
    patterns: ['smartrecruiters.com', 'smrtr.io', 'SmartRecruiters'],
    confidence: 88,
  },
  {
    ats: 'bamboohr',
    patterns: ['bamboohr.com', 'bamboo-assets', 'BambooHR'],
    confidence: 88,
  },
  {
    ats: 'breezyhr',
    patterns: ['breezy.hr', 'breezy-assets', 'BreezyApplication'],
    confidence: 88,
  },
  {
    ats: 'jazzhr',
    patterns: ['applytojob.com', 'jazz.co', 'JazzHR'],
    confidence: 88,
  },
  {
    ats: 'recruitee',
    patterns: ['recruitee.com', 'recruitee-assets', 'Recruitee'],
    confidence: 88,
  },
];

/**
 * Script and asset fingerprinting for ATS detection
 * Most comprehensive but slowest method
 */
export function detectATSFromScripts(doc: Document): ATSDetectionResult {
  const signals: string[] = [];

  // Collect all script sources
  const scripts = Array.from(doc.querySelectorAll('script[src]'));
  const scriptSrcs = scripts.map((s) => s.getAttribute('src') || '').join(' ').toLowerCase();

  // Collect all stylesheet links
  const stylesheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
  const styleSrcs = stylesheets.map((s) => s.getAttribute('href') || '').join(' ').toLowerCase();

  // Collect inline scripts content
  const inlineScripts = Array.from(doc.querySelectorAll('script:not([src])'));
  const inlineContent = inlineScripts.map((s) => s.textContent || '').join(' ').toLowerCase();

  const allAssets = `${scriptSrcs} ${styleSrcs} ${inlineContent}`;

  for (const { ats, patterns, confidence } of ASSET_PATTERNS) {
    for (const pattern of patterns) {
      if (allAssets.includes(pattern.toLowerCase())) {
        signals.push(`Found asset pattern: ${pattern}`);
        return {
          atsType: ats,
          confidence,
          method: 'script',
          signals,
        };
      }
    }
  }

  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'script',
    signals: ['No ATS script/asset patterns found'],
  };
}

/**
 * Global variable patterns for window object detection
 */
const GLOBAL_PATTERNS: Array<{ ats: ATSType; globals: string[]; confidence: number }> = [
  { ats: 'greenhouse', globals: ['Grnhse', 'GreenhouseJobBoard', 'GH_JOB_BOARD'], confidence: 92 },
  { ats: 'lever', globals: ['Lever', 'LeverApplication', 'LEVER_JOB_POSTING'], confidence: 92 },
  { ats: 'ashby', globals: ['Ashby', 'AshbyApplication', 'ASHBY_CONFIG'], confidence: 92 },
  { ats: 'workday', globals: ['WorkdayApp', 'WDAY', 'wd_application'], confidence: 92 },
  { ats: 'jobvite', globals: ['Jobvite', 'JV_APPLICATION'], confidence: 92 },
];

/**
 * Check for ATS-specific global JavaScript variables
 * Note: This requires access to the window object (browser context)
 */
export function detectATSFromGlobals(windowObj: Window): ATSDetectionResult {
  const signals: string[] = [];

  for (const { ats, globals, confidence } of GLOBAL_PATTERNS) {
    for (const global of globals) {
      if (global in windowObj) {
        signals.push(`Found global: window.${global}`);
        return {
          atsType: ats,
          confidence,
          method: 'script',
          signals,
        };
      }
    }
  }

  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'script',
    signals: ['No ATS globals found'],
  };
}

// ============================================================================
// COMBINED DETECTION WITH CONFIDENCE
// ============================================================================

/**
 * Combined detection with confidence scoring
 * Uses multiple detection methods and aggregates results
 */
export function detectATSWithConfidence(
  url: string,
  doc?: Document,
  windowObj?: Window
): ATSDetectionResult {
  const results: ATSDetectionResult[] = [];

  // 1. URL detection (always runs first)
  const urlResult = detectATSFromURLWithConfidence(url);
  if (urlResult.confidence >= 95) {
    return urlResult; // High confidence, return early
  }
  results.push(urlResult);

  if (doc) {
    // 2. Meta tag detection
    const metaResult = detectATSFromMeta(doc);
    if (metaResult.confidence >= 85) {
      results.push(metaResult);
    }

    // 3. DOM fingerprinting
    const domResult = detectATSFromDOM(doc);
    if (domResult.confidence >= 90) {
      results.push(domResult);
    }

    // 4. Script/asset fingerprinting
    const scriptResult = detectATSFromScripts(doc);
    if (scriptResult.confidence >= 88) {
      results.push(scriptResult);
    }
  }

  if (windowObj) {
    // 5. Global variable detection
    const globalResult = detectATSFromGlobals(windowObj);
    if (globalResult.confidence >= 92) {
      results.push(globalResult);
    }
  }

  // Aggregate results
  if (results.length === 0) {
    return {
      atsType: 'unknown',
      confidence: 0,
      method: 'url',
      signals: ['No detection methods succeeded'],
    };
  }

  // Find highest confidence result
  let best = results.reduce((a, b) => (a.confidence > b.confidence ? a : b));

  // Boost confidence if multiple methods agree
  const agreeing = results.filter((r) => r.atsType === best.atsType && r.atsType !== 'unknown');
  if (agreeing.length > 1) {
    const boostedConfidence = Math.min(99, best.confidence + (agreeing.length - 1) * 3);
    const allSignals = agreeing.flatMap((r) => r.signals);
    allSignals.push(`${agreeing.length} detection methods agree`);
    best = {
      ...best,
      confidence: boostedConfidence,
      signals: allSignals,
    };
  }

  return best;
}

// ============================================================================
// FALLBACK GENERIC FORM DETECTION
// ============================================================================

export interface GenericFormDetectionResult {
  /** Whether this appears to be a job application form */
  isApplicationForm: boolean;
  /** Confidence score 0-80 (capped for unknown ATS) */
  confidence: number;
  /** The form element if found */
  formElement: HTMLFormElement | null;
  /** Types of fields detected */
  fieldTypes: string[];
}

/**
 * Fallback detection for unknown ATS systems
 * Uses heuristics to identify job application forms
 */
export function detectGenericApplicationForm(doc: Document): GenericFormDetectionResult {
  const forms = Array.from(doc.querySelectorAll('form'));

  for (const form of forms) {
    const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
    const fieldTypes: string[] = [];
    let score = 0;

    for (const input of inputs) {
      const name = (input.getAttribute('name') || '').toLowerCase();
      const type = input.getAttribute('type') || 'text';
      const label = input.getAttribute('aria-label') || '';
      const placeholder = input.getAttribute('placeholder') || '';
      const combined = `${name} ${type} ${label} ${placeholder}`.toLowerCase();

      // Score based on field types
      if (combined.includes('name') || combined.includes('first') || combined.includes('last')) {
        score += 10;
        fieldTypes.push('name');
      }
      if (combined.includes('email') || type === 'email') {
        score += 15;
        fieldTypes.push('email');
      }
      if (combined.includes('phone') || combined.includes('tel') || type === 'tel') {
        score += 10;
        fieldTypes.push('phone');
      }
      if (combined.includes('resume') || combined.includes('cv') || type === 'file') {
        score += 20;
        fieldTypes.push('resume');
      }
      if (combined.includes('linkedin')) {
        score += 8;
        fieldTypes.push('linkedin');
      }
      if (combined.includes('cover') && combined.includes('letter')) {
        score += 10;
        fieldTypes.push('coverLetter');
      }
      if (combined.includes('work') && combined.includes('auth')) {
        score += 12;
        fieldTypes.push('workAuth');
      }
      if (combined.includes('sponsor')) {
        score += 12;
        fieldTypes.push('sponsorship');
      }
    }

    // Check for submit button text
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    const submitText = (submitBtn?.textContent || (submitBtn as HTMLInputElement)?.value || '').toLowerCase();

    if (submitText.includes('apply') || submitText.includes('submit')) {
      score += 15;
    }

    // Minimum threshold for job application
    if (score >= 45 && fieldTypes.includes('email') && fieldTypes.includes('resume')) {
      return {
        isApplicationForm: true,
        confidence: Math.min(score, 80), // Cap at 80 for unknown ATS
        formElement: form as HTMLFormElement,
        fieldTypes: Array.from(new Set(fieldTypes)),
      };
    }
  }

  return {
    isApplicationForm: false,
    confidence: 0,
    formElement: null,
    fieldTypes: [],
  };
}

// ============================================================================
// API PROBING
// ============================================================================

/**
 * API endpoint templates for probing
 */
const API_ENDPOINTS: Partial<Record<ATSType, (id: string) => string>> = {
  greenhouse: (id) => `https://boards-api.greenhouse.io/v1/boards/${id}/jobs`,
  lever: (id) => `https://api.lever.co/v0/postings/${id}`,
  ashby: (id) => `https://api.ashbyhq.com/posting-api/job-board/${id}/jobs`,
  smartrecruiters: (id) => `https://api.smartrecruiters.com/v1/companies/${id}/postings`,
  bamboohr: (id) => `https://${id}.bamboohr.com/careers/list`,
};

/**
 * Probe known ATS API endpoints to verify detection
 */
export async function probeATSAPI(atsType: ATSType, identifier: string): Promise<boolean> {
  const getEndpoint = API_ENDPOINTS[atsType];
  if (!getEndpoint) return false;

  const endpoint = getEndpoint(identifier);
  if (!endpoint) return false;

  try {
    const response = await fetch(endpoint, {
      method: 'HEAD',
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Enhanced detection combining new detection methods with registry
 */
export function detectAndGetConfig(
  url: string,
  doc?: Document
): {
  detection: ATSDetectionResult;
  config: ATSConfig | null;
} {
  const detection = detectATSWithConfidence(url, doc);

  const config = detection.atsType !== 'unknown' ? ATS_REGISTRY[detection.atsType] : null;

  return { detection, config };
}

/**
 * Get field mapping based on detection result
 */
export function getFieldsForDetectedATS(detection: ATSDetectionResult): ATSFieldMapping[] {
  if (detection.atsType === 'unknown') {
    return [];
  }

  return ATS_REGISTRY[detection.atsType].fieldMappings;
}

/**
 * Validate detection against expected URL patterns
 */
export function validateDetection(detection: ATSDetectionResult, url: string): boolean {
  if (detection.atsType === 'unknown') {
    return false;
  }

  const config = ATS_REGISTRY[detection.atsType];

  return config.urlPatterns.some((pattern) => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(url);
  });
}

/**
 * Get confidence threshold recommendation
 */
export function getConfidenceRecommendation(confidence: number): {
  level: 'high' | 'medium' | 'low' | 'unknown';
  action: string;
} {
  if (confidence >= 95) {
    return { level: 'high', action: 'Proceed with automation' };
  } else if (confidence >= 85) {
    return { level: 'medium', action: 'May need verification' };
  } else if (confidence >= 70) {
    return { level: 'low', action: 'Suggest manual review' };
  } else {
    return { level: 'unknown', action: 'Cannot automate' };
  }
}

// ============================================================================
// COMMON QUESTION PATTERNS
// ============================================================================

/**
 * Common screening question patterns and how to answer them
 */
export const COMMON_QUESTION_PATTERNS = {
  workAuthorization: {
    patterns: [
      /authorized.*work/i,
      /legally.*work/i,
      /work.*authorization/i,
      /eligible.*work/i,
      /right to work/i,
    ],
    answerType: 'yes_no' as const,
    profileField: 'work_authorization',
  },
  sponsorship: {
    patterns: [
      /require.*sponsorship/i,
      /need.*sponsorship/i,
      /visa.*sponsorship/i,
      /immigration.*sponsorship/i,
      /sponsor.*visa/i,
    ],
    answerType: 'yes_no' as const,
    profileField: 'require_sponsorship',
  },
  relocate: {
    patterns: [
      /willing.*relocate/i,
      /open.*relocation/i,
      /relocate.*position/i,
    ],
    answerType: 'yes_no' as const,
    profileField: 'willing_to_relocate',
  },
  yearsExperience: {
    patterns: [
      /years.*experience/i,
      /experience.*years/i,
      /how many years/i,
      /total.*experience/i,
    ],
    answerType: 'number' as const,
    profileField: 'years_experience',
  },
  startDate: {
    patterns: [
      /start date/i,
      /earliest.*start/i,
      /when.*start/i,
      /availability.*start/i,
    ],
    answerType: 'date' as const,
    profileField: 'start_date',
  },
  salary: {
    patterns: [
      /salary.*expect/i,
      /expected.*salary/i,
      /compensation.*expect/i,
      /desired.*salary/i,
    ],
    answerType: 'text' as const,
    profileField: 'salary_expectation',
  },
  gender: {
    patterns: [
      /what.*gender/i,
      /gender.*identity/i,
      /^gender$/i,
    ],
    answerType: 'select' as const,
    profileField: 'eeoc_gender',
    note: 'EEOC - typically optional',
  },
  ethnicity: {
    patterns: [
      /race.*ethnicity/i,
      /ethnic.*background/i,
      /racial.*background/i,
    ],
    answerType: 'select' as const,
    profileField: 'eeoc_ethnicity',
    note: 'EEOC - typically optional',
  },
  veteran: {
    patterns: [
      /veteran.*status/i,
      /military.*service/i,
      /protected.*veteran/i,
    ],
    answerType: 'select' as const,
    profileField: 'eeoc_veteran',
    note: 'EEOC - typically optional',
  },
  disability: {
    patterns: [
      /disability.*status/i,
      /disabled/i,
      /accommodation/i,
    ],
    answerType: 'select' as const,
    profileField: 'eeoc_disability',
    note: 'EEOC - typically optional',
  },
  referral: {
    patterns: [
      /how.*hear.*about/i,
      /referred.*by/i,
      /source.*application/i,
      /found.*job/i,
    ],
    answerType: 'text' as const,
    profileField: 'referral_source',
  },
};

// ============================================================================
// EXPORT DEFAULT CONFIG
// ============================================================================

export default ATS_REGISTRY;
