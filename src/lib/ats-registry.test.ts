/**
 * ATS Registry Tests
 *
 * Verify detection functions work for known URLs and field mappings are complete.
 */

import {
  detectATSFromURL,
  getAllURLPatterns,
  getSupportedATSTypes,
  getFieldMapping,
  findFieldByLabel,
  ATS_REGISTRY,
  ATSType,
  GREENHOUSE_CONFIG,
  LEVER_CONFIG,
  WORKDAY_CONFIG,
  ASHBY_CONFIG,
  ATS_AUTOMATION_PRIORITY,
} from './ats-registry';

describe('ATS Registry', () => {
  describe('detectATSFromURL', () => {
    // Greenhouse detection
    describe('Greenhouse', () => {
      const greenhouseUrls = [
        'https://boards.greenhouse.io/company/jobs/12345',
        'https://boards.greenhouse.io/stripe/jobs/5895287',
        'https://job-boards.greenhouse.io/somecompany',
        'https://example.com/jobs/123?gh_jid=456',
        'https://company.com/greenhouse/apply',
        'https://grnh.se/abc123',
      ];

      greenhouseUrls.forEach((url) => {
        it(`detects ${url} as greenhouse`, () => {
          expect(detectATSFromURL(url)).toBe('greenhouse');
        });
      });
    });

    // Lever detection
    describe('Lever', () => {
      const leverUrls = [
        'https://jobs.lever.co/company/12345',
        'https://jobs.lever.co/figma/senior-engineer',
        'https://apply.lever.co/company/job',
        'https://example.com/lever/apply',
      ];

      leverUrls.forEach((url) => {
        it(`detects ${url} as lever`, () => {
          expect(detectATSFromURL(url)).toBe('lever');
        });
      });
    });

    // Workday detection
    describe('Workday', () => {
      const workdayUrls = [
        'https://company.wd5.myworkdayjobs.com/en-US/careers',
        'https://amazon.wd1.myworkdayjobs.com/AmazonCareers',
        'https://google.wd5.myworkdayjobs.com/jobs/123',
        'https://meta.myworkdayjobs.com/careers/apply',
        'https://example.com/workday/careers',
      ];

      workdayUrls.forEach((url) => {
        it(`detects ${url} as workday`, () => {
          expect(detectATSFromURL(url)).toBe('workday');
        });
      });
    });

    // Ashby detection
    describe('Ashby', () => {
      const ashbyUrls = [
        'https://jobs.ashbyhq.com/company/12345',
        'https://company.ashbyhq.com/jobs',
        'https://app.ashbyhq.com/company/apply',
        'https://example.com/ashby/careers',
      ];

      ashbyUrls.forEach((url) => {
        it(`detects ${url} as ashby`, () => {
          expect(detectATSFromURL(url)).toBe('ashby');
        });
      });
    });

    // Other ATS systems
    describe('Other ATS', () => {
      it('detects Jobvite URLs', () => {
        expect(detectATSFromURL('https://jobs.jobvite.com/company/job/123')).toBe('jobvite');
      });

      it('detects iCIMS URLs', () => {
        expect(detectATSFromURL('https://careers-company.icims.com/jobs/123')).toBe('icims');
      });

      it('detects Taleo URLs', () => {
        expect(detectATSFromURL('https://company.taleo.net/careersection/1/job')).toBe('taleo');
      });

      it('detects SmartRecruiters URLs', () => {
        expect(detectATSFromURL('https://jobs.smartrecruiters.com/Company/12345')).toBe('smartrecruiters');
      });

      it('detects BambooHR URLs', () => {
        expect(detectATSFromURL('https://company.bamboohr.com/careers/123')).toBe('bamboohr');
      });
    });

    // Unknown URLs
    describe('Unknown URLs', () => {
      const unknownUrls = [
        'https://example.com/careers',
        'https://linkedin.com/jobs/123',
        'https://indeed.com/viewjob',
        'https://company.com/join-us',
      ];

      unknownUrls.forEach((url) => {
        it(`returns unknown for ${url}`, () => {
          expect(detectATSFromURL(url)).toBe('unknown');
        });
      });
    });
  });

  describe('getAllURLPatterns', () => {
    it('returns an array of patterns', () => {
      const patterns = getAllURLPatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('each pattern has atsType and pattern', () => {
      const patterns = getAllURLPatterns();
      patterns.forEach((p) => {
        expect(p.atsType).toBeDefined();
        expect(p.pattern).toBeInstanceOf(RegExp);
      });
    });

    it('does not include unknown type', () => {
      const patterns = getAllURLPatterns();
      const unknownPatterns = patterns.filter((p) => p.atsType === 'unknown');
      expect(unknownPatterns.length).toBe(0);
    });
  });

  describe('getSupportedATSTypes', () => {
    it('returns ATS types with difficulty <= 3', () => {
      const supported = getSupportedATSTypes();
      expect(Array.isArray(supported)).toBe(true);

      // These should be supported (difficulty <= 3)
      expect(supported).toContain('greenhouse');
      expect(supported).toContain('lever');
      expect(supported).toContain('ashby');
      expect(supported).toContain('bamboohr');
      expect(supported).toContain('smartrecruiters');
      expect(supported).toContain('jobvite');

      // These should NOT be supported (difficulty > 3)
      expect(supported).not.toContain('workday');
      expect(supported).not.toContain('taleo');
      expect(supported).not.toContain('icims');
    });
  });

  describe('Field Mappings', () => {
    describe('Greenhouse field mappings', () => {
      const requiredFields = ['firstName', 'lastName', 'email', 'resume'];
      const optionalFields = ['phone', 'coverLetter', 'linkedIn'];

      requiredFields.forEach((field) => {
        it(`has mapping for required field: ${field}`, () => {
          const mapping = getFieldMapping('greenhouse', field);
          expect(mapping).toBeDefined();
          expect(mapping?.required).toBe(true);
          expect(mapping?.selectors.length).toBeGreaterThan(0);
          expect(mapping?.namePatterns.length).toBeGreaterThan(0);
        });
      });

      optionalFields.forEach((field) => {
        it(`has mapping for optional field: ${field}`, () => {
          const mapping = getFieldMapping('greenhouse', field);
          expect(mapping).toBeDefined();
          expect(mapping?.required).toBe(false);
        });
      });
    });

    describe('Lever field mappings', () => {
      it('has fullName instead of firstName/lastName split', () => {
        const fullName = getFieldMapping('lever', 'fullName');
        expect(fullName).toBeDefined();
        expect(fullName?.required).toBe(true);
      });

      it('has resume mapping', () => {
        const resume = getFieldMapping('lever', 'resume');
        expect(resume).toBeDefined();
        expect(resume?.required).toBe(true);
      });

      it('has URL fields (LinkedIn, GitHub, Portfolio)', () => {
        expect(getFieldMapping('lever', 'linkedIn')).toBeDefined();
        expect(getFieldMapping('lever', 'github')).toBeDefined();
        expect(getFieldMapping('lever', 'portfolio')).toBeDefined();
      });
    });

    describe('Ashby field mappings', () => {
      it('uses _systemfield_ prefix for standard fields', () => {
        const firstName = getFieldMapping('ashby', 'firstName');
        expect(firstName?.namePatterns.some((p) => p.source.includes('_systemfield_'))).toBe(true);
      });
    });

    describe('Workday field mappings', () => {
      it('uses data-automation-id selectors', () => {
        const firstName = getFieldMapping('workday', 'firstName');
        expect(firstName?.selectors.some((s) => s.includes('data-automation-id'))).toBe(true);
      });
    });
  });

  describe('findFieldByLabel', () => {
    it('finds firstName by various labels', () => {
      const labels = ['First Name', 'first name', 'Given Name', 'FIRST'];
      labels.forEach((label) => {
        const field = findFieldByLabel('greenhouse', label);
        expect(field?.standard).toBe('firstName');
      });
    });

    it('finds email by various labels', () => {
      const labels = ['Email', 'E-mail', 'Email Address'];
      labels.forEach((label) => {
        const field = findFieldByLabel('greenhouse', label);
        expect(field?.standard).toBe('email');
      });
    });

    it('finds resume by various labels', () => {
      const labels = ['Resume', 'CV', 'Curriculum Vitae'];
      labels.forEach((label) => {
        const field = findFieldByLabel('greenhouse', label);
        expect(field?.standard).toBe('resume');
      });
    });
  });

  describe('ATS Registry completeness', () => {
    const allATSTypes: ATSType[] = [
      'greenhouse',
      'lever',
      'ashby',
      'workday',
      'jobvite',
      'icims',
      'taleo',
      'smartrecruiters',
      'bamboohr',
      'unknown',
    ];

    allATSTypes.forEach((atsType) => {
      it(`has config for ${atsType}`, () => {
        const config = ATS_REGISTRY[atsType];
        expect(config).toBeDefined();
        expect(config.type).toBe(atsType);
        expect(config.name).toBeDefined();
      });

      if (atsType !== 'unknown') {
        it(`${atsType} has URL patterns`, () => {
          const config = ATS_REGISTRY[atsType];
          expect(config.urlPatterns.length).toBeGreaterThan(0);
        });

        it(`${atsType} has form patterns`, () => {
          const config = ATS_REGISTRY[atsType];
          expect(config.formPatterns.formSelector).toBeDefined();
          expect(config.formPatterns.submitSelector).toBeDefined();
          expect(config.formPatterns.successIndicators.length).toBeGreaterThan(0);
        });

        it(`${atsType} has automation difficulty rating`, () => {
          const config = ATS_REGISTRY[atsType];
          expect(config.automationDifficulty).toBeGreaterThanOrEqual(1);
          expect(config.automationDifficulty).toBeLessThanOrEqual(5);
        });
      }
    });
  });

  describe('ATS_AUTOMATION_PRIORITY', () => {
    it('is ordered from easiest to hardest', () => {
      // Verify the priority list makes sense
      expect(ATS_AUTOMATION_PRIORITY[0]).toBe('lever'); // easiest
      expect(ATS_AUTOMATION_PRIORITY[1]).toBe('greenhouse');
      expect(ATS_AUTOMATION_PRIORITY[ATS_AUTOMATION_PRIORITY.length - 1]).toBe('taleo'); // hardest
    });

    it('contains all major ATS types', () => {
      const majorTypes = ['greenhouse', 'lever', 'ashby', 'workday'];
      majorTypes.forEach((type) => {
        expect(ATS_AUTOMATION_PRIORITY).toContain(type);
      });
    });
  });

  describe('Config validation', () => {
    describe('GREENHOUSE_CONFIG', () => {
      it('has valid API configuration', () => {
        expect(GREENHOUSE_CONFIG.api?.baseUrl).toContain('boards-api.greenhouse.io');
        expect(GREENHOUSE_CONFIG.api?.applyEndpoint).toBeDefined();
      });

      it('has correct automation difficulty', () => {
        expect(GREENHOUSE_CONFIG.automationDifficulty).toBe(2);
      });
    });

    describe('LEVER_CONFIG', () => {
      it('has valid API configuration', () => {
        expect(LEVER_CONFIG.api?.baseUrl).toContain('api.lever.co');
      });

      it('has correct automation difficulty', () => {
        expect(LEVER_CONFIG.automationDifficulty).toBe(2);
      });
    });

    describe('WORKDAY_CONFIG', () => {
      it('has high automation difficulty (enterprise complexity)', () => {
        expect(WORKDAY_CONFIG.automationDifficulty).toBe(5);
      });

      it('documents the multi-step wizard', () => {
        expect(WORKDAY_CONFIG.quirks.some((q) => q.includes('wizard'))).toBe(true);
      });
    });

    describe('ASHBY_CONFIG', () => {
      it('has valid API configuration', () => {
        expect(ASHBY_CONFIG.api?.baseUrl).toContain('ashbyhq.com');
      });

      it('has moderate automation difficulty', () => {
        expect(ASHBY_CONFIG.automationDifficulty).toBe(2);
      });
    });
  });
});
