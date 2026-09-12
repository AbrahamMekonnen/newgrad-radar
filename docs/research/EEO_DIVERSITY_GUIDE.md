# EEO and Diversity Questions Guide

## Overview

Equal Employment Opportunity (EEO) and diversity questions appear on most job applications, particularly at companies that are federal contractors (250+ employees or $50K+ in federal contracts). These questions help employers track their diversity efforts and comply with federal reporting requirements.

**Key Principle: All EEO questions are voluntary. Declining to answer cannot legally affect hiring decisions.**

---

## Legal Framework

### EEOC Requirements
The Equal Employment Opportunity Commission requires employers with 100+ employees to file EEO-1 reports annually. These reports track workforce demographics but do NOT require collecting data from applicants.

### OFCCP Requirements
The Office of Federal Contract Compliance Programs requires federal contractors to:
- Invite applicants to voluntarily self-identify race, gender, disability status, and veteran status
- Keep this data separate from application materials
- Use it only for aggregate reporting, not hiring decisions

### Privacy Protections
- Self-identification data must be kept confidential
- It cannot be shared with hiring managers
- It should be stored separately from application data
- "Prefer not to answer" / "Decline to self-identify" is always valid

---

## Standard EEO Questions

### 1. Gender Identity

**Common Options:**
| Value | Notes |
|-------|-------|
| Male | Binary option |
| Female | Binary option |
| Non-binary | Increasingly common |
| Prefer to self-describe | Allows free-text entry |
| Decline to self-identify | Always valid |

**ATS Variations:**
- Greenhouse: "Gender", "What is your gender?"
- Lever: "Gender Identity"
- Workday: "Gender", "Sex"

### 2. Race/Ethnicity

**Standard EEOC Categories:**
| Value | Description |
|-------|-------------|
| American Indian or Alaska Native | Indigenous peoples of North America |
| Asian | East, Southeast, or South Asian ancestry |
| Black or African American | African diaspora ancestry |
| Hispanic or Latino | Spanish-speaking country ancestry (any race) |
| Native Hawaiian or Other Pacific Islander | Pacific island ancestry |
| White | European, Middle Eastern, North African ancestry |
| Two or More Races | Multiple racial backgrounds |
| Decline to self-identify | Always valid |

**Notes:**
- Hispanic/Latino is often asked separately as an ethnicity question
- Some forms allow multiple selections
- Categories follow OMB Directive 15 standards

### 3. Veteran Status

**OFCCP-Required Categories (for federal contractors):**
| Value | Description |
|-------|-------------|
| I am not a protected veteran | No qualifying military service |
| I identify as one or more of the classifications of protected veteran | Includes disabled veteran, recently separated, active duty wartime, Armed Forces service medal veteran |
| I am a protected veteran, but choose not to self-identify the classifications | Identifies as veteran without specifying type |
| Decline to self-identify | Always valid |

**Simplified Versions:**
- Yes / No / Prefer not to answer
- Veteran / Not a veteran / Decline

### 4. Disability Status

**OFCCP Form CC-305 (Voluntary Self-Identification of Disability):**
| Value | Description |
|-------|-------------|
| Yes, I have a disability, or have had one in the past | Current or historical disability |
| No, I do not have a disability | No qualifying condition |
| I do not wish to answer | Decline option |

**Definition of Disability (ADA):**
A physical or mental impairment that substantially limits one or more major life activities. Includes (non-exhaustive):
- Blindness, deafness
- Cancer, diabetes, epilepsy
- Autism, cerebral palsy
- Depression, PTSD, bipolar disorder
- HIV/AIDS
- Missing limbs
- Intellectual disabilities

### 5. Sexual Orientation (Less Common)

**When Asked:**
| Value | Notes |
|-------|-------|
| Heterosexual / Straight | |
| Gay | |
| Lesbian | |
| Bisexual | |
| Queer | |
| Prefer to self-describe | |
| Prefer not to answer | |

**Note:** Currently not required by EEOC, but some companies collect voluntarily for internal D&I tracking.

---

## Implementation for Auto-Apply

### Profile Schema

```json
{
  "eeo": {
    "enabled": true,
    "defaultBehavior": "decline",
    "answers": {
      "gender": "Decline to self-identify",
      "race": "Decline to self-identify", 
      "veteran": "I am not a protected veteran",
      "disability": "I do not wish to answer",
      "lgbtq": "Prefer not to answer"
    }
  }
}
```

### Configuration Options

#### Option 1: Always Decline (Default - Recommended)
```json
{
  "eeo": {
    "defaultBehavior": "decline"
  }
}
```
- Safest privacy option
- Always selects "Prefer not to answer" or equivalent
- Legal and accepted by all employers

#### Option 2: Answer Specific Questions
```json
{
  "eeo": {
    "defaultBehavior": "answer",
    "answers": {
      "gender": "Male",
      "race": "Asian",
      "veteran": "I am not a protected veteran",
      "disability": "No, I do not have a disability"
    }
  }
}
```
- User provides specific answers
- Stored securely in profile
- Applied consistently across applications

#### Option 3: Skip EEO Section
```json
{
  "eeo": {
    "enabled": false
  }
}
```
- Does not interact with EEO questions at all
- May leave fields blank (usually acceptable)
- Fastest processing

---

## Answer Mapping Table

### Gender Variations
| User Input | Greenhouse | Lever | Workday | Ashby |
|------------|------------|-------|---------|-------|
| decline | "Decline to self-identify" | "I do not wish to answer" | "Prefer not to say" | "Decline" |
| male | "Male" | "Male" | "Male" | "Man" |
| female | "Female" | "Female" | "Female" | "Woman" |
| non-binary | "Non-binary" | "Non-binary" | "Non-binary" | "Non-binary" |

### Race Variations
| User Input | Standard | Alternative |
|------------|----------|-------------|
| decline | "Decline to self-identify" | "Two or More Races (Not Hispanic or Latino)" (some forms) |
| asian | "Asian" | "Asian (Not Hispanic or Latino)" |
| black | "Black or African American" | "Black or African American (Not Hispanic or Latino)" |
| white | "White" | "White (Not Hispanic or Latino)" |
| hispanic | "Hispanic or Latino" | "Hispanic or Latino" |
| mixed | "Two or More Races" | "Two or More Races (Not Hispanic or Latino)" |

### Veteran Variations
| User Input | OFCCP Form | Simple Form |
|------------|------------|-------------|
| decline | "I am a protected veteran, but choose not to self-identify the classifications" | "Prefer not to answer" |
| no | "I am not a protected veteran" | "No" |
| yes | "I identify as one or more of the classifications of protected veteran" | "Yes" |

### Disability Variations
| User Input | CC-305 Form | Simple Form |
|------------|-------------|-------------|
| decline | "I do not wish to answer" | "Prefer not to answer" |
| no | "No, I do not have a disability" | "No" |
| yes | "Yes, I have a disability, or have had one in the past" | "Yes" |

---

## Privacy-Conscious Storage Design

### Principles

1. **Encryption at Rest**: EEO data should be encrypted separately from other profile data
2. **Minimal Logging**: Never log EEO values in application logs
3. **User Control**: Easy to view, modify, and delete
4. **No Sharing**: Never transmitted to external services (except during form filling)

### Recommended Storage Structure

```
profile.json (main profile - git-trackable)
  |-- basic info
  |-- education
  |-- work history
  |-- customAnswers

profile.eeo.json (EEO data - gitignored, optional encryption)
  |-- eeo configuration
  |-- answers
```

### .gitignore Addition
```
# Sensitive EEO data
profile.eeo.json
*.eeo.json
```

### Example Implementation

**profile.eeo.json:**
```json
{
  "$schema": "eeo-profile-v1",
  "lastModified": "2026-09-10T00:00:00Z",
  "config": {
    "enabled": true,
    "defaultBehavior": "decline",
    "logActivity": false
  },
  "answers": {
    "gender": {
      "value": "decline",
      "customText": null
    },
    "race": {
      "value": "decline",
      "hispanic": null
    },
    "veteran": {
      "value": "no",
      "classifications": []
    },
    "disability": {
      "value": "decline"
    },
    "lgbtq": {
      "value": null,
      "enabled": false
    }
  }
}
```

---

## Field Detection Patterns

### Labels to Match

```javascript
const eeoPatterns = {
  gender: [
    'gender',
    'gender identity', 
    'what is your gender',
    'sex',
    'how do you identify'
  ],
  race: [
    'race',
    'ethnicity',
    'race/ethnicity',
    'racial background',
    'ethnic background'
  ],
  hispanic: [
    'hispanic',
    'latino',
    'latina',
    'latinx',
    'of hispanic or latino origin'
  ],
  veteran: [
    'veteran',
    'veteran status',
    'protected veteran',
    'military',
    'served in the military',
    'armed forces'
  ],
  disability: [
    'disability',
    'disabled',
    'accommodation',
    'voluntary self-identification of disability',
    'cc-305'
  ]
};
```

### Detection Strategy

1. Check if page contains EEO section markers:
   - "Voluntary Self-Identification"
   - "Equal Employment Opportunity"
   - "Demographic Information"
   - "EEOC"
   - "OFCCP"

2. Look for fieldsets/sections with these headers

3. Match individual field labels against patterns

4. Apply appropriate answer based on user config

---

## Best Practices for Auto-Apply

### Do:
- Default to "Decline to self-identify" for maximum privacy
- Store EEO preferences separately from main profile
- Let users opt-in to providing EEO data
- Support all standard decline options across ATS platforms
- Handle missing EEO section gracefully (skip without error)

### Don't:
- Never make EEO fields required in the profile
- Never log specific EEO answers
- Never share EEO data externally
- Never assume answers based on name or other profile data
- Never auto-fill EEO fields without explicit user consent

### User Communication
When setting up auto-apply, prompt user:

```
EEO/Diversity Questions

Job applications often include voluntary demographic questions 
for Equal Employment Opportunity reporting.

How would you like to handle these questions?

1. Decline all (recommended) - Select "Prefer not to answer" for all
2. Provide answers - Configure your responses  
3. Skip entirely - Leave EEO fields blank

Your choice: [1]
```

---

## References

- EEOC EEO-1 Instructions: eeoc.gov/employers/eeo-1-survey
- OFCCP Form CC-305: dol.gov/agencies/ofccp
- ADA Definition of Disability: ada.gov/topics/intro-to-ada
- OMB Directive 15 (Race/Ethnicity Categories): whitehouse.gov/omb/directives

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-09-10 | Initial research and documentation |
