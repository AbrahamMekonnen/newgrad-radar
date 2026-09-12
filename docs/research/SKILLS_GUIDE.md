# Skills and Technical Assessment Guide

Research on how job applications handle skills questions and how to answer them effectively.

## Table of Contents

1. [Common Skill Question Types](#common-skill-question-types)
2. [Question Formats by ATS](#question-formats-by-ats)
3. [Proficiency Rating Guide](#proficiency-rating-guide)
4. [Years of Experience Mapping](#years-of-experience-mapping)
5. [Extracting Skills from Resume](#extracting-skills-from-resume)
6. [Matching Skills to Job Requirements](#matching-skills-to-job-requirements)
7. [Skill Tracking Schema](#skill-tracking-schema)

---

## Common Skill Question Types

### 1. Proficiency Rating Questions (1-5 Scale)

**Question Patterns:**
- "Rate your proficiency in [X] (1-5)"
- "How would you rate your experience with [X]? (Beginner/Intermediate/Advanced/Expert)"
- "Self-assessed skill level in [X]"
- "On a scale of 1-5, rate your comfort level with [X]"

**Common Technologies Asked:**
| Category | Technologies |
|----------|-------------|
| Languages | Python, JavaScript, TypeScript, Java, C++, Go, Rust |
| Frontend | React, Vue, Angular, Next.js, HTML/CSS |
| Backend | Node.js, Django, Flask, Spring Boot, Express |
| Data | SQL, PostgreSQL, MongoDB, Redis, Elasticsearch |
| Cloud | AWS, GCP, Azure, Kubernetes, Docker |
| ML/AI | TensorFlow, PyTorch, scikit-learn, pandas, numpy |
| Tools | Git, CI/CD, Linux, Agile/Scrum |

**Rating Scale Interpretations:**
```
1 = No experience / Unfamiliar
2 = Basic knowledge / Completed tutorials
3 = Working knowledge / Used in projects
4 = Proficient / Used professionally
5 = Expert / Could teach others
```

### 2. Years of Experience Questions

**Question Patterns:**
- "How many years of experience do you have with [X]?"
- "Years of professional experience in [X]"
- "Total experience (academic + professional) with [X]"

**Answer Formats:**
- Dropdown: "0", "1-2", "2-3", "3-5", "5+"
- Numeric input: Exact years (e.g., "2.5")
- Range: "0-1 years", "1-3 years", "3-5 years", "5+ years"

### 3. Skill Listing Questions

**Question Patterns:**
- "List your technical skills"
- "What programming languages are you proficient in?"
- "Select all technologies you have experience with" (checkboxes)
- "Enter your skills (comma-separated)"

**Best Practices:**
- Order by relevance to job
- Include both technical and soft skills when appropriate
- Match terminology to job description
- Be specific (e.g., "React 18" not just "React")

### 4. Skill Description Questions

**Question Patterns:**
- "Describe your experience with [X]"
- "Tell us about a project where you used [X]"
- "How have you applied [X] in your work?"
- "What is your most significant accomplishment using [X]?"

**Answer Structure (STAR Format):**
```
Situation: Brief context
Task: What you needed to accomplish
Action: What you specifically did
Result: Quantifiable outcome
```

### 5. Certification Questions

**Question Patterns:**
- "Do you hold any relevant certifications?"
- "List professional certifications"
- "AWS Certified? (Yes/No)"
- "Upload certification documents"

**Common Certifications:**
| Provider | Certifications |
|----------|---------------|
| AWS | Solutions Architect, Developer, SysOps |
| GCP | Associate Cloud Engineer, Professional Data Engineer |
| Azure | AZ-900, AZ-104, AZ-204 |
| Meta | Frontend Developer Certificate |
| Google | TensorFlow Developer Certificate |
| CompTIA | Security+, Network+ |

---

## Question Formats by ATS

### Greenhouse

**Skill Questions:**
- Custom questions with dropdowns (1-5 scale common)
- Free-text fields for experience descriptions
- Multi-select checkboxes for technology stacks
- Yes/No for specific technology experience

**Pattern Detection:**
```javascript
// Common label patterns
"Rate your proficiency"
"experience with"
"How would you rate"
"skill level"
"years of experience"
```

### Lever

**Skill Questions:**
- Simpler format, often free-text
- May use "Additional Information" sections
- Skills often inferred from resume parsing
- Occasionally uses numeric dropdowns

### Ashby

**Skill Questions:**
- Modern, clean question interfaces
- Often uses sliding scales for proficiency
- May group related skills together
- Supports conditional questions based on answers

### Workday

**Skill Questions:**
- Structured skill matrices
- Predefined skill libraries
- Proficiency dropdown menus
- Required vs optional skill sections
- Often links to competency frameworks

---

## Proficiency Rating Guide

### How to Rate Yourself Honestly

**Level 1: No Experience / Unfamiliar**
- Never used the technology
- Only heard of it
- Cannot explain what it does

**Level 2: Basic / Beginner**
- Completed online courses or tutorials
- Can read code but rarely write it
- Needs significant guidance to use
- Example: "Completed a Codecademy course on Python"

**Level 3: Working Knowledge / Intermediate**
- Built personal projects or school assignments
- Can work independently on small tasks
- Comfortable reading documentation
- May need occasional help with complex problems
- Example: "Built a CRUD app with React for a class project"

**Level 4: Proficient / Advanced**
- Used professionally (internships count)
- Can architect solutions
- Debugs complex issues independently
- Mentors others on basics
- Example: "Built and maintained production APIs during internship"

**Level 5: Expert / Mastery**
- Deep understanding of internals
- Could give talks or teach courses
- Contributes to open source
- Recognized expertise
- Example: "Contributed to the React core library"

### Conservative vs. Aggressive Rating

**For New Grads: Rate Conservatively**
- If between two levels, choose the lower one
- Interviewers will verify claims
- Better to exceed expectations than disappoint
- Academic experience = Level 2-3 typically
- Internship experience = Level 3-4 typically

**Technology-Specific Guidelines:**

| Skill | If you can... | Rate |
|-------|---------------|------|
| Python | Write scripts, use libraries | 3 |
| Python | Build production services, optimize | 4 |
| React | Build components, use hooks | 3 |
| React | Optimize rendering, custom hooks | 4 |
| SQL | Write queries, joins | 3 |
| SQL | Optimize queries, indexing strategy | 4 |
| AWS | Use basic services (S3, EC2, Lambda) | 3 |
| AWS | Design architectures, IAM policies | 4 |

---

## Years of Experience Mapping

### Counting Experience for New Grads

**What Counts:**
- Internships (full value)
- Co-ops (full value)
- Part-time technical work (full value)
- Teaching assistant for technical courses (partial)
- Research positions (if relevant tech)
- Significant personal projects (partial)
- Open source contributions (partial)

**What Typically Doesn't Count:**
- Coursework alone
- Brief tutorials
- Non-technical work experience

### Calculation Examples

**Example 1: One Internship**
- 3-month internship at tech company using Python
- Python experience: "0-1 years" or "6 months"

**Example 2: Multiple Internships + Projects**
- Two 3-month internships (React, Node.js)
- 1 year of personal projects
- React experience: "1-2 years"

**Example 3: Research + Coursework**
- 1 year ML research using PyTorch
- 2 ML courses
- PyTorch experience: "1 year" (research counts)

### Handling "Professional Experience" Questions

Some applications ask specifically for "professional" experience:

| Question | What to Include |
|----------|-----------------|
| "Professional experience" | Internships, paid work only |
| "Total experience" | Everything including academic |
| "Relevant experience" | All related work, including projects |

**When unclear, err on the side of inclusion** - most companies count internships as professional experience for new grads.

---

## Extracting Skills from Resume

### Automated Skill Extraction

The auto-apply system should parse the resume to extract:

1. **Explicit Skills Section**
   - Technologies listed in "Skills" or "Technical Skills"
   - Tools and frameworks mentioned

2. **Experience-Based Skills**
   - Technologies mentioned in job descriptions
   - Tools used in projects

3. **Education-Based Skills**
   - Relevant coursework
   - Capstone/thesis technologies

### Skill Extraction Algorithm

```javascript
// Pseudocode for skill extraction
function extractSkills(resumeText) {
  const skills = {
    languages: [],
    frameworks: [],
    databases: [],
    cloud: [],
    tools: [],
    soft_skills: []
  };
  
  // Known skill patterns to look for
  const skillPatterns = {
    languages: ['python', 'javascript', 'typescript', 'java', 'c++', 'go', 'rust'],
    frameworks: ['react', 'vue', 'angular', 'django', 'flask', 'spring'],
    databases: ['postgresql', 'mysql', 'mongodb', 'redis'],
    cloud: ['aws', 'gcp', 'azure', 'kubernetes', 'docker'],
    tools: ['git', 'jenkins', 'terraform', 'figma']
  };
  
  // Match against resume text
  for (const [category, patterns] of Object.entries(skillPatterns)) {
    for (const pattern of patterns) {
      if (resumeText.toLowerCase().includes(pattern)) {
        skills[category].push(pattern);
      }
    }
  }
  
  return skills;
}
```

### Inferring Proficiency from Context

**Indicators of Higher Proficiency:**
- Listed as primary language in experience
- Mentioned in multiple positions
- Associated with shipped products
- "Led", "architected", "designed" language
- Listed first in skills section

**Indicators of Lower Proficiency:**
- Only in education section
- "Familiar with", "exposure to"
- Single mention
- Listed last in skills section

---

## Matching Skills to Job Requirements

### Job Description Parsing

Extract required and preferred skills from job descriptions:

**Required Skills (usually)**
- "Requirements" section
- "Must have" or "Required"
- "X years of experience with Y"
- Listed first in qualifications

**Preferred/Nice-to-Have Skills**
- "Preferred" or "Nice to have"
- "Experience with X is a plus"
- "Bonus points for"
- Listed later in qualifications

### Skill Matching Algorithm

```javascript
function matchSkillsToJob(userSkills, jobRequirements) {
  const matches = {
    strong_matches: [],    // User proficiency >= required
    partial_matches: [],   // User has skill but lower proficiency
    missing_required: [],  // Required but user doesn't have
    bonus_matches: []      // User has preferred skills
  };
  
  for (const req of jobRequirements.required) {
    const userSkill = userSkills.find(s => s.name === req.name);
    if (!userSkill) {
      matches.missing_required.push(req);
    } else if (userSkill.proficiency >= req.minProficiency) {
      matches.strong_matches.push({ req, userSkill });
    } else {
      matches.partial_matches.push({ req, userSkill });
    }
  }
  
  for (const pref of jobRequirements.preferred) {
    const userSkill = userSkills.find(s => s.name === pref.name);
    if (userSkill) {
      matches.bonus_matches.push({ pref, userSkill });
    }
  }
  
  return matches;
}
```

### Answer Generation Strategy

When asked about a skill in an application:

1. **Strong Match (proficiency >= 3):**
   - Give detailed, confident answer
   - Reference specific projects/experience
   - Use numbers when possible

2. **Partial Match (proficiency 2):**
   - Be honest about level
   - Emphasize learning ability
   - Connect to stronger related skills

3. **No Match:**
   - Don't claim experience you don't have
   - Highlight transferable skills
   - Show enthusiasm to learn

---

## Skill Tracking Schema

### Profile Schema Extension

Add to `profile.yaml` or `profile.json`:

```yaml
# ===========================================
# SKILLS SECTION
# ===========================================

skills:
  # Programming Languages
  languages:
    - name: "Python"
      proficiency: 4          # 1-5 scale
      years: 3                # Total years (academic + professional)
      professional_years: 0.5 # Internship/work only
      last_used: "2024-08"    # For freshness
      context: "Used in ML research and backend development"
      projects:
        - "Built ML pipeline for thesis"
        - "Internship API development"
    
    - name: "JavaScript"
      proficiency: 4
      years: 2
      professional_years: 0.25
      last_used: "2024-09"
      context: "Frontend and full-stack development"
    
    - name: "TypeScript"
      proficiency: 3
      years: 1
      professional_years: 0
      last_used: "2024-09"
      context: "Personal projects, Next.js apps"

  # Frameworks & Libraries
  frameworks:
    - name: "React"
      proficiency: 4
      years: 2
      last_used: "2024-09"
      context: "Frontend development for web apps"
    
    - name: "Next.js"
      proficiency: 3
      years: 1
      last_used: "2024-09"
      context: "Full-stack web applications"
    
    - name: "Django"
      proficiency: 3
      years: 1
      last_used: "2024-06"
      context: "Backend REST APIs"

  # Databases
  databases:
    - name: "PostgreSQL"
      proficiency: 3
      years: 2
      context: "Application databases, Supabase"
    
    - name: "MongoDB"
      proficiency: 2
      years: 0.5
      context: "Used in coursework"

  # Cloud & DevOps
  cloud:
    - name: "AWS"
      proficiency: 2
      years: 1
      services: ["S3", "Lambda", "EC2"]
      context: "Cloud coursework and personal projects"
    
    - name: "GCP"
      proficiency: 3
      years: 1
      services: ["Cloud Run", "BigQuery", "Cloud Functions"]
      context: "Internship project"
    
    - name: "Docker"
      proficiency: 3
      years: 1
      context: "Containerizing applications"

  # Tools
  tools:
    - name: "Git"
      proficiency: 4
      years: 4
      context: "Daily use for all projects"
    
    - name: "Linux"
      proficiency: 3
      years: 3
      context: "Development environment"

  # Certifications
  certifications:
    - name: "AWS Certified Cloud Practitioner"
      issuer: "Amazon Web Services"
      date: "2024-03"
      expires: "2027-03"
      credential_id: "ABC123"
      url: "https://..."
```

### Database Schema Extension

For storing skills in Supabase:

```sql
-- Skills master table (reference data)
CREATE TABLE skill_definitions (
  id TEXT PRIMARY KEY,              -- "python", "react", etc.
  name TEXT NOT NULL,               -- "Python", "React"
  category TEXT NOT NULL,           -- "language", "framework", "database", "cloud", "tool"
  aliases TEXT[] DEFAULT '{}',      -- ["py", "python3"]
  parent_skill TEXT,                -- For hierarchies: "typescript" -> "javascript"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User skills
CREATE TABLE user_skills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  skill_id TEXT REFERENCES skill_definitions(id) NOT NULL,
  proficiency INTEGER CHECK (proficiency BETWEEN 1 AND 5),
  years_total DECIMAL(3,1),
  years_professional DECIMAL(3,1),
  last_used DATE,
  context TEXT,                     -- Brief description of usage
  projects TEXT[],                  -- List of relevant projects
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

-- User certifications
CREATE TABLE user_certifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  issue_date DATE,
  expiry_date DATE,
  credential_id TEXT,
  credential_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job skill requirements (parsed from job descriptions)
CREATE TABLE job_skill_requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  skill_id TEXT REFERENCES skill_definitions(id) NOT NULL,
  is_required BOOLEAN DEFAULT true,
  min_proficiency INTEGER,
  min_years DECIMAL(3,1),
  raw_text TEXT,                    -- Original text from job description
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, skill_id)
);

-- Indexes
CREATE INDEX idx_user_skills_user ON user_skills(user_id);
CREATE INDEX idx_user_skills_proficiency ON user_skills(user_id, proficiency DESC);
CREATE INDEX idx_job_requirements_job ON job_skill_requirements(job_id);
CREATE INDEX idx_job_requirements_skill ON job_skill_requirements(skill_id);
```

### Skill Answer Generation

```javascript
// Generate answer to skill proficiency question
function generateSkillAnswer(skill, questionType) {
  const answers = {
    // For 1-5 scale questions
    numeric_scale: skill.proficiency,
    
    // For text-based proficiency
    proficiency_text: {
      1: "No experience",
      2: "Beginner",
      3: "Intermediate", 
      4: "Advanced",
      5: "Expert"
    }[skill.proficiency],
    
    // For years of experience dropdown
    years_dropdown: mapYearsToDropdown(skill.years_total),
    
    // For describe experience questions
    description: `${skill.context}. ${skill.projects?.[0] || ''}`
  };
  
  return answers[questionType];
}

function mapYearsToDropdown(years) {
  if (years === 0) return "0";
  if (years < 1) return "0-1";
  if (years < 2) return "1-2";
  if (years < 3) return "2-3";
  if (years < 5) return "3-5";
  return "5+";
}
```

---

## Implementation Notes

### Auto-Fill Strategy for Skill Questions

1. **Detection Phase:**
   - Identify question type (rating, years, description, list)
   - Extract skill name from question label
   - Normalize skill name (e.g., "JS" -> "JavaScript")

2. **Lookup Phase:**
   - Find skill in user's profile
   - If not found, check for related skills
   - If still not found, return null/default

3. **Answer Phase:**
   - Generate appropriate answer format
   - For descriptions, use AI to contextualize
   - Log for review if uncertain

### Handling Unknown Skills

When application asks about a skill not in profile:

```javascript
function handleUnknownSkill(skillName, questionType) {
  // Try to infer from related skills
  const related = findRelatedSkills(skillName);
  
  if (related.length > 0) {
    // Use lowest proficiency from related skills, minus 1
    const inferredProficiency = Math.max(1, Math.min(...related.map(s => s.proficiency)) - 1);
    return generateAnswer(skillName, inferredProficiency, questionType);
  }
  
  // If truly unknown, return conservative default
  return questionType === 'numeric_scale' ? 1 : "No experience";
}
```

### Skill Synonyms

Handle variations in how skills are named:

```javascript
const skillSynonyms = {
  "javascript": ["js", "ecmascript", "es6", "es2015"],
  "typescript": ["ts"],
  "python": ["py", "python3"],
  "postgresql": ["postgres", "psql"],
  "kubernetes": ["k8s"],
  "amazon web services": ["aws"],
  "google cloud platform": ["gcp"],
  "react.js": ["react", "reactjs"],
  "node.js": ["node", "nodejs"],
  "c++": ["cpp", "c plus plus"],
  "c#": ["csharp", "c sharp"]
};

function normalizeSkillName(name) {
  const lower = name.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(skillSynonyms)) {
    if (lower === canonical || aliases.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}
```

---

## Summary

**Key Takeaways:**

1. **Rate conservatively** - Better to exceed expectations
2. **Include all relevant experience** - Internships, projects, coursework
3. **Match job terminology** - Use the same words as the job description
4. **Be specific** - Versions, years, contexts
5. **Track skills systematically** - Use the schema above for consistent answers
6. **Handle unknowns gracefully** - Default to honest "no experience"

**Next Steps for Implementation:**
1. Add `skills` section to profile schema
2. Implement skill extraction from resume
3. Add skill matching to job recommendations
4. Integrate skill answers into form fillers
5. Build skill proficiency detection for questions
