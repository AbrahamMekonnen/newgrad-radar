# Education and GPA Guide for Auto-Apply

Research on education-related application fields and strategies for handling them effectively.

## Table of Contents

1. [Common Education Fields](#common-education-fields)
2. [GPA Handling](#gpa-handling)
3. [Format Variations by ATS](#format-variations-by-ats)
4. [Strategic Presentation](#strategic-presentation)
5. [User Data Requirements](#user-data-requirements)
6. [Database Schema Design](#database-schema-design)
7. [Implementation Guide](#implementation-guide)

---

## Common Education Fields

### Core Fields (Always Needed)

| Field | Description | Example Values |
|-------|-------------|----------------|
| School/University Name | Full institution name | "University of California, Berkeley" |
| Degree Type | Level of degree | "Bachelor of Science", "Master of Science", "Ph.D." |
| Major | Primary field of study | "Computer Science", "Electrical Engineering" |
| Graduation Date | Month/Year of graduation | "May 2024", "December 2024" |

### Frequently Asked Fields

| Field | Description | Example Values |
|-------|-------------|----------------|
| Minor | Secondary field of study | "Mathematics", "Business Administration" |
| Concentration | Specialization within major | "Machine Learning", "Systems" |
| GPA | Grade point average | "3.75", "3.75/4.00" |
| Start Date | When degree was started | "August 2020" |
| Expected Graduation | For current students | "May 2025" |
| School Location | City, State, Country | "Berkeley, CA" |
| Degree Status | Current status | "Completed", "In Progress", "Expected" |

### Honors and Achievements

| Field | Description | Example Values |
|-------|-------------|----------------|
| Honors | Latin honors received | "Cum Laude", "Magna Cum Laude", "Summa Cum Laude" |
| Dean's List | Academic distinction | "Dean's List - 6 semesters" |
| Awards | Academic recognitions | "Outstanding Senior Award", "Best Thesis" |
| Scholarships | Merit-based funding | "National Merit Scholar", "Chancellor's Scholar" |
| Relevant Coursework | Key courses taken | "Machine Learning, Distributed Systems, Algorithms" |
| Research | Academic research | "Undergraduate Research Assistant - ML Lab" |
| Thesis/Capstone | Final project | "Deep Learning for Medical Imaging" |

### Certifications (Related)

| Field | Description | Example Values |
|-------|-------------|----------------|
| Certifications | Professional certs | "AWS Certified Solutions Architect" |
| Online Courses | MOOCs, bootcamps | "Coursera ML Specialization" |
| Professional Memberships | Organizations | "ACM Student Member", "IEEE" |

---

## GPA Handling

### When to Include GPA

**Include GPA (Strong Cases):**
- GPA >= 3.5 (considered strong by most standards)
- Required field in the application
- Company/role known to filter by GPA
- New grad with limited work experience
- Major GPA significantly higher than cumulative

**Consider Omitting GPA:**
- GPA < 3.0 (unless required)
- GPA 3.0-3.4 and you have strong experience/projects
- More than 2-3 years post-graduation
- Application has it as optional and your experience is strong

### GPA Scale Conversions

#### US 4.0 Scale (Standard)

| Letter | Points | Meaning |
|--------|--------|---------|
| A+, A | 4.0 | Excellent |
| A- | 3.7 | Very Good |
| B+ | 3.3 | Good |
| B | 3.0 | Above Average |
| B- | 2.7 | Average |
| C+ | 2.3 | Below Average |
| C | 2.0 | Satisfactory |

#### International Scale Conversions

| Scale | Strong | Average | Convert to 4.0 |
|-------|--------|---------|----------------|
| UK (First/2:1/2:2) | First (70%+) | 2:1 (60-69%) | First=4.0, 2:1=3.5, 2:2=3.0 |
| Indian (10.0) | 8.5+ | 7.0-8.4 | (Indian GPA / 10) * 4 |
| Indian (100%) | 85%+ | 70-84% | (Percentage / 25) approx |
| German (1.0-5.0) | 1.0-1.5 | 2.0-2.5 | 4.0 - German + 1 |
| Canadian | 3.7+ | 3.0-3.6 | Same as US |
| Australian (7.0) | 6.0+ | 5.0-5.9 | (AUS / 7) * 4 |
| French (20.0) | 16+ | 12-15 | (French / 20) * 4 |

### Major GPA vs Cumulative GPA

**When to Use Major GPA:**
- Major GPA is significantly higher (0.3+ difference)
- Application specifically asks for major GPA
- Technical role where major coursework is most relevant
- Format: "Major GPA: 3.8, Cumulative: 3.5"

**When to Use Cumulative:**
- Application asks for "overall GPA" or just "GPA"
- Major and cumulative are similar
- Application has one GPA field

### How to Explain Low GPA

If GPA is low but you need to include it (required field or explain in interview):

1. **Show Improvement**: "GPA improved from 2.8 freshman year to 3.6 senior year"
2. **Context**: "Worked 25+ hours/week to fund education while maintaining coursework"
3. **Major GPA**: "CS Major GPA: 3.7 (Overall: 3.2)"
4. **Relevant Courses**: "GPA in technical courses: 3.6"
5. **Focus on Outcomes**: Redirect to projects, internships, and achievements

### GPA Format Variations

Applications may request GPA in different formats:

```
// Common formats
"3.75"          // Simple number
"3.75/4.00"     // With scale
"3.75 / 4.0"    // Spaced
"3.8 (Major)"   // Major GPA noted
"3.5 GPA"       // With label

// For dropdowns
"3.5 - 4.0"     // Range selection
"Above 3.5"     // Threshold
```

---

## Format Variations by ATS

### Greenhouse

Education fields typically appear as:
- School Name (text input)
- Degree Type (dropdown: "Bachelor's", "Master's", "PhD", etc.)
- Field of Study / Major (text input)
- Graduation Year (dropdown or text)
- GPA (optional text field, sometimes conditional)

```javascript
// Greenhouse patterns
{
  "School name": "University of California, Berkeley",
  "Degree": "Bachelor's",  // or "Bachelor of Science"
  "Field of Study": "Computer Science",
  "Graduation year": "2024",
  "GPA": "3.75"  // optional
}
```

### Lever

Often uses combined or simplified fields:
- Education (combined field or structured)
- School + Degree in one field sometimes
- May parse from resume

```javascript
// Lever patterns
{
  "Education": "B.S. Computer Science, UC Berkeley, 2024",
  // Or structured:
  "School": "UC Berkeley",
  "Degree": "B.S. Computer Science",
  "Graduation Date": "May 2024"
}
```

### Ashby

Modern, flexible forms:
- Often auto-fills from LinkedIn
- May have detailed or minimal education sections
- Sometimes pulls from uploaded resume

### Jobvite

Traditional form structure:
- School (text, often autocomplete)
- Degree (dropdown)
- Major (text or dropdown)
- Start Date / End Date
- GPA (usually optional)
- Honors (dropdown or text)

```javascript
// Jobvite patterns
{
  "School": "University of California, Berkeley",
  "Degree": "Bachelor's Degree",
  "Major": "Computer Science",
  "Start Date": "08/2020",
  "End Date": "05/2024",  // or "Present"
  "GPA": "3.75"
}
```

### Workday

Most complex, often requires:
- Multiple education entries
- Specific date formats (MM/YYYY)
- Country/State for school location
- Sometimes requires high school

```javascript
// Workday patterns
{
  "Education Level": "Bachelor's Degree",
  "School or University": "University of California, Berkeley",
  "Degree": "Bachelor of Science (BS)",
  "Field of Study": "Computer Science",
  "Start Date": "08/2020",
  "End Date": "05/2024",
  "GPA": "3.75",
  "GPA Out Of": "4.0",
  "Country": "United States",
  "State": "California"
}
```

---

## Strategic Presentation

### For New Grads

**Emphasize:**
- Relevant coursework (especially if matches job requirements)
- Research experience
- Capstone/senior project
- Academic achievements (if strong GPA, honors)
- Technical clubs/organizations

**De-emphasize:**
- GPA if below 3.3 and optional
- Unrelated coursework
- High school (unless notable)

### For Career Changers (Bootcamp/Self-Taught)

**Include:**
- Traditional degree (even if unrelated field)
- Bootcamp/certification completion
- Relevant online courses
- Self-study (strategically mentioned)

**Format:**
```
B.A. Economics, UCLA, 2020
Software Engineering Bootcamp, App Academy, 2023
AWS Certified Developer, 2023
```

### Common Mistakes to Avoid

1. **Inconsistent dates** between resume and application
2. **Wrong degree abbreviation** (B.S. vs. BS vs. Bachelor of Science)
3. **Omitting graduation month** when application asks for it
4. **Including pending degree** without marking "Expected"
5. **Wrong school name** (e.g., "Cal" vs "UC Berkeley")
6. **GPA on wrong scale** (e.g., entering percentage in 4.0 field)

---

## User Data Requirements

### Required Data Collection

The auto-apply system should collect:

```javascript
// Primary Education (required)
{
  education: [{
    schoolName: "University of California, Berkeley",
    schoolLocation: "Berkeley, CA",          // Optional but useful
    degreeType: "bachelors",                  // enum: associates, bachelors, masters, doctorate, bootcamp
    degreeName: "Bachelor of Science",        // Full name for forms
    major: "Computer Science",
    minor: "Mathematics",                     // Optional
    concentration: "Machine Learning",        // Optional
    startDate: "2020-08",                     // YYYY-MM
    endDate: "2024-05",                       // YYYY-MM or "present"
    graduationStatus: "completed",            // enum: completed, in_progress, expected
    
    // GPA
    gpa: 3.75,
    gpaScale: 4.0,
    majorGpa: 3.85,                           // Optional
    showGpa: true,                            // User preference
    
    // Honors
    honors: "Magna Cum Laude",                // Optional
    deansList: true,
    deansListSemesters: 6,
    
    // Additional
    relevantCoursework: [
      "Machine Learning",
      "Distributed Systems", 
      "Algorithms"
    ],
    thesis: "Deep Learning for Medical Imaging",
    awards: ["Outstanding Senior Award"]
  }]
}
```

### Degree Type Mapping

```javascript
const degreeTypes = {
  // Internal key -> Display variations for different ATS
  associates: ["Associate's Degree", "Associate", "AA", "AS"],
  bachelors: ["Bachelor's Degree", "Bachelor's", "Bachelor of Science", "B.S.", "BS", "B.A.", "BA"],
  masters: ["Master's Degree", "Master's", "Master of Science", "M.S.", "MS", "M.A.", "MA", "MBA"],
  doctorate: ["Ph.D.", "PhD", "Doctorate", "Doctor of Philosophy"],
  bootcamp: ["Bootcamp", "Certificate Program", "Professional Certificate"],
  other: ["Certificate", "High School Diploma", "GED"]
};
```

---

## Database Schema Design

### Recommended Schema for Multiple Degrees

```sql
-- ============================================
-- TABLE: user_education
-- Education history for auto-apply
-- Supports multiple degrees per user
-- ============================================
CREATE TABLE user_education (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Order (1 = primary/most recent)
  display_order INTEGER DEFAULT 1,
  
  -- School Information
  school_name TEXT NOT NULL,
  school_location TEXT,               -- "Berkeley, CA"
  school_country TEXT DEFAULT 'US',   -- For international
  
  -- Degree Information
  degree_type TEXT NOT NULL,          -- 'bachelors', 'masters', 'doctorate', 'bootcamp'
  degree_name TEXT,                   -- "Bachelor of Science" (full form)
  major TEXT NOT NULL,
  minor TEXT,
  concentration TEXT,
  
  -- Dates
  start_date DATE,                    -- or TEXT 'YYYY-MM'
  end_date DATE,                      -- null for in progress
  graduation_status TEXT DEFAULT 'completed',  -- 'completed', 'in_progress', 'expected'
  
  -- GPA
  gpa DECIMAL(3,2),                   -- e.g., 3.75
  gpa_scale DECIMAL(3,1) DEFAULT 4.0, -- e.g., 4.0, 10.0, 100
  major_gpa DECIMAL(3,2),
  show_gpa BOOLEAN DEFAULT true,
  
  -- Honors & Achievements
  honors TEXT,                        -- 'Cum Laude', 'Magna Cum Laude', etc.
  deans_list BOOLEAN DEFAULT false,
  deans_list_semesters INTEGER,
  
  -- Additional
  relevant_coursework TEXT[],         -- Array of course names
  thesis_title TEXT,
  awards TEXT[],                      -- Array of award names
  
  -- Metadata
  is_primary BOOLEAN DEFAULT false,   -- Primary degree for applications
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_education_user ON user_education(user_id);
CREATE INDEX idx_user_education_primary ON user_education(user_id, is_primary) WHERE is_primary = true;
CREATE INDEX idx_user_education_order ON user_education(user_id, display_order);

-- RLS
ALTER TABLE user_education ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own education" ON user_education
  FOR ALL USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_education_updated_at
  BEFORE UPDATE ON user_education
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### JSON Schema (For Profile JSON)

For local profile.json storage:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "education": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["schoolName", "degreeType", "major", "endDate"],
        "properties": {
          "schoolName": { "type": "string" },
          "schoolLocation": { "type": "string" },
          "degreeType": { 
            "type": "string",
            "enum": ["associates", "bachelors", "masters", "doctorate", "bootcamp", "certificate", "high_school"]
          },
          "degreeName": { "type": "string" },
          "major": { "type": "string" },
          "minor": { "type": "string" },
          "concentration": { "type": "string" },
          "startDate": { "type": "string", "pattern": "^\\d{4}-\\d{2}$" },
          "endDate": { "type": "string" },
          "graduationStatus": {
            "type": "string",
            "enum": ["completed", "in_progress", "expected"]
          },
          "gpa": { "type": "number", "minimum": 0, "maximum": 100 },
          "gpaScale": { "type": "number", "enum": [4.0, 5.0, 10.0, 100] },
          "majorGpa": { "type": "number" },
          "showGpa": { "type": "boolean", "default": true },
          "honors": { "type": "string" },
          "deansList": { "type": "boolean" },
          "deansListSemesters": { "type": "integer" },
          "relevantCoursework": { "type": "array", "items": { "type": "string" } },
          "thesis": { "type": "string" },
          "awards": { "type": "array", "items": { "type": "string" } },
          "isPrimary": { "type": "boolean", "default": true }
        }
      }
    }
  }
}
```

---

## Implementation Guide

### Upgrading Profile Schema

Current profile.json:
```javascript
// OLD (single education object)
{
  "education": {
    "school": "University of California, Berkeley",
    "degree": "Bachelor's",
    "major": "Computer Science",
    "graduationYear": "2024"
  }
}
```

New profile.json:
```javascript
// NEW (array supporting multiple degrees)
{
  "education": [
    {
      "schoolName": "University of California, Berkeley",
      "schoolLocation": "Berkeley, CA",
      "degreeType": "bachelors",
      "degreeName": "Bachelor of Science",
      "major": "Computer Science",
      "minor": "Mathematics",
      "startDate": "2020-08",
      "endDate": "2024-05",
      "graduationStatus": "completed",
      "gpa": 3.75,
      "gpaScale": 4.0,
      "showGpa": true,
      "honors": "Magna Cum Laude",
      "deansList": true,
      "deansListSemesters": 6,
      "relevantCoursework": ["Machine Learning", "Distributed Systems", "Algorithms"],
      "isPrimary": true
    }
  ]
}
```

### Backward Compatibility

```javascript
// Migration function
function migrateEducation(profile) {
  // Handle old format (single object)
  if (profile.education && !Array.isArray(profile.education)) {
    const oldEdu = profile.education;
    profile.education = [{
      schoolName: oldEdu.school,
      degreeType: mapDegreeType(oldEdu.degree),
      degreeName: oldEdu.degree,
      major: oldEdu.major,
      endDate: `${oldEdu.graduationYear}-05`,  // Assume May graduation
      graduationStatus: 'completed',
      isPrimary: true
    }];
  }
  return profile;
}

function mapDegreeType(degree) {
  const mapping = {
    "Bachelor's": "bachelors",
    "Bachelor of Science": "bachelors",
    "B.S.": "bachelors",
    "Master's": "masters",
    "Master of Science": "masters",
    "M.S.": "masters",
    "Ph.D.": "doctorate",
    "PhD": "doctorate"
  };
  return mapping[degree] || "bachelors";
}
```

### Filler Updates

```javascript
// Updated education filling for fillers
async function fillEducation(page, education, atsType) {
  // Get primary education (or first entry)
  const primary = education.find(e => e.isPrimary) || education[0];
  if (!primary) return;
  
  // Format values based on ATS expectations
  const schoolName = primary.schoolName;
  const degree = formatDegree(primary, atsType);
  const major = primary.major;
  const gradDate = formatGradDate(primary, atsType);
  const gpa = primary.showGpa ? formatGpa(primary, atsType) : null;
  
  // Fill based on ATS type
  switch (atsType) {
    case 'greenhouse':
      await fields.fillByLabel(page, 'School', schoolName);
      await fields.selectByLabel(page, 'Degree', degree);
      await fields.fillByLabel(page, 'Field of Study', major);
      await fields.fillByLabel(page, 'Graduation', gradDate);
      if (gpa) await fields.fillByLabel(page, 'GPA', gpa);
      break;
      
    case 'lever':
      // Lever may have combined education field
      await fields.fillByLabel(page, 'Education', 
        `${degree} ${major}, ${schoolName}, ${gradDate}`);
      break;
      
    case 'workday':
      await fields.fillByLabel(page, 'School or University', schoolName);
      await fields.selectByLabel(page, 'Education Level', degree);
      await fields.selectByLabel(page, 'Degree', primary.degreeName);
      await fields.fillByLabel(page, 'Field of Study', major);
      await fillWorkdayDates(page, primary);
      if (gpa) {
        await fields.fillByLabel(page, 'GPA', primary.gpa.toString());
        await fields.fillByLabel(page, 'GPA Out Of', primary.gpaScale.toString());
      }
      break;
  }
}

function formatDegree(edu, atsType) {
  const formats = {
    greenhouse: { bachelors: "Bachelor's", masters: "Master's", doctorate: "PhD" },
    lever: { bachelors: "B.S.", masters: "M.S.", doctorate: "Ph.D." },
    workday: { bachelors: "Bachelor's Degree", masters: "Master's Degree", doctorate: "Doctorate" }
  };
  return formats[atsType]?.[edu.degreeType] || edu.degreeName;
}

function formatGradDate(edu, atsType) {
  const date = edu.endDate;
  if (!date) return '';
  
  // Parse YYYY-MM format
  const [year, month] = date.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  switch (atsType) {
    case 'greenhouse':
      return year;  // Just year
    case 'workday':
      return `${month}/${year}`;  // MM/YYYY
    case 'lever':
      return `${monthNames[parseInt(month) - 1]} ${year}`;  // May 2024
    default:
      return `${year}-${month}`;
  }
}

function formatGpa(edu, atsType) {
  if (!edu.gpa) return null;
  
  switch (atsType) {
    case 'workday':
      return edu.gpa.toString();  // Just number, scale separate
    case 'greenhouse':
    case 'lever':
    default:
      return `${edu.gpa}/${edu.gpaScale}`;  // 3.75/4.0
  }
}
```

---

## Summary

### Key Takeaways

1. **Support Multiple Degrees**: Not everyone has just one - career changers, grad students
2. **GPA is Context-Dependent**: Include logic for when to show/hide
3. **ATS Variation is Real**: Same data needs different formats
4. **Dates Matter**: Month/year precision needed for Workday-style forms
5. **Graceful Degradation**: Handle old profile format smoothly

### Data Collection Priorities

1. **Must Have**: School, Degree Type, Major, Graduation Date
2. **Should Have**: GPA (with scale), Minor, Start Date
3. **Nice to Have**: Honors, Coursework, Thesis, Awards

### Next Steps

1. Update profile.json schema to array format
2. Add migration for existing profiles
3. Update fillers to use new education format
4. Add GPA display logic based on user preference and value
5. Create education section in profile setup UI
