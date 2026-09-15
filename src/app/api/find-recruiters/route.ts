import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key')
);

interface RecruiterInfo {
  name: string;
  title?: string;
  email?: string;
  emails?: { email: string; valid: boolean; confidence: number }[];
  linkedin_url?: string;
  source: string;
  confidence: number;
}

// Response shape from AI-generated recruiter data
interface AIRecruiterResponse {
  name: string;
  title?: string;
  linkedin?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { companySlug, companyName, jobId } = await request.json();

    if (!companySlug || !companyName) {
      return NextResponse.json({ error: 'Company info required' }, { status: 400 });
    }

    const recruiters: RecruiterInfo[] = [];

    // Method 1: Use AI to find recruiters
    const aiRecruiters = await findRecruitersWithAI(companyName);
    recruiters.push(...aiRecruiters);

    // Method 2: Search web for recruiter info
    const webRecruiters = await searchWebForRecruiters(companyName);
    recruiters.push(...webRecruiters);

    // Method 3: Verify recruiters have LinkedIn (required for confidence)
    // Only generate emails for recruiters with verified LinkedIn profiles
    const verifiedRecruiters = recruiters.filter(r => {
      // Must have LinkedIn URL to be confident this is the right person
      if (!r.linkedin_url) {
        console.log(`Skipping ${r.name} - no LinkedIn URL to verify identity`);
        return false;
      }
      // Must have recruiter-related title
      const recruiterTitles = ['recruiter', 'talent', 'hiring', 'hr', 'people', 'acquisition'];
      const title = r.title;
      const hasRecruiterTitle = title && recruiterTitles.some(t =>
        title.toLowerCase().includes(t)
      );
      if (!hasRecruiterTitle) {
        console.log(`Skipping ${r.name} - title "${r.title}" doesn't appear to be recruiting-related`);
        return false;
      }
      return true;
    });

    // Method 4: Find real emails using external services (best accuracy)
    const domain = await guessCompanyDomain(companyName);

    for (const r of verifiedRecruiters) {
      if (!r.name) continue;

      const nameParts = r.name.split(' ').filter(Boolean);
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];

      r.emails = [];

      // Try external services in order of reliability

      // 1. Apollo.io - best for B2B, uses LinkedIn data (free tier)
      const apolloResult = await findEmailWithApollo(r.name, companyName, r.linkedin_url);
      if (apolloResult) {
        r.emails.push({ email: apolloResult.email, confidence: apolloResult.confidence, valid: true });
        r.email = apolloResult.email;
        console.log(`Found verified email via Apollo: ${apolloResult.email}`);
        continue; // Got verified email, no need to try others
      }

      // 2. RocketReach - good LinkedIn integration
      const rrResult = await findEmailWithRocketReach(r.name, companyName, r.linkedin_url);
      if (rrResult) {
        r.emails.push({ email: rrResult.email, confidence: rrResult.confidence, valid: true });
        r.email = rrResult.email;
        console.log(`Found verified email via RocketReach: ${rrResult.email}`);
        continue;
      }

      // 3. Hunter.io Email Finder (25 free/month)
      if (domain) {
        const hunterResult = await findEmailWithHunter(firstName, lastName, domain);
        if (hunterResult) {
          r.emails.push({ email: hunterResult.email, confidence: hunterResult.confidence, valid: true });
          r.email = hunterResult.email;
          console.log(`Found email via Hunter: ${hunterResult.email}`);
          continue;
        }
      }

      // 4. Snov.io (50 free/month)
      if (domain) {
        const snovResult = await findEmailWithSnov(firstName, lastName, domain);
        if (snovResult) {
          r.emails.push({ email: snovResult.email, confidence: snovResult.confidence, valid: true });
          r.email = snovResult.email;
          console.log(`Found email via Snov: ${snovResult.email}`);
          continue;
        }
      }

      // 5. Fallback: Generate patterns and verify (least accurate)
      if (domain) {
        console.log(`No verified email found for ${r.name}, falling back to pattern generation`);
        const allEmails = generateAllEmailPatterns(r.name, domain);
        const verifiedEmails = await verifyEmails(allEmails);
        r.emails = verifiedEmails.filter(e => e.valid);

        if (r.emails.length > 0) {
          r.email = r.emails[0].email;
        }
      }
    }

    // Replace recruiters with verified ones
    recruiters.length = 0;
    recruiters.push(...verifiedRecruiters);

    // Deduplicate by name
    const uniqueRecruiters = deduplicateRecruiters(recruiters);

    // Save to database
    const saved = await saveRecruiters(uniqueRecruiters, companySlug, jobId);

    return NextResponse.json({
      found: uniqueRecruiters.length,
      saved: saved,
      recruiters: uniqueRecruiters,
    });

  } catch (error) {
    console.error('Find recruiters error:', error);
    return NextResponse.json({ error: 'Failed to find recruiters' }, { status: 500 });
  }
}

async function findRecruitersWithAI(companyName: string): Promise<RecruiterInfo[]> {
  // DISABLED: LLMs hallucinate recruiter names + fake LinkedIn URLs. Real
  // recruiters are now sourced by the Python pipeline (recruiters/enrich.py:
  // LinkedIn X-Ray via Serper -> learned-pattern emails) and written to the
  // recruiters table, which the app reads directly. Never fabricate people.
  return [];
  // eslint-disable-next-line no-unreachable
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  try {
    const prompt = `Find recruiters, talent acquisition specialists, and hiring managers at ${companyName} who hire for software engineering roles.

For each person, provide:
- Full name (must be unique - if there are multiple people with similar names, include middle initial or full middle name)
- EXACT job title (must contain words like Recruiter, Talent, Hiring, HR, People)
- LinkedIn URL (REQUIRED - only include people whose LinkedIn you can verify)

Return ONLY a JSON array, no other text. Example format:
[
  {"name": "John A. Smith", "title": "Technical Recruiter", "linkedin": "linkedin.com/in/johnasmith-recruiter"},
  {"name": "Jane Doe", "title": "Senior Talent Acquisition Partner", "linkedin": "linkedin.com/in/janedoe-talent"}
]

CRITICAL RULES:
1. Only include people you are 100% certain are recruiters at ${companyName}
2. LinkedIn URL is REQUIRED - skip anyone without a verifiable LinkedIn
3. The LinkedIn profile MUST show they work at ${companyName} in a recruiting role
4. Do NOT guess - if unsure, return fewer results or empty array []
5. Include full names to avoid confusion with non-recruiters who share the same name

If you cannot verify any recruiters with LinkedIn profiles, return: []`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);

    return (parsed as AIRecruiterResponse[]).map((r) => ({
      name: r.name,
      title: r.title,
      linkedin_url: r.linkedin ? (r.linkedin.startsWith('http') ? r.linkedin : `https://${r.linkedin}`) : undefined,
      source: 'ai',
      confidence: 0.7,
    }));

  } catch (error) {
    console.error('AI recruiter search error:', error);
    return [];
  }
}

async function verifyLinkedInProfile(linkedinUrl: string, companyName: string): Promise<boolean> {
  // Use AI to verify the LinkedIn profile belongs to a recruiter at this company
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return true; // If no AI, assume valid

  try {
    const prompt = `I have a LinkedIn URL: ${linkedinUrl}
And a company name: ${companyName}

Based on the LinkedIn URL pattern, does this appear to be a recruiter/HR/talent acquisition person at ${companyName}?

Reply with ONLY "YES" or "NO".
- YES if the URL contains recruiter-related keywords AND company name hints
- NO if it seems unrelated or you're unsure`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        }),
      }
    );

    if (!response.ok) return true;

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
    return answer === 'YES';
  } catch {
    return true; // Assume valid on error
  }
}

async function searchWebForRecruiters(companyName: string): Promise<RecruiterInfo[]> {
  const recruiters: RecruiterInfo[] = [];

  try {
    // Use DuckDuckGo to search for recruiters
    const searchQuery = `${companyName} recruiter OR "talent acquisition" site:linkedin.com`;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];

    // DuckDuckGo's instant-answer API frequently returns an empty body for
    // these queries, which makes response.json() throw. Parse defensively.
    const raw = await response.text();
    if (!raw || !raw.trim().startsWith('{')) return [];
    let data: { RelatedTopics?: { Text?: string; FirstURL?: string }[] };
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }

    // Parse related topics for recruiter names
    const topics = data.RelatedTopics || [];
    for (const topic of topics) {
      const text = topic.Text || '';
      const firstUrl = topic.FirstURL || '';

      // Look for LinkedIn profiles
      if (firstUrl.includes('linkedin.com/in/')) {
        const nameMatch = text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
        if (nameMatch) {
          recruiters.push({
            name: nameMatch[1],
            linkedin_url: firstUrl,
            source: 'web_search',
            confidence: 0.5,
          });
        }
      }
    }

  } catch (error) {
    console.error('Web search error:', error);
  }

  return recruiters;
}

async function guessCompanyDomain(companyName: string): Promise<string | null> {
  // Common domain patterns
  const baseName = companyName.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/inc$|llc$|corp$|corporation$|company$/i, '');

  const domains = [
    `${baseName}.com`,
    `${baseName}.io`,
    `${baseName}.co`,
    `${baseName}hq.com`,
  ];

  // Try to verify domain exists
  for (const domain of domains) {
    try {
      const response = await fetch(`https://logo.clearbit.com/${domain}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return domain;
    } catch {
      continue;
    }
  }

  return domains[0]; // Default to .com
}

function generateAllEmailPatterns(name: string, domain: string): string[] {
  const parts = name.toLowerCase().split(' ').filter(Boolean);
  if (parts.length < 2) return [];

  const first = parts[0];
  const last = parts[parts.length - 1];
  const firstInitial = first[0];
  const lastInitial = last[0];

  // Generate all common email patterns
  const patterns = [
    `${first}.${last}@${domain}`,           // john.smith@company.com
    `${first}${last}@${domain}`,            // johnsmith@company.com
    `${firstInitial}${last}@${domain}`,     // jsmith@company.com
    `${first}@${domain}`,                   // john@company.com
    `${first}_${last}@${domain}`,           // john_smith@company.com
    `${first}-${last}@${domain}`,           // john-smith@company.com
    `${last}.${first}@${domain}`,           // smith.john@company.com
    `${firstInitial}.${last}@${domain}`,    // j.smith@company.com
    `${first}${lastInitial}@${domain}`,     // johns@company.com
  ];

  return [...new Set(patterns)]; // Remove duplicates
}

async function verifyEmails(emails: string[]): Promise<{ email: string; valid: boolean; confidence: number }[]> {
  const results: { email: string; valid: boolean; confidence: number }[] = [];

  for (const email of emails) {
    const result = await verifyEmail(email);
    results.push({ email, ...result });
  }

  // Sort by confidence (highest first)
  return results.sort((a, b) => b.confidence - a.confidence);
}

async function verifyEmail(email: string): Promise<{ valid: boolean; confidence: number }> {
  const domain = email.split('@')[1];
  if (!domain) return { valid: false, confidence: 0 };

  try {
    // Method 1: Check if domain has MX records (basic check)
    const mxValid = await checkMXRecords(domain);
    if (!mxValid) return { valid: false, confidence: 0 };

    // Method 2: Try Hunter.io email verification (free tier: 25/month)
    const hunterResult = await verifyWithHunter(email);
    if (hunterResult.checked) {
      return hunterResult;
    }

    // Method 3: Check common corporate email patterns
    const patternScore = getEmailPatternScore(email);

    return { valid: true, confidence: patternScore };
  } catch {
    return { valid: true, confidence: 0.3 }; // Default to valid but low confidence
  }
}

async function checkMXRecords(domain: string): Promise<boolean> {
  try {
    // Use Google DNS API to check MX records (free, no auth)
    const response = await fetch(
      `https://dns.google/resolve?name=${domain}&type=MX`,
      { signal: AbortSignal.timeout(3000) }
    );
    const data = await response.json();
    return data.Answer && data.Answer.length > 0;
  } catch {
    return true; // Assume valid if check fails
  }
}

async function verifyWithHunter(email: string): Promise<{ checked: boolean; valid: boolean; confidence: number }> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { checked: false, valid: false, confidence: 0 };

  try {
    const response = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) return { checked: false, valid: false, confidence: 0 };

    const data = await response.json();
    const result = data.data;

    if (result.status === 'valid') {
      return { checked: true, valid: true, confidence: 0.95 };
    } else if (result.status === 'invalid') {
      return { checked: true, valid: false, confidence: 0 };
    }

    return { checked: true, valid: true, confidence: 0.5 };
  } catch {
    return { checked: false, valid: false, confidence: 0 };
  }
}

// Hunter.io Email Finder - finds email from name + domain (25 free/month)
async function findEmailWithHunter(firstName: string, lastName: string, domain: string): Promise<{ email: string; confidence: number } | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data.data?.email) {
      return {
        email: data.data.email,
        confidence: data.data.score / 100, // Hunter returns 0-100
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Apollo.io - massive B2B database with verified emails (free tier available)
async function findEmailWithApollo(name: string, companyName: string, linkedinUrl?: string): Promise<{ email: string; confidence: number } | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;

  try {
    // Apollo people search
    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        name: name,
        organization_name: companyName,
        linkedin_url: linkedinUrl,
        reveal_personal_emails: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.person?.email) {
      return {
        email: data.person.email,
        confidence: data.person.email_status === 'verified' ? 0.95 : 0.7,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Snov.io - email finder with 50 free credits/month
async function findEmailWithSnov(firstName: string, lastName: string, domain: string): Promise<{ email: string; confidence: number } | null> {
  const clientId = process.env.SNOV_CLIENT_ID;
  const clientSecret = process.env.SNOV_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    // First get access token
    const tokenResponse = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) return null;
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Then find email
    const response = await fetch('https://api.snov.io/v1/get-emails-from-names', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        firstName,
        lastName,
        domain,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.data?.emails?.[0]) {
      const emailData = data.data.emails[0];
      return {
        email: emailData.email,
        confidence: emailData.emailStatus === 'valid' ? 0.95 : 0.6,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// RocketReach - another popular option (limited free tier)
async function findEmailWithRocketReach(name: string, companyName: string, linkedinUrl?: string): Promise<{ email: string; confidence: number } | null> {
  const apiKey = process.env.ROCKETREACH_API_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({
      name,
      current_employer: companyName,
    });
    if (linkedinUrl) {
      params.append('linkedin_url', linkedinUrl);
    }

    const response = await fetch(`https://api.rocketreach.co/v2/api/lookupProfile?${params}`, {
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.emails?.[0]) {
      return {
        email: data.emails[0],
        confidence: 0.9,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getEmailPatternScore(email: string): number {
  const localPart = email.split('@')[0];

  // Common corporate patterns score higher
  if (/^[a-z]+\.[a-z]+$/.test(localPart)) return 0.8;  // first.last
  if (/^[a-z][a-z]+$/.test(localPart)) return 0.6;     // firstlast or jsmith
  if (/^[a-z]\.[a-z]+$/.test(localPart)) return 0.7;   // j.smith
  if (/^[a-z]+_[a-z]+$/.test(localPart)) return 0.5;   // first_last

  return 0.4;
}

function deduplicateRecruiters(recruiters: RecruiterInfo[]): RecruiterInfo[] {
  const seen = new Map<string, RecruiterInfo>();

  for (const r of recruiters) {
    const key = r.name.toLowerCase();
    const existing = seen.get(key);

    if (!existing || r.confidence > existing.confidence) {
      seen.set(key, r);
    } else {
      // Merge info
      if (r.email && !existing.email) existing.email = r.email;
      if (r.linkedin_url && !existing.linkedin_url) existing.linkedin_url = r.linkedin_url;
      if (r.title && !existing.title) existing.title = r.title;
    }
  }

  return Array.from(seen.values());
}

async function saveRecruiters(
  recruiters: RecruiterInfo[],
  companySlug: string,
  jobId?: string
): Promise<number> {
  let saved = 0;

  for (const r of recruiters) {
    // Check if recruiter already exists
    const { data: existing } = await supabase
      .from('recruiters')
      .select('id')
      .eq('company_slug', companySlug)
      .ilike('name', r.name)
      .single();

    if (existing) continue;

    // Format email variants for storage
    const emailVariants = r.emails?.map(e => ({
      email: e.email,
      confidence: e.confidence,
      verified: e.valid,
    })) || null;

    // Insert new recruiter
    const { error } = await supabase.from('recruiters').insert({
      job_id: jobId || null,
      company_slug: companySlug,
      name: r.name,
      title: r.title || null,
      email: r.email || null,
      email_variants: emailVariants,
      linkedin_url: r.linkedin_url || null,
      source: r.source,
      verification_status: r.emails && r.emails.length > 0 ? 'valid' : 'pending',
    });

    if (!error) saved++;
  }

  return saved;
}
