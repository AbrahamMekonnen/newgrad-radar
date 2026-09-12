/**
 * Question Classifier Integration Tests
 *
 * Tests the ability to detect and classify different types of questions
 * on job application forms.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  detectSkillQuestion,
  normalizeSkillName,
  getSkillCategory,
} from '../utils/skills.js';

import {
  detectEEOFieldType,
} from '../utils/eeo.js';

import {
  detectATS,
} from '../config.js';

describe('Question Classifier', () => {
  describe('Skill Question Detection', () => {
    it('detects rating-type skill questions', () => {
      const questions = [
        'Rate your proficiency in Python',
        'Python proficiency (1-5)',
        'Skill level with JavaScript',
        'Rate your React experience on a scale of 1-5',
      ];

      for (const q of questions) {
        const result = detectSkillQuestion(q);
        assert.ok(result, `Should detect question: "${q}"`);
        assert.strictEqual(result.type, 'rating', `"${q}" should be type "rating"`);
      }
    });

    it('detects years of experience questions', () => {
      const questions = [
        'Years of experience with Python',
        'How many years of experience do you have with React?',
        'Experience with Node.js (in years)',
      ];

      for (const q of questions) {
        const result = detectSkillQuestion(q);
        assert.ok(result, `Should detect question: "${q}"`);
        assert.strictEqual(result.type, 'years', `"${q}" should be type "years"`);
      }
    });

    it('detects yes/no skill questions', () => {
      const questions = [
        'Do you have experience in Python?',
        'Have you used React before?',
        'Are you familiar with AWS?',
      ];

      for (const q of questions) {
        const result = detectSkillQuestion(q);
        assert.ok(result, `Should detect question: "${q}"`);
        assert.strictEqual(result.type, 'yes_no', `"${q}" should be type "yes_no"`);
      }
    });

    it('detects description-type questions', () => {
      const questions = [
        'Describe your Python skills',
        'Tell us about your React journey',
        'Please explain your experience using Kubernetes',
      ];

      for (const q of questions) {
        const result = detectSkillQuestion(q);
        assert.ok(result, `Should detect question: "${q}"`);
        assert.strictEqual(result.type, 'description', `"${q}" should be type "description"`);
      }
    });

    it('extracts skill names from questions', () => {
      const testCases = [
        { question: 'Rate your proficiency in Python', expected: 'python' },
        { question: 'Years of experience with React', expected: 'react' },
        { question: 'Do you have experience in Node.js?', expected: 'node.js' },
        { question: 'TypeScript proficiency level', expected: 'typescript' },
      ];

      for (const { question, expected } of testCases) {
        const result = detectSkillQuestion(question);
        assert.ok(result, `Should detect question: "${question}"`);
        assert.strictEqual(result.skillName, expected, `Skill name should be "${expected}"`);
      }
    });
  });

  describe('Skill Name Normalization', () => {
    it('normalizes common skill aliases', () => {
      const testCases = [
        { input: 'js', expected: 'javascript' },
        { input: 'ts', expected: 'typescript' },
        { input: 'py', expected: 'python' },
        { input: 'nodejs', expected: 'node.js' },
        { input: 'k8s', expected: 'kubernetes' },
        { input: 'postgres', expected: 'postgresql' },
        { input: 'react.js', expected: 'react' },
        { input: 'aws', expected: 'amazon web services' },
      ];

      for (const { input, expected } of testCases) {
        const result = normalizeSkillName(input);
        assert.strictEqual(result, expected, `"${input}" should normalize to "${expected}"`);
      }
    });

    it('preserves canonical names', () => {
      const canonical = ['python', 'javascript', 'react', 'postgresql'];
      for (const name of canonical) {
        assert.strictEqual(normalizeSkillName(name), name);
      }
    });

    it('handles edge cases', () => {
      assert.strictEqual(normalizeSkillName(''), '');
      assert.strictEqual(normalizeSkillName(null), '');
      assert.strictEqual(normalizeSkillName(undefined), '');
    });
  });

  describe('Skill Category Detection', () => {
    it('categorizes languages correctly', () => {
      const languages = ['python', 'javascript', 'typescript', 'java', 'golang', 'rust'];
      for (const lang of languages) {
        assert.strictEqual(getSkillCategory(lang), 'languages', `${lang} should be in "languages"`);
      }
    });

    it('categorizes frameworks correctly', () => {
      const frameworks = ['react', 'vue', 'angular', 'next.js', 'django', 'flask'];
      for (const fw of frameworks) {
        assert.strictEqual(getSkillCategory(fw), 'frameworks', `${fw} should be in "frameworks"`);
      }
    });

    it('categorizes databases correctly', () => {
      const databases = ['postgresql', 'mysql', 'mongodb', 'redis'];
      for (const db of databases) {
        assert.strictEqual(getSkillCategory(db), 'databases', `${db} should be in "databases"`);
      }
    });

    it('categorizes cloud services correctly', () => {
      const cloud = ['amazon web services', 'google cloud platform', 'kubernetes', 'docker'];
      for (const svc of cloud) {
        assert.strictEqual(getSkillCategory(svc), 'cloud', `${svc} should be in "cloud"`);
      }
    });

    it('returns null for unknown skills', () => {
      const unknown = ['somecustomframework', 'proprietary-tool', 'abc123'];
      for (const skill of unknown) {
        assert.strictEqual(getSkillCategory(skill), null, `${skill} should return null`);
      }
    });
  });

  describe('EEO Question Detection', () => {
    it('detects gender questions', () => {
      const questions = [
        'Gender',
        'What is your gender identity?',
        'How do you identify?',
      ];

      for (const q of questions) {
        assert.strictEqual(detectEEOFieldType(q), 'gender', `"${q}" should be "gender"`);
      }
    });

    it('detects race/ethnicity questions', () => {
      const questions = [
        'Race',
        'Ethnicity',
        'What is your race/ethnicity?',
        'Please identify your race or ethnic background',
      ];

      for (const q of questions) {
        assert.strictEqual(detectEEOFieldType(q), 'race', `"${q}" should be "race"`);
      }
    });

    it('detects veteran status questions', () => {
      const questions = [
        'Veteran Status',
        'Are you a protected veteran?',
        'Have you served in the military?',
      ];

      for (const q of questions) {
        assert.strictEqual(detectEEOFieldType(q), 'veteran', `"${q}" should be "veteran"`);
      }
    });

    it('detects disability questions', () => {
      const questions = [
        'Disability Status',
        'Do you have a disability?',
        'Voluntary Self-Identification of Disability (CC-305)',
      ];

      for (const q of questions) {
        assert.strictEqual(detectEEOFieldType(q), 'disability', `"${q}" should be "disability"`);
      }
    });

    it('returns null for non-EEO questions', () => {
      const nonEEO = [
        'First Name',
        'Email Address',
        'Years of Experience',
        'Preferred Start Date',
      ];

      for (const q of nonEEO) {
        assert.strictEqual(detectEEOFieldType(q), null, `"${q}" should be null`);
      }
    });
  });

  describe('ATS Detection', () => {
    it('detects Greenhouse URLs', () => {
      const urls = [
        'https://boards.greenhouse.io/stripe/jobs/12345',
        'https://job-boards.greenhouse.io/company/job',
      ];

      for (const url of urls) {
        assert.strictEqual(detectATS(url), 'greenhouse', `${url} should be greenhouse`);
      }
    });

    it('detects Lever URLs', () => {
      const urls = [
        'https://jobs.lever.co/figma/designer',
        'https://jobs.lever.co/company/12345',
      ];

      for (const url of urls) {
        assert.strictEqual(detectATS(url), 'lever', `${url} should be lever`);
      }
    });

    it('detects Ashby URLs', () => {
      const urls = [
        'https://jobs.ashbyhq.com/company/job',
      ];

      for (const url of urls) {
        assert.strictEqual(detectATS(url), 'ashby', `${url} should be ashby`);
      }
    });

    it('detects Jobvite URLs', () => {
      const urls = [
        'https://jobs.jobvite.com/company/job/12345',
        'https://company.jobvite.com/apply',
      ];

      for (const url of urls) {
        assert.strictEqual(detectATS(url), 'jobvite', `${url} should be jobvite`);
      }
    });

    it('returns null for unknown URLs', () => {
      const unknown = [
        'https://linkedin.com/jobs/12345',
        'https://indeed.com/viewjob',
        'https://company.com/careers',
      ];

      for (const url of unknown) {
        assert.strictEqual(detectATS(url), null, `${url} should be null`);
      }
    });
  });
});
