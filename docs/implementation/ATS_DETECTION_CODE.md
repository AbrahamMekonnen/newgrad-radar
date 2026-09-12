# ATS Detection Implementation

Complete implementation guide for detecting which Applicant Tracking System (ATS) a job application page uses.

## Table of Contents

1. [Detection Strategy Overview](#detection-strategy-overview)
2. [URL Pattern Matching](#url-pattern-matching)
3. [DOM Fingerprinting](#dom-fingerprinting)
4. [Meta Tag Detection](#meta-tag-detection)
5. [Script/Asset Fingerprinting](#scriptasset-fingerprinting)
6. [Detection Functions by ATS](#detection-functions-by-ats)
7. [Confidence Scoring](#confidence-scoring)
8. [Fallback Detection](#fallback-detection)
9. [Integration with ats-registry.ts](#integration-with-ats-registryts)

---

## Detection Strategy Overview

ATS detection uses a multi-layered approach with confidence scoring:

```typescript
type DetectionMethod = 'url' | 'dom' | 'meta' | 'script' | 'api';

interface ATSDetectionResult {
  atsType: ATSType;
  confidence: number; // 0-100
  method: DetectionMethod;
  signals: string[];
}
```

**Detection Priority Order:**
1. URL Pattern (fastest, 90%+ accuracy)
2. Meta Tags (fast, high specificity)
3. DOM Signatures (reliable, requires page load)
4. Script/Asset fingerprints (comprehensive)
5. API probing (most accurate, slowest)

---

## URL Pattern Matching

### Implementation

```typescript
/**
 * Primary URL-based ATS detection
 * Executes first - no DOM access required
 */
export function detectATSFromURL(url: string): ATSDetectionResult {
  const normalizedUrl = url.toLowerCase();
  
  const patterns: Array<{
    ats: ATSType;
    patterns: RegExp[];
    confidence: number;
  }> = [
    // Greenhouse - highest confidence for direct domains
    {
      ats: 'greenhouse',
      patterns: [
        /boards\.greenhouse\.io\/[\w-]+/i,
        /job-boards\.greenhouse\.io/i,
        /grnh\.se\//i,
        /\?gh_jid=\d+/i,
        /greenhouse\.io\/embed\/job_board/i,
      ],
      confidence: 95,
    },
    // Lever
    {
      ats: 'lever',
      patterns: [
        /jobs\.lever\.co\/[\w-]+/i,
        /apply\.lever\.co/i,
        /lever\.co\/[\w-]+\/[\w-]+/i,
      ],
      confidence: 95,
    },
    // Ashby
    {
      ats: 'ashby',
      patterns: [
        /jobs\.ashbyhq\.com\/[\w-]+/i,
        /[\w-]+\.ashbyhq\.com/i,
        /app\.ashbyhq\.com/i,
      ],
      confidence: 95,
    },
    // Workday - complex patterns
    {
      ats: 'workday',
      patterns: [
        /[\w-]+\.wd\d+\.myworkdayjobs\.com/i,
        /[\w-]+\.myworkdayjobs\.com/i,
        /workdayjobs\.com\/[\w-]+/i,
      ],
      confidence: 95,
    },
    // Jobvite
    {
      ats: 'jobvite',
      patterns: [
        /jobs\.jobvite\.com\/[\w-]+/i,
        /[\w-]+\.jobvite\.com\/apply/i,
        /hire\.jobvite\.com/i,
      ],
      confidence: 95,
    },
    // iCIMS
    {
      ats: 'icims',
      patterns: [
        /careers-[\w-]+\.icims\.com/i,
        /[\w-]+\.icims\.com\/jobs/i,
        /icims\.com\/[\w-]+\/jobs/i,
      ],
      confidence: 95,
    },
    // Taleo
    {
      ats: 'taleo',
      patterns: [
        /[\w-]+\.taleo\.net/i,
        /taleo\.com\/careersection/i,
        /recruiter\.taleo/i,
      ],
      confidence: 95,
    },
    // SmartRecruiters
    {
      ats: 'smartrecruiters',
      patterns: [
        /jobs\.smartrecruiters\.com\/[\w-]+/i,
        /careers\.smartrecruiters\.com/i,
        /[\w-]+\.smartrecruiters\.com/i,
      ],
      confidence: 95,
    },
    // BambooHR
    {
      ats: 'bamboohr',
      patterns: [
        /[\w-]+\.bamboohr\.com\/careers/i,
        /[\w-]+\.bamboohr\.com\/jobs/i,
      ],
      confidence: 95,
    },
    // BreezyHR
    {
      ats: 'breezyhr',
      patterns: [
        /[\w-]+\.breezy\.hr/i,
        /app\.breezy\.hr/i,
      ],
      confidence: 95,
    },
    // JazzHR
    {
      ats: 'jazzhr',
      patterns: [
        /[\w-]+\.applytojob\.com/i,
        /app\.jazz\.co/i,
        /[\w-]+\.jazz\.co/i,
      ],
      confidence: 95,
    },
    // Recruitee
    {
      ats: 'recruitee',
      patterns: [
        /[\w-]+\.recruitee\.com/i,
        /careers\.recruitee\.com/i,
      ],
      confidence: 95,
    },
  ];
  
  for (const { ats, patterns: regexes, confidence } of patterns) {
    for (const regex of regexes) {
      if (regex.test(normalizedUrl)) {
        return {
          atsType: ats,
          confidence,
          method: 'url',
          signals: [`URL matches ${regex.source}`],
        };
      }
    }
  }
  
  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'url',
    signals: ['No URL pattern matched'],
  };
}
```

### URL Pattern Reference Table

| ATS | Primary Domain | Secondary Patterns |
|-----|----------------|-------------------|
| Greenhouse | `boards.greenhouse.io` | `grnh.se`, `?gh_jid=` |
| Lever | `jobs.lever.co` | `apply.lever.co` |
| Ashby | `jobs.ashbyhq.com` | `*.ashbyhq.com` |
| Workday | `*.wd{1-5}.myworkdayjobs.com` | `*.myworkdayjobs.com` |
| Jobvite | `jobs.jobvite.com` | `hire.jobvite.com` |
| iCIMS | `careers-*.icims.com` | `*.icims.com/jobs` |
| Taleo | `*.taleo.net` | `taleo.com/careersection` |
| SmartRecruiters | `jobs.smartrecruiters.com` | `careers.smartrecruiters.com` |
| BambooHR | `*.bamboohr.com/careers` | `*.bamboohr.com/jobs` |

---

## DOM Fingerprinting

### Implementation

```typescript
/**
 * DOM-based ATS detection
 * Requires page to be loaded in browser context
 */
export async function detectATSFromDOM(document: Document): Promise<ATSDetectionResult> {
  const detectors: Array<{
    ats: ATSType;
    detect: () => { found: boolean; signals: string[] };
    confidence: number;
  }> = [
    {
      ats: 'greenhouse',
      detect: () => detectGreenhouseDOM(document),
      confidence: 90,
    },
    {
      ats: 'lever',
      detect: () => detectLeverDOM(document),
      confidence: 90,
    },
    {
      ats: 'ashby',
      detect: () => detectAshbyDOM(document),
      confidence: 90,
    },
    {
      ats: 'workday',
      detect: () => detectWorkdayDOM(document),
      confidence: 90,
    },
    {
      ats: 'jobvite',
      detect: () => detectJobviteDOM(document),
      confidence: 90,
    },
    {
      ats: 'icims',
      detect: () => detectICIMSDOM(document),
      confidence: 90,
    },
    {
      ats: 'taleo',
      detect: () => detectTaleoDOM(document),
      confidence: 90,
    },
  ];
  
  for (const { ats, detect, confidence } of detectors) {
    const result = detect();
    if (result.found) {
      return {
        atsType: ats,
        confidence,
        method: 'dom',
        signals: result.signals,
      };
    }
  }
  
  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'dom',
    signals: ['No DOM signature matched'],
  };
}

// Individual DOM detectors

function detectGreenhouseDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  // Primary selectors
  if (doc.querySelector('#application-form')) {
    signals.push('Found #application-form');
  }
  if (doc.querySelector('[data-greenhouse]')) {
    signals.push('Found [data-greenhouse] attribute');
  }
  if (doc.querySelector('.greenhouse-form')) {
    signals.push('Found .greenhouse-form class');
  }
  if (doc.querySelector('#greenhouse-jobboard')) {
    signals.push('Found #greenhouse-jobboard');
  }
  if (doc.querySelector('input[name*="job_application"]')) {
    signals.push('Found job_application input pattern');
  }
  
  // Data attributes
  const dataJobId = doc.querySelector('[data-job-id]');
  const dataToken = doc.querySelector('[data-token]');
  if (dataJobId) signals.push('Found [data-job-id]');
  if (dataToken) signals.push('Found [data-token]');
  
  return { found: signals.length >= 2, signals };
}

function detectLeverDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  if (doc.querySelector('.application-form')) {
    signals.push('Found .application-form');
  }
  if (doc.querySelector('.lever-form')) {
    signals.push('Found .lever-form class');
  }
  if (doc.querySelector('[data-lever]')) {
    signals.push('Found [data-lever] attribute');
  }
  if (doc.querySelector('.lever-application')) {
    signals.push('Found .lever-application');
  }
  if (doc.querySelector('.posting-application')) {
    signals.push('Found .posting-application');
  }
  if (doc.querySelector('form[action*="lever"]')) {
    signals.push('Found form with lever action');
  }
  if (doc.querySelector('[data-posting-id]')) {
    signals.push('Found [data-posting-id]');
  }
  
  return { found: signals.length >= 2, signals };
}

function detectAshbyDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  if (doc.querySelector('.ashby-application-form')) {
    signals.push('Found .ashby-application-form');
  }
  if (doc.querySelector('[data-ashby]')) {
    signals.push('Found [data-ashby] attribute');
  }
  if (doc.querySelector('.ashby-job-posting')) {
    signals.push('Found .ashby-job-posting');
  }
  if (doc.querySelector('#ashby-embed')) {
    signals.push('Found #ashby-embed');
  }
  if (doc.querySelector('form[data-form-type="application"]')) {
    signals.push('Found application form type');
  }
  if (doc.querySelector('[data-job-posting-id]')) {
    signals.push('Found [data-job-posting-id]');
  }
  if (doc.querySelector('[data-ashby-job-posting-id]')) {
    signals.push('Found [data-ashby-job-posting-id]');
  }
  
  // Ashby system field pattern
  if (doc.querySelector('input[name*="_systemfield_"]')) {
    signals.push('Found _systemfield_ input pattern');
  }
  
  return { found: signals.length >= 2, signals };
}

function detectWorkdayDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  // Workday uses data-automation-id extensively
  if (doc.querySelector('[data-automation-id]')) {
    signals.push('Found [data-automation-id] attributes');
  }
  if (doc.querySelector('.WGDC')) {
    signals.push('Found .WGDC class');
  }
  if (doc.querySelector('.WPF')) {
    signals.push('Found .WPF class');
  }
  if (doc.querySelector('[data-automation-id="jobPostingPage"]')) {
    signals.push('Found jobPostingPage automation id');
  }
  if (doc.querySelector('[data-automation-id="applyButton"]')) {
    signals.push('Found applyButton automation id');
  }
  if (doc.querySelector('[data-uxi-widget-type]')) {
    signals.push('Found Workday UXI widget');
  }
  
  // Workday-specific form elements
  if (doc.querySelector('[data-automation-id="legalNameSection_firstName"]')) {
    signals.push('Found Workday firstName field');
  }
  
  return { found: signals.length >= 2, signals };
}

function detectJobviteDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  if (doc.querySelector('#jv-application-form')) {
    signals.push('Found #jv-application-form');
  }
  if (doc.querySelector('.jv-page-body')) {
    signals.push('Found .jv-page-body');
  }
  if (doc.querySelector('.jv-header')) {
    signals.push('Found .jv-header');
  }
  if (doc.querySelector('[class*="jobvite"]')) {
    signals.push('Found jobvite class pattern');
  }
  if (doc.querySelector('[data-jv-app]')) {
    signals.push('Found [data-jv-app]');
  }
  if (doc.querySelector('[data-jv-job-id]')) {
    signals.push('Found [data-jv-job-id]');
  }
  
  // Jobvite-specific prefixes
  if (doc.querySelector('#jv-firstName')) {
    signals.push('Found jv-prefixed form fields');
  }
  
  return { found: signals.length >= 2, signals };
}

function detectICIMSDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  if (doc.querySelector('#icims_content')) {
    signals.push('Found #icims_content');
  }
  if (doc.querySelector('.iCIMS_MainWrapper')) {
    signals.push('Found .iCIMS_MainWrapper');
  }
  if (doc.querySelector('.iCIMS_JobContent')) {
    signals.push('Found .iCIMS_JobContent');
  }
  if (doc.querySelector('[class*="icims"]')) {
    signals.push('Found icims class pattern');
  }
  
  // iCIMS uses iframes heavily
  const iframes = doc.querySelectorAll('iframe');
  for (const iframe of iframes) {
    if (iframe.src?.includes('icims')) {
      signals.push('Found iCIMS iframe');
      break;
    }
  }
  
  return { found: signals.length >= 2, signals };
}

function detectTaleoDOM(doc: Document): { found: boolean; signals: string[] } {
  const signals: string[] = [];
  
  if (doc.querySelector('#requisitionDescriptionInterface')) {
    signals.push('Found #requisitionDescriptionInterface');
  }
  if (doc.querySelector('.ftlEditFormWrapper')) {
    signals.push('Found .ftlEditFormWrapper');
  }
  if (doc.querySelector('.contentTitle')) {
    signals.push('Found .contentTitle');
  }
  if (doc.querySelector('[class*="taleo"]')) {
    signals.push('Found taleo class pattern');
  }
  
  // Taleo-specific patterns
  if (doc.querySelector('input[id*="FirstName"]')) {
    signals.push('Found Taleo FirstName pattern');
  }
  
  return { found: signals.length >= 2, signals };
}
```

### DOM Signature Reference

| ATS | Primary Selectors | Secondary Selectors |
|-----|------------------|---------------------|
| Greenhouse | `#application-form`, `#application` | `[data-greenhouse]`, `.greenhouse-form` |
| Lever | `.application-form`, `.lever-form` | `[data-lever]`, `.posting-application` |
| Ashby | `.ashby-application-form` | `[data-ashby]`, `#ashby-embed` |
| Workday | `[data-automation-id]` | `.WGDC`, `.WPF`, `[data-uxi-widget-type]` |
| Jobvite | `#jv-application-form` | `.jv-page-body`, `[data-jv-app]` |
| iCIMS | `#icims_content` | `.iCIMS_MainWrapper`, `.iCIMS_JobContent` |
| Taleo | `#requisitionDescriptionInterface` | `.ftlEditFormWrapper` |

---

## Meta Tag Detection

### Implementation

```typescript
/**
 * Meta tag based ATS detection
 * Fast and reliable when meta tags are present
 */
export function detectATSFromMeta(document: Document): ATSDetectionResult {
  const signals: string[] = [];
  
  // Check generator meta tag
  const generator = document.querySelector('meta[name="generator"]');
  const generatorContent = generator?.getAttribute('content')?.toLowerCase() || '';
  
  // Check application-name
  const appName = document.querySelector('meta[name="application-name"]');
  const appNameContent = appName?.getAttribute('content')?.toLowerCase() || '';
  
  // Check og:site_name
  const siteName = document.querySelector('meta[property="og:site_name"]');
  const siteNameContent = siteName?.getAttribute('content')?.toLowerCase() || '';
  
  // Check all meta tags for ATS hints
  const allMeta = document.querySelectorAll('meta');
  const metaStrings = Array.from(allMeta).map(m => 
    `${m.getAttribute('name')} ${m.getAttribute('property')} ${m.getAttribute('content')}`
  ).join(' ').toLowerCase();
  
  // ATS-specific meta patterns
  const metaPatterns: Array<{ ats: ATSType; patterns: string[]; confidence: number }> = [
    {
      ats: 'greenhouse',
      patterns: ['greenhouse', 'grnh'],
      confidence: 85,
    },
    {
      ats: 'lever',
      patterns: ['lever'],
      confidence: 85,
    },
    {
      ats: 'ashby',
      patterns: ['ashby', 'ashbyhq'],
      confidence: 85,
    },
    {
      ats: 'workday',
      patterns: ['workday', 'myworkdayjobs'],
      confidence: 85,
    },
    {
      ats: 'jobvite',
      patterns: ['jobvite'],
      confidence: 85,
    },
    {
      ats: 'icims',
      patterns: ['icims'],
      confidence: 85,
    },
    {
      ats: 'taleo',
      patterns: ['taleo', 'oracle recruiting'],
      confidence: 85,
    },
    {
      ats: 'smartrecruiters',
      patterns: ['smartrecruiters'],
      confidence: 85,
    },
    {
      ats: 'bamboohr',
      patterns: ['bamboohr', 'bamboo hr'],
      confidence: 85,
    },
  ];
  
  for (const { ats, patterns, confidence } of metaPatterns) {
    for (const pattern of patterns) {
      if (
        generatorContent.includes(pattern) ||
        appNameContent.includes(pattern) ||
        siteNameContent.includes(pattern) ||
        metaStrings.includes(pattern)
      ) {
        signals.push(`Meta tag contains "${pattern}"`);
        return {
          atsType: ats,
          confidence,
          method: 'meta',
          signals,
        };
      }
    }
  }
  
  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'meta',
    signals: ['No ATS meta tags found'],
  };
}
```

### Common Meta Tag Patterns

```html
<!-- Greenhouse -->
<meta name="generator" content="Greenhouse Job Board">
<meta property="og:site_name" content="Greenhouse Job Board">

<!-- Lever -->
<meta name="generator" content="Lever">
<meta property="og:site_name" content="Lever">

<!-- Ashby -->
<meta name="generator" content="Ashby">

<!-- Workday -->
<meta name="application-name" content="Workday">

<!-- SmartRecruiters -->
<meta name="generator" content="SmartRecruiters">
```

---

## Script/Asset Fingerprinting

### Implementation

```typescript
/**
 * Script and asset fingerprinting for ATS detection
 * Most comprehensive but slowest method
 */
export function detectATSFromScripts(document: Document): ATSDetectionResult {
  const signals: string[] = [];
  
  // Collect all script sources
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  const scriptSrcs = scripts.map(s => s.getAttribute('src') || '').join(' ').toLowerCase();
  
  // Collect all stylesheet links
  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  const styleSrcs = stylesheets.map(s => s.getAttribute('href') || '').join(' ').toLowerCase();
  
  // Collect inline scripts content
  const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'));
  const inlineContent = inlineScripts.map(s => s.textContent || '').join(' ').toLowerCase();
  
  const allAssets = `${scriptSrcs} ${styleSrcs} ${inlineContent}`;
  
  const assetPatterns: Array<{ ats: ATSType; patterns: string[]; confidence: number }> = [
    {
      ats: 'greenhouse',
      patterns: [
        'boards.greenhouse.io',
        'greenhouse-assets',
        'greenhouse_embed',
        'greenhouse_jobs',
        'ghJobBoard',
      ],
      confidence: 88,
    },
    {
      ats: 'lever',
      patterns: [
        'lever-analytics',
        'lever.co/embed',
        'lever_jobs',
        'LeverApplication',
        'postings.lever.co',
      ],
      confidence: 88,
    },
    {
      ats: 'ashby',
      patterns: [
        'ashbyhq.com',
        'ashby-embed',
        'ashby-application',
        'AshbyApplication',
      ],
      confidence: 88,
    },
    {
      ats: 'workday',
      patterns: [
        'myworkdayjobs',
        'wd-resources',
        'workday-cdn',
        'wday/cxs',
        'WDAY_APPLICATION',
      ],
      confidence: 88,
    },
    {
      ats: 'jobvite',
      patterns: [
        'jobs.jobvite.com',
        'jobvite-assets',
        'jv-assets',
        'JobviteClient',
      ],
      confidence: 88,
    },
    {
      ats: 'icims',
      patterns: [
        'icims.com',
        'icims-assets',
        'iCIMS_',
      ],
      confidence: 88,
    },
    {
      ats: 'taleo',
      patterns: [
        'taleo.net',
        'taleo-assets',
        'OracleRecruiting',
      ],
      confidence: 88,
    },
    {
      ats: 'smartrecruiters',
      patterns: [
        'smartrecruiters.com',
        'smrtr.io',
        'SmartRecruiters',
      ],
      confidence: 88,
    },
    {
      ats: 'bamboohr',
      patterns: [
        'bamboohr.com',
        'bamboo-assets',
        'BambooHR',
      ],
      confidence: 88,
    },
  ];
  
  for (const { ats, patterns, confidence } of assetPatterns) {
    for (const pattern of patterns) {
      if (allAssets.includes(pattern.toLowerCase())) {
        signals.push(`Found asset pattern: ${pattern}`);
        return {
          atsType: ats,
          confidence,
          method: 'script',
          signals,
        };
      }
    }
  }
  
  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'script',
    signals: ['No ATS script/asset patterns found'],
  };
}

/**
 * Check for ATS-specific global JavaScript variables
 */
export function detectATSFromGlobals(window: Window): ATSDetectionResult {
  const signals: string[] = [];
  
  const globalChecks: Array<{ ats: ATSType; globals: string[]; confidence: number }> = [
    {
      ats: 'greenhouse',
      globals: ['Grnhse', 'GreenhouseJobBoard', 'GH_JOB_BOARD'],
      confidence: 92,
    },
    {
      ats: 'lever',
      globals: ['Lever', 'LeverApplication', 'LEVER_JOB_POSTING'],
      confidence: 92,
    },
    {
      ats: 'ashby',
      globals: ['Ashby', 'AshbyApplication', 'ASHBY_CONFIG'],
      confidence: 92,
    },
    {
      ats: 'workday',
      globals: ['WorkdayApp', 'WDAY', 'wd_application'],
      confidence: 92,
    },
    {
      ats: 'jobvite',
      globals: ['Jobvite', 'JV_APPLICATION'],
      confidence: 92,
    },
  ];
  
  for (const { ats, globals, confidence } of globalChecks) {
    for (const global of globals) {
      if (global in window) {
        signals.push(`Found global: window.${global}`);
        return {
          atsType: ats,
          confidence,
          method: 'script',
          signals,
        };
      }
    }
  }
  
  return {
    atsType: 'unknown',
    confidence: 0,
    method: 'script',
    signals: ['No ATS globals found'],
  };
}
```

---

## Detection Functions by ATS

### Greenhouse Detection

```typescript
export function detectGreenhouse(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns (highest confidence)
  const urlPatterns = [
    /boards\.greenhouse\.io\/[\w-]+/i,
    /job-boards\.greenhouse\.io/i,
    /grnh\.se\//i,
    /\?gh_jid=\d+/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    // DOM checks
    if (document.querySelector('#application-form, #application')) {
      signals.push('Found application form element');
      confidence = Math.max(confidence, 90);
    }
    
    if (document.querySelector('[data-greenhouse]')) {
      signals.push('Found data-greenhouse attribute');
      confidence = Math.max(confidence, 92);
    }
    
    // Input pattern
    if (document.querySelector('input[name*="job_application"]')) {
      signals.push('Found job_application input');
      confidence = Math.max(confidence, 88);
    }
    
    // Script check
    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      if (script.src?.includes('greenhouse')) {
        signals.push('Found Greenhouse script');
        confidence = Math.max(confidence, 90);
      }
    }
  }
  
  return {
    atsType: confidence > 0 ? 'greenhouse' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

### Lever Detection

```typescript
export function detectLever(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns
  const urlPatterns = [
    /jobs\.lever\.co\/[\w-]+/i,
    /apply\.lever\.co/i,
    /lever\.co\/[\w-]+\/[\w-]+/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    // DOM checks
    if (document.querySelector('.application-form, .lever-form')) {
      signals.push('Found lever form element');
      confidence = Math.max(confidence, 90);
    }
    
    if (document.querySelector('[data-lever], [data-posting-id]')) {
      signals.push('Found lever data attribute');
      confidence = Math.max(confidence, 92);
    }
    
    // URLs field pattern (Lever-specific)
    if (document.querySelector('input[name*="urls["]')) {
      signals.push('Found Lever URLs field pattern');
      confidence = Math.max(confidence, 85);
    }
  }
  
  return {
    atsType: confidence > 0 ? 'lever' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

### Workday Detection

```typescript
export function detectWorkday(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns - Workday has complex patterns
  const urlPatterns = [
    /[\w-]+\.wd\d+\.myworkdayjobs\.com/i,
    /[\w-]+\.myworkdayjobs\.com/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    // Workday's signature: data-automation-id attributes
    const automationIds = document.querySelectorAll('[data-automation-id]');
    if (automationIds.length > 5) {
      signals.push(`Found ${automationIds.length} data-automation-id elements`);
      confidence = Math.max(confidence, 92);
    }
    
    // Workday CSS classes
    if (document.querySelector('.WGDC, .WPF')) {
      signals.push('Found Workday CSS classes');
      confidence = Math.max(confidence, 88);
    }
    
    // Workday UXI widgets
    if (document.querySelector('[data-uxi-widget-type]')) {
      signals.push('Found UXI widget');
      confidence = Math.max(confidence, 90);
    }
    
    // Specific automation IDs
    const specificIds = [
      'jobPostingPage',
      'applyButton', 
      'legalNameSection_firstName',
      'jobApplicationForm',
    ];
    
    for (const id of specificIds) {
      if (document.querySelector(`[data-automation-id="${id}"]`)) {
        signals.push(`Found ${id} automation ID`);
        confidence = Math.max(confidence, 95);
        break;
      }
    }
  }
  
  return {
    atsType: confidence > 0 ? 'workday' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

### Ashby Detection

```typescript
export function detectAshby(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns
  const urlPatterns = [
    /jobs\.ashbyhq\.com\/[\w-]+/i,
    /[\w-]+\.ashbyhq\.com/i,
    /app\.ashbyhq\.com/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    // DOM checks
    if (document.querySelector('.ashby-application-form')) {
      signals.push('Found Ashby application form');
      confidence = Math.max(confidence, 92);
    }
    
    if (document.querySelector('[data-ashby], [data-ashby-job-posting-id]')) {
      signals.push('Found Ashby data attribute');
      confidence = Math.max(confidence, 90);
    }
    
    // Ashby system field pattern
    if (document.querySelector('input[name*="_systemfield_"]')) {
      signals.push('Found Ashby _systemfield_ pattern');
      confidence = Math.max(confidence, 88);
    }
    
    if (document.querySelector('#ashby-embed')) {
      signals.push('Found Ashby embed');
      confidence = Math.max(confidence, 90);
    }
  }
  
  return {
    atsType: confidence > 0 ? 'ashby' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

### iCIMS Detection

```typescript
export function detectICIMS(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns
  const urlPatterns = [
    /careers-[\w-]+\.icims\.com/i,
    /[\w-]+\.icims\.com\/jobs/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    if (document.querySelector('#icims_content')) {
      signals.push('Found #icims_content');
      confidence = Math.max(confidence, 92);
    }
    
    if (document.querySelector('.iCIMS_MainWrapper, .iCIMS_JobContent')) {
      signals.push('Found iCIMS wrapper class');
      confidence = Math.max(confidence, 90);
    }
    
    // iCIMS uses iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src?.includes('icims')) {
        signals.push('Found iCIMS iframe');
        confidence = Math.max(confidence, 88);
        break;
      }
    }
  }
  
  return {
    atsType: confidence > 0 ? 'icims' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

### Taleo Detection

```typescript
export function detectTaleo(url: string, document?: Document): ATSDetectionResult {
  const signals: string[] = [];
  let confidence = 0;
  
  // URL patterns
  const urlPatterns = [
    /[\w-]+\.taleo\.net/i,
    /taleo\.com\/careersection/i,
  ];
  
  for (const pattern of urlPatterns) {
    if (pattern.test(url)) {
      signals.push(`URL matches: ${pattern.source}`);
      confidence = Math.max(confidence, 95);
    }
  }
  
  if (document) {
    if (document.querySelector('#requisitionDescriptionInterface')) {
      signals.push('Found Taleo requisition interface');
      confidence = Math.max(confidence, 92);
    }
    
    if (document.querySelector('.ftlEditFormWrapper')) {
      signals.push('Found Taleo form wrapper');
      confidence = Math.max(confidence, 88);
    }
    
    // Taleo field patterns
    if (document.querySelector('input[id*="FirstName"], input[name*="FirstName"]')) {
      signals.push('Found Taleo name pattern');
      confidence = Math.max(confidence, 85);
    }
  }
  
  return {
    atsType: confidence > 0 ? 'taleo' : 'unknown',
    confidence,
    method: confidence >= 95 ? 'url' : 'dom',
    signals,
  };
}
```

---

## Confidence Scoring

### Scoring System

```typescript
interface ConfidenceWeights {
  urlMatch: 95;       // Direct URL pattern match
  dataAttribute: 92;  // ATS-specific data attributes
  domSelector: 90;    // Primary DOM selectors
  scriptAsset: 88;    // Script/CSS asset patterns
  metaTag: 85;        // Meta tag detection
  inputPattern: 80;   // Input name patterns
  globalVariable: 92; // Window globals
}

/**
 * Combined detection with confidence scoring
 */
export async function detectATSWithConfidence(
  url: string,
  document?: Document,
  window?: Window
): Promise<ATSDetectionResult> {
  const results: ATSDetectionResult[] = [];
  
  // 1. URL detection (always runs first)
  const urlResult = detectATSFromURL(url);
  if (urlResult.confidence >= 95) {
    return urlResult; // High confidence, return early
  }
  results.push(urlResult);
  
  if (document) {
    // 2. Meta tag detection
    const metaResult = detectATSFromMeta(document);
    if (metaResult.confidence >= 85) {
      results.push(metaResult);
    }
    
    // 3. DOM fingerprinting
    const domResult = await detectATSFromDOM(document);
    if (domResult.confidence >= 90) {
      results.push(domResult);
    }
    
    // 4. Script/asset fingerprinting
    const scriptResult = detectATSFromScripts(document);
    if (scriptResult.confidence >= 88) {
      results.push(scriptResult);
    }
  }
  
  if (window) {
    // 5. Global variable detection
    const globalResult = detectATSFromGlobals(window);
    if (globalResult.confidence >= 92) {
      results.push(globalResult);
    }
  }
  
  // Aggregate results
  if (results.length === 0) {
    return {
      atsType: 'unknown',
      confidence: 0,
      method: 'url',
      signals: ['No detection methods succeeded'],
    };
  }
  
  // Find highest confidence result
  const best = results.reduce((a, b) => a.confidence > b.confidence ? a : b);
  
  // Boost confidence if multiple methods agree
  const agreeing = results.filter(r => r.atsType === best.atsType);
  if (agreeing.length > 1) {
    best.confidence = Math.min(99, best.confidence + (agreeing.length - 1) * 3);
    best.signals.push(`${agreeing.length} detection methods agree`);
  }
  
  return best;
}
```

### Confidence Thresholds

| Confidence | Action |
|------------|--------|
| 95-100 | High confidence - proceed with automation |
| 85-94 | Medium confidence - may need verification |
| 70-84 | Low confidence - suggest manual review |
| <70 | Unknown - cannot automate |

---

## Fallback Detection

### Generic Form Detection

```typescript
/**
 * Fallback detection for unknown ATS systems
 * Uses heuristics to identify job application forms
 */
export function detectGenericApplicationForm(document: Document): {
  isApplicationForm: boolean;
  confidence: number;
  formElement: HTMLFormElement | null;
  fieldTypes: string[];
} {
  const forms = document.querySelectorAll('form');
  
  for (const form of forms) {
    const inputs = form.querySelectorAll('input, select, textarea');
    const fieldTypes: string[] = [];
    let score = 0;
    
    for (const input of inputs) {
      const name = (input.getAttribute('name') || '').toLowerCase();
      const type = input.getAttribute('type') || 'text';
      const label = input.getAttribute('aria-label') || '';
      const placeholder = input.getAttribute('placeholder') || '';
      const combined = `${name} ${type} ${label} ${placeholder}`.toLowerCase();
      
      // Score based on field types
      if (combined.includes('name') || combined.includes('first') || combined.includes('last')) {
        score += 10;
        fieldTypes.push('name');
      }
      if (combined.includes('email') || type === 'email') {
        score += 15;
        fieldTypes.push('email');
      }
      if (combined.includes('phone') || combined.includes('tel') || type === 'tel') {
        score += 10;
        fieldTypes.push('phone');
      }
      if (combined.includes('resume') || combined.includes('cv') || type === 'file') {
        score += 20;
        fieldTypes.push('resume');
      }
      if (combined.includes('linkedin')) {
        score += 8;
        fieldTypes.push('linkedin');
      }
      if (combined.includes('cover') && combined.includes('letter')) {
        score += 10;
        fieldTypes.push('coverLetter');
      }
      if (combined.includes('work') && combined.includes('auth')) {
        score += 12;
        fieldTypes.push('workAuth');
      }
      if (combined.includes('sponsor')) {
        score += 12;
        fieldTypes.push('sponsorship');
      }
    }
    
    // Check for submit button text
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    const submitText = (submitBtn?.textContent || submitBtn?.getAttribute('value') || '').toLowerCase();
    
    if (submitText.includes('apply') || submitText.includes('submit')) {
      score += 15;
    }
    
    // Minimum threshold for job application
    if (score >= 45 && fieldTypes.includes('email') && fieldTypes.includes('resume')) {
      return {
        isApplicationForm: true,
        confidence: Math.min(score, 80), // Cap at 80 for unknown ATS
        formElement: form as HTMLFormElement,
        fieldTypes: [...new Set(fieldTypes)],
      };
    }
  }
  
  return {
    isApplicationForm: false,
    confidence: 0,
    formElement: null,
    fieldTypes: [],
  };
}
```

### API Probing

```typescript
/**
 * Probe known ATS API endpoints to verify detection
 */
export async function probeATSAPI(atsType: ATSType, identifier: string): Promise<boolean> {
  const endpoints: Record<ATSType, (id: string) => string> = {
    greenhouse: (id) => `https://boards-api.greenhouse.io/v1/boards/${id}/jobs`,
    lever: (id) => `https://api.lever.co/v0/postings/${id}`,
    ashby: (id) => `https://api.ashbyhq.com/posting-api/job-board/${id}/jobs`,
    smartrecruiters: (id) => `https://api.smartrecruiters.com/v1/companies/${id}/postings`,
    // Others require auth or don't have public APIs
    workday: () => '',
    jobvite: () => '',
    icims: () => '',
    taleo: () => '',
    bamboohr: (id) => `https://${id}.bamboohr.com/careers/list`,
    unknown: () => '',
  };
  
  const getEndpoint = endpoints[atsType];
  if (!getEndpoint) return false;
  
  const endpoint = getEndpoint(identifier);
  if (!endpoint) return false;
  
  try {
    const response = await fetch(endpoint, {
      method: 'HEAD',
      headers: { 'Accept': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

---

## Integration with ats-registry.ts

### Using with Existing Registry

```typescript
import { 
  ATS_REGISTRY, 
  ATSType, 
  detectATSFromURL as registryDetect 
} from '@/lib/ats-registry';

/**
 * Enhanced detection combining new detection methods with registry
 */
export async function detectAndGetConfig(
  url: string,
  document?: Document
): Promise<{
  detection: ATSDetectionResult;
  config: ATSConfig | null;
}> {
  // Use multi-method detection
  const detection = await detectATSWithConfidence(url, document);
  
  // Get config from registry
  const config = detection.atsType !== 'unknown' 
    ? ATS_REGISTRY[detection.atsType] 
    : null;
  
  return { detection, config };
}

/**
 * Get field mapping based on detection
 */
export function getFieldsForDetectedATS(
  detection: ATSDetectionResult
): ATSFieldMapping[] {
  if (detection.atsType === 'unknown') {
    return [];
  }
  
  return ATS_REGISTRY[detection.atsType].fieldMappings;
}

/**
 * Validate detection against expected URL patterns
 */
export function validateDetection(
  detection: ATSDetectionResult,
  url: string
): boolean {
  if (detection.atsType === 'unknown') {
    return false;
  }
  
  const config = ATS_REGISTRY[detection.atsType];
  
  // Check if URL matches any expected pattern
  return config.urlPatterns.some(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(url);
  });
}
```

### Browser Extension Integration

```typescript
/**
 * Content script for browser extension
 * Runs in page context to detect ATS
 */
async function detectCurrentPageATS(): Promise<ATSDetectionResult> {
  const url = window.location.href;
  
  // Full detection with all methods
  return detectATSWithConfidence(url, document, window);
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectATS') {
    detectCurrentPageATS().then(result => {
      sendResponse(result);
    });
    return true; // Async response
  }
});
```

### Playwright/Puppeteer Integration

```typescript
import { Page } from 'playwright';

/**
 * Detect ATS from a Playwright page
 */
export async function detectATSFromPage(page: Page): Promise<ATSDetectionResult> {
  const url = page.url();
  
  // Run URL detection first
  const urlResult = detectATSFromURL(url);
  if (urlResult.confidence >= 95) {
    return urlResult;
  }
  
  // Run DOM detection in page context
  const domResult = await page.evaluate(() => {
    // This code runs in browser context
    // Include detection functions here or inject them
    const signals: string[] = [];
    
    // Greenhouse
    if (document.querySelector('#application-form, [data-greenhouse]')) {
      return { atsType: 'greenhouse', confidence: 90, method: 'dom', signals: ['DOM match'] };
    }
    // Lever
    if (document.querySelector('.lever-form, [data-lever]')) {
      return { atsType: 'lever', confidence: 90, method: 'dom', signals: ['DOM match'] };
    }
    // ... other detectors
    
    return { atsType: 'unknown', confidence: 0, method: 'dom', signals: [] };
  });
  
  // Return best result
  return domResult.confidence > urlResult.confidence ? domResult : urlResult;
}
```

---

## Quick Reference

### Detection Method Priority

1. **URL Pattern** - Instant, 95%+ accuracy
2. **Data Attributes** - Fast, 92% accuracy  
3. **DOM Selectors** - Reliable, 90% accuracy
4. **Script/Assets** - Comprehensive, 88% accuracy
5. **Meta Tags** - Fast, 85% accuracy
6. **API Probing** - Definitive, but slow

### ATS Automation Difficulty

| ATS | Difficulty | Notes |
|-----|------------|-------|
| Lever | 2/5 | Simple forms, public API |
| Greenhouse | 2/5 | Predictable structure, good API |
| Ashby | 2/5 | Modern React, GraphQL API |
| BambooHR | 2/5 | Simple HTML forms |
| SmartRecruiters | 3/5 | React SPA, REST API |
| Jobvite | 3/5 | jQuery forms, moderate complexity |
| iCIMS | 4/5 | Iframes, session management |
| Workday | 5/5 | Complex SPA, multi-step wizard |
| Taleo | 5/5 | Legacy system, server-side rendering |

### Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| Custom domain hiding ATS | Use DOM/script detection |
| Embedded iframe | Access iframe document |
| React hydration delay | Wait for data attributes |
| CORS on API probe | Use server-side proxy |
| Multi-step forms | Detect on each page |
