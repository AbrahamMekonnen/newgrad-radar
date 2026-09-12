/**
 * Answer Personalization Integration Tests
 *
 * Tests the ability to generate personalized answers based on
 * user profile data for various question types.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  generateSkillAnswer,
  generateSkillDescription,
  answerSkillQuestion,
  findSkillInProfile,
  mapYearsToDropdown,
  getProficiencyLabel,
  parseProficiencyFromText,
  getSkillsSummary,
} from '../utils/skills.js';

import {
  getATSValue,
  getDefaultEEOConfig,
} from '../utils/eeo.js';

import {
  matchLabelToProfileKey,
} from '../utils/fields.js';

// Sample profile for testing
const sampleProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  phone: '+1-555-123-4567',
  location: 'San Francisco, CA',
  linkedin: 'https://linkedin.com/in/janedoe',
  github: 'https://github.com/janedoe',
  skills: {
    languages: [
      { name: 'Python', proficiency: 4, years: 3, context: 'Backend development' },
      { name: 'JavaScript', proficiency: 4, years: 2 },
      { name: 'TypeScript', proficiency: 3, years: 1 },
    ],
    frameworks: [
      { name: 'React', proficiency: 4, years: 2, context: 'Frontend development' },
      { name: 'Node.js', proficiency: 3, years: 2 },
      { name: 'Django', proficiency: 2, years: 0.5 },
    ],
    databases: [
      { name: 'PostgreSQL', proficiency: 3, years: 2 },
      { name: 'MongoDB', proficiency: 2, years: 0.5 },
    ],
    cloud: [
      { name: 'AWS', proficiency: 2, years: 1, services: ['S3', 'Lambda', 'EC2'] },
      { name: 'Docker', proficiency: 3, years: 1 },
    ],
  },
  eeo: {
    enabled: true,
    defaultBehavior: 'decline',
    answers: {
      gender: 'Decline to self-identify',
      veteran: 'I am not a protected veteran',
    },
  },
};

describe('Answer Personalization', () => {
  describe('Skill Answer Generation', () => {
    it('generates numeric ratings correctly', () => {
      const skill = { name: 'Python', proficiency: 4, years: 3 };

      assert.strictEqual(generateSkillAnswer(skill, 'rating'), 4);
      assert.strictEqual(generateSkillAnswer(skill, 'numeric_scale'), 4);
      assert.strictEqual(generateSkillAnswer(skill, '1-5'), 4);
    });

    it('generates proficiency text labels correctly', () => {
      const skill = { proficiency: 4 };

      const answer = generateSkillAnswer(skill, 'proficiency_text');
      assert.strictEqual(answer, 'Advanced');
    });

    it('generates years dropdown values correctly', () => {
      const testCases = [
        { skill: { years: 0 }, expected: '0' },
        { skill: { years: 0.5 }, expected: '0-1' },
        { skill: { years: 1 }, expected: '1-2' },
        { skill: { years: 2 }, expected: '2-3' },
        { skill: { years: 4 }, expected: '3-5' },
        { skill: { years: 7 }, expected: '5+' },
      ];

      for (const { skill, expected } of testCases) {
        assert.strictEqual(
          generateSkillAnswer(skill, 'years_dropdown'),
          expected,
          `${skill.years} years should map to "${expected}"`
        );
      }
    });

    it('generates yes/no answers correctly', () => {
      const experiencedSkill = { proficiency: 3 };
      const noviceSkill = { proficiency: 1 };

      assert.strictEqual(generateSkillAnswer(experiencedSkill, 'yes_no'), 'Yes');
      assert.strictEqual(generateSkillAnswer(noviceSkill, 'yes_no'), 'No');
    });

    it('handles null or undefined skills gracefully', () => {
      assert.strictEqual(generateSkillAnswer(null, 'rating'), null);
      assert.strictEqual(generateSkillAnswer(undefined, 'rating'), null);
    });
  });

  describe('Skill Description Generation', () => {
    it('generates description with years and context', () => {
      const skill = { years: 3, context: 'Backend development', proficiency: 4 };

      const desc = generateSkillDescription(skill);
      assert.ok(desc.includes('3 years'), 'Should include years');
      assert.ok(desc.includes('Backend development'), 'Should include context');
    });

    it('generates description with projects', () => {
      const skill = {
        years: 2,
        projects: ['ML Pipeline', 'Web App', 'Data Dashboard'],
        proficiency: 4,
      };

      const desc = generateSkillDescription(skill);
      assert.ok(desc.includes('Projects:'), 'Should include projects section');
      assert.ok(desc.includes('ML Pipeline'), 'Should include project name');
    });

    it('falls back to proficiency label when no other data', () => {
      const skill = { proficiency: 3 };

      const desc = generateSkillDescription(skill);
      assert.ok(desc.length > 0, 'Should return non-empty description');
    });
  });

  describe('Profile Skill Lookup', () => {
    it('finds skills in profile by exact name', () => {
      const python = findSkillInProfile(sampleProfile, 'Python');
      assert.ok(python, 'Should find Python');
      assert.strictEqual(python.proficiency, 4);
      assert.strictEqual(python.years, 3);
    });

    it('finds skills with normalized names', () => {
      const react = findSkillInProfile(sampleProfile, 'react');
      assert.ok(react, 'Should find React');
      assert.strictEqual(react.proficiency, 4);
    });

    it('returns null for skills not in profile', () => {
      const unknown = findSkillInProfile(sampleProfile, 'Rust');
      assert.strictEqual(unknown, null);
    });

    it('searches across all skill categories', () => {
      const pg = findSkillInProfile(sampleProfile, 'PostgreSQL');
      assert.ok(pg, 'Should find PostgreSQL in databases');

      const aws = findSkillInProfile(sampleProfile, 'AWS');
      assert.ok(aws, 'Should find AWS in cloud');
    });
  });

  describe('Complete Question Answering', () => {
    it('answers skill rating questions from profile', () => {
      const answer = answerSkillQuestion(sampleProfile, 'Rate your Python proficiency');
      assert.strictEqual(answer, 4);
    });

    it('answers years of experience questions', () => {
      const answer = answerSkillQuestion(sampleProfile, 'Years of experience with React');
      assert.strictEqual(answer, '2-3');
    });

    it('returns conservative defaults for unknown skills', () => {
      const rating = answerSkillQuestion(sampleProfile, 'Rate your Scala proficiency');
      assert.strictEqual(rating, 1);

      const years = answerSkillQuestion(sampleProfile, 'Years of experience with Haskell');
      assert.strictEqual(years, '0');

      const yesNo = answerSkillQuestion(sampleProfile, 'Do you have experience in Elixir?');
      assert.strictEqual(yesNo, 'No');
    });
  });

  describe('Years to Dropdown Mapping', () => {
    it('maps years correctly to dropdown values', () => {
      const testCases = [
        { years: 0, expected: '0' },
        { years: 0.5, expected: '0-1' },
        { years: 1, expected: '1-2' },
        { years: 1.5, expected: '1-2' },
        { years: 2, expected: '2-3' },
        { years: 2.5, expected: '2-3' },
        { years: 3, expected: '3-5' },
        { years: 4, expected: '3-5' },
        { years: 5, expected: '5+' },
        { years: 10, expected: '5+' },
      ];

      for (const { years, expected } of testCases) {
        assert.strictEqual(
          mapYearsToDropdown(years),
          expected,
          `${years} years should be "${expected}"`
        );
      }
    });
  });

  describe('Proficiency Label Mapping', () => {
    it('returns correct short labels', () => {
      assert.strictEqual(getProficiencyLabel(1, 'short'), 'None');
      assert.strictEqual(getProficiencyLabel(2, 'short'), 'Basic');
      assert.strictEqual(getProficiencyLabel(3, 'short'), 'Working');
      assert.strictEqual(getProficiencyLabel(4, 'short'), 'Proficient');
      assert.strictEqual(getProficiencyLabel(5, 'short'), 'Expert');
    });

    it('returns correct long labels', () => {
      assert.strictEqual(getProficiencyLabel(1, 'long'), 'No experience');
      assert.strictEqual(getProficiencyLabel(2, 'long'), 'Beginner');
      assert.strictEqual(getProficiencyLabel(3, 'long'), 'Intermediate');
      assert.strictEqual(getProficiencyLabel(4, 'long'), 'Advanced');
      assert.strictEqual(getProficiencyLabel(5, 'long'), 'Expert');
    });

    it('returns Unknown for invalid levels', () => {
      assert.strictEqual(getProficiencyLabel(0), 'Unknown');
      assert.strictEqual(getProficiencyLabel(6), 'Unknown');
      assert.strictEqual(getProficiencyLabel(-1), 'Unknown');
    });
  });

  describe('Proficiency Text Parsing', () => {
    it('parses numeric proficiency', () => {
      assert.strictEqual(parseProficiencyFromText('3'), 3);
      assert.strictEqual(parseProficiencyFromText('5'), 5);
    });

    it('parses text labels', () => {
      assert.strictEqual(parseProficiencyFromText('beginner'), 2);
      assert.strictEqual(parseProficiencyFromText('Intermediate'), 3);
      assert.strictEqual(parseProficiencyFromText('Advanced'), 4);
      assert.strictEqual(parseProficiencyFromText('Expert level'), 5);
    });

    it('returns 0 for unparseable text', () => {
      assert.strictEqual(parseProficiencyFromText('xyz'), 0);
      assert.strictEqual(parseProficiencyFromText(''), 0);
      assert.strictEqual(parseProficiencyFromText(null), 0);
    });
  });

  describe('Skills Summary Generation', () => {
    it('generates summary grouped by category', () => {
      const summary = getSkillsSummary(sampleProfile);

      assert.ok(summary.languages, 'Should have languages');
      assert.ok(summary.frameworks, 'Should have frameworks');
      assert.ok(summary.databases, 'Should have databases');
    });

    it('sorts skills by proficiency (highest first)', () => {
      const summary = getSkillsSummary(sampleProfile);

      // Python and JavaScript both have proficiency 4, TypeScript has 3
      assert.ok(
        summary.languages[0].proficiency >= summary.languages[2].proficiency,
        'First skill should have higher proficiency'
      );
    });

    it('returns empty object for missing profile', () => {
      assert.deepStrictEqual(getSkillsSummary(null), {});
      assert.deepStrictEqual(getSkillsSummary({}), {});
    });
  });

  describe('EEO Value Mapping', () => {
    it('maps gender decline values per ATS', () => {
      assert.strictEqual(getATSValue('gender', 'decline', 'greenhouse'), 'Decline to self-identify');
      assert.strictEqual(getATSValue('gender', 'decline', 'lever'), 'I do not wish to answer');
      assert.strictEqual(getATSValue('gender', 'decline', 'workday'), 'Prefer not to say');
    });

    it('maps veteran status correctly', () => {
      assert.strictEqual(
        getATSValue('veteran', 'no', 'greenhouse'),
        'I am not a protected veteran'
      );
    });

    it('maps disability status correctly', () => {
      assert.strictEqual(
        getATSValue('disability', 'decline', 'default'),
        'I do not wish to answer'
      );
    });

    it('uses default for unknown ATS', () => {
      const value = getATSValue('gender', 'decline', 'unknown-ats');
      assert.strictEqual(value, 'Decline to self-identify');
    });
  });

  describe('Default EEO Configuration', () => {
    it('returns valid default config', () => {
      const config = getDefaultEEOConfig();

      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.defaultBehavior, 'decline');
      assert.ok(config.answers.gender);
      assert.ok(config.answers.race);
      assert.ok(config.answers.veteran);
      assert.ok(config.answers.disability);
    });
  });

  describe('Field Label Matching', () => {
    it('matches first name labels', () => {
      const labels = ['First Name', 'first_name', 'firstname', 'Given Name'];
      for (const label of labels) {
        assert.strictEqual(matchLabelToProfileKey(label), 'firstName', `"${label}" should match firstName`);
      }
    });

    it('matches email labels', () => {
      const labels = ['Email', 'E-mail', 'Email Address'];
      for (const label of labels) {
        assert.strictEqual(matchLabelToProfileKey(label), 'email', `"${label}" should match email`);
      }
    });

    it('matches phone labels', () => {
      const labels = ['Phone', 'telephone', 'Mobile', 'Phone Number'];
      for (const label of labels) {
        assert.strictEqual(matchLabelToProfileKey(label), 'phone', `"${label}" should match phone`);
      }
    });

    it('matches LinkedIn labels', () => {
      const labels = ['LinkedIn', 'LinkedIn URL', 'LinkedIn Profile'];
      for (const label of labels) {
        assert.strictEqual(matchLabelToProfileKey(label), 'linkedin', `"${label}" should match linkedin`);
      }
    });

    it('returns null for unknown labels', () => {
      const unknown = ['Company Size', 'Favorite Color', 'Hobbies'];
      for (const label of unknown) {
        assert.strictEqual(matchLabelToProfileKey(label), null, `"${label}" should return null`);
      }
    });
  });
});
