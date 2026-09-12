# Answer Template Generation with LLM

Complete implementation guide for generating and caching personalized answer templates using LLM for job applications.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Question Categories and Templates](#2-question-categories-and-templates)
3. [Storage Schema](#3-storage-schema)
4. [LLM Prompts for Bulk Generation](#4-llm-prompts-for-bulk-generation)
5. [Runtime Personalization](#5-runtime-personalization)
6. [Implementation Code](#6-implementation-code)
7. [Cost Optimization](#7-cost-optimization)

---

## 1. Architecture Overview

### The Problem

Generating personalized answers at application time is:
- **Slow**: LLM calls add 2-5 seconds per question
- **Expensive**: Each application triggers multiple API calls
- **Inconsistent**: Real-time generation can produce varying quality

### The Solution

**One-Time Bulk Generation + Runtime Personalization**

```
+-------------------+     +------------------+     +-------------------+
|   User Profile    |---->|  LLM Generation  |---->|   Answer Bank     |
|   (story bank,    |     |  (one-time,      |     |   (pre-generated  |
|    experiences)   |     |   cached)        |     |    templates)     |
+-------------------+     +------------------+     +-------------------+
                                                            |
                                                            v
+-------------------+     +------------------+     +-------------------+
|   Application     |<----|  Personalization |<----|   Template        |
|   Form            |     |  Engine          |     |   Selection       |
+-------------------+     +------------------+     +-------------------+
```

### Key Principles

1. **Generate Once, Use Many**: Pre-generate answers from user's story bank
2. **Variable Interpolation**: Replace `{company}`, `{role}`, `{product}` at runtime
3. **Category Matching**: Map questions to pre-generated answer categories
4. **Length Variants**: Store short (75w), standard (150w), and long (300w) versions

---

## 2. Question Categories and Templates

### 2.1 Question Pattern Matching

```javascript
// /auto-apply/answers/question-classifier.js

const QUESTION_PATTERNS = {
  // Category: why_company
  why_company: [
    /why.*(?:interested|want|applying|work).*(?:here|company|organization)/i,
    /what.*(?:excites|attracts|interests).*(?:about|regarding).*(?:company|role)/i,
    /why.*(?:this|our).*company/i,
    /what.*drew.*to.*(?:this|our)/i,
  ],

  // Category: why_role
  why_role: [
    /why.*(?:interested|want).*(?:this|the).*(?:role|position|job)/i,
    /what.*(?:excites|interests).*about.*(?:this|the).*(?:role|position)/i,
    /why.*(?:software|engineering|developer)/i,
  ],

  // Category: challenging_project
  challenging_project: [
    /(?:challenging|difficult|complex).*project/i,
    /project.*(?:proud|significant|impactful)/i,
    /describe.*(?:technical|engineering).*project/i,
    /tell.*about.*project/i,
  ],

  // Category: teamwork
  teamwork: [
    /(?:work|collaborate).*(?:team|group)/i,
    /team.*(?:experience|project)/i,
    /describe.*(?:collaboration|teamwork)/i,
    /cross-functional/i,
  ],

  // Category: conflict_resolution
  conflict_resolution: [
    /(?:conflict|disagreement|difficult).*(?:colleague|coworker|team)/i,
    /(?:resolve|handle).*(?:conflict|disagreement)/i,
    /time.*(?:disagreed|conflict)/i,
  ],

  // Category: failure_learning
  failure_learning: [
    /(?:fail|mistake|wrong).*(?:learn|teach)/i,
    /time.*(?:failed|made.*mistake)/i,
    /learn.*from.*(?:failure|mistake)/i,
    /biggest.*(?:failure|mistake)/i,
  ],

  // Category: leadership
  leadership: [
    /(?:lead|leadership|led).*(?:team|project|initiative)/i,
    /(?:mentor|manage|influence)/i,
    /take.*(?:initiative|charge|lead)/i,
  ],

  // Category: problem_solving
  problem_solving: [
    /(?:solve|approach|tackle).*(?:problem|challenge|issue)/i,
    /(?:debug|troubleshoot)/i,
    /difficult.*(?:technical|engineering).*(?:problem|challenge)/i,
  ],

  // Category: strengths
  strengths: [
    /(?:strength|strong.*point|best.*quality)/i,
    /what.*(?:make|makes).*(?:good|great|strong)/i,
    /why.*(?:hire|should.*hire)/i,
  ],

  // Category: weaknesses
  weaknesses: [
    /(?:weakness|area.*improvement|growth.*area)/i,
    /what.*(?:improve|working.*on)/i,
    /constructive.*feedback/i,
  ],

  // Category: career_goals
  career_goals: [
    /(?:career|professional).*(?:goal|aspiration)/i,
    /where.*(?:see.*yourself|want.*be).*(?:years|future)/i,
    /long.*term.*(?:goal|plan)/i,
  ],

  // Category: achievement
  achievement: [
    /(?:accomplishment|achievement|proud)/i,
    /greatest.*(?:success|achievement)/i,
    /impact.*(?:made|had)/i,
  ],
};

/**
 * Classify a question into a category
 * @param {string} questionText - The question text from the form
 * @returns {{category: string, confidence: number, suggestedLength: number}}
 */
export function classifyQuestion(questionText) {
  const normalized = questionText.toLowerCase().trim();

  // Detect character/word limits
  const wordLimit = detectWordLimit(questionText);

  // Match against patterns
  const matches = Object.entries(QUESTION_PATTERNS)
    .map(([category, patterns]) => {
      const matchCount = patterns.filter((p) => p.test(normalized)).length;
      return {
        category,
        confidence: matchCount / patterns.length,
        matchCount,
      };
    })
    .filter((m) => m.matchCount > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      category: 'generic',
      confidence: 0,
      suggestedLength: wordLimit || 150,
    };
  }

  return {
    category: matches[0].category,
    confidence: matches[0].confidence,
    suggestedLength: wordLimit || 150,
  };
}

/**
 * Detect word/character limits from question text
 */
function detectWordLimit(text) {
  const patterns = [
    /(\d+)\s*(?:words?|characters?)\s*(?:max|limit|or less)/i,
    /(?:max|limit|under)\s*(\d+)\s*(?:words?|characters?)/i,
    /\((\d+)\s*(?:words?|characters?)\)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const limit = parseInt(match[1]);
      // If characters, convert to approximate word count
      return limit > 500 ? Math.floor(limit / 5) : limit;
    }
  }

  return null;
}

export default { classifyQuestion, QUESTION_PATTERNS };
```

### 2.2 Answer Templates by Category

```javascript
// /auto-apply/answers/templates.js

/**
 * Template structures for each answer category
 * Variables: {company}, {role}, {product}, {team}, {experience}, {skill}
 */
export const ANSWER_TEMPLATES = {
  why_company: {
    structure: 'hook + company_specific + personal_connection + contribution',
    variables: ['company', 'product', 'mission', 'recent_news'],
    lengths: {
      short: 75,
      standard: 150,
      long: 300,
    },
    examples: {
      short: `I've been following {company}'s work on {product}, and the approach to {mission} aligns with what I care about. My experience with {relevant_experience} would let me contribute from day one.`,
      standard: `I've been following {company}'s work on {product} since {timeline}. What stands out is {specific_detail} - it shows a commitment to {value}. My background in {relevant_experience} connects directly to {role_requirement}. I want to contribute to {specific_goal} and grow as an engineer at a company that {culture_fit}.`,
      long: `I've been following {company} since {timeline}, particularly the work on {product}. {specific_observation_about_product}. What excites me most is {technical_challenge} - as someone who has worked on {relevant_experience}, I understand the complexity of {problem_domain}. {personal_connection_story}. The {role} role excites me because {role_specific_interest}. My experience with {technical_skills} has prepared me for {job_requirements}. I'm drawn to {company}'s approach to {company_value}, and I want to be part of building {future_vision}.`,
    },
  },

  challenging_project: {
    structure: 'STAR: situation + task + actions + results + learning',
    variables: ['project_name', 'context', 'challenge', 'actions', 'metrics'],
    lengths: {
      short: 75,
      standard: 200,
      long: 350,
    },
  },

  teamwork: {
    structure: 'context + role + collaboration + outcome',
    variables: ['project', 'team_size', 'your_role', 'collaboration_style'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
  },

  conflict_resolution: {
    structure: 'situation + approach + resolution + relationship_outcome',
    variables: ['context', 'disagreement', 'approach', 'resolution'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
  },

  failure_learning: {
    structure: 'mistake + impact + response + learning + application',
    variables: ['failure', 'consequence', 'recovery', 'lesson'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
  },

  leadership: {
    structure: 'context + challenge + leadership_actions + team_outcome',
    variables: ['scope', 'situation', 'actions', 'impact'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
  },

  problem_solving: {
    structure: 'problem + analysis + solution + result',
    variables: ['problem', 'approach', 'solution', 'outcome'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
  },

  strengths: {
    structure: 'strength + evidence + relevance_to_role',
    variables: ['strength', 'example', 'application'],
    lengths: {
      short: 50,
      standard: 100,
      long: 200,
    },
  },

  career_goals: {
    structure: 'current_position + growth_areas + long_term_vision + company_fit',
    variables: ['current_stage', 'learning_goals', 'future_role'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
  },
};

export default ANSWER_TEMPLATES;
```

---

## 3. Storage Schema

### 3.1 Database Schema (Supabase)

```sql
-- =============================================
-- User Story Bank
-- =============================================
-- Core experiences that power answer generation

CREATE TABLE user_story_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Story classification
  story_type TEXT NOT NULL CHECK (story_type IN (
    'project', 'teamwork', 'conflict', 'leadership', 
    'failure', 'achievement', 'technical', 'growth'
  )),
  
  -- Story content
  title TEXT NOT NULL,
  context TEXT, -- 'internship', 'class', 'personal', 'hackathon', 'work'
  organization TEXT, -- Company/school name (can be anonymized)
  
  -- STAR components
  situation TEXT NOT NULL,
  task TEXT NOT NULL,
  actions JSONB NOT NULL, -- Array of action statements
  results JSONB NOT NULL, -- Array of {metric, value, description}
  
  -- Additional context
  team_size INTEGER,
  duration TEXT,
  technologies TEXT[],
  skills_demonstrated TEXT[],
  challenges_faced TEXT[],
  lessons_learned TEXT[],
  
  -- Question mapping
  applicable_categories TEXT[], -- Which question categories this answers
  strength_rating INTEGER CHECK (strength_rating BETWEEN 1 AND 5),
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_used_company TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_story_bank_user ON user_story_bank(user_id);
CREATE INDEX idx_story_bank_type ON user_story_bank(user_id, story_type);
CREATE INDEX idx_story_bank_categories ON user_story_bank USING GIN(applicable_categories);

-- =============================================
-- Pre-Generated Answer Bank
-- =============================================
-- Cached answers generated from story bank

CREATE TABLE answer_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES user_story_bank(id) ON DELETE CASCADE,
  
  -- Question classification
  question_category TEXT NOT NULL,
  word_count_target INTEGER NOT NULL, -- 75, 150, 250, 350
  variation_index INTEGER NOT NULL DEFAULT 1, -- For multiple versions
  
  -- Generated content
  answer_text TEXT NOT NULL,
  answer_structure TEXT, -- 'result_first', 'challenge_first', 'standard_star'
  
  -- Personalization slots
  variable_slots JSONB, -- {company: null, product: null, ...}
  
  -- Quality metadata
  generation_model TEXT, -- 'gemini-1.5-flash', 'gpt-4', etc.
  generation_prompt_version TEXT,
  
  -- Usage
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(story_id, question_category, word_count_target, variation_index)
);

CREATE INDEX idx_answer_bank_user ON answer_bank(user_id);
CREATE INDEX idx_answer_bank_category ON answer_bank(user_id, question_category);

-- =============================================
-- Company-Specific Answers
-- =============================================
-- Personalized "Why Company" answers

CREATE TABLE company_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Company info
  company_slug TEXT NOT NULL,
  company_name TEXT NOT NULL,
  
  -- Pre-generated answers by length
  why_company_short TEXT, -- 75 words
  why_company_standard TEXT, -- 150 words
  why_company_long TEXT, -- 300 words
  
  -- Context used for generation
  company_mission TEXT,
  company_products TEXT[],
  recent_news TEXT[],
  user_connection TEXT, -- Personal reason
  relevant_experience TEXT, -- From story bank
  
  -- Metadata
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generation_model TEXT,
  
  UNIQUE(user_id, company_slug)
);

CREATE INDEX idx_company_answers_user ON company_answers(user_id);
CREATE INDEX idx_company_answers_company ON company_answers(company_slug);

-- =============================================
-- Generation History (for debugging/improvement)
-- =============================================

CREATE TABLE generation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Request
  request_type TEXT, -- 'bulk_stories', 'company_specific', 'single_question'
  input_data JSONB,
  prompt_used TEXT,
  
  -- Response
  model_used TEXT,
  tokens_used INTEGER,
  generation_time_ms INTEGER,
  output_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Profile Extension (profile.json)

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  
  "storyBank": {
    "projects": [
      {
        "id": "proj_001",
        "title": "Real-time Notification System",
        "context": "internship",
        "organization": "TechCo",
        "situation": "Our app's notifications were delayed 30 minutes due to batch processing",
        "task": "Redesign notification pipeline for sub-second delivery",
        "actions": [
          "Analyzed existing batch system to identify bottlenecks",
          "Proposed WebSocket-based real-time architecture",
          "Built proof-of-concept in 1 week",
          "Led migration with backward compatibility"
        ],
        "results": [
          {"metric": "latency", "value": "30min to <1s"},
          {"metric": "engagement", "value": "15% increase"}
        ],
        "technologies": ["WebSocket", "Redis", "Node.js"],
        "skillsDemonstrated": ["problem-solving", "leadership", "system-design"],
        "applicableCategories": ["challenging_project", "technical", "leadership", "achievement"],
        "strengthRating": 5
      }
    ],
    "teamwork": [],
    "challenges": [],
    "failures": []
  },
  
  "answerBank": {
    "challenging_project": {
      "short": "During my internship, our app's notifications were delayed 30 minutes. I proposed and implemented a WebSocket-based system, reducing latency to under 1 second and increasing engagement by 15%. This taught me to advocate for user-impacting improvements.",
      "standard": "During my internship at TechCo, I identified that our mobile app's notifications were delayed by up to 30 minutes due to legacy batch processing. I took ownership of the problem, proposing a WebSocket-based real-time architecture. After building a proof-of-concept in a week and getting approval, I led the migration while maintaining backward compatibility. The result: latency dropped from 30 minutes to under 1 second, and notification engagement increased 15%. This project taught me how to advocate for user-impacting improvements and lead cross-functional initiatives.",
      "long": "..."
    },
    "teamwork": {
      "short": "...",
      "standard": "...",
      "long": "..."
    }
  },
  
  "companyAnswers": {
    "stripe": {
      "why_company_short": "I've integrated Stripe in three projects and was struck by the API design and error messages. I want to help build developer tools that set the standard for what good DX looks like.",
      "why_company_standard": "Stripe's developer experience set the standard for what APIs should feel like. I've integrated Stripe in three personal projects, and each time I was struck by how thoughtful the documentation and error messages are. That attention to developer ergonomics is what I want to help build. The Infrastructure Engineering role excites me because I love the challenge of systems that need to be both fast and reliable. During my internship, I worked on a payment processing service, and I learned how critical every millisecond of latency is. I'm drawn to Stripe's engineering culture of writing detailed RFCs and investing in internal tools."
    }
  }
}
```

---

## 4. LLM Prompts for Bulk Generation

### 4.1 Story-to-Answer Generation Prompt

```javascript
// /auto-apply/answers/prompts.js

/**
 * Prompt for generating multiple answer variations from a single story
 */
export function buildStoryToAnswerPrompt(story, category, userProfile) {
  return `You are helping a job applicant generate answers for their applications.

TASK: Generate 3 variations of an answer for the "${category}" question category, using the provided story.

USER STORY:
- Title: ${story.title}
- Context: ${story.context} at ${story.organization || 'a tech company'}
- Situation: ${story.situation}
- Task: ${story.task}
- Actions: ${story.actions.join('; ')}
- Results: ${story.results.map(r => `${r.metric}: ${r.value}`).join('; ')}
- Technologies: ${story.technologies?.join(', ') || 'N/A'}
- Skills: ${story.skillsDemonstrated?.join(', ') || 'N/A'}

CANDIDATE BACKGROUND:
- Education: ${userProfile.education?.degree} in ${userProfile.education?.major} from ${userProfile.education?.school}
- Interests: ${userProfile.interests?.slice(0, 3).join(', ') || 'building great software'}

REQUIREMENTS:
1. Generate 3 answer lengths: SHORT (75 words), STANDARD (150-200 words), LONG (300-350 words)
2. Each answer MUST follow STAR format: Situation, Task, Action, Result
3. Use first-person "I" statements for actions
4. Include specific metrics/numbers from the story
5. Sound natural and conversational, not robotic
6. Use contractions naturally ("I'm", "I've", "didn't")
7. Vary sentence lengths for rhythm

DO NOT use these phrases:
- "I am passionate about"
- "I thrive in fast-paced environments"
- "I am confident that"
- "leverage my skills"
- "Furthermore" / "Moreover" / "In addition"

OUTPUT FORMAT (JSON):
{
  "short": "...",
  "standard": "...",
  "long": "...",
  "structure_used": "result_first" | "challenge_first" | "standard_star"
}

Generate the answers:`;
}

/**
 * Prompt for generating "Why this company?" answers
 */
export function buildWhyCompanyPrompt(companyData, userProfile, relevantStory) {
  return `Generate a "Why do you want to work at ${companyData.name}?" answer for a job application.

COMPANY CONTEXT:
- Company: ${companyData.name}
- Mission: ${companyData.mission || 'Not provided'}
- Key Products: ${companyData.products?.join(', ') || 'Not provided'}
- Recent News: ${companyData.recentNews?.join('; ') || 'None provided'}
- Technical Focus: ${companyData.technicalFocus?.join(', ') || 'Not provided'}

ROLE CONTEXT:
- Job Title: ${companyData.roleTitle || 'Software Engineer'}
- Team: ${companyData.team || 'Engineering'}
- Key Requirements: ${companyData.requirements?.slice(0, 3).join(', ') || 'Not specified'}

CANDIDATE PROFILE:
- Background: ${userProfile.education?.degree} in ${userProfile.education?.major} from ${userProfile.education?.school}
- Interests: ${userProfile.interests?.join(', ') || 'building impactful products'}
- Goals: ${userProfile.goals?.slice(0, 2).join(', ') || 'learn and grow'}
${relevantStory ? `- Relevant Experience: ${relevantStory.title} - ${relevantStory.results?.map(r => r.value).join(', ')}` : ''}
${companyData.personalConnection ? `- Personal Connection: ${companyData.personalConnection}` : ''}

REQUIREMENTS:
1. Generate 3 lengths: SHORT (75w), STANDARD (150-200w), LONG (300w)
2. Reference at least 2 specific company details (product, mission, recent news)
3. Connect candidate's experience to company needs
4. Balance: ~60% about company, ~40% about candidate
5. Sound genuine and conversational, not sycophantic
6. Include specific technical connections if applicable

DO NOT use:
- "I am passionate about technology"
- "leader in the industry"
- "I believe I would be a great fit"
- "aligned with my goals"
- Generic flattery without specifics

OUTPUT FORMAT (JSON):
{
  "short": "...",
  "standard": "...",
  "long": "...",
  "company_details_used": ["product X", "mission Y"],
  "candidate_connections": ["experience A", "interest B"]
}

Generate the answers:`;
}

/**
 * Prompt for bulk generating answers for all categories
 */
export function buildBulkGenerationPrompt(stories, userProfile) {
  const storyList = stories.map((s, i) => 
    `Story ${i + 1} (${s.story_type}): ${s.title}
     - Situation: ${s.situation}
     - Actions: ${s.actions.slice(0, 3).join('; ')}
     - Results: ${s.results.slice(0, 2).map(r => r.value).join('; ')}`
  ).join('\n\n');

  return `Generate a complete answer bank for a job applicant.

CANDIDATE PROFILE:
- Education: ${userProfile.education?.degree} in ${userProfile.education?.major}
- Interests: ${userProfile.interests?.slice(0, 3).join(', ')}
- Goals: ${userProfile.goals?.slice(0, 2).join(', ')}

USER STORIES:
${storyList}

TASK: For each question category below, select the most appropriate story and generate SHORT (75w) and STANDARD (150w) answers.

CATEGORIES:
1. challenging_project - Use a project/technical story
2. teamwork - Use a teamwork/collaboration story
3. failure_learning - Use a failure/growth story
4. problem_solving - Use a technical/challenge story
5. achievement - Use the strongest story overall

OUTPUT FORMAT (JSON):
{
  "challenging_project": {
    "story_used": "Story X",
    "short": "...",
    "standard": "..."
  },
  "teamwork": {...},
  "failure_learning": {...},
  "problem_solving": {...},
  "achievement": {...}
}

Generate all answers:`;
}

export default {
  buildStoryToAnswerPrompt,
  buildWhyCompanyPrompt,
  buildBulkGenerationPrompt,
};
```

### 4.2 Generation Service

```javascript
// /auto-apply/answers/generation-service.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from './prompts.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MODEL_CONFIG = {
  model: 'gemini-1.5-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 2000,
    responseMimeType: 'application/json',
  },
};

/**
 * Generate answers from a single story for multiple categories
 */
export async function generateFromStory(story, categories, userProfile) {
  const model = genAI.getGenerativeModel(MODEL_CONFIG);
  const results = {};

  for (const category of categories) {
    const prompt = prompts.buildStoryToAnswerPrompt(story, category, userProfile);
    
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      
      results[category] = {
        story_id: story.id,
        short: parsed.short,
        standard: parsed.standard,
        long: parsed.long,
        structure: parsed.structure_used,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Failed to generate ${category} from story ${story.id}:`, error);
      results[category] = { error: error.message };
    }
    
    // Rate limiting: Gemini Flash has 60 RPM free tier
    await sleep(1100);
  }

  return results;
}

/**
 * Generate "Why Company" answers for a specific company
 */
export async function generateWhyCompany(companyData, userProfile, relevantStory) {
  const model = genAI.getGenerativeModel(MODEL_CONFIG);
  const prompt = prompts.buildWhyCompanyPrompt(companyData, userProfile, relevantStory);
  
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    
    return {
      company_slug: companyData.slug,
      company_name: companyData.name,
      short: parsed.short,
      standard: parsed.standard,
      long: parsed.long,
      details_used: parsed.company_details_used,
      connections: parsed.candidate_connections,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Failed to generate Why Company for ${companyData.name}:`, error);
    throw error;
  }
}

/**
 * Bulk generate all answer categories from story bank
 */
export async function bulkGenerateAnswerBank(storyBank, userProfile) {
  const model = genAI.getGenerativeModel({
    ...MODEL_CONFIG,
    generationConfig: {
      ...MODEL_CONFIG.generationConfig,
      maxOutputTokens: 4000,
    },
  });
  
  const prompt = prompts.buildBulkGenerationPrompt(storyBank, userProfile);
  
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    
    return {
      answers: parsed,
      generated_at: new Date().toISOString(),
      model: MODEL_CONFIG.model,
    };
  } catch (error) {
    console.error('Bulk generation failed:', error);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  generateFromStory,
  generateWhyCompany,
  bulkGenerateAnswerBank,
};
```

---

## 5. Runtime Personalization

### 5.1 Variable Interpolation Engine

```javascript
// /auto-apply/answers/personalization.js

/**
 * Variables that can be personalized at runtime
 */
const RUNTIME_VARIABLES = {
  // Company-specific
  company: null,
  company_name: null,
  product: null,
  team: null,
  role: null,
  mission: null,
  
  // Job-specific
  requirement: null,
  technology: null,
  
  // Timing
  timeline: null,
};

/**
 * Personalize a pre-generated answer with runtime context
 */
export function personalizeAnswer(template, context) {
  let personalized = template;
  
  // Replace known variables
  for (const [key, value] of Object.entries(context)) {
    if (value) {
      const patterns = [
        new RegExp(`\\{${key}\\}`, 'g'),
        new RegExp(`\\[${key}\\]`, 'g'),
        new RegExp(`\\$\\{${key}\\}`, 'g'),
      ];
      
      for (const pattern of patterns) {
        personalized = personalized.replace(pattern, value);
      }
    }
  }
  
  // Clean up any remaining unfilled variables
  personalized = personalized.replace(/\{[^}]+\}/g, '');
  personalized = personalized.replace(/\[[^\]]+\]/g, '');
  
  // Clean up double spaces
  personalized = personalized.replace(/\s+/g, ' ').trim();
  
  return personalized;
}

/**
 * Select the best answer based on question context
 */
export function selectBestAnswer(question, answerBank, context) {
  // Classify the question
  const { category, suggestedLength } = classifyQuestion(question);
  
  // Get answers for this category
  const categoryAnswers = answerBank[category];
  if (!categoryAnswers) {
    return { answer: null, category, matched: false };
  }
  
  // Select length variant
  let lengthKey = 'standard';
  if (suggestedLength <= 100) lengthKey = 'short';
  else if (suggestedLength >= 250) lengthKey = 'long';
  
  const template = categoryAnswers[lengthKey] || categoryAnswers.standard;
  
  // Personalize with runtime context
  const personalized = personalizeAnswer(template, context);
  
  return {
    answer: personalized,
    category,
    lengthKey,
    matched: true,
  };
}

/**
 * Build runtime context from job posting and company data
 */
export function buildRuntimeContext(jobData, companyData) {
  return {
    company: companyData?.name || '',
    company_name: companyData?.name || '',
    product: companyData?.products?.[0] || '',
    team: jobData?.team || '',
    role: jobData?.title || 'Software Engineer',
    mission: companyData?.mission || '',
    requirement: jobData?.requirements?.[0] || '',
    technology: jobData?.technologies?.[0] || '',
    timeline: 'recently',
  };
}

export default {
  personalizeAnswer,
  selectBestAnswer,
  buildRuntimeContext,
  RUNTIME_VARIABLES,
};
```

### 5.2 Answer Selection and Rotation

```javascript
// /auto-apply/answers/selector.js

/**
 * Smart answer selection with usage tracking and rotation
 */
export class AnswerSelector {
  constructor(answerBank, usageTracker) {
    this.answerBank = answerBank;
    this.usageTracker = usageTracker;
    this.recentlyUsed = new Map(); // category -> [story_ids]
  }
  
  /**
   * Select an answer for a question, avoiding recently used stories
   */
  selectAnswer(question, context, options = {}) {
    const { excludeRecent = 3, preferHighRating = true } = options;
    const { category, suggestedLength } = classifyQuestion(question);
    
    // Get all answers for this category
    const candidates = this.answerBank
      .filter(a => a.question_category === category)
      .filter(a => !this._isRecentlyUsed(a.story_id, category, excludeRecent));
    
    if (candidates.length === 0) {
      // Fall back to any answer in category
      const anyAnswer = this.answerBank.find(a => a.question_category === category);
      return anyAnswer ? this._formatAnswer(anyAnswer, suggestedLength, context) : null;
    }
    
    // Sort by strength rating if enabled
    if (preferHighRating) {
      candidates.sort((a, b) => (b.strength_rating || 0) - (a.strength_rating || 0));
    }
    
    // Add some randomness among top candidates
    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    
    // Track usage
    this._recordUsage(selected.story_id, category, context.company);
    
    return this._formatAnswer(selected, suggestedLength, context);
  }
  
  _isRecentlyUsed(storyId, category, limit) {
    const recent = this.recentlyUsed.get(category) || [];
    return recent.slice(0, limit).includes(storyId);
  }
  
  _recordUsage(storyId, category, company) {
    const recent = this.recentlyUsed.get(category) || [];
    recent.unshift(storyId);
    this.recentlyUsed.set(category, recent.slice(0, 10));
    
    // Update persistent tracker
    if (this.usageTracker) {
      this.usageTracker.recordUsage(storyId, category, company);
    }
  }
  
  _formatAnswer(answer, targetLength, context) {
    let lengthKey = 'standard';
    if (targetLength <= 100) lengthKey = 'short';
    else if (targetLength >= 250) lengthKey = 'long';
    
    const template = answer[lengthKey] || answer.standard || answer.short;
    return personalizeAnswer(template, context);
  }
}

export default AnswerSelector;
```

---

## 6. Implementation Code

### 6.1 Complete Answer Generation Module

```javascript
// /auto-apply/answers/index.js

import { classifyQuestion, QUESTION_PATTERNS } from './question-classifier.js';
import { ANSWER_TEMPLATES } from './templates.js';
import generationService from './generation-service.js';
import { personalizeAnswer, selectBestAnswer, buildRuntimeContext } from './personalization.js';
import AnswerSelector from './selector.js';

/**
 * Main Answer Manager
 * Handles generation, caching, and retrieval of answers
 */
export class AnswerManager {
  constructor(supabaseClient, userProfile) {
    this.db = supabaseClient;
    this.profile = userProfile;
    this.answerBank = null;
    this.selector = null;
  }
  
  /**
   * Initialize: Load existing answers from database or generate fresh
   */
  async init() {
    // Load existing answers from database
    const { data: answers } = await this.db
      .from('answer_bank')
      .select('*')
      .eq('user_id', this.profile.userId);
    
    if (answers && answers.length > 0) {
      this.answerBank = this._organizeAnswers(answers);
      this.selector = new AnswerSelector(answers);
      console.log(`[AnswerManager] Loaded ${answers.length} pre-generated answers`);
    } else {
      console.log('[AnswerManager] No existing answers found');
    }
    
    return this;
  }
  
  /**
   * Generate all answers from user's story bank
   * Call this once after user fills out their stories
   */
  async generateAllAnswers() {
    console.log('[AnswerManager] Starting bulk answer generation...');
    
    // Load story bank
    const { data: stories } = await this.db
      .from('user_story_bank')
      .select('*')
      .eq('user_id', this.profile.userId);
    
    if (!stories || stories.length === 0) {
      throw new Error('No stories in story bank. Please add experiences first.');
    }
    
    // Generate answers using LLM
    const result = await generationService.bulkGenerateAnswerBank(
      stories,
      this.profile
    );
    
    // Save to database
    const inserts = [];
    for (const [category, answers] of Object.entries(result.answers)) {
      for (const [lengthKey, text] of Object.entries(answers)) {
        if (lengthKey === 'story_used') continue;
        
        inserts.push({
          user_id: this.profile.userId,
          story_id: this._findStoryId(stories, answers.story_used),
          question_category: category,
          word_count_target: this._lengthToWordCount(lengthKey),
          answer_text: text,
          generation_model: 'gemini-1.5-flash',
        });
      }
    }
    
    await this.db.from('answer_bank').upsert(inserts);
    
    // Reload answers
    await this.init();
    
    console.log(`[AnswerManager] Generated ${inserts.length} answers`);
    return result;
  }
  
  /**
   * Generate company-specific "Why Company" answers
   */
  async generateCompanyAnswers(companyData) {
    console.log(`[AnswerManager] Generating answers for ${companyData.name}...`);
    
    // Find most relevant story
    const { data: stories } = await this.db
      .from('user_story_bank')
      .select('*')
      .eq('user_id', this.profile.userId)
      .order('strength_rating', { ascending: false })
      .limit(1);
    
    const relevantStory = stories?.[0];
    
    // Generate
    const result = await generationService.generateWhyCompany(
      companyData,
      this.profile,
      relevantStory
    );
    
    // Save
    await this.db.from('company_answers').upsert({
      user_id: this.profile.userId,
      company_slug: companyData.slug,
      company_name: companyData.name,
      why_company_short: result.short,
      why_company_standard: result.standard,
      why_company_long: result.long,
      company_mission: companyData.mission,
      company_products: companyData.products,
      generation_model: 'gemini-1.5-flash',
    });
    
    return result;
  }
  
  /**
   * Get an answer for a question (main API)
   */
  async getAnswer(questionText, context = {}) {
    // Ensure initialized
    if (!this.answerBank) {
      await this.init();
    }
    
    // Try pre-generated answers first
    if (this.selector) {
      const answer = this.selector.selectAnswer(questionText, context);
      if (answer) {
        return { source: 'cached', answer, category: classifyQuestion(questionText).category };
      }
    }
    
    // Fall back to generic answer
    const { category, suggestedLength } = classifyQuestion(questionText);
    const template = ANSWER_TEMPLATES[category];
    
    if (template) {
      const answer = personalizeAnswer(template.examples?.standard || '', context);
      return { source: 'template', answer, category };
    }
    
    return { source: 'none', answer: null, category };
  }
  
  /**
   * Get company-specific answer
   */
  async getCompanyAnswer(companySlug, length = 'standard') {
    const { data } = await this.db
      .from('company_answers')
      .select('*')
      .eq('user_id', this.profile.userId)
      .eq('company_slug', companySlug)
      .single();
    
    if (!data) return null;
    
    const field = `why_company_${length}`;
    return data[field] || data.why_company_standard;
  }
  
  // Helper methods
  _organizeAnswers(answers) {
    const organized = {};
    for (const answer of answers) {
      if (!organized[answer.question_category]) {
        organized[answer.question_category] = {};
      }
      organized[answer.question_category][this._wordCountToLength(answer.word_count_target)] = answer.answer_text;
    }
    return organized;
  }
  
  _lengthToWordCount(length) {
    const map = { short: 75, standard: 150, long: 300 };
    return map[length] || 150;
  }
  
  _wordCountToLength(wordCount) {
    if (wordCount <= 100) return 'short';
    if (wordCount <= 200) return 'standard';
    return 'long';
  }
  
  _findStoryId(stories, storyTitle) {
    const story = stories.find(s => storyTitle?.includes(s.title));
    return story?.id || null;
  }
}

export default AnswerManager;
```

### 6.2 Integration with Auto-Apply

```javascript
// /auto-apply/fillers/base.js (updated)

import { AnswerManager } from '../answers/index.js';
import { classifyQuestion } from '../answers/question-classifier.js';
import { buildRuntimeContext } from '../answers/personalization.js';

/**
 * Base filler with integrated answer management
 */
export class BaseFiller {
  constructor(options) {
    this.profile = options.profile;
    this.supabase = options.supabase;
    this.answerManager = null;
  }
  
  async init() {
    // Initialize answer manager
    this.answerManager = new AnswerManager(this.supabase, this.profile);
    await this.answerManager.init();
  }
  
  /**
   * Answer a text question on the form
   */
  async answerQuestion(page, labelText, context = {}) {
    // Build runtime context from job/company data
    const runtimeContext = buildRuntimeContext(
      context.jobData || {},
      context.companyData || {}
    );
    
    // Get pre-generated answer
    const { answer, category, source } = await this.answerManager.getAnswer(
      labelText,
      runtimeContext
    );
    
    if (answer) {
      console.log(`[filler] Using ${source} answer for "${labelText}" (${category})`);
      await this.fillTextArea(page, labelText, answer);
      return true;
    }
    
    // Check custom answers in profile
    const customAnswer = this.profile.customAnswers?.[labelText];
    if (customAnswer) {
      await this.fillTextArea(page, labelText, customAnswer);
      return true;
    }
    
    console.log(`[filler] No answer found for "${labelText}"`);
    return false;
  }
  
  /**
   * Answer "Why this company?" specifically
   */
  async answerWhyCompany(page, labelText, companySlug, length = 'standard') {
    // Try company-specific pre-generated answer
    const answer = await this.answerManager.getCompanyAnswer(companySlug, length);
    
    if (answer) {
      console.log(`[filler] Using pre-generated company answer for ${companySlug}`);
      await this.fillTextArea(page, labelText, answer);
      return true;
    }
    
    // Check profile for company notes
    const notes = this.profile.company_notes?.[companySlug];
    if (notes?.why) {
      console.log(`[filler] Using profile company notes for ${companySlug}`);
      await this.fillTextArea(page, labelText, notes.why);
      return true;
    }
    
    console.log(`[filler] No company-specific answer for ${companySlug}`);
    return false;
  }
  
  async fillTextArea(page, labelText, value) {
    // Implementation from fields.js
    await fillByLabel(page, labelText, value);
  }
}

export default BaseFiller;
```

---

## 7. Cost Optimization

### 7.1 Token and Cost Estimation

| Operation | Est. Tokens | Cost (Gemini Flash) | Frequency |
|-----------|-------------|---------------------|-----------|
| Single story → 3 lengths | ~1,000 input + 800 output | ~$0.0003 | Per story |
| Why Company (1 company) | ~800 input + 600 output | ~$0.0002 | Per company |
| Bulk generation (5 stories → all categories) | ~3,000 input + 2,000 output | ~$0.0008 | Once per user |

**Cost for typical user:**
- 5 stories × $0.0003 = $0.0015
- 10 companies × $0.0002 = $0.002
- 1 bulk generation = $0.0008
- **Total: ~$0.004** (less than 1 cent)

### 7.2 Caching Strategy

```javascript
// /auto-apply/answers/cache.js

const CACHE_TTL = {
  STORY_ANSWERS: 30 * 24 * 60 * 60 * 1000,    // 30 days
  COMPANY_ANSWERS: 7 * 24 * 60 * 60 * 1000,   // 7 days
  PROFILE_COMPILED: 24 * 60 * 60 * 1000,      // 24 hours
};

export class AnswerCache {
  constructor(fileCache, memoryCache) {
    this.file = fileCache;
    this.memory = memoryCache;
  }
  
  /**
   * Get answer from cache (memory → file → null)
   */
  get(key) {
    // Check memory first
    let value = this.memory.get(key);
    if (value) return value;
    
    // Check file cache
    value = this.file.get(key);
    if (value) {
      // Promote to memory
      this.memory.set(key, value);
      return value;
    }
    
    return null;
  }
  
  /**
   * Cache an answer
   */
  set(key, value, ttl = CACHE_TTL.STORY_ANSWERS) {
    this.memory.set(key, value, ttl);
    this.file.set(key, value, ttl);
  }
  
  /**
   * Cache key builders
   */
  storyAnswerKey(userId, storyId, category, length) {
    return `answer:${userId}:${storyId}:${category}:${length}`;
  }
  
  companyAnswerKey(userId, companySlug, length) {
    return `company:${userId}:${companySlug}:${length}`;
  }
}

export default AnswerCache;
```

### 7.3 Generation Scheduling

```javascript
// /auto-apply/answers/scheduler.js

/**
 * Schedule answer generation during idle time
 */
export class GenerationScheduler {
  constructor(answerManager) {
    this.manager = answerManager;
    this.queue = [];
    this.isRunning = false;
  }
  
  /**
   * Queue a company for answer generation
   */
  queueCompany(companyData, priority = 'normal') {
    this.queue.push({
      type: 'company',
      data: companyData,
      priority,
      addedAt: Date.now(),
    });
    
    if (priority === 'high') {
      this._processNext();
    }
  }
  
  /**
   * Process queue during idle time
   */
  async processQueue() {
    if (this.isRunning || this.queue.length === 0) return;
    
    this.isRunning = true;
    
    // Sort by priority
    this.queue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      
      try {
        if (task.type === 'company') {
          await this.manager.generateCompanyAnswers(task.data);
        }
        
        // Rate limit: 1 request per 2 seconds
        await sleep(2000);
      } catch (error) {
        console.error(`[scheduler] Failed to process task:`, error);
        // Re-queue with lower priority
        if (task.priority !== 'low') {
          task.priority = 'low';
          this.queue.push(task);
        }
      }
    }
    
    this.isRunning = false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default GenerationScheduler;
```

---

## Summary

### Key Files to Create

1. `/auto-apply/answers/question-classifier.js` - Question pattern matching
2. `/auto-apply/answers/templates.js` - Answer structure templates
3. `/auto-apply/answers/prompts.js` - LLM prompt builders
4. `/auto-apply/answers/generation-service.js` - LLM API integration
5. `/auto-apply/answers/personalization.js` - Runtime variable interpolation
6. `/auto-apply/answers/selector.js` - Answer selection and rotation
7. `/auto-apply/answers/index.js` - Main AnswerManager class
8. `/auto-apply/answers/cache.js` - Caching utilities
9. `/auto-apply/answers/scheduler.js` - Background generation

### Database Migrations

1. Create `user_story_bank` table
2. Create `answer_bank` table
3. Create `company_answers` table
4. Add indexes for efficient queries

### Usage Flow

1. **Setup (once per user)**:
   - User fills out story bank via UI wizard
   - System calls `answerManager.generateAllAnswers()`
   - Answers cached to database

2. **Per Company (as needed)**:
   - User adds company to "My List"
   - System queues `answerManager.generateCompanyAnswers()`
   - Company-specific answers cached

3. **At Application Time**:
   - Filler calls `answerManager.getAnswer(question, context)`
   - Returns cached answer with runtime variables filled
   - Zero LLM calls needed

### Cost Summary

- Initial generation: ~$0.004 per user
- Company-specific: ~$0.0002 per company
- Runtime: **$0.00** (all cached)

*Total for 100 applications: less than 1 cent*
