/**
 * Configuration for auto-apply scripts
 */

export const config = {
  // Browser settings
  browser: {
    headless: false, // Set to true for background operation
    slowMo: 100,     // Milliseconds between actions (helps avoid detection)
    timeout: 30000,  // Default timeout for actions
  },

  // ATS detection patterns
  atsPatterns: {
    greenhouse: [
      /boards\.greenhouse\.io/i,
      /job-boards\.greenhouse\.io/i,
      /careers\..*\.com.*greenhouse/i,
    ],
    lever: [
      /jobs\.lever\.co/i,
      /lever\.co\/.*\/apply/i,
    ],
    ashby: [
      /jobs\.ashbyhq\.com/i,
      /ashbyhq\.com.*apply/i,
    ],
    jobvite: [
      /jobs\.jobvite\.com/i,
      /.*\.jobvite\.com/i,
    ],
  },

  // Field label patterns for smart matching
  fieldPatterns: {
    firstName: ['first name', 'first_name', 'firstname', 'given name'],
    lastName: ['last name', 'last_name', 'lastname', 'surname', 'family name'],
    fullName: ['full name', 'name', 'your name'],
    email: ['email', 'e-mail', 'email address'],
    phone: ['phone', 'telephone', 'mobile', 'cell', 'phone number'],
    linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
    github: ['github', 'github url', 'github profile'],
    website: ['website', 'portfolio', 'personal website', 'portfolio url'],
    resume: ['resume', 'cv', 'curriculum vitae'],
    coverLetter: ['cover letter', 'cover_letter', 'coverletter'],
    workAuth: [
      'authorized to work',
      'work authorization',
      'legally authorized',
      'require sponsorship',
      'visa sponsorship',
    ],
    yearsExperience: ['years of experience', 'experience', 'years experience'],
    degree: ['degree', 'education', 'highest degree'],
    location: ['location', 'city', 'where are you located'],
    startDate: ['start date', 'when can you start', 'availability'],
    salary: ['salary', 'compensation', 'expected salary', 'desired salary'],
  },

  // Default delays (optimized for speed while avoiding detection)
  delays: {
    betweenFields: 100,      // Reduced from 200ms - fields are filled in parallel now
    betweenBatches: 50,      // Delay between parallel batches
    beforeSubmit: 800,       // Reduced from 1000ms
    afterPageLoad: 400,      // Reduced from 500ms
    afterUpload: 300,        // Delay after file uploads
  },

  // Parallel filling settings (performance optimization)
  parallel: {
    enabled: true,           // Enable parallel field filling
    batchSize: 4,            // Max fields per parallel batch
    maxConcurrent: 3,        // Max concurrent browser connections
  },

  // Retry settings (enhanced with exponential backoff)
  retry: {
    maxAttempts: 3,
    delayBetweenAttempts: 800, // Base delay (will use exponential backoff)
    // Backoff configuration
    backoff: {
      baseDelay: 1000,      // Initial delay in ms
      maxDelay: 30000,      // Maximum delay cap in ms
      factor: 2,            // Exponential factor
      jitter: 'full',       // Jitter strategy: 'full', 'equal', 'decorrelated', 'none'
    },
    // Error classification
    retryOnTransient: true,     // Retry on network errors, timeouts
    retryOnRateLimit: true,     // Retry on 429 (with Retry-After)
    retryOnServerError: true,   // Retry on 5xx errors
    failFastOnPermanent: true,  // Don't retry on 4xx (except 429)
  },

  // Performance tracking
  performance: {
    enabled: true,           // Enable performance logging
    logDetails: true,        // Log detailed timing breakdowns
  },
};

/**
 * Detect ATS type from URL
 * @param {string} url - Job application URL
 * @returns {string|null} - ATS name or null if not detected
 */
export function detectATS(url) {
  for (const [ats, patterns] of Object.entries(config.atsPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(url)) {
        return ats;
      }
    }
  }
  return null;
}

export default config;
