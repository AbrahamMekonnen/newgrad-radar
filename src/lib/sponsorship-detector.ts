/**
 * Visa Sponsorship Detection System
 *
 * Parses job descriptions to detect visa sponsorship status.
 * Critical for international students seeking H1B sponsorship.
 */

export type SponsorshipStatus = 'sponsors' | 'no_sponsor' | 'unknown';

interface SponsorshipResult {
  status: SponsorshipStatus;
  confidence: number;
  matchedKeywords: string[];
  reasoning: string;
}

// Keywords that indicate positive sponsorship
const POSITIVE_SPONSORSHIP_PATTERNS = [
  // Direct sponsorship mentions
  /\bwill\s+sponsor\b/i,
  /\bvisa\s+sponsorship\s+(?:is\s+)?available\b/i,
  /\bvisa\s+sponsorship\s+provided\b/i,
  /\bh[- ]?1b\s+sponsorship\s+(?:is\s+)?available\b/i,
  /\bh[- ]?1b\s+visa\s+sponsorship\b/i,
  /\bsponsor(?:s|ing)?\s+(?:h[- ]?1b|work\s+visa|employment\s+visa)\b/i,
  /\bopen\s+to\s+(?:visa\s+)?sponsorship\b/i,
  /\bwilling\s+to\s+sponsor\b/i,
  /\bsponsorship\s+is\s+offered\b/i,
  /\bwe\s+(?:can|will|do)\s+sponsor\b/i,
  /\bimmigration\s+sponsorship\s+(?:is\s+)?available\b/i,
  /\beligible\s+for\s+(?:visa\s+)?sponsorship\b/i,
  /\bprovide\s+(?:visa\s+)?sponsorship\b/i,
  /\boffer\s+(?:visa\s+)?sponsorship\b/i,
  /\bsponsorship\s+opportunities?\s+available\b/i,
];

// Keywords that indicate no sponsorship
const NEGATIVE_SPONSORSHIP_PATTERNS = [
  // Direct no sponsorship
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bnot\s+(?:able\s+to\s+)?sponsor\b/i,
  /\bwill\s+not\s+sponsor\b/i,
  /\bcannot\s+sponsor\b/i,
  /\bcan(?:'t|not)\s+sponsor\b/i,
  /\bwon(?:'t|not)\s+sponsor\b/i,
  /\bdoes\s+not\s+(?:provide\s+)?sponsor(?:ship)?\b/i,
  /\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)\b/i,
  /\bunable\s+to\s+sponsor\b/i,
  /\bwithout\s+(?:visa\s+)?sponsorship\b/i,

  // Work authorization requirements (often implies no sponsorship)
  /\bmust\s+(?:be\s+)?(?:currently\s+)?(?:legally\s+)?authorized\s+to\s+work\b/i,
  /\brequire(?:s|d)?\s+(?:us\s+)?work\s+authorization\b/i,
  /\bus\s+work\s+authorization\s+(?:is\s+)?required\b/i,
  /\bwork\s+authorization\s+(?:is\s+)?required\b/i,
  /\bauthorized\s+to\s+work\s+in\s+(?:the\s+)?(?:us|u\.?s\.?|united\s+states)\s+(?:is\s+)?required\b/i,
  /\bmust\s+have\s+(?:valid\s+)?(?:us\s+)?work\s+authorization\b/i,
  /\beligible\s+to\s+work\s+(?:in\s+(?:the\s+)?(?:us|u\.?s\.?|united\s+states)\s+)?without\s+(?:visa\s+)?sponsorship\b/i,
  /\bno\s+(?:current\s+or\s+future\s+)?(?:visa\s+)?sponsorship\s+(?:is\s+)?available\b/i,
  /\bsponsorship\s+(?:for\s+)?(?:employment\s+)?visa\s+(?:is\s+)?not\s+available\b/i,

  // US citizenship/permanent resident requirements
  /\b(?:us|u\.?s\.?)\s+citizen(?:ship)?\s+(?:is\s+)?required\b/i,
  /\brequires?\s+(?:us|u\.?s\.?)\s+citizen(?:ship)?\b/i,
  /\bpermanent\s+resident\s+(?:is\s+)?required\b/i,
  /\bgreen\s+card\s+(?:holder\s+)?(?:is\s+)?required\b/i,
  /\bmust\s+be\s+(?:a\s+)?(?:us|u\.?s\.?)\s+citizen\b/i,
  /\bmust\s+be\s+(?:a\s+)?(?:permanent\s+resident|green\s+card\s+holder)\b/i,
  /\bonly\s+(?:us|u\.?s\.?)\s+citizens?\b/i,
  /\b(?:us|u\.?s\.?)\s+citizens?\s+only\b/i,

  // Security clearance (usually requires citizenship)
  /\bsecurity\s+clearance\s+required\b/i,
  /\brequire(?:s|d)?\s+(?:active\s+)?security\s+clearance\b/i,
  /\btop\s+secret\s+clearance\b/i,
  /\bts\/sci\s+clearance\b/i,
];

// Neutral/ambiguous patterns that need context
const AMBIGUOUS_PATTERNS = [
  /\bwork\s+authorization\b/i,
  /\bvisa\s+status\b/i,
  /\bimmigration\s+status\b/i,
  /\bsponsorship\b/i,
  /\bh[- ]?1b\b/i,
  /\bopt\b/i,
  /\bcpt\b/i,
];

/**
 * Detects visa sponsorship status from a job description.
 *
 * @param description - The job description text to analyze
 * @returns SponsorshipResult with status, confidence, and matched keywords
 */
export function detectSponsorship(description: string): SponsorshipResult {
  if (!description || typeof description !== 'string') {
    return {
      status: 'unknown',
      confidence: 0,
      matchedKeywords: [],
      reasoning: 'No job description provided',
    };
  }

  const positiveMatches: string[] = [];
  const negativeMatches: string[] = [];

  // Check for positive patterns
  for (const pattern of POSITIVE_SPONSORSHIP_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      positiveMatches.push(match[0]);
    }
  }

  // Check for negative patterns
  for (const pattern of NEGATIVE_SPONSORSHIP_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      negativeMatches.push(match[0]);
    }
  }

  // Determine status based on matches
  // Negative patterns take precedence (if a company says both, assume no sponsorship)
  if (negativeMatches.length > 0) {
    const confidence = Math.min(0.95, 0.7 + negativeMatches.length * 0.1);
    return {
      status: 'no_sponsor',
      confidence,
      matchedKeywords: negativeMatches,
      reasoning: `Found ${negativeMatches.length} indicator(s) that sponsorship is not available`,
    };
  }

  if (positiveMatches.length > 0) {
    const confidence = Math.min(0.95, 0.7 + positiveMatches.length * 0.1);
    return {
      status: 'sponsors',
      confidence,
      matchedKeywords: positiveMatches,
      reasoning: `Found ${positiveMatches.length} indicator(s) that sponsorship is available`,
    };
  }

  // Check for ambiguous patterns - these indicate the topic is mentioned but unclear
  const ambiguousMatches: string[] = [];
  for (const pattern of AMBIGUOUS_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      ambiguousMatches.push(match[0]);
    }
  }

  if (ambiguousMatches.length > 0) {
    return {
      status: 'unknown',
      confidence: 0.3,
      matchedKeywords: ambiguousMatches,
      reasoning: 'Sponsorship mentioned but status unclear - recommend checking with employer',
    };
  }

  return {
    status: 'unknown',
    confidence: 0.1,
    matchedKeywords: [],
    reasoning: 'No sponsorship-related keywords found in job description',
  };
}

/**
 * Batch process multiple job descriptions for sponsorship detection.
 *
 * @param jobs - Array of objects with id and description
 * @returns Map of job id to sponsorship result
 */
export function detectSponsorshipBatch(
  jobs: Array<{ id: string; description: string }>
): Map<string, SponsorshipResult> {
  const results = new Map<string, SponsorshipResult>();

  for (const job of jobs) {
    results.set(job.id, detectSponsorship(job.description));
  }

  return results;
}

/**
 * Quick check that returns just the status (for filtering).
 *
 * @param description - The job description text
 * @returns SponsorshipStatus
 */
export function getSponsorshipStatus(description: string): SponsorshipStatus {
  return detectSponsorship(description).status;
}

/**
 * Check if a job description likely sponsors visas.
 * Returns true only for 'sponsors' status.
 *
 * @param description - The job description text
 * @returns boolean
 */
export function sponsorsVisa(description: string): boolean {
  return detectSponsorship(description).status === 'sponsors';
}

/**
 * Check if a job description explicitly does NOT sponsor visas.
 * Returns true only for 'no_sponsor' status.
 *
 * @param description - The job description text
 * @returns boolean
 */
export function doesNotSponsor(description: string): boolean {
  return detectSponsorship(description).status === 'no_sponsor';
}

// Export patterns for testing
export const _testPatterns = {
  positive: POSITIVE_SPONSORSHIP_PATTERNS,
  negative: NEGATIVE_SPONSORSHIP_PATTERNS,
  ambiguous: AMBIGUOUS_PATTERNS,
};
