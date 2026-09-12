# Job Application Fields Research

Comprehensive analysis of data fields required by major ATS (Applicant Tracking Systems) for job applications. This research covers Greenhouse, Lever, Workday, iCIMS, Taleo, SmartRecruiters, BambooHR, JazzHR, and others.

---

## Table of Contents

1. [Personal Information](#1-personal-information)
2. [Contact Information](#2-contact-information)
3. [Work Authorization](#3-work-authorization)
4. [Education](#4-education)
5. [Work Experience](#5-work-experience)
6. [Resume & Documents](#6-resume--documents)
7. [Skills & Qualifications](#7-skills--qualifications)
8. [Availability & Compensation](#8-availability--compensation)
9. [EEO & Diversity (Voluntary)](#9-eeo--diversity-voluntary)
10. [Custom Application Questions](#10-custom-application-questions)
11. [Social & Professional Links](#11-social--professional-links)
12. [References](#12-references)
13. [ATS-Specific Fields](#13-ats-specific-fields)

---

## 1. Personal Information

### Core Identity Fields

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| First Name | **Required** | Text (1-50 chars) | "John" | Always required |
| Last Name | **Required** | Text (1-50 chars) | "Smith" | Always required |
| Middle Name | Optional | Text | "Robert" | Rare, ~5% of apps |
| Preferred Name | Optional | Text | "Jack" | Growing in popularity |
| Full Legal Name | Rare | Text | "John Robert Smith" | For background checks |
| Pronouns | Optional | Select/Text | "he/him", "she/her", "they/them" | Increasingly common |
| Suffix | Rare | Select | "Jr.", "Sr.", "III", "PhD" | ~2% of apps |
| Prefix/Title | Rare | Select | "Mr.", "Ms.", "Dr." | ~1% of apps |

### Address Information

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Street Address Line 1 | Common | Text | "123 Main Street" | ~60% required |
| Street Address Line 2 | Optional | Text | "Apt 4B" | For unit/suite |
| City | **Required** | Text | "San Francisco" | Almost always required |
| State/Province | **Required** | Select/Text | "CA", "California" | US uses 2-letter codes |
| ZIP/Postal Code | **Required** | Text | "94102", "M5V 2H1" | Format varies by country |
| Country | **Required** | Select | "United States" | ISO country codes often used |

---

## 2. Contact Information

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Email | **Required** | Email | "john.smith@email.com" | Primary contact method |
| Phone Number | **Required** | Phone | "+1 (555) 123-4567" | Various format acceptances |
| Phone Type | Optional | Select | "Mobile", "Home", "Work" | ~20% of apps |
| Secondary Email | Rare | Email | "jsmith@personal.com" | Backup contact |
| Secondary Phone | Rare | Phone | Same format | Emergency contact |
| Preferred Contact Method | Optional | Select | "Email", "Phone" | ~10% of apps |
| Best Time to Contact | Rare | Text/Select | "9am-5pm PST" | ~5% of apps |

---

## 3. Work Authorization

### US-Specific Authorization

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Authorized to work in US | **Required** | Yes/No | "Yes" | Legal compliance |
| Require visa sponsorship | **Required** | Yes/No | "No" | Critical for employers |
| Current visa status | Common | Select | "H-1B", "F-1 OPT", "Green Card" | If not citizen |
| Visa expiration date | Optional | Date | "2025-06-15" | If applicable |
| Are you a US Citizen | Common | Yes/No | "Yes" | ~40% of apps |
| Eligible for security clearance | Rare | Yes/No | "Yes" | Government/defense jobs |
| Current security clearance | Rare | Select | "Secret", "Top Secret" | Defense contractors |

### Visa Status Options (Common Values)

```
- US Citizen
- Permanent Resident (Green Card)
- H-1B Visa
- H-1B1 Visa
- L-1 Visa
- O-1 Visa
- TN Visa
- E-2 Visa
- F-1 OPT
- F-1 CPT
- F-1 STEM OPT Extension
- J-1 Visa
- EAD (Employment Authorization Document)
- Asylum/Refugee Status
- Other (please specify)
```

### International Authorization

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Work authorization country | Common | Multi-select | ["US", "UK", "Canada"] | For global roles |
| Passport country | Rare | Select | "United States" | ~5% of apps |
| EU work rights | Common (EU jobs) | Yes/No | "Yes" | GDPR regions |
| Right to work in UK | Common (UK jobs) | Yes/No | "Yes" | Post-Brexit requirement |

---

## 4. Education

### Degree Information (Repeatable Section)

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| School/University Name | **Required** | Text/Autocomplete | "Stanford University" | Often autocomplete |
| Degree Type | **Required** | Select | "Bachelor's", "Master's" | See list below |
| Field of Study/Major | **Required** | Text/Select | "Computer Science" | Sometimes autocomplete |
| Minor | Optional | Text | "Mathematics" | ~30% of apps |
| Start Date | Common | Date (Month/Year) | "August 2018" | ~60% of apps |
| End Date/Expected Graduation | **Required** | Date (Month/Year) | "May 2022" | Can be future |
| GPA | Common | Number | "3.8" | ~50% of apps ask |
| GPA Scale | Optional | Select | "4.0", "5.0" | Clarification |
| Currently Enrolled | Optional | Yes/No | "No" | For students |
| Honors/Awards | Optional | Text | "Magna Cum Laude" | ~20% of apps |
| Relevant Coursework | Rare | Text/List | "Data Structures, ML" | Entry-level jobs |
| Thesis Title | Rare | Text | "ML in Healthcare" | PhD/Master's |

### Degree Type Options

```
- High School Diploma / GED
- Some College (No Degree)
- Associate's Degree (AA/AS)
- Bachelor's Degree (BA/BS)
- Master's Degree (MA/MS/MBA/MFA)
- Doctorate (PhD/EdD/JD/MD)
- Professional Degree
- Certificate / Certification
- Vocational Training
- Bootcamp / Coding Academy
- Other
```

---

## 5. Work Experience

### Employment History (Repeatable Section)

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Company Name | **Required** | Text/Autocomplete | "Google" | Often autocomplete |
| Job Title | **Required** | Text | "Software Engineer" | Free text usually |
| Location | Common | Text | "Mountain View, CA" | ~70% of apps |
| Start Date | **Required** | Date (Month/Year) | "June 2020" | Always required |
| End Date | **Required** | Date or "Present" | "Present" | Current job indicator |
| Currently Working Here | Common | Checkbox | true | Toggle for current |
| Employment Type | Common | Select | "Full-time" | See list below |
| Description/Responsibilities | Common | Textarea | "Developed..." | ~60% of apps |
| Reason for Leaving | Optional | Text/Select | "Career growth" | ~20% of apps |
| Supervisor Name | Rare | Text | "Jane Doe" | Background check apps |
| Supervisor Contact | Rare | Phone/Email | "555-1234" | May we contact? |
| May We Contact | Rare | Yes/No | "Yes" | Permission to verify |
| Salary | Rare | Number | "85000" | ~10% of apps |

### Employment Type Options

```
- Full-time
- Part-time
- Contract
- Temporary
- Internship
- Co-op
- Freelance
- Self-employed
- Volunteer
- Apprenticeship
```

### Experience Summary Fields

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Total Years of Experience | Common | Number/Select | "5" | Often dropdown ranges |
| Years in Role/Industry | Optional | Number | "3" | Specific experience |
| Current/Most Recent Salary | Optional | Number/Range | "$80,000-$100,000" | ~30% of apps |
| Notice Period | Optional | Select | "2 weeks" | Time to start |

---

## 6. Resume & Documents

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Resume/CV | **Required** | File Upload | .pdf, .doc, .docx | 2-5MB limit typical |
| Cover Letter | Common | File/Text | .pdf or textarea | ~50% allow, ~20% require |
| Portfolio URL | Optional | URL | "portfolio.com" | Design/creative roles |
| Writing Sample | Rare | File Upload | .pdf, .doc | Content/writing roles |
| Code Sample/GitHub | Optional | URL/File | "github.com/user" | Engineering roles |
| Transcript | Rare | File Upload | .pdf | New grad roles |
| Certificates | Optional | File Upload | .pdf | Credentialed roles |
| Additional Documents | Optional | File Upload | Various | Catch-all |

### File Format Specifications

```
Accepted formats (typical):
- Resume: .pdf, .doc, .docx, .rtf, .txt
- Cover Letter: .pdf, .doc, .docx, .txt
- Portfolio: URL or .pdf
- Images: .png, .jpg, .jpeg (for design)

Size limits:
- Most ATS: 2-5 MB per file
- Some allow: up to 10 MB
- Total upload: often 25 MB max
```

---

## 7. Skills & Qualifications

### Technical Skills

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Skills List | Common | Multi-select/Tags | ["Python", "React", "SQL"] | Often searchable |
| Skill Proficiency | Optional | Scale | "Expert", "Intermediate" | Per-skill rating |
| Years with Skill | Rare | Number | "5" | Per skill |
| Programming Languages | Common (tech) | Multi-select | ["Python", "Java", "JS"] | Tech roles |
| Frameworks/Tools | Common (tech) | Multi-select | ["React", "Django", "AWS"] | Tech roles |
| Software Proficiency | Common | Multi-select | ["Excel", "Salesforce"] | Various roles |

### Certifications

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Certification Name | Optional | Text/Select | "AWS Solutions Architect" | Free text or list |
| Issuing Organization | Optional | Text | "Amazon Web Services" | Who issued |
| Issue Date | Optional | Date | "January 2023" | When obtained |
| Expiration Date | Optional | Date | "January 2026" | If applicable |
| Credential ID | Rare | Text | "ABC123456" | Verification |

### Languages

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Language | Common | Select | "Spanish" | Spoken languages |
| Proficiency Level | Common | Select | "Fluent", "Conversational" | See scale below |
| Reading Proficiency | Rare | Select | "Advanced" | Separate skills |
| Writing Proficiency | Rare | Select | "Intermediate" | Separate skills |

### Language Proficiency Scale

```
Common scales:
- Basic / Elementary
- Conversational / Limited Working
- Professional Working
- Full Professional
- Native / Bilingual

Alternative scale:
- A1, A2 (Basic)
- B1, B2 (Independent)
- C1, C2 (Proficient)
```

---

## 8. Availability & Compensation

### Start Date & Availability

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Earliest Start Date | Common | Date | "2024-02-01" | ~60% of apps |
| Availability | Common | Select | "Immediately", "2 weeks" | Preset options |
| Notice Period Required | Optional | Select | "2 weeks", "1 month" | Current employment |
| Available for Relocation | Common | Yes/No/Maybe | "Yes" | ~50% of apps |
| Preferred Work Location | Optional | Select/Text | "San Francisco, CA" | Remote era |
| Remote Work Preference | Common | Select | "Remote", "Hybrid", "On-site" | Post-COVID standard |
| Travel Willingness | Optional | Percentage | "25%", "50%" | Sales/consulting |

### Compensation

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Desired Salary | Common | Number/Range | "$120,000" | ~40% of apps |
| Salary Currency | Optional | Select | "USD" | International roles |
| Salary Type | Optional | Select | "Annual", "Hourly" | Clarification |
| Current Salary | Optional | Number | "$100,000" | ~20% of apps (declining) |
| Minimum Acceptable Salary | Rare | Number | "$110,000" | Negotiation baseline |
| Bonus Expectations | Rare | Number/Percentage | "15%" | Senior roles |
| Equity Expectations | Rare | Text | "0.1%" | Startup roles |

### Salary Range Format Options

```
- Exact number: "$95,000"
- Range: "$90,000 - $110,000"
- Dropdown ranges: "$80k-$100k", "$100k-$120k"
- Hourly: "$50/hour"
- Open/Negotiable: "Negotiable based on total comp"
```

---

## 9. EEO & Diversity (Voluntary)

All fields in this section are legally optional in the US and must be clearly marked as voluntary. They are used for aggregate reporting only.

### Gender & Identity

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Gender | Common (voluntary) | Select | "Male", "Female", "Non-binary" | EEOC reporting |
| Gender Identity | Optional | Select | Extended options | More inclusive |
| Sexual Orientation | Rare | Select | "LGBTQ+", "Heterosexual" | ~5% of apps |
| Transgender Status | Rare | Yes/No/Prefer not to say | N/A | Voluntary |

### Gender Options (Inclusive)

```
- Male
- Female
- Non-binary
- Genderqueer
- Genderfluid
- Agender
- Two-Spirit
- Prefer to self-describe: [text]
- Prefer not to answer
```

### Race & Ethnicity

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Race/Ethnicity | Common (voluntary) | Select/Multi-select | See list below | EEOC categories |
| Hispanic/Latino | Common (voluntary) | Yes/No | "Yes" | Separate question |

### Race/Ethnicity Options (EEOC Standard)

```
- American Indian or Alaska Native
- Asian
- Black or African American
- Hispanic or Latino
- Native Hawaiian or Other Pacific Islander
- White
- Two or More Races
- Prefer not to answer
```

### Extended Race/Ethnicity (Some Companies)

```
Asian subcategories:
- Asian Indian
- Chinese
- Filipino
- Japanese
- Korean
- Vietnamese
- Other Asian

Pacific Islander subcategories:
- Native Hawaiian
- Guamanian or Chamorro
- Samoan
- Other Pacific Islander
```

### Disability Status

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Disability Status | Common (voluntary) | Select | See options | ADA compliance |
| Accommodation Needed | Rare | Yes/No + Text | "Yes - wheelchair access" | Interview accommodations |

### Disability Status Options

```
- Yes, I have a disability (or previously had)
- No, I don't have a disability
- I don't wish to answer
```

### Veteran Status

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Veteran Status | Common (voluntary) | Select | See options | VEVRAA compliance |
| Protected Veteran | Optional | Select | Multiple categories | Federal contractors |
| Branch of Service | Rare | Select | "Army", "Navy" | If veteran |
| Discharge Status | Rare | Select | "Honorable" | If veteran |

### Veteran Status Options

```
- I am not a protected veteran
- I identify as one or more of the following:
  - Disabled Veteran
  - Recently Separated Veteran
  - Active Duty Wartime or Campaign Badge Veteran
  - Armed Forces Service Medal Veteran
- I don't wish to answer
```

---

## 10. Custom Application Questions

### Common Question Types

| Question Type | Format | Example | Commonality |
|--------------|--------|---------|-------------|
| Short Answer | Text (<500 chars) | "Describe your interest..." | Very Common |
| Long Answer/Essay | Textarea | "Tell us about a project..." | Common |
| Yes/No | Boolean | "Willing to work weekends?" | Very Common |
| Multiple Choice | Select | "How did you hear about us?" | Very Common |
| Multi-select | Checkboxes | "Select all that apply..." | Common |
| Numeric | Number | "Years of Python experience?" | Common |
| Date | Date picker | "When can you start?" | Common |
| File Upload | File | "Upload portfolio" | Optional |
| URL | Link | "Link to GitHub profile" | Common |
| Scale/Rating | 1-5, 1-10 | "Rate your SQL skills" | Rare |

### Frequently Asked Custom Questions

#### About the Role
```
- Why are you interested in this position?
- Why do you want to work at [Company]?
- What excites you about this role?
- What relevant experience do you have?
- Describe a relevant project you've worked on.
```

#### Technical/Skills
```
- Rate your proficiency in [Skill] (1-5)
- How many years of experience with [Technology]?
- Describe your experience with [Framework/Tool]
- What's your preferred programming language?
- Have you worked with [specific technology]? (Y/N)
```

#### Behavioral
```
- Describe a challenging situation and how you handled it.
- Tell us about a time you failed and what you learned.
- How do you handle tight deadlines?
- Describe your ideal work environment.
- What's your management/leadership style?
```

#### Logistics
```
- How did you hear about this position?
- Have you applied to [Company] before?
- Do you know anyone who works here?
- Are you willing to relocate?
- Can you commute to [location]?
- Are you available for the salary range of $X-$Y?
```

#### Legal/Compliance
```
- Are you over 18 years of age?
- Have you ever been convicted of a felony? (Ban-the-box varies by state)
- Are you subject to any non-compete agreements?
- Have you signed any confidentiality agreements that might affect this role?
```

### "How Did You Hear About Us" Options

```
Common referral sources:
- Company Website
- LinkedIn
- Indeed
- Glassdoor
- AngelList / Wellfound
- Google Search
- Social Media (Twitter, Facebook, Instagram)
- Job Board (specify)
- Employee Referral
- University/Campus Recruiting
- Career Fair
- Recruiter
- Podcast/Event
- News Article
- Friend/Family
- Other (please specify)
```

---

## 11. Social & Professional Links

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| LinkedIn URL | **Very Common** | URL | "linkedin.com/in/username" | ~80% of apps |
| GitHub URL | Common (tech) | URL | "github.com/username" | Engineering roles |
| Portfolio/Website | Common | URL | "portfolio.com" | Creative/tech roles |
| Twitter/X | Optional | URL/Handle | "@username" | ~10% of apps |
| Dribbble | Optional (design) | URL | "dribbble.com/user" | Design roles |
| Behance | Optional (design) | URL | "behance.net/user" | Design roles |
| Medium/Blog | Rare | URL | "medium.com/@user" | Content roles |
| Stack Overflow | Rare | URL | "stackoverflow.com/users/id" | ~5% of tech apps |
| Personal Website | Optional | URL | "johnsmith.com" | ~20% of apps |
| Other URL | Optional | URL | Any relevant link | Catch-all |

---

## 12. References

Usually collected later in the process, but some applications ask upfront.

### Reference Information (Repeatable, typically 2-3)

| Field | Commonality | Format | Example | Notes |
|-------|-------------|--------|---------|-------|
| Reference Name | When asked | Text | "Jane Doe" | Full name |
| Reference Title | When asked | Text | "Engineering Manager" | Job title |
| Reference Company | When asked | Text | "Google" | Where they work |
| Reference Email | When asked | Email | "jane.doe@email.com" | Contact info |
| Reference Phone | When asked | Phone | "(555) 123-4567" | Contact info |
| Relationship | When asked | Select/Text | "Former Manager" | How you know them |
| Years Known | Rare | Number | "3" | Duration |

### Relationship Options

```
- Current Manager/Supervisor
- Former Manager/Supervisor
- Current Colleague/Peer
- Former Colleague/Peer
- Direct Report
- Professor/Academic Advisor
- Mentor
- Client
- Vendor/Partner
- Personal Reference
- Other
```

---

## 13. ATS-Specific Fields

### Greenhouse-Specific

| Field | Notes |
|-------|-------|
| Source attribution | Tracks referral/source |
| EEOC fields | Standard voluntary questions |
| Custom questions | Highly customizable per job |
| Data privacy consent | GDPR compliance |
| Offer details (internal) | Salary, equity, start date |

### Lever-Specific

| Field | Notes |
|-------|-------|
| Requisition ID | Job identifier |
| Origin source | How candidate found job |
| Custom forms | Configurable per stage |
| Feedback tags | Internal assessment |

### Workday-Specific

| Field | Notes |
|-------|-------|
| Candidate ID | Unique system identifier |
| Job Requisition | Position identifier |
| Internal mobility | Current employee flag |
| Preferred language | System language preference |
| Time zone | For scheduling |
| Account creation | Often requires account |
| Questionnaire | Detailed screening questions |

### iCIMS-Specific

| Field | Notes |
|-------|-------|
| Profile completeness | Percentage tracking |
| Skills matching | Auto-parsed from resume |
| Job alerts subscription | Opt-in for notifications |
| Talent pool consent | Future opportunities |

### Taleo-Specific

| Field | Notes |
|-------|-------|
| Candidate profile | Stored across applications |
| Assessment links | Skills tests |
| Background check consent | Pre-authorization |
| Drug test consent | Industry-specific |

---

## Field Frequency Summary

### Always Required (95%+ of applications)
- First Name
- Last Name
- Email
- Phone Number
- Resume Upload
- Work Authorization (US)
- Sponsorship Requirement

### Usually Required (60-90% of applications)
- City/Location
- LinkedIn URL
- Education (at least one entry)
- Work Experience (at least one entry)

### Commonly Asked (30-60% of applications)
- Cover Letter
- Desired Salary
- Start Date/Availability
- Skills/Technologies
- "How did you hear about us?"
- Why interested in role/company
- Years of experience with X

### Sometimes Asked (10-30% of applications)
- Full Address
- GPA
- Current Salary
- Relocation willingness
- Remote preference
- Custom essays/questions
- EEO questions (voluntary)

### Rarely Asked (<10% of applications)
- References upfront
- Transcript
- Middle name
- Security clearance
- Supervisor contact info
- Specific visa details
- Salary history (increasingly banned)

---

## Data Validation Patterns

### Common Validations

```javascript
// Email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Phone (flexible)
const phoneRegex = /^[\d\s\-\+\(\)]+$/

// URL
const urlRegex = /^https?:\/\/.+/

// LinkedIn
const linkedinRegex = /linkedin\.com\/in\/[\w\-]+/

// GitHub  
const githubRegex = /github\.com\/[\w\-]+/

// ZIP Code (US)
const zipRegex = /^\d{5}(-\d{4})?$/

// Date (various)
const dateFormats = ['YYYY-MM-DD', 'MM/DD/YYYY', 'YYYY-MM']

// GPA
const gpaRange = { min: 0, max: 4.0 } // or 5.0

// Salary
const salaryRegex = /^\$?[\d,]+$/
```

---

## Recommendations for Auto-Apply System

### Must Collect from Users
1. **Personal**: Full name, email, phone, location (city, state, country)
2. **Work Auth**: US authorization, sponsorship needs, visa status
3. **Education**: Degree, school, graduation date, major, GPA (optional)
4. **Experience**: Job history with dates, titles, descriptions
5. **Resume**: PDF file upload
6. **Links**: LinkedIn URL (critical), GitHub (for tech roles)
7. **Preferences**: Desired salary range, start date, remote preference

### Should Collect (High Value)
1. Cover letter (or template to customize)
2. Technical skills list
3. Languages spoken
4. Portfolio/website URL
5. Relocation willingness

### Nice to Have
1. Certifications
2. Projects descriptions
3. References (can add later)
4. EEO data (optional, user choice)

### Auto-Generate or Skip
1. "How did you hear about us" - auto-select reasonable option
2. "Why this company" - template with company name insertion
3. Referral codes - if available

---

## Notes on Privacy & Compliance

1. **GDPR (EU)**: Requires explicit consent for data storage
2. **CCPA (California)**: Right to know what data is collected
3. **Ban-the-Box**: Many states prohibit criminal history questions
4. **Salary History Bans**: 21+ states prohibit asking current/past salary
5. **EEO Data**: Must be voluntary, separate from application evaluation

---

*Last Updated: September 2026*
*Research conducted for newgrad-radar auto-apply system*
