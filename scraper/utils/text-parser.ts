import { CompanyMatch, RoleMatch, DateExtraction } from './types';

const COMPANY_ALIASES: Record<string, string[]> = {
  'google': ['google', 'alphabet', 'googl', 'goog', 'deepmind', 'waymo', 'youtube'],
  'meta': ['meta', 'facebook', 'fb', 'instagram', 'whatsapp', 'oculus'],
  'amazon': ['amazon', 'amzn', 'aws', 'amazon web services', 'a]mazon', 'amazn'],
  'apple': ['apple', 'aapl'],
  'microsoft': ['microsoft', 'msft', 'azure', 'linkedin', 'github'],
  'netflix': ['netflix', 'nflx'],
  'uber': ['uber'],
  'lyft': ['lyft'],
  'airbnb': ['airbnb', 'abnb'],
  'stripe': ['stripe'],
  'coinbase': ['coinbase'],
  'robinhood': ['robinhood'],
  'doordash': ['doordash'],
  'snap': ['snap', 'snapchat'],
  'twitter': ['twitter', 'x corp', 'x.com'],
  'salesforce': ['salesforce', 'slack'],
  'nvidia': ['nvidia', 'nvda'],
  'palantir': ['palantir', 'pltr'],
  'databricks': ['databricks'],
  'snowflake': ['snowflake'],
  'bytedance': ['bytedance', 'tiktok', 'douyin'],
  'jane_street': ['jane street', 'janestreet', 'js'],
  'citadel': ['citadel', 'citadel securities'],
  'two_sigma': ['two sigma', 'twosigma'],
  'de_shaw': ['d.e. shaw', 'de shaw', 'deshaw'],
  'hrt': ['hudson river trading', 'hrt'],
  'jump_trading': ['jump trading', 'jump'],
  'goldman_sachs': ['goldman sachs', 'goldman', 'gs'],
  'morgan_stanley': ['morgan stanley', 'ms'],
  'jpmorgan': ['jpmorgan', 'jp morgan', 'jpm', 'chase'],
  'bloomberg': ['bloomberg'],
  'oracle': ['oracle'],
  'ibm': ['ibm'],
  'intel': ['intel'],
  'amd': ['amd'],
  'adobe': ['adobe'],
  'vmware': ['vmware'],
  'atlassian': ['atlassian', 'jira', 'confluence'],
  'shopify': ['shopify'],
  'twilio': ['twilio'],
  'square': ['square', 'block', 'cash app'],
  'dropbox': ['dropbox'],
  'zoom': ['zoom'],
  'pinterest': ['pinterest'],
  'reddit': ['reddit'],
  'discord': ['discord'],
  'spotify': ['spotify'],
  'plaid': ['plaid'],
  'roblox': ['roblox'],
  'instacart': ['instacart'],
  'grubhub': ['grubhub'],
  'opendoor': ['opendoor'],
  'zillow': ['zillow'],
  'redfin': ['redfin'],
  'cruise': ['cruise'],
  'aurora': ['aurora'],
  'rivian': ['rivian'],
  'lucid': ['lucid'],
  'tesla': ['tesla'],
  'spacex': ['spacex'],
};

const ROLE_PATTERNS: { pattern: RegExp; normalized: string; level: RoleMatch['level'] }[] = [
  { pattern: /\b(swe|software engineer|software developer|developer|engineer)\s*(intern|internship)\b/i, normalized: 'software_engineer_intern', level: 'intern' },
  { pattern: /\b(new grad|newgrad|entry.?level|junior)\s*(swe|software engineer|developer|engineer)\b/i, normalized: 'software_engineer_new_grad', level: 'new_grad' },
  { pattern: /\b(swe|software engineer|software developer)\s*(new grad|newgrad|entry|junior|ng|l3|e3|ic1|ic2)\b/i, normalized: 'software_engineer_new_grad', level: 'new_grad' },
  { pattern: /\bswe\s*[1-2]\b/i, normalized: 'software_engineer_new_grad', level: 'new_grad' },
  { pattern: /\b(senior|sr\.?|l5|l6|e5|e6|ic4|ic5)\s*(swe|software engineer|developer)\b/i, normalized: 'software_engineer_senior', level: 'senior' },
  { pattern: /\bstaff\s*(swe|software engineer|developer|engineer)\b/i, normalized: 'software_engineer_staff', level: 'staff' },
  { pattern: /\bprincipal\s*(swe|software engineer|developer|engineer)\b/i, normalized: 'software_engineer_principal', level: 'principal' },
  { pattern: /\b(swe|software engineer|software developer|software dev)\b/i, normalized: 'software_engineer', level: 'unknown' },
  { pattern: /\b(frontend|front.?end|fe)\s*(engineer|developer|dev)\b/i, normalized: 'frontend_engineer', level: 'unknown' },
  { pattern: /\b(backend|back.?end|be)\s*(engineer|developer|dev)\b/i, normalized: 'backend_engineer', level: 'unknown' },
  { pattern: /\b(fullstack|full.?stack|fs)\s*(engineer|developer|dev)\b/i, normalized: 'fullstack_engineer', level: 'unknown' },
  { pattern: /\b(ml|machine learning|ai)\s*(engineer|scientist|researcher)\b/i, normalized: 'ml_engineer', level: 'unknown' },
  { pattern: /\bdata\s*(scientist|science)\b/i, normalized: 'data_scientist', level: 'unknown' },
  { pattern: /\bdata\s*(engineer|engineering)\b/i, normalized: 'data_engineer', level: 'unknown' },
  { pattern: /\bdata\s*(analyst|analytics)\b/i, normalized: 'data_analyst', level: 'unknown' },
  { pattern: /\b(devops|sre|site reliability|platform)\s*(engineer)?\b/i, normalized: 'devops_engineer', level: 'unknown' },
  { pattern: /\b(ios|android|mobile)\s*(engineer|developer|dev)\b/i, normalized: 'mobile_engineer', level: 'unknown' },
  { pattern: /\b(pm|product manager|product management)\b/i, normalized: 'product_manager', level: 'unknown' },
  { pattern: /\b(tpm|technical program manager)\b/i, normalized: 'technical_program_manager', level: 'unknown' },
  { pattern: /\b(quant|quantitative)\s*(trader|researcher|developer|analyst)?\b/i, normalized: 'quant', level: 'unknown' },
  { pattern: /\b(ux|ui|product)\s*(designer|design)\b/i, normalized: 'ux_designer', level: 'unknown' },
  { pattern: /\b(security|infosec|cybersecurity)\s*(engineer)?\b/i, normalized: 'security_engineer', level: 'unknown' },
  { pattern: /\b(embedded|firmware)\s*(engineer|developer)?\b/i, normalized: 'embedded_engineer', level: 'unknown' },
  { pattern: /\b(systems?|infrastructure)\s*(engineer|developer)?\b/i, normalized: 'systems_engineer', level: 'unknown' },
];

const MONTH_NAMES: Record<string, number> = {
  'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
  'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
  'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8, 'october': 9, 'oct': 9,
  'november': 10, 'nov': 10, 'december': 11, 'dec': 11,
};

export function extractCompany(text: string): CompanyMatch | null {
  const lowerText = text.toLowerCase();

  for (const [normalized, aliases] of Object.entries(COMPANY_ALIASES)) {
    for (const alias of aliases) {
      const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText)) {
        return {
          name: alias,
          normalized,
          confidence: alias.length > 3 ? 0.9 : 0.7,
          aliases: aliases,
        };
      }
    }
  }

  const companyPatterns = [
    /(?:at|@|for|with|from)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)/g,
    /([A-Z][a-zA-Z0-9]+)\s+(?:interview|onsite|phone screen|oa|online assessment)/gi,
    /(?:interviewed|interviewing|worked)\s+(?:at|with|for)\s+([A-Z][a-zA-Z0-9]+)/gi,
  ];

  for (const pattern of companyPatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const companyName = match[1].trim();
      if (companyName.length >= 2 && companyName.length <= 50) {
        return {
          name: companyName,
          normalized: companyName.toLowerCase().replace(/\s+/g, '_'),
          confidence: 0.5,
          aliases: [],
        };
      }
    }
  }

  return null;
}

export function extractRole(text: string): RoleMatch | null {
  for (const { pattern, normalized, level } of ROLE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return {
        title: match[0],
        normalized,
        level,
        confidence: 0.85,
      };
    }
  }

  return null;
}

export function extractDate(text: string): DateExtraction | null {
  const now = new Date();

  const relativePatterns: { pattern: RegExp; calculate: (match: RegExpMatchArray) => Date }[] = [
    { pattern: /(\d+)\s*(?:days?)\s*ago/i, calculate: (m) => new Date(now.getTime() - parseInt(m[1]) * 86400000) },
    { pattern: /(\d+)\s*(?:weeks?)\s*ago/i, calculate: (m) => new Date(now.getTime() - parseInt(m[1]) * 604800000) },
    { pattern: /(\d+)\s*(?:months?)\s*ago/i, calculate: (m) => new Date(now.getFullYear(), now.getMonth() - parseInt(m[1]), now.getDate()) },
    { pattern: /yesterday/i, calculate: () => new Date(now.getTime() - 86400000) },
    { pattern: /today/i, calculate: () => now },
    { pattern: /last\s*week/i, calculate: () => new Date(now.getTime() - 604800000) },
    { pattern: /last\s*month/i, calculate: () => new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()) },
  ];

  for (const { pattern, calculate } of relativePatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        date: calculate(match),
        confidence: 0.8,
        original: match[0],
        type: 'relative',
      };
    }
  }

  const absolutePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i,
    /(\d{1,2})(?:st|nd|rd|th)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s*(\d{4})/i,
  ];

  for (const pattern of absolutePatterns) {
    const match = text.match(pattern);
    if (match) {
      let date: Date | null = null;

      if (/^\d/.test(match[1]) && match[3]?.length === 4) {
        date = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
      } else if (match[1]?.length === 4) {
        date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      } else {
        const monthStr = (match[1] || match[2]).toLowerCase().slice(0, 3);
        const month = MONTH_NAMES[monthStr];
        const day = parseInt(match[1]?.match(/\d+/)?.[0] || match[2]?.match(/\d+/)?.[0] || '1');
        const year = parseInt(match[3]);
        if (month !== undefined && year) {
          date = new Date(year, month, day);
        }
      }

      if (date && !isNaN(date.getTime())) {
        return {
          date,
          confidence: 0.9,
          original: match[0],
          type: 'posted_date',
        };
      }
    }
  }

  return null;
}

export function extractAllCompanies(text: string): CompanyMatch[] {
  const matches: CompanyMatch[] = [];
  const seen = new Set<string>();
  const lowerText = text.toLowerCase();

  for (const [normalized, aliases] of Object.entries(COMPANY_ALIASES)) {
    for (const alias of aliases) {
      const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText) && !seen.has(normalized)) {
        seen.add(normalized);
        matches.push({
          name: alias,
          normalized,
          confidence: alias.length > 3 ? 0.9 : 0.7,
          aliases,
        });
      }
    }
  }

  return matches;
}

export function cleanQuestionText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^Q:\s*/i, '')
    .replace(/^Question:\s*/i, '')
    .trim();
}

export function extractTags(text: string): string[] {
  const tags = new Set<string>();

  const tagPatterns = [
    { pattern: /\b(array|arrays)\b/i, tag: 'array' },
    { pattern: /\b(string|strings)\b/i, tag: 'string' },
    { pattern: /\b(hash|hashing|hashmap|hashtable)\b/i, tag: 'hash' },
    { pattern: /\b(dp|dynamic programming)\b/i, tag: 'dynamic_programming' },
    { pattern: /\b(tree|trees|bst|binary tree)\b/i, tag: 'tree' },
    { pattern: /\b(graph|graphs|dfs|bfs)\b/i, tag: 'graph' },
    { pattern: /\b(linked list|linkedlist)\b/i, tag: 'linked_list' },
    { pattern: /\b(stack|stacks)\b/i, tag: 'stack' },
    { pattern: /\b(queue|queues)\b/i, tag: 'queue' },
    { pattern: /\b(heap|heaps|priority queue)\b/i, tag: 'heap' },
    { pattern: /\b(sort|sorting)\b/i, tag: 'sorting' },
    { pattern: /\b(binary search)\b/i, tag: 'binary_search' },
    { pattern: /\b(recursion|recursive)\b/i, tag: 'recursion' },
    { pattern: /\b(backtrack|backtracking)\b/i, tag: 'backtracking' },
    { pattern: /\b(two pointer|two-pointer|sliding window)\b/i, tag: 'two_pointer' },
    { pattern: /\b(greedy)\b/i, tag: 'greedy' },
    { pattern: /\b(sql|database|query)\b/i, tag: 'sql' },
    { pattern: /\b(api|rest|restful)\b/i, tag: 'api' },
    { pattern: /\b(system design|distributed|scalability)\b/i, tag: 'system_design' },
    { pattern: /\b(oop|object oriented)\b/i, tag: 'oop' },
    { pattern: /\b(leadership|lp|behavioral)\b/i, tag: 'behavioral' },
    { pattern: /\b(star method|tell me about)\b/i, tag: 'behavioral' },
    { pattern: /\b(online assessment|oa|hackerrank|codesignal)\b/i, tag: 'oa' },
  ];

  for (const { pattern, tag } of tagPatterns) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}
