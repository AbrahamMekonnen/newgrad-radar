/**
 * LLM Prompts for Answer Generation
 *
 * Generates natural, human-like answers for job application questions.
 * Includes anti-AI-detection guidelines and STAR format structuring.
 */

// =============================================================================
// Types
// =============================================================================

export interface Story {
  id?: string;
  title: string;
  context?: string; // 'internship', 'class', 'personal', 'hackathon', 'work'
  organization?: string;
  story_type?: string;
  situation: string;
  task: string;
  actions: string[];
  results: Array<{ metric: string; value: string; description?: string }>;
  technologies?: string[];
  skillsDemonstrated?: string[];
  skills_demonstrated?: string[];
  applicableCategories?: string[];
  applicable_categories?: string[];
  strengthRating?: number;
  strength_rating?: number;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  education?: {
    degree?: string;
    major?: string;
    school?: string;
    graduationYear?: string;
  };
  interests?: string[];
  goals?: string[];
  storyBank?: {
    projects?: Story[];
    teamwork?: Story[];
    challenges?: Story[];
    failures?: Story[];
  };
}

export interface CompanyData {
  name: string;
  slug?: string;
  mission?: string;
  products?: string[];
  recentNews?: string[];
  technicalFocus?: string[];
  roleTitle?: string;
  team?: string;
  requirements?: string[];
  personalConnection?: string;
}

export type AnswerCategory =
  | 'challenging_project'
  | 'teamwork'
  | 'conflict_resolution'
  | 'failure_learning'
  | 'leadership'
  | 'problem_solving'
  | 'strengths'
  | 'weaknesses'
  | 'career_goals'
  | 'achievement'
  | 'why_company'
  | 'why_role'
  | 'generic';

export interface StoryAnswerOutput {
  short: string;
  standard: string;
  long: string;
  structure_used: 'result_first' | 'challenge_first' | 'standard_star';
}

export interface WhyCompanyOutput {
  short: string;
  standard: string;
  long: string;
  company_details_used: string[];
  candidate_connections: string[];
}

export interface BulkAnswerOutput {
  [category: string]: {
    story_used: string;
    short: string;
    standard: string;
  };
}

// =============================================================================
// Anti-AI-Detection Guidelines
// =============================================================================

/**
 * Guidelines to make generated text sound natural and human.
 * These are embedded in prompts to avoid AI-detection patterns.
 */
const ANTI_AI_GUIDELINES = `
CRITICAL WRITING GUIDELINES (to sound natural and human):

AVOID these AI-tell phrases completely:
- "I am passionate about" / "passionate about"
- "I thrive in fast-paced environments"
- "I am confident that" / "I believe I would be"
- "leverage my skills" / "leverage my experience"
- "Furthermore" / "Moreover" / "In addition" / "Additionally"
- "I am excited to" / "excited about the opportunity"
- "utilize" (use "use" instead)
- "implement" when "build" or "create" works
- "facilitate" / "synergy" / "optimize"
- "aligned with my goals" / "aligns perfectly"
- "cutting-edge" / "innovative" / "groundbreaking"
- "I am a hard worker" / "team player" (show, don't tell)
- "I am detail-oriented" / "results-driven"
- Starting sentences with "As a..." repeatedly

DO use these natural patterns:
- Contractions naturally: "I'm", "I've", "didn't", "wasn't", "couldn't"
- Occasional informal connectors: "That said", "Honestly", "Looking back"
- Vary sentence length: mix short punchy sentences with longer ones
- Start some sentences with "And" or "But" sparingly
- Include specific details, numbers, metrics
- Reference concrete examples, not abstract qualities
- Use active voice: "I built" not "was built by me"
- First-person naturally: "I noticed" not "It was observed"

TONE:
- Confident but not arrogant
- Specific but not exhaustive
- Professional but conversational
- Genuine interest, not desperation
- Self-aware about growth areas

STRUCTURE:
- Lead with the most interesting part (often the result)
- Don't over-explain context - get to the action quickly
- End with what you learned or would do differently, not generic statements
`.trim();

// =============================================================================
// Prompt Builders
// =============================================================================

/**
 * Build prompt to convert a user story into STAR-format answers.
 *
 * Generates three length variants (short, standard, long) for a given
 * question category using the provided story.
 */
export function buildStoryToAnswerPrompt(
  story: Story,
  category: AnswerCategory,
  userProfile: UserProfile
): string {
  const skills = story.skillsDemonstrated || story.skills_demonstrated || [];
  const techs = story.technologies || [];
  const results = story.results || [];

  return `You are helping a job applicant generate natural, compelling answers for their applications.

${ANTI_AI_GUIDELINES}

TASK: Generate 3 variations of an answer for the "${category}" question category, using the provided story.

USER STORY:
- Title: ${story.title}
- Context: ${story.context || 'professional experience'} at ${story.organization || 'a tech company'}
- Situation: ${story.situation}
- Task: ${story.task}
- Actions: ${story.actions.join('; ')}
- Results: ${results.map((r) => `${r.metric}: ${r.value}`).join('; ')}
- Technologies: ${techs.length > 0 ? techs.join(', ') : 'N/A'}
- Skills: ${skills.length > 0 ? skills.join(', ') : 'N/A'}

CANDIDATE BACKGROUND:
- Education: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'Computer Science'} from ${userProfile.education?.school || 'university'}
- Interests: ${userProfile.interests?.slice(0, 3).join(', ') || 'building useful software'}
- Goals: ${userProfile.goals?.slice(0, 2).join(', ') || 'grow as an engineer'}

REQUIREMENTS:
1. Generate 3 answer lengths:
   - SHORT: ~75 words (for tight character limits)
   - STANDARD: 150-200 words (most common)
   - LONG: 300-350 words (for detailed prompts)

2. Each answer MUST follow STAR format but can vary the order:
   - result_first: Lead with impact, then explain how
   - challenge_first: Start with the problem to hook the reader
   - standard_star: Situation -> Task -> Action -> Result

3. Writing requirements:
   - Use first-person "I" statements for actions (not "we" unless truly collaborative)
   - Include specific metrics/numbers from the story
   - Vary sentence lengths for natural rhythm
   - Use contractions ("I'm", "didn't", "couldn't")
   - Sound conversational, like talking to a friend who happens to be a recruiter

4. Category-specific focus for "${category}":
${getCategoryGuidance(category)}

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "short": "75-word answer here...",
  "standard": "150-200 word answer here...",
  "long": "300-350 word answer here...",
  "structure_used": "result_first" | "challenge_first" | "standard_star"
}`;
}

/**
 * Build prompt for "Why this company?" answers.
 *
 * Creates personalized answers that connect the candidate's background
 * to specific company details.
 */
export function buildWhyCompanyPrompt(
  companyData: CompanyData,
  userProfile: UserProfile,
  relevantStory?: Story | null
): string {
  const products = companyData.products || [];
  const recentNews = companyData.recentNews || [];
  const techFocus = companyData.technicalFocus || [];
  const requirements = companyData.requirements || [];
  const interests = userProfile.interests || [];
  const goals = userProfile.goals || [];

  let relevantExperience = '';
  if (relevantStory) {
    const results = relevantStory.results || [];
    relevantExperience = `- Relevant Experience: ${relevantStory.title} - ${results.map((r) => r.value).join(', ')}`;
  }

  return `Generate a natural "Why do you want to work at ${companyData.name}?" answer for a job application.

${ANTI_AI_GUIDELINES}

COMPANY CONTEXT:
- Company: ${companyData.name}
- Mission: ${companyData.mission || 'Not provided - focus on products instead'}
- Key Products: ${products.length > 0 ? products.join(', ') : 'Not provided'}
- Recent News: ${recentNews.length > 0 ? recentNews.join('; ') : 'None provided'}
- Technical Focus: ${techFocus.length > 0 ? techFocus.join(', ') : 'Not provided'}

ROLE CONTEXT:
- Job Title: ${companyData.roleTitle || 'Software Engineer'}
- Team: ${companyData.team || 'Engineering'}
- Key Requirements: ${requirements.length > 0 ? requirements.slice(0, 3).join(', ') : 'Not specified'}

CANDIDATE PROFILE:
- Background: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'Computer Science'} from ${userProfile.education?.school || 'university'}
- Interests: ${interests.length > 0 ? interests.join(', ') : 'building impactful products'}
- Goals: ${goals.length > 0 ? goals.slice(0, 2).join(', ') : 'learn and grow as an engineer'}
${relevantExperience}
${companyData.personalConnection ? `- Personal Connection: ${companyData.personalConnection}` : ''}

REQUIREMENTS:
1. Generate 3 lengths:
   - SHORT: ~75 words
   - STANDARD: 150-200 words
   - LONG: ~300 words

2. Content balance:
   - ~60% about the company (show you've done research)
   - ~40% about yourself (connect your experience to their needs)

3. Reference at least 2 specific company details:
   - A product, feature, or technical approach
   - The mission, culture, or recent achievement
   - Something from news/blog if provided

4. Connect naturally:
   - Don't force connections - if it doesn't fit, don't include it
   - Mention relevant experience briefly, don't retell the whole story
   - Show genuine interest without being sycophantic

5. Avoid:
   - "leader in the industry" / "innovative company"
   - "dream company" / "always wanted to work at"
   - Praising without specifics
   - Repeating job description back to them

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "short": "75-word answer here...",
  "standard": "150-200 word answer here...",
  "long": "~300 word answer here...",
  "company_details_used": ["specific product/feature", "specific value/mission"],
  "candidate_connections": ["relevant experience", "relevant interest"]
}`;
}

/**
 * Build prompt for bulk generating answers across all categories.
 *
 * Efficiently generates answers for multiple question types in a single
 * LLM call by matching stories to categories.
 */
export function buildBulkGenerationPrompt(
  stories: Story[],
  userProfile: UserProfile
): string {
  const storyList = stories
    .map((s, i) => {
      const results = s.results || [];
      const actions = s.actions || [];
      return `Story ${i + 1} (${s.story_type || 'general'}): ${s.title}
   - Context: ${s.context || 'professional'} at ${s.organization || 'tech company'}
   - Situation: ${s.situation}
   - Task: ${s.task}
   - Key Actions: ${actions.slice(0, 3).join('; ')}
   - Results: ${results.slice(0, 2).map((r) => `${r.metric}: ${r.value}`).join('; ')}
   - Tech: ${s.technologies?.slice(0, 4).join(', ') || 'N/A'}`;
    })
    .join('\n\n');

  const interests = userProfile.interests || [];
  const goals = userProfile.goals || [];

  return `Generate a complete answer bank for a job applicant. Match the best story to each category and write natural, compelling answers.

${ANTI_AI_GUIDELINES}

CANDIDATE PROFILE:
- Name: ${userProfile.firstName || 'Candidate'} ${userProfile.lastName || ''}
- Education: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'Computer Science'} from ${userProfile.education?.school || 'university'}
- Graduation: ${userProfile.education?.graduationYear || 'recent'}
- Interests: ${interests.slice(0, 3).join(', ') || 'building software'}
- Goals: ${goals.slice(0, 2).join(', ') || 'grow as an engineer'}

USER STORIES:
${storyList}

TASK: For each question category below, select the BEST matching story and generate SHORT (~75 words) and STANDARD (~150-200 words) answers.

CATEGORIES TO GENERATE:

1. challenging_project
   - Question type: "Tell me about a challenging project" / "Describe a technical challenge"
   - Best story type: technical project with clear problem-solving
   - Focus on: the challenge, your approach, the technical solution, measurable outcome

2. teamwork
   - Question type: "How do you work with teams?" / "Describe collaboration experience"
   - Best story type: cross-functional work, helping others, team success
   - Focus on: your role, how you collaborated, what the team achieved together

3. failure_learning
   - Question type: "Tell me about a failure" / "What did you learn from a mistake?"
   - Best story type: honest mistake with genuine learning
   - Focus on: what went wrong (own it), what you learned, how you've applied it since

4. problem_solving
   - Question type: "How do you approach problems?" / "Describe your debugging process"
   - Best story type: technical debugging, systematic problem-solving
   - Focus on: your methodology, how you broke down the problem, the solution

5. achievement
   - Question type: "What's your proudest accomplishment?" / "Greatest achievement?"
   - Best story type: use the STRONGEST story overall (highest impact)
   - Focus on: why it mattered, what made it challenging, the outcome

6. leadership
   - Question type: "Have you led a project?" / "Describe a time you took initiative"
   - Best story type: taking ownership, mentoring, driving decisions
   - Focus on: what you initiated, how you influenced others, the result

SELECTION RULES:
- Use each story at most TWICE across all categories
- Pick the story that best demonstrates the category's core competency
- If no story fits a category well, use the closest match and adjust framing

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "challenging_project": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  },
  "teamwork": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  },
  "failure_learning": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  },
  "problem_solving": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  },
  "achievement": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  },
  "leadership": {
    "story_used": "Story N: [title]",
    "short": "~75 word answer",
    "standard": "~150-200 word answer"
  }
}`;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get category-specific writing guidance for prompts.
 */
function getCategoryGuidance(category: AnswerCategory): string {
  const guidance: Record<AnswerCategory, string> = {
    challenging_project: `
   - Lead with what made it challenging (technical complexity, time pressure, ambiguity)
   - Emphasize YOUR contribution, not just the team's
   - Include specific technical decisions and tradeoffs
   - End with measurable impact or lessons learned`,

    teamwork: `
   - Show how you contributed to team success, not just that you worked with others
   - Mention specific collaboration: code reviews, pair programming, mentoring
   - Highlight how you handled disagreements constructively
   - Show awareness of others' perspectives`,

    conflict_resolution: `
   - Be honest about the conflict without villainizing anyone
   - Show emotional intelligence and self-awareness
   - Emphasize the resolution process, not just the outcome
   - Demonstrate what you learned about working with others`,

    failure_learning: `
   - Own the failure genuinely - don't disguise a success as a failure
   - Show self-awareness about what went wrong
   - Focus more on the learning than the failure itself
   - Explain how you've applied this lesson since`,

    leadership: `
   - Leadership doesn't require a title - show initiative and influence
   - Describe how you got buy-in from others
   - Include decisions you made and their reasoning
   - Show impact on the team or project outcome`,

    problem_solving: `
   - Walk through your thought process, not just the solution
   - Show systematic debugging or analysis approach
   - Mention tools, techniques, or methodologies used
   - Demonstrate persistence and creativity`,

    strengths: `
   - Pick a specific strength with concrete evidence
   - Show the strength in action, don't just claim it
   - Connect to how it helps in engineering work
   - Be confident but not arrogant`,

    weaknesses: `
   - Choose a real weakness, not a humble-brag
   - Show self-awareness and growth mindset
   - Explain specific steps you're taking to improve
   - Don't pick something critical for the role`,

    career_goals: `
   - Show ambition without being unrealistic
   - Connect goals to the company/role when possible
   - Balance learning with contributing
   - Show you've thought beyond just "get a job"`,

    achievement: `
   - Pick something with clear, measurable impact
   - Explain why it was challenging and meaningful
   - Highlight your specific contribution
   - Show pride without arrogance`,

    why_company: `
   - Reference specific company details (products, mission, tech)
   - Connect your experience to their needs
   - Show genuine interest, not generic enthusiasm
   - Balance company praise with self-connection`,

    why_role: `
   - Explain what excites you about this specific role
   - Connect your skills and interests to role requirements
   - Show you understand what the job entails
   - Demonstrate relevant background`,

    generic: `
   - Adapt to the question's core intent
   - Use relevant story elements
   - Focus on concrete examples over abstractions
   - Keep the response focused and direct`,
  };

  return guidance[category] || guidance.generic;
}

/**
 * Export constants for external use
 */
export const WRITING_GUIDELINES = ANTI_AI_GUIDELINES;

// =============================================================================
// TOKEN-OPTIMIZED PROMPT BUILDERS
// =============================================================================

/**
 * Condensed writing guidelines for token efficiency.
 * Reduces ~200 tokens to ~50 while maintaining core guidance.
 */
const CONDENSED_GUIDELINES = `Natural writing: contractions, varied sentences, specifics.
Avoid: "passionate", "leverage", "thrive", "Furthermore", "I believe".
Lead with impact. Use numbers. Active voice.`;

/**
 * Token-optimized prompt for story-to-answer generation.
 * Reduces token usage by ~40% while maintaining output quality.
 *
 * Use this for cost-sensitive batch operations.
 */
export function buildOptimizedStoryPrompt(
  story: Story,
  category: AnswerCategory,
  userProfile: UserProfile
): string {
  const skills = story.skillsDemonstrated || story.skills_demonstrated || [];
  const results = story.results || [];
  const resultStr = results.map((r) => `${r.metric}:${r.value}`).join(';');

  return `Generate ${category} answer using STAR format.
${CONDENSED_GUIDELINES}

STORY: ${story.title} @ ${story.organization || 'company'}
S: ${story.situation}
T: ${story.task}
A: ${story.actions.slice(0, 3).join('; ')}
R: ${resultStr}
Tech: ${(story.technologies || []).slice(0, 4).join(',')}

CANDIDATE: ${userProfile.education?.major || 'CS'} grad

OUTPUT (JSON):
{"short":"75w","standard":"150w","long":"300w","structure_used":"result_first|challenge_first|standard_star"}`;
}

/**
 * Token-optimized prompt for "Why Company" answers.
 * Focuses on essential context only.
 */
export function buildOptimizedWhyCompanyPrompt(
  companyData: CompanyData,
  userProfile: UserProfile
): string {
  const products = (companyData.products || []).slice(0, 2).join(',');
  const techFocus = (companyData.technicalFocus || []).slice(0, 3).join(',');

  return `Generate "Why ${companyData.name}?" answer.
${CONDENSED_GUIDELINES}

COMPANY: ${companyData.name}
Mission: ${companyData.mission || 'N/A'}
Products: ${products || 'N/A'}
Tech: ${techFocus || 'N/A'}
Role: ${companyData.roleTitle || 'SWE'}

CANDIDATE: ${userProfile.education?.major || 'CS'} grad, interests: ${(userProfile.interests || []).slice(0, 2).join(',')}

RULES: 60% company / 40% candidate. Reference 2+ company details. No generic praise.

OUTPUT (JSON):
{"short":"75w","standard":"150w","long":"300w"}`;
}

/**
 * Estimate token count for a prompt (rough approximation).
 * Useful for cost estimation before API calls.
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: 1 token per 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Compare token efficiency between standard and optimized prompts.
 */
export function getPromptEfficiencyStats(
  story: Story,
  category: AnswerCategory,
  userProfile: UserProfile
): { standard: number; optimized: number; savingsPercent: number } {
  const standardPrompt = buildStoryToAnswerPrompt(story, category, userProfile);
  const optimizedPrompt = buildOptimizedStoryPrompt(story, category, userProfile);

  const standardTokens = estimateTokenCount(standardPrompt);
  const optimizedTokens = estimateTokenCount(optimizedPrompt);

  return {
    standard: standardTokens,
    optimized: optimizedTokens,
    savingsPercent: Math.round((1 - optimizedTokens / standardTokens) * 100),
  };
}

export { CONDENSED_GUIDELINES };

export default {
  buildStoryToAnswerPrompt,
  buildWhyCompanyPrompt,
  buildBulkGenerationPrompt,
  buildOptimizedStoryPrompt,
  buildOptimizedWhyCompanyPrompt,
  estimateTokenCount,
  getPromptEfficiencyStats,
  WRITING_GUIDELINES,
  CONDENSED_GUIDELINES,
};
