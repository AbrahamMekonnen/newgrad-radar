import { extractJobRequirements, scoreResume } from './resume-scorer';
import type { ResumeData } from './resume-templates';

const resume: ResumeData = {
  name: 'Test User',
  email: 'test@example.com',
  education: [],
  experience: [],
  projects: [],
  skills: [{
    category: 'Technical',
    items: ['Data Structures', 'Algorithms', 'Problem Solving', 'Git', 'SQL', 'React'],
  }],
};

describe('resume scoring', () => {
  it('does not cap required-only skill matches at 70 percent', () => {
    const score = scoreResume(resume, {
      title: 'Software Engineer',
      company: 'Example',
      tier: 'startup',
      roleType: 'swe',
      requiredSkills: ['Data Structures', 'Algorithms', 'Problem Solving'],
      niceToHaveSkills: [],
      techStack: ['Git', 'SQL'],
      keywords: [],
    });

    expect(score.skillMatch).toBe(100);
    expect(score.overall).toBe(100);
  });

  it('uses the job description to produce job-specific technology requirements', async () => {
    const reactJob = await extractJobRequirements(
      'Frontend Engineer',
      'Example',
      'startup',
      'frontend',
      'Build React and TypeScript applications with GraphQL.'
    );
    const backendJob = await extractJobRequirements(
      'Backend Engineer',
      'Example',
      'startup',
      'backend',
      'Build Python services using PostgreSQL, Redis, and Docker.'
    );

    expect(reactJob.techStack).toEqual(expect.arrayContaining(['React', 'TypeScript', 'GraphQL']));
    expect(backendJob.techStack).toEqual(expect.arrayContaining(['Python', 'PostgreSQL', 'Redis', 'Docker']));
    expect(reactJob.techStack).not.toEqual(backendJob.techStack);
  });
});

