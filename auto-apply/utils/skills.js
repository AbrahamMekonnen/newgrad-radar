/**
 * Skills tracking and matching utilities for auto-apply
 *
 * Handles:
 * - Skill proficiency ratings
 * - Years of experience calculations
 * - Skill synonym normalization
 * - Answer generation for skill questions
 */

// Skill synonyms for normalization
const SKILL_SYNONYMS = {
  // Languages
  'javascript': ['js', 'ecmascript', 'es6', 'es2015', 'es2020'],
  'typescript': ['ts'],
  'python': ['py', 'python3', 'python2'],
  'c++': ['cpp', 'c plus plus', 'cplusplus'],
  'c#': ['csharp', 'c sharp', 'dotnet'],
  'golang': ['go'],

  // Frameworks
  'react': ['react.js', 'reactjs', 'react js'],
  'vue': ['vue.js', 'vuejs', 'vue js'],
  'angular': ['angular.js', 'angularjs'],
  'next.js': ['next', 'nextjs'],
  'node.js': ['node', 'nodejs', 'node js'],
  'express': ['express.js', 'expressjs'],
  'django': ['python django'],
  'flask': ['python flask'],
  'spring': ['spring boot', 'springboot'],

  // Databases
  'postgresql': ['postgres', 'psql', 'pg'],
  'mysql': ['my sql'],
  'mongodb': ['mongo'],
  'elasticsearch': ['elastic', 'es'],

  // Cloud
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  'microsoft azure': ['azure'],
  'kubernetes': ['k8s', 'kube'],
  'docker': ['containers'],

  // Tools
  'git': ['github', 'gitlab', 'version control'],
  'terraform': ['tf', 'iac'],
  'jenkins': ['ci/cd', 'cicd'],
};

// Skill categories
const SKILL_CATEGORIES = {
  languages: ['javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'golang', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala'],
  frameworks: ['react', 'vue', 'angular', 'next.js', 'node.js', 'express', 'django', 'flask', 'spring', 'rails', 'fastapi'],
  databases: ['postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'sqlite'],
  cloud: ['amazon web services', 'google cloud platform', 'microsoft azure', 'kubernetes', 'docker', 'terraform'],
  tools: ['git', 'linux', 'jenkins', 'figma', 'jira', 'confluence'],
  ml: ['tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy', 'keras', 'huggingface'],
};

// Proficiency level mappings
const PROFICIENCY_LABELS = {
  1: { short: 'None', long: 'No experience', description: 'Never used or unfamiliar' },
  2: { short: 'Basic', long: 'Beginner', description: 'Completed tutorials or coursework' },
  3: { short: 'Working', long: 'Intermediate', description: 'Built projects, can work independently' },
  4: { short: 'Proficient', long: 'Advanced', description: 'Used professionally, can architect solutions' },
  5: { short: 'Expert', long: 'Expert', description: 'Deep expertise, could teach others' },
};

// Years of experience dropdown mappings
const YEARS_DROPDOWNS = [
  { value: '0', maxYears: 0 },
  { value: '0-1', maxYears: 1, aliases: ['< 1', 'Less than 1', '0-1 years'] },
  { value: '1-2', maxYears: 2, aliases: ['1-2 years', '1 to 2'] },
  { value: '2-3', maxYears: 3, aliases: ['2-3 years', '2 to 3'] },
  { value: '3-5', maxYears: 5, aliases: ['3-5 years', '3 to 5'] },
  { value: '5+', maxYears: Infinity, aliases: ['5+ years', '5 or more', '5-10', '10+'] },
];

/**
 * Normalize a skill name to its canonical form
 * @param {string} name - The skill name to normalize
 * @returns {string} - Canonical skill name
 */
function normalizeSkillName(name) {
  if (!name) return '';
  const lower = name.toLowerCase().trim();

  // Check if it's a canonical name
  if (SKILL_SYNONYMS[lower]) return lower;

  // Check synonyms
  for (const [canonical, aliases] of Object.entries(SKILL_SYNONYMS)) {
    if (aliases.includes(lower)) {
      return canonical;
    }
  }

  return lower;
}

/**
 * Get the category for a skill
 * @param {string} skillName - Normalized skill name
 * @returns {string|null} - Category name or null
 */
function getSkillCategory(skillName) {
  const normalized = normalizeSkillName(skillName);
  for (const [category, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (skills.includes(normalized)) {
      return category;
    }
  }
  return null;
}

/**
 * Map years of experience to dropdown value
 * @param {number} years - Years of experience
 * @returns {string} - Dropdown value
 */
function mapYearsToDropdown(years) {
  if (years === 0) return '0';
  if (years < 1) return '0-1';
  if (years < 2) return '1-2';
  if (years < 3) return '2-3';
  if (years < 5) return '3-5';
  return '5+';
}

/**
 * Get proficiency label for a level
 * @param {number} level - Proficiency level (1-5)
 * @param {string} format - 'short', 'long', or 'description'
 * @returns {string}
 */
function getProficiencyLabel(level, format = 'long') {
  const labels = PROFICIENCY_LABELS[level];
  if (!labels) return 'Unknown';
  return labels[format] || labels.long;
}

/**
 * Parse proficiency from text
 * @param {string} text - Text like "Intermediate", "3", "Advanced"
 * @returns {number} - Proficiency level (1-5)
 */
function parseProficiencyFromText(text) {
  if (!text) return 0;
  const lower = text.toLowerCase().trim();

  // Numeric
  if (/^[1-5]$/.test(lower)) return parseInt(lower);

  // Text labels
  const textMappings = {
    'none': 1, 'no experience': 1, 'unfamiliar': 1,
    'basic': 2, 'beginner': 2, 'familiar': 2, 'learning': 2,
    'working': 3, 'intermediate': 3, 'competent': 3,
    'proficient': 4, 'advanced': 4, 'strong': 4,
    'expert': 5, 'mastery': 5, 'lead': 5,
  };

  for (const [key, value] of Object.entries(textMappings)) {
    if (lower.includes(key)) return value;
  }

  return 0;
}

/**
 * Generate answer for a skill question
 * @param {Object} skill - Skill object from profile
 * @param {string} questionType - Type of question
 * @returns {string|number} - Answer
 */
function generateSkillAnswer(skill, questionType) {
  if (!skill) return null;

  switch (questionType) {
    case 'numeric_scale':
    case 'rating':
    case '1-5':
      return skill.proficiency || 1;

    case 'proficiency_text':
    case 'level':
      return getProficiencyLabel(skill.proficiency || 1, 'long');

    case 'years_dropdown':
    case 'years':
      return mapYearsToDropdown(skill.years || 0);

    case 'years_numeric':
      return skill.years || 0;

    case 'description':
    case 'experience':
      return generateSkillDescription(skill);

    case 'yes_no':
    case 'have_experience':
      return (skill.proficiency || 0) >= 2 ? 'Yes' : 'No';

    default:
      return skill.proficiency ? getProficiencyLabel(skill.proficiency) : 'No experience';
  }
}

/**
 * Generate a description of skill experience
 * @param {Object} skill - Skill object
 * @returns {string}
 */
function generateSkillDescription(skill) {
  const parts = [];

  if (skill.years) {
    parts.push(`${skill.years} year${skill.years !== 1 ? 's' : ''} of experience`);
  }

  if (skill.context) {
    parts.push(skill.context);
  }

  if (skill.projects && skill.projects.length > 0) {
    parts.push(`Projects: ${skill.projects.slice(0, 2).join(', ')}`);
  }

  if (parts.length === 0) {
    return getProficiencyLabel(skill.proficiency || 1, 'description');
  }

  return parts.join('. ');
}

/**
 * Detect what type of skill question is being asked
 * @param {string} questionText - The question label/text
 * @returns {Object} - { type, skillName }
 */
function detectSkillQuestion(questionText) {
  if (!questionText) return null;
  const lower = questionText.toLowerCase();

  // Detect question type
  let type = 'unknown';

  if (/rate|proficiency|skill level|1-5|scale/.test(lower)) {
    type = 'rating';
  } else if (/years of experience|how many years|experience with/.test(lower)) {
    type = 'years';
  } else if (/describe|tell us about|explain.*experience/.test(lower)) {
    type = 'description';
  } else if (/do you have|have you used|experience in|familiar with/.test(lower)) {
    type = 'yes_no';
  } else if (/list|select|choose|check all/.test(lower)) {
    type = 'list';
  }

  // Try to extract skill name
  let skillName = null;

  // Common patterns
  const patterns = [
    /(?:with|in|using)\s+([a-zA-Z0-9#+.]+)/i,
    /(?:proficiency|experience|skill).*?(?:in|with)\s+([a-zA-Z0-9#+.]+)/i,
    /([a-zA-Z0-9#+.]+)\s+(?:proficiency|experience|skill)/i,
    /rate.*?([a-zA-Z0-9#+.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      skillName = normalizeSkillName(match[1]);
      break;
    }
  }

  return { type, skillName };
}

/**
 * Find a skill in the profile
 * @param {Object} profile - User profile with skills
 * @param {string} skillName - Skill to find
 * @returns {Object|null} - Skill object or null
 */
function findSkillInProfile(profile, skillName) {
  if (!profile?.skills || !skillName) return null;

  const normalized = normalizeSkillName(skillName);

  // Check all skill categories
  const categories = ['languages', 'frameworks', 'databases', 'cloud', 'tools', 'ml'];

  for (const category of categories) {
    const skills = profile.skills[category];
    if (!skills) continue;

    const found = skills.find(s =>
      normalizeSkillName(s.name) === normalized
    );

    if (found) return found;
  }

  return null;
}

/**
 * Answer a skill question from the profile
 * @param {Object} profile - User profile
 * @param {string} questionText - The question being asked
 * @param {string} questionType - Optional explicit type override
 * @returns {string|number|null} - Answer or null if skill not found
 */
function answerSkillQuestion(profile, questionText, questionType = null) {
  const detected = detectSkillQuestion(questionText);
  if (!detected) return null;

  const skill = findSkillInProfile(profile, detected.skillName);
  if (!skill) {
    // Return conservative default for unknown skills
    const type = questionType || detected.type;
    if (type === 'rating') return 1;
    if (type === 'years') return '0';
    if (type === 'yes_no') return 'No';
    return 'No experience';
  }

  return generateSkillAnswer(skill, questionType || detected.type);
}

/**
 * Create a skill summary for display
 * @param {Object} profile - User profile
 * @returns {Object} - Summary by category
 */
function getSkillsSummary(profile) {
  if (!profile?.skills) return {};

  const summary = {};

  for (const [category, skills] of Object.entries(profile.skills)) {
    if (!Array.isArray(skills) || skills.length === 0) continue;

    summary[category] = skills
      .sort((a, b) => (b.proficiency || 0) - (a.proficiency || 0))
      .map(s => ({
        name: s.name,
        proficiency: s.proficiency,
        proficiencyLabel: getProficiencyLabel(s.proficiency || 1, 'short'),
        years: s.years || 0,
      }));
  }

  return summary;
}

export {
  normalizeSkillName,
  getSkillCategory,
  mapYearsToDropdown,
  getProficiencyLabel,
  parseProficiencyFromText,
  generateSkillAnswer,
  generateSkillDescription,
  detectSkillQuestion,
  findSkillInProfile,
  answerSkillQuestion,
  getSkillsSummary,
  SKILL_SYNONYMS,
  SKILL_CATEGORIES,
  PROFICIENCY_LABELS,
  YEARS_DROPDOWNS,
};

export default {
  normalizeSkillName,
  getSkillCategory,
  mapYearsToDropdown,
  getProficiencyLabel,
  parseProficiencyFromText,
  generateSkillAnswer,
  generateSkillDescription,
  detectSkillQuestion,
  findSkillInProfile,
  answerSkillQuestion,
  getSkillsSummary,
  SKILL_SYNONYMS,
  SKILL_CATEGORIES,
  PROFICIENCY_LABELS,
  YEARS_DROPDOWNS,
};
