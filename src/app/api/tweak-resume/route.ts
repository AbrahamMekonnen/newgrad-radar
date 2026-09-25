import { NextRequest, NextResponse } from 'next/server';
import { ResumeData, JobContext, ResumeTweak, TweakedResume } from '@/lib/resume-templates';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface TweakRequest {
  resume: ResumeData;
  job: JobContext;
  userLevel: 'new_grad' | 'junior' | 'mid' | 'senior';
}

export async function POST(request: NextRequest) {
  try {
    const body: TweakRequest = await request.json();
    const { resume, job, userLevel } = body;

    if (!resume || !job) {
      return NextResponse.json(
        { error: 'Resume and job context are required' },
        { status: 400 }
      );
    }

    // Extract keywords from job
    const jobKeywords = extractKeywords(job);

    // Check which keywords are already in the resume
    const resumeText = stringifyResume(resume).toLowerCase();
    const keywordsPresent = jobKeywords.filter(k => resumeText.includes(k.toLowerCase()));
    const keywordsMissing = jobKeywords.filter(k => !resumeText.includes(k.toLowerCase()));

    // Generate AI-powered tweaks
    let tweaks: ResumeTweak[] = [];
    let tweakedResume = JSON.parse(JSON.stringify(resume)) as ResumeData;

    if (GEMINI_API_KEY) {
      const aiResult = await generateAITweaks(resume, job, userLevel, keywordsMissing);
      tweaks = aiResult.tweaks;
      tweakedResume = aiResult.tweakedResume;
    } else {
      // Fallback: basic keyword insertion
      const basicResult = generateBasicTweaks(resume, job, keywordsMissing);
      tweaks = basicResult.tweaks;
      tweakedResume = basicResult.tweakedResume;
    }

    // Calculate match score
    const matchScore = calculateMatchScore(tweakedResume, jobKeywords);

    const result: TweakedResume = {
      original: resume,
      tweaked: tweakedResume,
      tweaks,
      matchScore,
      keywordsAdded: keywordsMissing.filter(k =>
        stringifyResume(tweakedResume).toLowerCase().includes(k.toLowerCase())
      ),
      keywordsAlreadyPresent: keywordsPresent,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Resume tweak error:', error);
    return NextResponse.json(
      { error: 'Failed to tweak resume' },
      { status: 500 }
    );
  }
}

function extractKeywords(job: JobContext): string[] {
  const keywords = new Set<string>();

  // From explicit keywords
  job.keywords?.forEach(k => keywords.add(k));

  // From requirements
  job.requirements?.forEach(req => {
    // Extract technology names (capitalized words, acronyms)
    const matches = req.match(/\b[A-Z][a-zA-Z+#]*\b|\b[A-Z]{2,}\b/g);
    matches?.forEach(m => keywords.add(m));
  });

  // Role-specific keywords
  const roleKeywords: Record<string, string[]> = {
    ml: ['Python', 'TensorFlow', 'PyTorch', 'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'scikit-learn', 'pandas', 'NumPy'],
    backend: ['API', 'REST', 'GraphQL', 'SQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'microservices'],
    frontend: ['React', 'TypeScript', 'JavaScript', 'CSS', 'HTML', 'Next.js', 'Vue', 'responsive design', 'accessibility'],
    fullstack: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'REST API', 'Docker', 'CI/CD'],
    infra: ['AWS', 'GCP', 'Terraform', 'Kubernetes', 'Docker', 'CI/CD', 'Linux', 'monitoring'],
    data: ['SQL', 'Python', 'ETL', 'data pipelines', 'Spark', 'Airflow', 'BigQuery', 'data modeling'],
    swe: ['algorithms', 'data structures', 'system design', 'testing', 'agile', 'Git'],
  };

  const roleType = job.roleType.toLowerCase();
  if (roleKeywords[roleType]) {
    roleKeywords[roleType].forEach(k => keywords.add(k));
  }

  // Tier-specific keywords
  if (job.tier === 'faang') {
    ['scalability', 'distributed systems', 'system design', 'performance optimization'].forEach(k => keywords.add(k));
  } else if (job.tier === 'ai') {
    ['LLM', 'transformers', 'fine-tuning', 'RAG', 'embeddings'].forEach(k => keywords.add(k));
  }

  return Array.from(keywords);
}

function stringifyResume(resume: ResumeData): string {
  const parts: string[] = [];

  resume.experience.forEach(exp => {
    parts.push(exp.title, exp.company);
    parts.push(...exp.bullets);
  });

  resume.projects.forEach(proj => {
    parts.push(proj.name, proj.technologies);
    parts.push(...proj.bullets);
  });

  resume.skills.forEach(skill => {
    parts.push(...skill.items);
  });

  return parts.join(' ');
}

function calculateMatchScore(resume: ResumeData, keywords: string[]): number {
  if (keywords.length === 0) return 100;

  const resumeText = stringifyResume(resume).toLowerCase();
  const matches = keywords.filter(k => resumeText.includes(k.toLowerCase()));

  return Math.round((matches.length / keywords.length) * 100);
}

async function generateAITweaks(
  resume: ResumeData,
  job: JobContext,
  userLevel: string,
  missingKeywords: string[]
): Promise<{ tweaks: ResumeTweak[]; tweakedResume: ResumeData }> {
  const prompt = `You are a professional resume writer helping to REPHRASE existing content. Your job is to make the resume more relevant to the job posting.

JOB DETAILS:
- Position: ${job.title} at ${job.company}
- Company Tier: ${job.tier}
- Role Type: ${job.roleType}
- Relevant Keywords: ${missingKeywords.join(', ')}
${job.description ? `- Description: ${job.description}` : ''}
${job.requirements ? `- Requirements: ${job.requirements.join('; ')}` : ''}

CANDIDATE LEVEL: ${userLevel}

RESUME:
${JSON.stringify(resume, null, 2)}

Provide tweaks in this JSON format:
{
  "tweaks": [
    {
      "section": "experience" | "projects" | "skills",
      "index": 0,
      "field": "bullets",
      "bulletIndex": 0,
      "original": "original text",
      "suggested": "improved text with keywords naturally integrated",
      "reason": "why this change helps",
      "priority": "high" | "medium" | "low"
    }
  ],
  "skillsToAdd": ["skill1", "skill2"],
  "reorderSuggestion": "optional suggestion to reorder sections"
}

=== CRITICAL ETHICAL RULES - NEVER VIOLATE ===

NEVER DO:
❌ Add experiences, jobs, or projects that don't exist in the original resume
❌ Add skills the user hasn't demonstrated in their existing content
❌ Invent metrics or numbers that aren't implied by the original
❌ Exaggerate scope (don't turn a small project into "enterprise-scale")
❌ Add certifications, degrees, or credentials not in the original
❌ Claim technologies not mentioned or implied in any bullet point
❌ Change job titles, company names, or dates
❌ Add responsibilities the user didn't actually have

ONLY DO:
✅ Rephrase existing bullets to naturally include relevant keywords
✅ Reorder existing content to highlight most relevant items first
✅ Add skills ONLY if clearly demonstrated in existing experience/projects
✅ Improve verb strength (e.g., "worked on" → "developed")
✅ Make implicit accomplishments explicit (if they "built an API", they used "REST")
✅ Tighten wording for clarity and impact
✅ Suggest moving Projects section before Experience if projects are more relevant

EXAMPLE OF ALLOWED TWEAK:
Original: "Built a web app using Python"
Allowed: "Developed a full-stack web application using Python and Flask, implementing RESTful API endpoints"
(Flask and REST are reasonable inferences IF Python web dev is mentioned)

EXAMPLE OF FORBIDDEN TWEAK:
Original: "Built a web app using Python"
Forbidden: "Led a team of 5 engineers to build a machine learning platform processing 1M requests/day"
(This adds fake team leadership, ML, and metrics)

Maximum 5 tweaks. Only suggest changes you're confident don't fabricate information.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Gemini API error');
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const aiResult = JSON.parse(jsonMatch[0]);
    const tweaks: ResumeTweak[] = [];
    const tweakedResume = JSON.parse(JSON.stringify(resume)) as ResumeData;

    // Apply tweaks
    for (const tweak of aiResult.tweaks || []) {
      const section = tweak.section as 'experience' | 'projects' | 'skills';
      const index = tweak.index ?? 0;

      if (section === 'experience' && tweakedResume.experience[index]) {
        if (tweak.field === 'bullets' && typeof tweak.bulletIndex === 'number') {
          const original = tweakedResume.experience[index].bullets[tweak.bulletIndex];
          if (original) {
            tweakedResume.experience[index].bullets[tweak.bulletIndex] = tweak.suggested;
            tweaks.push({
              section,
              index,
              field: `bullet ${tweak.bulletIndex + 1}`,
              original,
              suggested: tweak.suggested,
              reason: tweak.reason,
              priority: tweak.priority || 'medium',
            });
          }
        }
      } else if (section === 'projects' && tweakedResume.projects[index]) {
        if (tweak.field === 'bullets' && typeof tweak.bulletIndex === 'number') {
          const original = tweakedResume.projects[index].bullets[tweak.bulletIndex];
          if (original) {
            tweakedResume.projects[index].bullets[tweak.bulletIndex] = tweak.suggested;
            tweaks.push({
              section,
              index,
              field: `bullet ${tweak.bulletIndex + 1}`,
              original,
              suggested: tweak.suggested,
              reason: tweak.reason,
              priority: tweak.priority || 'medium',
            });
          }
        }
      }
    }

    // Add missing skills
    if (aiResult.skillsToAdd?.length > 0) {
      const skillsSection = tweakedResume.skills.find(s =>
        s.category.toLowerCase().includes('language') ||
        s.category.toLowerCase().includes('framework') ||
        s.category.toLowerCase().includes('tool')
      ) || tweakedResume.skills[0];

      if (skillsSection) {
        const originalSkills = [...skillsSection.items];
        const newSkills = aiResult.skillsToAdd.filter(
          (s: string) => !skillsSection.items.some(
            existing => existing.toLowerCase() === s.toLowerCase()
          )
        );

        if (newSkills.length > 0) {
          skillsSection.items.push(...newSkills);
          tweaks.push({
            section: 'skills',
            original: originalSkills.join(', '),
            suggested: skillsSection.items.join(', '),
            reason: `Added relevant skills: ${newSkills.join(', ')}`,
            priority: 'high',
          });
        }
      }
    }

    // Validate all tweaks for safety
    const validatedTweaks = tweaks.map(t => validateTweakSafety(t, resume));

    return { tweaks: validatedTweaks, tweakedResume };
  } catch (error) {
    console.error('AI tweak error:', error);
    // Fall back to basic tweaks
    return generateBasicTweaks(resume, job, missingKeywords);
  }
}

// Safety check: flag tweaks that might be adding fabricated content
function validateTweakSafety(tweak: ResumeTweak, originalResume: ResumeData): ResumeTweak {
  const original = tweak.original.toLowerCase();
  const suggested = tweak.suggested.toLowerCase();

  // Dangerous patterns that indicate fabrication
  const fabricationPatterns = [
    /led a team of \d+/i,           // Adding team leadership
    /managed \d+ (engineers|people|developers)/i,
    /\$\d+[kmb]?\+? (revenue|savings|impact)/i,  // Adding dollar amounts
    /\d+[kmb]\+ (users|requests|transactions)/i,  // Adding large scale numbers not in original
    /promoted to|received promotion/i,
    /awarded|won award|received recognition/i,
    /certified|certification/i,
    /patent|published paper/i,
  ];

  // Check if suggested adds any fabrication patterns not in original
  for (const pattern of fabricationPatterns) {
    if (pattern.test(suggested) && !pattern.test(original)) {
      return {
        ...tweak,
        safetyFlag: 'risky',
        safetyNote: 'This change may add claims not in your original resume. Please verify.',
      };
    }
  }

  // Check if suggested is significantly longer (might be adding content)
  const lengthRatio = suggested.length / Math.max(original.length, 1);
  if (lengthRatio > 2.5) {
    return {
      ...tweak,
      safetyFlag: 'review',
      safetyNote: 'Significant expansion - verify all claims are accurate.',
    };
  }

  // Check for new technology claims
  const techPatterns = /\b(kubernetes|aws|gcp|azure|docker|terraform|kafka|spark|hadoop|ml|ai|llm|machine learning|deep learning|neural|transformer)\b/gi;
  const originalTech = original.match(techPatterns) || [];
  const suggestedTech = suggested.match(techPatterns) || [];

  const newTech = suggestedTech.filter(t =>
    !originalTech.some(ot => ot.toLowerCase() === t.toLowerCase())
  );

  if (newTech.length > 0) {
    // Check if the tech is mentioned elsewhere in the resume
    const resumeText = JSON.stringify(originalResume).toLowerCase();
    const trulyNew = newTech.filter(t => !resumeText.includes(t.toLowerCase()));

    if (trulyNew.length > 0) {
      return {
        ...tweak,
        safetyFlag: 'review',
        safetyNote: `Adds technologies (${trulyNew.join(', ')}) - verify you have experience with these.`,
      };
    }
  }

  return { ...tweak, safetyFlag: 'safe' };
}

function generateBasicTweaks(
  resume: ResumeData,
  job: JobContext,
  missingKeywords: string[]
): { tweaks: ResumeTweak[]; tweakedResume: ResumeData } {
  const tweaks: ResumeTweak[] = [];
  const tweakedResume = JSON.parse(JSON.stringify(resume)) as ResumeData;

  // Add missing skills
  if (missingKeywords.length > 0) {
    const skillsSection = tweakedResume.skills.find(s =>
      s.category.toLowerCase().includes('language') ||
      s.category.toLowerCase().includes('framework')
    ) || tweakedResume.skills[0];

    if (skillsSection) {
      const originalSkills = [...skillsSection.items];
      const relevantKeywords = missingKeywords.slice(0, 5).filter(k =>
        !skillsSection.items.some(s => s.toLowerCase() === k.toLowerCase())
      );

      if (relevantKeywords.length > 0) {
        skillsSection.items.push(...relevantKeywords);
        tweaks.push({
          section: 'skills',
          original: originalSkills.join(', '),
          suggested: skillsSection.items.join(', '),
          reason: `Added skills mentioned in job posting: ${relevantKeywords.join(', ')}`,
          priority: 'high',
        });
      }
    }
  }

  // Suggest reordering for new grads (projects before experience if more relevant)
  if (job.roleType === 'ml' || job.roleType === 'ai') {
    const hasMLProject = resume.projects.some(p =>
      p.technologies.toLowerCase().includes('python') ||
      p.technologies.toLowerCase().includes('tensorflow') ||
      p.technologies.toLowerCase().includes('pytorch')
    );

    if (hasMLProject) {
      tweaks.push({
        section: 'projects',
        original: 'Projects section after Experience',
        suggested: 'Move Projects section before Experience',
        reason: 'For ML roles, relevant projects often matter more than general work experience',
        priority: 'medium',
      });
    }
  }

  return { tweaks, tweakedResume };
}
