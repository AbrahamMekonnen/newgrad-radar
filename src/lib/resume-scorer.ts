/**
 * Resume scoring and matching logic
 * Calculates how well a resume matches a specific job
 */

import { ResumeData } from './resume-templates';

export interface JobRequirements {
  title: string;
  company: string;
  tier: string;
  roleType: string;
  description?: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  techStack: string[];
  keywords: string[];
}

export interface SkillSuggestion {
  skill: string;
  category: 'critical' | 'nice_to_have';
  action: 'add_skill' | 'highlight_in_experience' | 'add_project';
  suggestion: string;  // Specific actionable suggestion
  impact: 'high' | 'medium' | 'low';  // How much this would improve the score
}

export interface ResumeScore {
  overall: number;           // 0-100
  skillMatch: number;        // 0-100
  experienceMatch: number;   // 0-100
  keywordMatch: number;      // 0-100
  missingCritical: string[]; // Skills you're missing that are required
  missingNice: string[];     // Nice-to-have skills you're missing
  presentSkills: string[];   // Skills you have that match
  suggestion: 'good' | 'tweak' | 'major_tweak';
  suggestedTweaks: string[]; // What to improve

  // Enhanced actionable suggestions
  skillSuggestions: SkillSuggestion[];  // Specific, prioritized suggestions
  quickWins: string[];                   // Skills that would be easy to add
  topPriority: string[];                 // Most impactful skills to add (top 3)
  improvementPotential: number;          // How much the score could improve
}

/**
 * Extract all skills/keywords from a resume
 */
export function extractResumeKeywords(resume: ResumeData): string[] {
  const keywords = new Set<string>();

  // From skills section
  resume.skills.forEach(category => {
    category.items.forEach(skill => {
      keywords.add(skill.toLowerCase().trim());
    });
  });

  // From experience bullets
  resume.experience.forEach(exp => {
    exp.bullets.forEach(bullet => {
      extractTechFromText(bullet).forEach(tech => keywords.add(tech.toLowerCase()));
    });
    // Also add company/title context
    if (exp.title) extractTechFromText(exp.title).forEach(t => keywords.add(t.toLowerCase()));
  });

  // From projects
  resume.projects.forEach(proj => {
    // Technologies field
    proj.technologies.split(/[,|]/).forEach(tech => {
      keywords.add(tech.trim().toLowerCase());
    });
    proj.bullets.forEach(bullet => {
      extractTechFromText(bullet).forEach(tech => keywords.add(tech.toLowerCase()));
    });
  });

  return Array.from(keywords).filter(k => k.length > 1);
}

/**
 * Extract technology/skill terms from text
 */
function extractTechFromText(text: string): string[] {
  const techPatterns = [
    // Languages
    /\b(python|java|javascript|typescript|go|golang|rust|c\+\+|c#|ruby|php|swift|kotlin|scala|r)\b/gi,
    // Frameworks
    /\b(react|angular|vue|next\.?js|node\.?js|express|django|flask|spring|rails|fastapi|nest\.?js)\b/gi,
    // Databases
    /\b(postgresql|mysql|mongodb|redis|elasticsearch|dynamodb|cassandra|sqlite|oracle|sql server)\b/gi,
    // Cloud/Infra
    /\b(aws|gcp|azure|docker|kubernetes|k8s|terraform|jenkins|circleci|github actions)\b/gi,
    // ML/AI
    /\b(tensorflow|pytorch|keras|scikit-learn|pandas|numpy|opencv|nlp|llm|transformers|bert|gpt)\b/gi,
    // Tools
    /\b(git|linux|unix|rest|graphql|grpc|kafka|rabbitmq|nginx|apache)\b/gi,
    // Concepts
    /\b(microservices|api|ci\/cd|devops|agile|scrum|tdd|oop|functional)\b/gi,
  ];

  const found: string[] = [];
  techPatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    found.push(...matches);
  });

  return found;
}

/**
 * Score how well a resume matches a job
 */
export function scoreResume(resume: ResumeData, job: JobRequirements): ResumeScore {
  const resumeKeywords = extractResumeKeywords(resume);
  const resumeKeywordsLower = new Set(resumeKeywords.map(k => k.toLowerCase()));

  // Check required skills
  const presentRequired: string[] = [];
  const missingRequired: string[] = [];
  job.requiredSkills.forEach(skill => {
    const skillLower = skill.toLowerCase();
    const variations = getSkillVariations(skillLower);
    if (variations.some(v => resumeKeywordsLower.has(v))) {
      presentRequired.push(skill);
    } else {
      missingRequired.push(skill);
    }
  });

  // Check nice-to-have skills
  const presentNice: string[] = [];
  const missingNice: string[] = [];
  job.niceToHaveSkills.forEach(skill => {
    const skillLower = skill.toLowerCase();
    const variations = getSkillVariations(skillLower);
    if (variations.some(v => resumeKeywordsLower.has(v))) {
      presentNice.push(skill);
    } else {
      missingNice.push(skill);
    }
  });

  // Check tech stack
  const presentTech: string[] = [];
  job.techStack.forEach(tech => {
    const techLower = tech.toLowerCase();
    const variations = getSkillVariations(techLower);
    if (variations.some(v => resumeKeywordsLower.has(v))) {
      presentTech.push(tech);
    }
  });

  // Check keywords
  const presentKeywords: string[] = [];
  job.keywords.forEach(kw => {
    const kwLower = kw.toLowerCase();
    if (resumeKeywordsLower.has(kwLower)) {
      presentKeywords.push(kw);
    }
  });

  // Calculate scores
  const requiredTotal = job.requiredSkills.length;
  const niceTotal = job.niceToHaveSkills.length;
  const techTotal = job.techStack.length;
  const keywordTotal = job.keywords.length;

  // Normalize across the dimensions that actually exist. Previously every role
  // with no nice-to-have list had a hard 70% ceiling for skill match.
  const requiredRatio = requiredTotal ? presentRequired.length / requiredTotal : null;
  const niceRatio = niceTotal ? presentNice.length / niceTotal : null;
  const skillMatch = Math.round(
    requiredRatio !== null && niceRatio !== null
      ? (requiredRatio * 70) + (niceRatio * 30)
      : (requiredRatio ?? niceRatio ?? 0) * 100
  );
  const experienceMatch = Math.round(techTotal ? (presentTech.length / techTotal) * 100 : skillMatch);
  const keywordMatch = Math.round(keywordTotal ? (presentKeywords.length / keywordTotal) * 100 : skillMatch);

  const dimensions = [
    { score: skillMatch, weight: 0.5, available: requiredTotal + niceTotal > 0 },
    { score: experienceMatch, weight: 0.3, available: techTotal > 0 },
    { score: keywordMatch, weight: 0.2, available: keywordTotal > 0 },
  ].filter((dimension) => dimension.available);
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) || 1;
  const overall = Math.round(
    dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / totalWeight
  );

  // Generate specific, actionable skill suggestions
  const skillSuggestions: SkillSuggestion[] = [];

  // Critical skills (required) - high impact
  missingRequired.forEach((skill, index) => {
    const isCommonSkill = isEasyToLearn(skill);
    skillSuggestions.push({
      skill,
      category: 'critical',
      action: isCommonSkill ? 'add_skill' : 'highlight_in_experience',
      suggestion: generateSpecificSuggestion(skill, 'critical', resumeKeywords),
      impact: index < 3 ? 'high' : 'medium',
    });
  });

  // Nice-to-have skills - medium/low impact
  missingNice.forEach((skill, index) => {
    skillSuggestions.push({
      skill,
      category: 'nice_to_have',
      action: 'add_skill',
      suggestion: generateSpecificSuggestion(skill, 'nice_to_have', resumeKeywords),
      impact: index < 2 ? 'medium' : 'low',
    });
  });

  // Sort by impact
  skillSuggestions.sort((a, b) => {
    const impactOrder = { high: 0, medium: 1, low: 2 };
    return impactOrder[a.impact] - impactOrder[b.impact];
  });

  // Quick wins: skills that are easy to add (common tech terms)
  const quickWins = missingRequired
    .filter(skill => isEasyToLearn(skill))
    .slice(0, 3);

  // Top priority: first 3 critical skills
  const topPriority = missingRequired.slice(0, 3);

  // Calculate improvement potential
  const maxPossibleImprovement = Math.min(100 - overall,
    (missingRequired.length * 5) + (missingNice.length * 2));

  // Determine suggestion
  let suggestion: 'good' | 'tweak' | 'major_tweak';
  const suggestedTweaks: string[] = [];

  if (overall >= 80) {
    suggestion = 'good';
  } else if (overall >= 50) {
    suggestion = 'tweak';
    if (missingRequired.length > 0) {
      suggestedTweaks.push(`Add these skills: ${missingRequired.slice(0, 3).join(', ')}`);
    }
    if (presentTech.length < techTotal * 0.5) {
      suggestedTweaks.push('Highlight relevant tech stack in your experience bullets');
    }
  } else {
    suggestion = 'major_tweak';
    suggestedTweaks.push(`Missing ${missingRequired.length} required skills`);
    suggestedTweaks.push('Consider emphasizing transferable projects');
    if (missingRequired.length > 3) {
      suggestedTweaks.push('This role may not be a strong match for your background');
    }
  }

  return {
    overall,
    skillMatch,
    experienceMatch,
    keywordMatch,
    missingCritical: missingRequired,
    missingNice: missingNice,
    presentSkills: [...new Set([...presentRequired, ...presentNice, ...presentTech])],
    suggestion,
    suggestedTweaks,
    skillSuggestions,
    quickWins,
    topPriority,
    improvementPotential: maxPossibleImprovement,
  };
}

/**
 * Check if a skill is commonly used and easy to demonstrate
 */
function isEasyToLearn(skill: string): boolean {
  const easySkills = [
    'git', 'sql', 'rest', 'json', 'linux', 'docker', 'agile', 'scrum',
    'typescript', 'javascript', 'python', 'html', 'css', 'graphql',
    'react', 'node.js', 'express', 'jest', 'testing', 'ci/cd',
  ];
  return easySkills.some(s => skill.toLowerCase().includes(s));
}

/**
 * Generate a specific, actionable suggestion for a missing skill
 */
function generateSpecificSuggestion(
  skill: string,
  category: 'critical' | 'nice_to_have',
  existingSkills: string[]
): string {
  const skillLower = skill.toLowerCase();

  // Map skills to related skills user might have
  const relatedSkillsMap: Record<string, string[]> = {
    'react': ['javascript', 'typescript', 'vue', 'angular'],
    'typescript': ['javascript'],
    'python': ['java', 'javascript', 'ruby'],
    'aws': ['gcp', 'azure', 'cloud'],
    'kubernetes': ['docker', 'containers'],
    'postgresql': ['mysql', 'sql', 'database'],
    'machine learning': ['python', 'tensorflow', 'pytorch', 'data science'],
    'system design': ['architecture', 'distributed systems'],
  };

  // Check if user has related skills
  const relatedSkills = relatedSkillsMap[skillLower] || [];
  const hasRelated = relatedSkills.some(rs =>
    existingSkills.some(es => es.toLowerCase().includes(rs))
  );

  // Generate specific suggestions based on skill type
  if (skillLower.includes('sql') || skillLower.includes('database')) {
    return `Add "${skill}" to your skills - mention any database queries or data manipulation in your projects`;
  }

  if (skillLower.includes('docker') || skillLower.includes('kubernetes')) {
    return `Add "${skill}" to your skills - if you've used containers in any project, highlight that`;
  }

  if (skillLower.includes('aws') || skillLower.includes('gcp') || skillLower.includes('cloud')) {
    return `Add "${skill}" - mention any cloud deployments, even personal projects on free tiers count`;
  }

  if (skillLower.includes('react') || skillLower.includes('vue') || skillLower.includes('angular')) {
    return `Add "${skill}" to your frontend skills - include any web apps you've built`;
  }

  if (skillLower.includes('python') || skillLower.includes('java') || skillLower.includes('go')) {
    return `Add "${skill}" - list it under Languages and mention in project descriptions`;
  }

  if (skillLower.includes('system design') || skillLower.includes('architecture')) {
    return `For "${skill}" - describe technical decisions in your project bullets (e.g., "Designed X to handle Y")`;
  }

  if (category === 'critical') {
    if (hasRelated) {
      return `Add "${skill}" to your skills - your experience with ${relatedSkills.find(rs => existingSkills.some(es => es.toLowerCase().includes(rs)))} is transferable`;
    }
    return `Add "${skill}" to your skills section - this is required for the role`;
  }

  return `Consider adding "${skill}" - it would strengthen your application`;
}

/**
 * Get common variations of a skill name
 */
function getSkillVariations(skill: string): string[] {
  const variations = [skill];

  // Common aliases
  const aliases: Record<string, string[]> = {
    'javascript': ['js', 'node', 'nodejs', 'node.js'],
    'typescript': ['ts'],
    'python': ['py'],
    'golang': ['go'],
    'kubernetes': ['k8s'],
    'postgresql': ['postgres', 'psql'],
    'mongodb': ['mongo'],
    'machine learning': ['ml'],
    'artificial intelligence': ['ai'],
    'amazon web services': ['aws'],
    'google cloud': ['gcp', 'google cloud platform'],
    'microsoft azure': ['azure'],
    'react': ['reactjs', 'react.js'],
    'vue': ['vuejs', 'vue.js'],
    'next.js': ['nextjs', 'next'],
    'node.js': ['nodejs', 'node'],
  };

  // Add aliases
  Object.entries(aliases).forEach(([key, vals]) => {
    if (skill === key) {
      variations.push(...vals);
    }
    if (vals.includes(skill)) {
      variations.push(key);
    }
  });

  // Add without special chars
  variations.push(skill.replace(/[.\-_]/g, ''));
  variations.push(skill.replace(/[.\-_]/g, ' '));

  return [...new Set(variations)];
}

/**
 * Extract job requirements from job posting text (uses AI)
 */
export async function extractJobRequirements(
  jobTitle: string,
  company: string,
  tier: string,
  roleType: string,
  description?: string
): Promise<JobRequirements> {
  // Base requirements by role type
  const roleDefaults: Record<string, Partial<JobRequirements>> = {
    swe: {
      requiredSkills: ['Data Structures', 'Algorithms', 'Problem Solving'],
      techStack: ['Git', 'SQL'],
      keywords: ['software engineer', 'development', 'coding'],
    },
    backend: {
      requiredSkills: ['API Design', 'Databases', 'Server-side Development'],
      techStack: ['SQL', 'REST', 'Docker'],
      keywords: ['backend', 'server', 'api', 'microservices'],
    },
    frontend: {
      requiredSkills: ['HTML', 'CSS', 'JavaScript'],
      techStack: ['React', 'TypeScript', 'CSS'],
      keywords: ['frontend', 'ui', 'ux', 'responsive'],
    },
    fullstack: {
      requiredSkills: ['Frontend Development', 'Backend Development', 'Databases'],
      techStack: ['React', 'Node.js', 'PostgreSQL'],
      keywords: ['fullstack', 'full-stack', 'end-to-end'],
    },
    ml: {
      requiredSkills: ['Machine Learning', 'Python', 'Statistics'],
      techStack: ['Python', 'TensorFlow', 'PyTorch', 'pandas'],
      keywords: ['machine learning', 'ml', 'ai', 'deep learning', 'nlp'],
    },
    data: {
      requiredSkills: ['SQL', 'Data Analysis', 'Python'],
      techStack: ['SQL', 'Python', 'Spark', 'Airflow'],
      keywords: ['data engineer', 'etl', 'pipeline', 'data warehouse'],
    },
    infra: {
      requiredSkills: ['Cloud Platforms', 'Linux', 'Networking'],
      techStack: ['AWS', 'Docker', 'Kubernetes', 'Terraform'],
      keywords: ['infrastructure', 'devops', 'sre', 'cloud'],
    },
  };

  const defaults = roleDefaults[roleType] || roleDefaults.swe;
  const detectedTech = description ? extractTechFromText(description) : [];
  const titleKeywords = jobTitle
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'with'].includes(word));

  // Tier-specific additions
  const tierAdditions: Record<string, string[]> = {
    faang: ['System Design', 'Scalability', 'Distributed Systems'],
    ai: ['LLM', 'Transformers', 'Deep Learning'],
    unicorn: ['Fast-paced', 'Ownership', 'Impact'],
  };

  return {
    title: jobTitle,
    company,
    tier,
    roleType,
    description,
    requiredSkills: [...(defaults.requiredSkills || []), ...(tierAdditions[tier] || [])],
    niceToHaveSkills: [],
    techStack: [...new Set([...(defaults.techStack || []), ...detectedTech])],
    keywords: [...new Set([...(defaults.keywords || []), ...titleKeywords])],
  };
}
