# Salary Expectations and Availability Guide

Research and implementation guide for handling salary and availability questions in automated job applications.

## Table of Contents

1. [Salary Expectations](#salary-expectations)
2. [Availability Questions](#availability-questions)
3. [User Preference Fields](#user-preference-fields)
4. [Implementation Strategies](#implementation-strategies)

---

## Salary Expectations

### Common Question Formats

Applications ask about salary in various ways:

| Question Type | Example | Recommended Response |
|--------------|---------|---------------------|
| **Open-ended text** | "What are your salary expectations?" | Range with explanation |
| **Numeric field** | "Desired salary (annual)" | Single number (use midpoint) |
| **Range selection** | Dropdown: "$100k-$120k", "$120k-$140k" | Select based on research |
| **Current salary** | "Current/most recent salary" | Only where legal; otherwise leave blank |
| **Hourly rate** | "Expected hourly rate" | Calculate from annual: (annual / 2080) |

### Researching Market Rates

#### Free Data Sources (Priority Order)

1. **H1B LCA Disclosure Data** (Best for tech)
   - URL: https://www.dol.gov/agencies/eta/foreign-labor/performance
   - Coverage: All companies sponsoring H1B visas
   - Data: Actual salaries filed with DOL
   - Update frequency: Quarterly
   - Integration: Already implemented in `/src/lib/salary-data.ts`

2. **Levels.fyi** (Best for company comparisons)
   - URL: https://www.levels.fyi
   - Coverage: Tech companies, verified by community
   - Limitation: No public API; manual research only

3. **Glassdoor** (Broad coverage)
   - URL: https://www.glassdoor.com/Salaries
   - Coverage: All industries
   - Limitation: Self-reported, API discontinued

4. **Bureau of Labor Statistics**
   - URL: https://www.bls.gov/oes
   - Coverage: National averages by occupation
   - Use case: Fallback for uncommon roles

#### Research Workflow for New Grads

```
1. Look up company on levels.fyi
   - Check "New Grad" or "L3/E3" level
   - Note base salary range
   - Check total compensation (TC)

2. Cross-reference with H1B data
   - Use our salary lookup: /api/salary-lookup?company=X
   - Filter for "Software Engineer" titles
   - Look at 25th-75th percentile

3. Adjust for location
   - SF/NYC: Base rate
   - Seattle: -5% to -10%
   - Austin/Denver: -15% to -20%
   - Remote: Depends on company policy

4. Set your range
   - Target: 50th-75th percentile
   - Floor: No less than 25th percentile
   - Always use total comp when comparing
```

### New Grad Salary Benchmarks (2024-2025)

| Company Tier | Base Salary | Signing Bonus | Stock/RSU | Total Comp |
|--------------|-------------|---------------|-----------|------------|
| **FAANG/Big Tech** | $180-220K | $30-50K | $50-100K/yr | $260-370K |
| **AI/ML Unicorns** | $180-250K | $25-50K | $40-100K/yr | $245-400K |
| **Well-Funded Startups** | $150-180K | $20-30K | Variable | $170-210K+ |
| **Mid-Size Tech** | $130-160K | $10-20K | $20-40K/yr | $160-220K |
| **Early Startups (Seed/A)** | $100-140K | $0-10K | Higher equity | $100-150K |
| **Fintech** | $140-180K | $20-40K | $30-60K/yr | $190-280K |

### When to Give a Range vs Specific Number

#### Give a RANGE When:
- Open text field asks for "expectations"
- Early in the process (initial application)
- You have flexibility
- Market data shows wide variance

**Format:** "$140,000 - $160,000, depending on total compensation structure"

#### Give a SPECIFIC NUMBER When:
- Numeric-only field (won't accept text)
- Asked for "minimum acceptable"
- Company has transparent pay bands
- You have a firm number in mind

**Strategy:** Use the 75th percentile of your research as the single number.

### Handling "Negotiable" or "Open"

Many applications allow "Negotiable" or "Open to discussion". Use when:

- Very early stage startup (equity heavy)
- Unique role with no market data
- You're more interested in the opportunity than the comp
- The company has transparent, non-negotiable pay bands

**Caution:** Some ATS systems filter out "negotiable" as low-effort answers.

### Location-Based Adjustments

When an application asks about salary AND location, adjust:

```typescript
const LOCATION_MODIFIERS = {
  // Premium markets
  'san francisco': 1.0,
  'new york city': 1.0,
  'seattle': 0.95,
  
  // High cost
  'los angeles': 0.90,
  'boston': 0.92,
  'washington dc': 0.90,
  
  // Medium cost
  'austin': 0.85,
  'denver': 0.85,
  'chicago': 0.85,
  
  // Lower cost
  'atlanta': 0.80,
  'dallas': 0.80,
  'phoenix': 0.75,
  
  // Remote (varies by company policy)
  'remote': 0.85,  // Most companies
  // Some companies pay SF rates for remote
};
```

### Current Salary Question Handling

**Legal Status by State:**
- **Banned:** CA, CO, CT, DE, HI, IL, MA, MD, NJ, NY, OR, PA (some cities), RI, VT, WA
- **Allowed but risky:** Other states

**Response Strategies:**

1. **If legally banned:** Leave blank or enter "N/A - prohibited by state law"
2. **If allowed but early career:** Enter expected salary (you're not lying - you expect to make X)
3. **If must answer:** Enter total compensation, not just base
4. **Field requires number:** Enter 0 or 1 (clear signal you're not answering)

---

## Availability Questions

### Common Availability Questions

| Question | Context | Strategy |
|----------|---------|----------|
| "When can you start?" | Start date | 2-4 weeks from expected offer date |
| "Available for X hours/week?" | Part-time/Intern | Match job posting requirements |
| "Preferred work schedule?" | Hybrid policies | Show flexibility |
| "Willing to relocate?" | Location requirements | Depends on job and offer |

### Start Date Strategies

#### For New Grads

```
Scenario 1: Still in school
  -> "Available [graduation month + 2 weeks]"
  -> Example: "June 15, 2025"

Scenario 2: Recently graduated, no current job
  -> "Available immediately" or "2 weeks notice"
  -> Shows you're ready and motivated

Scenario 3: Have current job
  -> "2-4 weeks from offer acceptance"
  -> Standard professional notice period

Scenario 4: Negotiating multiple offers
  -> Give the latest reasonable date
  -> "August 1, 2025" buys time to compare
```

#### Date Calculation Logic

```typescript
function calculateStartDate(
  situation: 'student' | 'unemployed' | 'employed',
  graduationDate?: Date
): Date {
  const today = new Date();
  
  if (situation === 'student' && graduationDate) {
    // 2 weeks after graduation to decompress
    return addDays(graduationDate, 14);
  }
  
  if (situation === 'unemployed') {
    // Can start quickly but not too eager
    return addDays(today, 14);
  }
  
  // Currently employed - standard notice
  return addDays(today, 28); // 4 weeks
}
```

### Hours/Week Availability

For internships and part-time roles:

| Role Type | Expected Hours | Response Strategy |
|-----------|---------------|-------------------|
| **Full-time** | 40 hrs | "Full-time, 40 hours/week" |
| **Internship** | 40 hrs | Match posting; mention availability for overtime |
| **Part-time** | 20-30 hrs | Give actual availability, be honest |
| **Contract** | Variable | Specify your preferences |

### Work Schedule Preferences

Common questions and suggested responses:

**"What is your preferred work schedule?"**
- Default: "I'm flexible and can adapt to team needs"
- If hybrid: "I prefer X days in office but am flexible"
- Show willingness to collaborate

**"Are you available for on-call/weekend work?"**
- Research if role requires it
- For new grads, showing willingness is positive
- "Yes, I understand this may be required occasionally"

### Relocation Questions

#### When to Say YES to Relocation

- Job is in a tier-1 company in another city
- Company provides relocation assistance
- City has lower cost of living (salary goes further)
- Important for career growth

#### When to Say NO/MAYBE

- Role can be done remotely
- You have strong ties to current location
- No relocation package offered
- Early-stage startup (may not survive)

#### Handling "Willing to Relocate" Checkbox

```typescript
const RELOCATION_DECISION = {
  // Definitely check YES
  bigTechWithPackage: true,
  topTierAI: true,
  dreamCompany: true,
  
  // Check YES if flexible
  goodCompanyNoPackage: 'user_preference',
  costOfLivingIncrease: 'user_preference',
  
  // Probably NO
  earlyStartup: false,
  lateralMove: false,
  familyTies: false,
};
```

---

## User Preference Fields

### Expanded Profile Schema

Based on research, the `UserProfile` type should be enhanced with these fields:

```typescript
interface SalaryPreferences {
  // Basic preferences
  salary_type: 'range' | 'specific' | 'negotiable' | 'market_rate';
  
  // For range type
  salary_min: number | null;
  salary_max: number | null;
  
  // For specific type
  salary_target: number | null;
  
  // Flexibility
  salary_flexibility: 'firm' | 'somewhat_flexible' | 'very_flexible';
  
  // What's included
  salary_includes: ('base' | 'bonus' | 'equity' | 'benefits')[];
  
  // Display preference for applications
  salary_display_strategy: 'show_range' | 'show_target' | 'show_negotiable' | 'leave_blank';
  
  // Hourly rate (for part-time/contract)
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  
  // Geographic awareness
  salary_location_adjusted: boolean; // Whether to auto-adjust for job location
  salary_base_location: string | null; // The location salary is based on
}

interface AvailabilityPreferences {
  // Start date
  start_date_type: 'specific' | 'immediate' | 'flexible' | 'after_graduation';
  start_date_earliest: string | null; // ISO date
  start_date_preferred: string | null; // ISO date
  graduation_date: string | null; // For students
  
  // Notice period
  notice_period_weeks: number | null;
  
  // Hours
  hours_per_week_min: number | null;
  hours_per_week_max: number | null;
  preferred_work_schedule: 'standard' | 'flexible' | 'shift' | 'any';
  
  // Work mode
  work_mode_preference: 'remote' | 'hybrid' | 'onsite' | 'any';
  hybrid_days_in_office: number | null; // If hybrid, how many days
  
  // On-call/Travel
  available_for_oncall: boolean | null;
  willing_to_travel: boolean | null;
  travel_percentage_max: number | null; // 0-100
  
  // Relocation
  willing_to_relocate: boolean;
  relocation_preferences: {
    requires_package: boolean;
    preferred_locations: string[];
    excluded_locations: string[];
  };
}

// Full enhanced UserProfile
interface EnhancedUserProfile extends UserProfile {
  salary_preferences: SalaryPreferences;
  availability_preferences: AvailabilityPreferences;
}
```

### Database Migration

```sql
-- Add salary preferences to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_type TEXT DEFAULT 'range';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_min INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_max INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_target INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_flexibility TEXT DEFAULT 'somewhat_flexible';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_includes TEXT[] DEFAULT '{"base"}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_display_strategy TEXT DEFAULT 'show_range';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hourly_rate_min NUMERIC(10,2);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hourly_rate_max NUMERIC(10,2);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_location_adjusted BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS salary_base_location TEXT;

-- Add availability preferences
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS start_date_type TEXT DEFAULT 'flexible';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS start_date_earliest DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS start_date_preferred DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS graduation_date DATE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notice_period_weeks INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hours_per_week_min INTEGER DEFAULT 40;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hours_per_week_max INTEGER DEFAULT 40;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_work_schedule TEXT DEFAULT 'standard';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS work_mode_preference TEXT DEFAULT 'any';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hybrid_days_in_office INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS available_for_oncall BOOLEAN;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS willing_to_travel BOOLEAN;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS travel_percentage_max INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS relocation_requires_package BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS relocation_preferred_locations TEXT[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS relocation_excluded_locations TEXT[] DEFAULT '{}';
```

---

## Implementation Strategies

### Auto-Fill Logic for Salary Fields

```typescript
interface SalaryFieldFiller {
  fillSalaryField(
    fieldType: 'text' | 'number' | 'select' | 'range',
    fieldLabel: string,
    userPrefs: SalaryPreferences,
    jobData: { company: string; tier: string; location: string }
  ): string | number;
}

class SalaryFieldFillerImpl implements SalaryFieldFiller {
  fillSalaryField(
    fieldType: 'text' | 'number' | 'select' | 'range',
    fieldLabel: string,
    userPrefs: SalaryPreferences,
    jobData: { company: string; tier: string; location: string }
  ): string | number {
    
    // Handle "current salary" questions - leave blank where illegal
    if (isSalaryHistoryQuestion(fieldLabel)) {
      return this.handleSalaryHistory(userPrefs);
    }
    
    // Get market-adjusted salary
    const marketSalary = this.getMarketRate(jobData);
    const userTarget = this.getUserTarget(userPrefs, jobData.location);
    const finalTarget = Math.max(marketSalary.median, userTarget);
    
    switch (fieldType) {
      case 'number':
        return finalTarget;
        
      case 'text':
        if (userPrefs.salary_display_strategy === 'show_negotiable') {
          return 'Open to discussion based on total compensation';
        }
        return `$${formatNumber(userPrefs.salary_min)} - $${formatNumber(userPrefs.salary_max)}`;
        
      case 'select':
        return this.findClosestOption(finalTarget);
        
      case 'range':
        return { min: userPrefs.salary_min, max: userPrefs.salary_max };
    }
  }
  
  private handleSalaryHistory(userPrefs: SalaryPreferences): string {
    // Check if we should answer salary history questions
    // Most states now ban this
    return '0'; // Signal we're not answering
  }
}
```

### Auto-Fill Logic for Availability Fields

```typescript
class AvailabilityFieldFiller {
  fillStartDate(
    fieldType: 'date' | 'text' | 'select',
    userPrefs: AvailabilityPreferences
  ): string | Date {
    
    const today = new Date();
    
    switch (userPrefs.start_date_type) {
      case 'immediate':
        if (fieldType === 'date') {
          return addWeeks(today, 2);
        }
        return 'Available within 2 weeks';
        
      case 'specific':
        if (fieldType === 'date') {
          return userPrefs.start_date_preferred || addWeeks(today, 4);
        }
        return formatDate(userPrefs.start_date_preferred);
        
      case 'after_graduation':
        const gradDate = userPrefs.graduation_date;
        if (fieldType === 'date') {
          return gradDate ? addWeeks(new Date(gradDate), 2) : addMonths(today, 6);
        }
        return gradDate 
          ? `Available ${formatDate(addWeeks(new Date(gradDate), 2))}` 
          : 'Available after graduation (Spring 2025)';
        
      case 'flexible':
      default:
        if (fieldType === 'date') {
          return addWeeks(today, 4);
        }
        return 'Flexible - can discuss based on team needs';
    }
  }
  
  fillHoursPerWeek(
    fieldType: 'number' | 'text' | 'select',
    userPrefs: AvailabilityPreferences,
    jobType: 'full-time' | 'part-time' | 'intern' | 'contract'
  ): string | number {
    
    if (jobType === 'full-time') {
      return fieldType === 'number' ? 40 : '40 hours/week (full-time)';
    }
    
    if (fieldType === 'number') {
      return userPrefs.hours_per_week_max || 40;
    }
    
    const min = userPrefs.hours_per_week_min || 20;
    const max = userPrefs.hours_per_week_max || 40;
    
    return min === max 
      ? `${min} hours/week` 
      : `${min}-${max} hours/week, flexible`;
  }
  
  fillRelocation(
    willingToRelocate: boolean,
    relocationPrefs: AvailabilityPreferences['relocation_preferences'],
    jobLocation: string
  ): boolean | string {
    
    // Check if job location is in excluded list
    if (relocationPrefs.excluded_locations.some(
      loc => jobLocation.toLowerCase().includes(loc.toLowerCase())
    )) {
      return false;
    }
    
    // Check if job location is in preferred list
    if (relocationPrefs.preferred_locations.length > 0) {
      const isPreferred = relocationPrefs.preferred_locations.some(
        loc => jobLocation.toLowerCase().includes(loc.toLowerCase())
      );
      if (isPreferred) return true;
    }
    
    // Fall back to general preference
    return willingToRelocate;
  }
}
```

### Question Detection Patterns

```typescript
// Patterns to detect salary-related questions
const SALARY_QUESTION_PATTERNS = [
  /salary\s*expectation/i,
  /desired\s*salary/i,
  /compensation\s*expectation/i,
  /expected\s*pay/i,
  /salary\s*requirement/i,
  /pay\s*rate/i,
  /hourly\s*rate/i,
  /annual\s*salary/i,
  /current\s*salary/i,       // Salary history
  /previous\s*salary/i,      // Salary history
  /most\s*recent\s*salary/i, // Salary history
];

// Patterns to detect availability questions
const AVAILABILITY_QUESTION_PATTERNS = [
  /when\s*(can|could)\s*you\s*start/i,
  /earliest\s*start\s*date/i,
  /available\s*to\s*start/i,
  /start\s*date/i,
  /availability/i,
  /hours\s*per\s*week/i,
  /work\s*schedule/i,
  /relocat(e|ion)/i,
  /willing\s*to\s*move/i,
  /on\s*call/i,
  /travel/i,
];

// Detect if question is asking about salary history (often illegal)
function isSalaryHistoryQuestion(question: string): boolean {
  const historyPatterns = [
    /current\s*salary/i,
    /previous\s*salary/i,
    /most\s*recent\s*(salary|compensation)/i,
    /what\s*(do|did)\s*you\s*(make|earn)/i,
    /salary\s*history/i,
  ];
  return historyPatterns.some(p => p.test(question));
}
```

### UI Component Suggestions

For the ProfileForm, add these sections:

```tsx
// Salary Preferences Section
<section>
  <h2>Salary Preferences</h2>
  
  <Select 
    label="How should we fill salary fields?"
    options={[
      { value: 'show_range', label: 'Show my salary range' },
      { value: 'show_target', label: 'Show target amount' },
      { value: 'show_negotiable', label: 'Mark as negotiable' },
      { value: 'leave_blank', label: 'Leave blank when possible' },
    ]}
  />
  
  <div className="grid grid-cols-2 gap-4">
    <CurrencyInput label="Minimum Acceptable" />
    <CurrencyInput label="Target/Maximum" />
  </div>
  
  <Checkbox label="Auto-adjust salary based on job location" />
  
  <Alert>
    Based on H1B data, {tier} companies pay new grads 
    ${formatRange(tierRange)} for SWE roles.
  </Alert>
</section>

// Availability Section
<section>
  <h2>Availability</h2>
  
  <Select
    label="When can you start?"
    options={[
      { value: 'immediate', label: 'Within 2 weeks' },
      { value: 'specific', label: 'Specific date' },
      { value: 'after_graduation', label: 'After graduation' },
      { value: 'flexible', label: 'Flexible' },
    ]}
  />
  
  {startDateType === 'specific' && (
    <DatePicker label="Preferred Start Date" />
  )}
  
  {startDateType === 'after_graduation' && (
    <DatePicker label="Expected Graduation Date" />
  )}
  
  <Select
    label="Work Mode Preference"
    options={[
      { value: 'any', label: 'Open to any arrangement' },
      { value: 'remote', label: 'Remote only' },
      { value: 'hybrid', label: 'Hybrid preferred' },
      { value: 'onsite', label: 'In-office preferred' },
    ]}
  />
  
  <Checkbox label="Willing to relocate" />
  
  {willingToRelocate && (
    <>
      <Checkbox label="Only if relocation package provided" />
      <TagInput label="Preferred locations" placeholder="e.g., San Francisco, NYC" />
      <TagInput label="Locations to avoid" placeholder="e.g., remote only companies" />
    </>
  )}
</section>
```

---

## Summary

### Key Takeaways

1. **Research before setting salary expectations** - Use H1B data, levels.fyi, and company tier as guides

2. **Give ranges when possible** - Single numbers leave no room for negotiation

3. **Be strategic with start dates** - Not too eager, not too far out

4. **Location matters** - Adjust expectations based on market

5. **Know the laws** - Don't answer salary history questions where banned

6. **Store structured data** - Text fields for salary limit auto-apply capabilities

### Next Steps for Implementation

1. Add enhanced fields to `UserProfile` type
2. Create database migration for new columns
3. Update `ProfileForm` component with new sections
4. Implement field-filling logic in ATS adapters
5. Add salary research API endpoint for real-time market data
6. Build location-based salary adjustment utilities
