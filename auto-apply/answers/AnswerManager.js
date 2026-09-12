/**
 * AnswerManager - Intelligent answer generation and caching for job applications
 *
 * Handles common application questions with caching and profile fallback.
 * Supports "Why [Company]?" questions with company-specific context.
 */

// Answer sources for logging
export const AnswerSource = {
  CACHED: 'cached',
  PROFILE: 'profile',
  GENERATED: 'generated',
  DEFAULT: 'default',
};

/**
 * AnswerManager class for handling job application questions
 */
export class AnswerManager {
  constructor(profile, options = {}) {
    this.profile = profile;
    this.cache = new Map();
    this.options = {
      enableCache: true,
      logLevel: 'info', // 'debug', 'info', 'warn', 'error'
      ...options,
    };

    // Common question patterns and their answer generators
    this.questionPatterns = this._initializePatterns();
  }

  /**
   * Initialize common question patterns with matching functions
   * @private
   */
  _initializePatterns() {
    return [
      {
        patterns: [/why\s+(?:do\s+you\s+want\s+to\s+)?(?:work\s+(?:at|for)|join)\s+(\w+)/i, /why\s+(\w+)\??/i],
        type: 'whyCompany',
        handler: (match, companyName) => this._generateWhyCompanyAnswer(companyName),
      },
      {
        patterns: [/tell\s+(?:us|me)\s+about\s+yourself/i, /describe\s+yourself/i],
        type: 'aboutYourself',
        handler: () => this._generateAboutYourselfAnswer(),
      },
      {
        patterns: [/interested\s+in\s+this\s+(?:role|position|job)/i, /why\s+this\s+(?:role|position)/i],
        type: 'whyRole',
        handler: () => this._generateWhyRoleAnswer(),
      },
      {
        patterns: [/what\s+(?:are\s+)?your\s+strengths/i, /greatest\s+strength/i],
        type: 'strengths',
        handler: () => this._generateStrengthsAnswer(),
      },
      {
        patterns: [/career\s+goals?/i, /where\s+do\s+you\s+see\s+yourself/i],
        type: 'careerGoals',
        handler: () => this._generateCareerGoalsAnswer(),
      },
      {
        patterns: [/salary\s+(?:requirements?|expectations?)/i, /compensation/i],
        type: 'salary',
        handler: () => this.profile.salaryExpectation || 'Negotiable',
      },
      {
        patterns: [/start\s+date/i, /when\s+can\s+you\s+start/i, /available\s+to\s+start/i],
        type: 'startDate',
        handler: () => this.profile.startDate || 'Immediately',
      },
      {
        patterns: [/years?\s+of\s+experience/i, /how\s+(?:many|much)\s+experience/i],
        type: 'experience',
        handler: () => this.profile.yearsExperience || '0-1',
      },
    ];
  }

  /**
   * Log a message at the appropriate level
   * @private
   */
  _log(level, message, data = {}) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevel = levels.indexOf(this.options.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel >= currentLevel) {
      const prefix = '[AnswerManager]';
      const sourceTag = data.source ? ` [${data.source}]` : '';
      console.log(`${prefix}${sourceTag} ${message}`);
    }
  }

  /**
   * Generate a cache key from a question
   * @private
   */
  _getCacheKey(question, context = {}) {
    // Normalize the question for better cache hits
    const normalized = question.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const contextKey = context.company ? `-${context.company.toLowerCase()}` : '';
    return `${normalized}${contextKey}`;
  }

  /**
   * Answer a general question
   * @param {string} question - The question text
   * @param {Object} context - Additional context (company name, job title, etc.)
   * @returns {Object} - { answer: string, source: AnswerSource }
   */
  answerQuestion(question, context = {}) {
    const cacheKey = this._getCacheKey(question, context);

    // Check cache first
    if (this.options.enableCache && this.cache.has(cacheKey)) {
      const cachedAnswer = this.cache.get(cacheKey);
      this._log('debug', `Cache hit for: "${question.substring(0, 50)}..."`, { source: AnswerSource.CACHED });
      return { answer: cachedAnswer, source: AnswerSource.CACHED };
    }

    // Check profile customAnswers
    const profileAnswer = this._findProfileAnswer(question);
    if (profileAnswer) {
      this._log('info', `Using profile answer for: "${question.substring(0, 50)}..."`, { source: AnswerSource.PROFILE });
      this._cacheAnswer(cacheKey, profileAnswer);
      return { answer: profileAnswer, source: AnswerSource.PROFILE };
    }

    // Try pattern matching
    for (const pattern of this.questionPatterns) {
      for (const regex of pattern.patterns) {
        const match = question.match(regex);
        if (match) {
          const answer = pattern.handler(match, match[1], context);
          this._log('info', `Generated answer for "${pattern.type}" question`, { source: AnswerSource.GENERATED });
          this._cacheAnswer(cacheKey, answer);
          return { answer, source: AnswerSource.GENERATED };
        }
      }
    }

    // No answer found
    this._log('warn', `No answer found for: "${question.substring(0, 50)}..."`);
    return { answer: null, source: null };
  }

  /**
   * Answer a "Why [Company]?" question
   * @param {string} companyName - The company name
   * @param {Object} context - Additional context (job title, job description, etc.)
   * @returns {Object} - { answer: string, source: AnswerSource }
   */
  answerWhyCompany(companyName, context = {}) {
    const cacheKey = this._getCacheKey(`why company ${companyName}`, context);

    // Check cache
    if (this.options.enableCache && this.cache.has(cacheKey)) {
      const cachedAnswer = this.cache.get(cacheKey);
      this._log('debug', `Cache hit for: Why ${companyName}?`, { source: AnswerSource.CACHED });
      return { answer: cachedAnswer, source: AnswerSource.CACHED };
    }

    // Check profile longAnswers for company-specific answer
    const longAnswerKey = `Why ${companyName}`;
    if (this.profile.longAnswers && this.profile.longAnswers[longAnswerKey]) {
      const answer = this.profile.longAnswers[longAnswerKey];
      this._log('info', `Using profile longAnswer for: Why ${companyName}?`, { source: AnswerSource.PROFILE });
      this._cacheAnswer(cacheKey, answer);
      return { answer, source: AnswerSource.PROFILE };
    }

    // Check customAnswers for variations
    const customKeys = [
      `Why ${companyName}?`,
      `Why do you want to work at ${companyName}?`,
      `Why are you interested in ${companyName}?`,
    ];

    for (const key of customKeys) {
      if (this.profile.customAnswers && this.profile.customAnswers[key]) {
        const answer = this.profile.customAnswers[key];
        this._log('info', `Using profile customAnswer for: Why ${companyName}?`, { source: AnswerSource.PROFILE });
        this._cacheAnswer(cacheKey, answer);
        return { answer, source: AnswerSource.PROFILE };
      }
    }

    // Generate a generic "Why Company" answer
    const answer = this._generateWhyCompanyAnswer(companyName, context);
    this._log('info', `Generated answer for: Why ${companyName}?`, { source: AnswerSource.GENERATED });
    this._cacheAnswer(cacheKey, answer);
    return { answer, source: AnswerSource.GENERATED };
  }

  /**
   * Find an answer in profile customAnswers or longAnswers
   * @private
   */
  _findProfileAnswer(question) {
    const questionLower = question.toLowerCase();

    // Check customAnswers (exact and fuzzy match)
    if (this.profile.customAnswers) {
      // Exact match
      if (this.profile.customAnswers[question]) {
        return this.profile.customAnswers[question];
      }

      // Fuzzy match - check if question contains any customAnswer key
      for (const [key, value] of Object.entries(this.profile.customAnswers)) {
        const keyLower = key.toLowerCase();
        // Check if the question contains the key or vice versa
        if (questionLower.includes(keyLower) || keyLower.includes(questionLower)) {
          return value;
        }
      }
    }

    // Check longAnswers
    if (this.profile.longAnswers) {
      if (this.profile.longAnswers[question]) {
        return this.profile.longAnswers[question];
      }

      for (const [key, value] of Object.entries(this.profile.longAnswers)) {
        const keyLower = key.toLowerCase();
        if (questionLower.includes(keyLower) || keyLower.includes(questionLower)) {
          return value;
        }
      }
    }

    return null;
  }

  /**
   * Cache an answer
   * @private
   */
  _cacheAnswer(key, answer) {
    if (this.options.enableCache && answer) {
      this.cache.set(key, answer);
    }
  }

  /**
   * Generate "Why [Company]?" answer
   * @private
   */
  _generateWhyCompanyAnswer(companyName, context = {}) {
    // Build a compelling but generic answer that works for most tech companies
    const { jobTitle } = context;

    const templates = [
      `I am excited about the opportunity to join ${companyName} because of its reputation for innovation and engineering excellence. As a new graduate eager to make an impact, I believe ${companyName}'s collaborative culture and challenging technical problems would provide an ideal environment for me to grow while contributing meaningful work.`,
      `${companyName} stands out to me because of its commitment to building impactful products and fostering engineering talent. I am drawn to the opportunity to work alongside talented engineers and contribute to projects that make a real difference. The combination of technical challenges and ${companyName}'s mission aligns perfectly with my career goals.`,
      `What attracts me to ${companyName} is the opportunity to work on technically challenging problems in a collaborative environment. I admire ${companyName}'s engineering culture and believe my skills and enthusiasm would be a great fit. I am eager to learn from experienced engineers while contributing fresh perspectives as a new graduate.`,
    ];

    // Pick a template based on company name hash for consistency
    const hash = companyName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const template = templates[hash % templates.length];

    return template;
  }

  /**
   * Generate "Tell us about yourself" answer
   * @private
   */
  _generateAboutYourselfAnswer() {
    const { firstName, education, skills } = this.profile;

    // Get top skills
    const topLanguages = skills?.languages?.slice(0, 3).map(l => l.name).join(', ') || 'various programming languages';

    const degree = education?.degree || "Bachelor's";
    const major = education?.major || 'Computer Science';
    const school = education?.school || 'university';

    return `I am a recent ${degree} graduate in ${major} from ${school}, passionate about software engineering and building impactful technology. My technical experience includes working with ${topLanguages}, and I have applied these skills in both academic projects and internship experiences. I am a quick learner who thrives in collaborative environments and am excited to contribute to a team where I can grow while making meaningful contributions.`;
  }

  /**
   * Generate "Why this role?" answer
   * @private
   */
  _generateWhyRoleAnswer() {
    const { skills } = this.profile;
    const topLanguages = skills?.languages?.slice(0, 2).map(l => l.name).join(' and ') || 'modern technologies';

    return `This role aligns perfectly with my technical background and career aspirations. I am particularly excited about the opportunity to apply my experience with ${topLanguages} to solve real-world problems. As a new graduate, I am looking for a position where I can make meaningful contributions while learning from experienced engineers, and this role offers exactly that opportunity.`;
  }

  /**
   * Generate strengths answer
   * @private
   */
  _generateStrengthsAnswer() {
    return `My greatest strengths are my ability to learn quickly and adapt to new technologies, my strong problem-solving skills developed through rigorous coursework, and my collaborative approach to engineering. I combine technical curiosity with a practical mindset, allowing me to effectively break down complex problems and work well with cross-functional teams.`;
  }

  /**
   * Generate career goals answer
   * @private
   */
  _generateCareerGoalsAnswer() {
    return `In the short term, I aim to deepen my technical expertise and contribute to impactful projects as part of a strong engineering team. Long term, I aspire to grow into a technical leadership role where I can mentor others while continuing to solve challenging problems. I am committed to continuous learning and staying at the forefront of technology.`;
  }

  /**
   * Clear the answer cache
   */
  clearCache() {
    this.cache.clear();
    this._log('info', 'Answer cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export default AnswerManager;
