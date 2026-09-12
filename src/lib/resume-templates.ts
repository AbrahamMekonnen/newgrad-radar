// Jake's Resume LaTeX Template - converted to structured format
// Original: https://github.com/jakegut/resume

export interface ResumeData {
  name: string;
  email: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  location?: string;

  education: {
    school: string;
    degree: string;
    location: string;
    date: string;
    gpa?: string;
    coursework?: string[];
  }[];

  experience: {
    company: string;
    title: string;
    location: string;
    date: string;
    bullets: string[];
  }[];

  projects: {
    name: string;
    technologies: string;
    date?: string;
    bullets: string[];
  }[];

  skills: {
    category: string;
    items: string[];
  }[];
}

export interface JobContext {
  title: string;
  company: string;
  tier: string;
  description?: string;
  requirements?: string[];
  keywords?: string[];
  roleType: string; // 'ml', 'backend', 'frontend', etc.
}

export interface ResumeTweak {
  section: 'experience' | 'projects' | 'skills' | 'education';
  index?: number;
  field?: string;
  original: string;
  suggested: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  safetyFlag?: 'safe' | 'review' | 'risky';
  safetyNote?: string;
}

export interface TweakedResume {
  original: ResumeData;
  tweaked: ResumeData;
  tweaks: ResumeTweak[];
  matchScore: number; // 0-100 how well it matches the job
  keywordsAdded: string[];
  keywordsAlreadyPresent: string[];
}

// Jake's Resume LaTeX template
export function generateLatex(resume: ResumeData): string {
  const escapeLatex = (text: string) => {
    return text
      .replace(/&/g, '\\&')
      .replace(/%/g, '\\%')
      .replace(/\$/g, '\\$')
      .replace(/#/g, '\\#')
      .replace(/_/g, '\\_')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
  };

  const header = `%-------------------------
% Resume in Latex
% Based on Jake's Resume Template
%------------------------

\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}

\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

\\newcommand{\\resumeItem}[1]{
  \\item\\small{#1 \\vspace{-2pt}}
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & #2 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}
\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

\\begin{document}
`;

  // Contact info
  const contactParts = [
    resume.phone,
    resume.email ? `\\href{mailto:${resume.email}}{${escapeLatex(resume.email)}}` : null,
    resume.linkedin ? `\\href{${resume.linkedin}}{LinkedIn}` : null,
    resume.github ? `\\href{${resume.github}}{GitHub}` : null,
    resume.portfolio ? `\\href{${resume.portfolio}}{Portfolio}` : null,
  ].filter(Boolean);

  const contactSection = `
\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeLatex(resume.name)}} \\\\ \\vspace{1pt}
    \\small ${contactParts.join(' $|$ ')}
\\end{center}
`;

  // Education
  let educationSection = '';
  if (resume.education.length > 0) {
    educationSection = `
\\section{Education}
  \\resumeSubHeadingListStart
${resume.education.map(edu => `    \\resumeSubheading
      {${escapeLatex(edu.school)}}{${escapeLatex(edu.location)}}
      {${escapeLatex(edu.degree)}${edu.gpa ? ` -- GPA: ${edu.gpa}` : ''}}{${escapeLatex(edu.date)}}`).join('\n')}
  \\resumeSubHeadingListEnd
`;
  }

  // Experience
  let experienceSection = '';
  if (resume.experience.length > 0) {
    experienceSection = `
\\section{Experience}
  \\resumeSubHeadingListStart
${resume.experience.map(exp => `    \\resumeSubheading
      {${escapeLatex(exp.title)}}{${escapeLatex(exp.date)}}
      {${escapeLatex(exp.company)}}{${escapeLatex(exp.location)}}
      \\resumeItemListStart
${exp.bullets.map(b => `        \\resumeItem{${escapeLatex(b)}}`).join('\n')}
      \\resumeItemListEnd`).join('\n')}
  \\resumeSubHeadingListEnd
`;
  }

  // Projects
  let projectsSection = '';
  if (resume.projects.length > 0) {
    projectsSection = `
\\section{Projects}
  \\resumeSubHeadingListStart
${resume.projects.map(proj => `    \\resumeProjectHeading
      {\\textbf{${escapeLatex(proj.name)}} $|$ \\emph{${escapeLatex(proj.technologies)}}}{${proj.date ? escapeLatex(proj.date) : ''}}
      \\resumeItemListStart
${proj.bullets.map(b => `        \\resumeItem{${escapeLatex(b)}}`).join('\n')}
      \\resumeItemListEnd`).join('\n')}
  \\resumeSubHeadingListEnd
`;
  }

  // Skills
  let skillsSection = '';
  if (resume.skills.length > 0) {
    skillsSection = `
\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
${resume.skills.map(s => `     \\textbf{${escapeLatex(s.category)}}{: ${escapeLatex(s.items.join(', '))}} \\\\`).join('\n')}
    }}
 \\end{itemize}
`;
  }

  const footer = `
\\end{document}
`;

  return header + contactSection + educationSection + experienceSection + projectsSection + skillsSection + footer;
}

// Sample resume for testing
export const SAMPLE_RESUME: ResumeData = {
  name: "Jake Ryan",
  email: "jake@su.edu",
  phone: "123-456-7890",
  linkedin: "https://linkedin.com/in/jakeryan",
  github: "https://github.com/jakeryan",

  education: [{
    school: "Southwestern University",
    degree: "Bachelor of Arts in Computer Science, Minor in Business",
    location: "Georgetown, TX",
    date: "Aug. 2018 -- May 2021",
    gpa: "3.8",
  }],

  experience: [
    {
      company: "Texas A&M University",
      title: "Undergraduate Research Assistant",
      location: "College Station, TX",
      date: "June 2020 -- Present",
      bullets: [
        "Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems",
        "Developed a full-stack web application using Flask, React, PostgreSQL and Docker to analyze GitHub data",
        "Explored ways to visualize GitHub collaboration in a classroom setting",
      ],
    },
    {
      company: "Southwestern University",
      title: "Information Technology Support Specialist",
      location: "Georgetown, TX",
      date: "Sep. 2018 -- Present",
      bullets: [
        "Communicate with managers to set up campus computers used on extract dates",
        "Assess and troubleshoot computer problems brought by students, extract and faculty",
        "Maintain upkeep of computers, extract, extract, and logging inventory",
      ],
    },
  ],

  projects: [
    {
      name: "Gitlytics",
      technologies: "Python, Flask, React, PostgreSQL, Docker",
      date: "June 2020 -- Present",
      bullets: [
        "Developed a full-stack web application using with Flask serving a REST API with React as the frontend",
        "Implemented GitHub OAuth to get data from user's repositories",
        "Visualized GitHub data to show collaboration",
        "Used Celery and Redis for asynchronous tasks",
      ],
    },
    {
      name: "Simple Paintball",
      technologies: "Spigot API, Java, Maven, TravisCI, Git",
      date: "May 2018 -- May 2020",
      bullets: [
        "Developed a Minecraft server plugin to extract extract extract game modes",
        "Published plugin to websites extract extract extract extract 2K extract extract extract",
        "Implemented extract extract systems extract extract extract extract extract",
      ],
    },
  ],

  skills: [
    { category: "Languages", items: ["Java", "Python", "C/C++", "SQL (Postgres)", "JavaScript", "HTML/CSS", "R"] },
    { category: "Frameworks", items: ["React", "Node.js", "Flask", "JUnit", "WordPress", "Material-UI", "FastAPI"] },
    { category: "Developer Tools", items: ["Git", "Docker", "TravisCI", "Google Cloud Platform", "VS Code", "Visual Studio", "PyCharm", "IntelliJ", "Eclipse"] },
    { category: "Libraries", items: ["pandas", "NumPy", "Matplotlib"] },
  ],
};
