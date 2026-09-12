/**
 * Company Data Enrichment System
 *
 * Fetches company metadata from FREE sources:
 * - Wikipedia/Wikidata for public info
 * - DuckDuckGo instant answers
 * - Job description parsing
 * - Known company database
 *
 * Focus: Funding stage is most important for new grads assessing startup risk
 */

export type FundingStage =
  | 'bootstrapped'
  | 'pre-seed'
  | 'seed'
  | 'series-a'
  | 'series-b'
  | 'series-c'
  | 'series-d+'
  | 'late-stage'
  | 'public'
  | 'acquired'
  | 'unknown';

export type CompanySize =
  | '1-10'
  | '11-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1001-5000'
  | '5001-10000'
  | '10000+'
  | 'unknown';

export interface CompanyEnrichment {
  fundingStage: FundingStage;
  fundingStageConfidence: number; // 0-1
  companySize: CompanySize;
  companySizeConfidence: number;
  industry: string | null;
  foundedYear: number | null;
  headquarters: string | null;
  description: string | null;
  stockTicker: string | null;
  isPublic: boolean;
  sources: string[];
  enrichedAt: string;
}

// Well-known companies with verified data (saves API calls)
const KNOWN_COMPANIES: Record<string, Partial<CompanyEnrichment>> = {
  'google': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 1998, stockTicker: 'GOOGL', isPublic: true, headquarters: 'Mountain View, CA' },
  'meta': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 2004, stockTicker: 'META', isPublic: true, headquarters: 'Menlo Park, CA' },
  'facebook': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 2004, stockTicker: 'META', isPublic: true, headquarters: 'Menlo Park, CA' },
  'amazon': { fundingStage: 'public', companySize: '10000+', industry: 'E-commerce/Cloud', foundedYear: 1994, stockTicker: 'AMZN', isPublic: true, headquarters: 'Seattle, WA' },
  'apple': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 1976, stockTicker: 'AAPL', isPublic: true, headquarters: 'Cupertino, CA' },
  'microsoft': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 1975, stockTicker: 'MSFT', isPublic: true, headquarters: 'Redmond, WA' },
  'netflix': { fundingStage: 'public', companySize: '5001-10000', industry: 'Entertainment', foundedYear: 1997, stockTicker: 'NFLX', isPublic: true, headquarters: 'Los Gatos, CA' },
  'nvidia': { fundingStage: 'public', companySize: '10000+', industry: 'Semiconductors', foundedYear: 1993, stockTicker: 'NVDA', isPublic: true, headquarters: 'Santa Clara, CA' },
  'tesla': { fundingStage: 'public', companySize: '10000+', industry: 'Automotive/Energy', foundedYear: 2003, stockTicker: 'TSLA', isPublic: true, headquarters: 'Austin, TX' },
  'salesforce': { fundingStage: 'public', companySize: '10000+', industry: 'Enterprise Software', foundedYear: 1999, stockTicker: 'CRM', isPublic: true, headquarters: 'San Francisco, CA' },
  'stripe': { fundingStage: 'late-stage', companySize: '5001-10000', industry: 'Fintech', foundedYear: 2010, isPublic: false, headquarters: 'San Francisco, CA' },
  'openai': { fundingStage: 'late-stage', companySize: '1001-5000', industry: 'Artificial Intelligence', foundedYear: 2015, isPublic: false, headquarters: 'San Francisco, CA' },
  'anthropic': { fundingStage: 'series-c', companySize: '501-1000', industry: 'Artificial Intelligence', foundedYear: 2021, isPublic: false, headquarters: 'San Francisco, CA' },
  'databricks': { fundingStage: 'late-stage', companySize: '5001-10000', industry: 'Data/AI', foundedYear: 2013, isPublic: false, headquarters: 'San Francisco, CA' },
  'figma': { fundingStage: 'acquired', companySize: '1001-5000', industry: 'Design Software', foundedYear: 2012, isPublic: false, headquarters: 'San Francisco, CA' },
  'notion': { fundingStage: 'series-c', companySize: '501-1000', industry: 'Productivity', foundedYear: 2016, isPublic: false, headquarters: 'San Francisco, CA' },
  'discord': { fundingStage: 'late-stage', companySize: '501-1000', industry: 'Communication', foundedYear: 2015, isPublic: false, headquarters: 'San Francisco, CA' },
  'airbnb': { fundingStage: 'public', companySize: '5001-10000', industry: 'Travel', foundedYear: 2008, stockTicker: 'ABNB', isPublic: true, headquarters: 'San Francisco, CA' },
  'uber': { fundingStage: 'public', companySize: '10000+', industry: 'Transportation', foundedYear: 2009, stockTicker: 'UBER', isPublic: true, headquarters: 'San Francisco, CA' },
  'lyft': { fundingStage: 'public', companySize: '1001-5000', industry: 'Transportation', foundedYear: 2012, stockTicker: 'LYFT', isPublic: true, headquarters: 'San Francisco, CA' },
  'doordash': { fundingStage: 'public', companySize: '5001-10000', industry: 'Delivery', foundedYear: 2013, stockTicker: 'DASH', isPublic: true, headquarters: 'San Francisco, CA' },
  'coinbase': { fundingStage: 'public', companySize: '1001-5000', industry: 'Cryptocurrency', foundedYear: 2012, stockTicker: 'COIN', isPublic: true, headquarters: 'San Francisco, CA' },
  'robinhood': { fundingStage: 'public', companySize: '1001-5000', industry: 'Fintech', foundedYear: 2013, stockTicker: 'HOOD', isPublic: true, headquarters: 'Menlo Park, CA' },
  'plaid': { fundingStage: 'series-d+', companySize: '1001-5000', industry: 'Fintech', foundedYear: 2013, isPublic: false, headquarters: 'San Francisco, CA' },
  'ramp': { fundingStage: 'series-d+', companySize: '501-1000', industry: 'Fintech', foundedYear: 2019, isPublic: false, headquarters: 'New York, NY' },
  'vercel': { fundingStage: 'series-d+', companySize: '201-500', industry: 'Developer Tools', foundedYear: 2015, isPublic: false, headquarters: 'San Francisco, CA' },
  'supabase': { fundingStage: 'series-c', companySize: '51-200', industry: 'Developer Tools', foundedYear: 2020, isPublic: false, headquarters: 'San Francisco, CA' },
  'linear': { fundingStage: 'series-b', companySize: '51-200', industry: 'Developer Tools', foundedYear: 2019, isPublic: false, headquarters: 'San Francisco, CA' },
  'retool': { fundingStage: 'series-c', companySize: '201-500', industry: 'Developer Tools', foundedYear: 2017, isPublic: false, headquarters: 'San Francisco, CA' },
  'datadog': { fundingStage: 'public', companySize: '5001-10000', industry: 'Monitoring', foundedYear: 2010, stockTicker: 'DDOG', isPublic: true, headquarters: 'New York, NY' },
  'snowflake': { fundingStage: 'public', companySize: '5001-10000', industry: 'Data Cloud', foundedYear: 2012, stockTicker: 'SNOW', isPublic: true, headquarters: 'Bozeman, MT' },
  'cloudflare': { fundingStage: 'public', companySize: '1001-5000', industry: 'Security/CDN', foundedYear: 2009, stockTicker: 'NET', isPublic: true, headquarters: 'San Francisco, CA' },
  'twilio': { fundingStage: 'public', companySize: '5001-10000', industry: 'Communications', foundedYear: 2008, stockTicker: 'TWLO', isPublic: true, headquarters: 'San Francisco, CA' },
  'palantir': { fundingStage: 'public', companySize: '1001-5000', industry: 'Data Analytics', foundedYear: 2003, stockTicker: 'PLTR', isPublic: true, headquarters: 'Denver, CO' },
  'crowdstrike': { fundingStage: 'public', companySize: '5001-10000', industry: 'Cybersecurity', foundedYear: 2011, stockTicker: 'CRWD', isPublic: true, headquarters: 'Austin, TX' },
  'hashicorp': { fundingStage: 'public', companySize: '1001-5000', industry: 'Infrastructure', foundedYear: 2012, stockTicker: 'HCP', isPublic: true, headquarters: 'San Francisco, CA' },
  'mongodb': { fundingStage: 'public', companySize: '1001-5000', industry: 'Database', foundedYear: 2007, stockTicker: 'MDB', isPublic: true, headquarters: 'New York, NY' },
  'elastic': { fundingStage: 'public', companySize: '1001-5000', industry: 'Search/Analytics', foundedYear: 2012, stockTicker: 'ESTC', isPublic: true, headquarters: 'Mountain View, CA' },
  'airtable': { fundingStage: 'late-stage', companySize: '501-1000', industry: 'Productivity', foundedYear: 2012, isPublic: false, headquarters: 'San Francisco, CA' },
  'scale': { fundingStage: 'late-stage', companySize: '501-1000', industry: 'AI/Data', foundedYear: 2016, isPublic: false, headquarters: 'San Francisco, CA' },
  'anduril': { fundingStage: 'late-stage', companySize: '1001-5000', industry: 'Defense Tech', foundedYear: 2017, isPublic: false, headquarters: 'Costa Mesa, CA' },
  'flexport': { fundingStage: 'late-stage', companySize: '1001-5000', industry: 'Logistics', foundedYear: 2013, isPublic: false, headquarters: 'San Francisco, CA' },
  'ibm': { fundingStage: 'public', companySize: '10000+', industry: 'Technology', foundedYear: 1911, stockTicker: 'IBM', isPublic: true, headquarters: 'Armonk, NY' },
  'oracle': { fundingStage: 'public', companySize: '10000+', industry: 'Enterprise Software', foundedYear: 1977, stockTicker: 'ORCL', isPublic: true, headquarters: 'Austin, TX' },
  'intel': { fundingStage: 'public', companySize: '10000+', industry: 'Semiconductors', foundedYear: 1968, stockTicker: 'INTC', isPublic: true, headquarters: 'Santa Clara, CA' },
  'amd': { fundingStage: 'public', companySize: '10000+', industry: 'Semiconductors', foundedYear: 1969, stockTicker: 'AMD', isPublic: true, headquarters: 'Santa Clara, CA' },
  'cisco': { fundingStage: 'public', companySize: '10000+', industry: 'Networking', foundedYear: 1984, stockTicker: 'CSCO', isPublic: true, headquarters: 'San Jose, CA' },
  'adobe': { fundingStage: 'public', companySize: '10000+', industry: 'Software', foundedYear: 1982, stockTicker: 'ADBE', isPublic: true, headquarters: 'San Jose, CA' },
  'vmware': { fundingStage: 'acquired', companySize: '10000+', industry: 'Cloud/Virtualization', foundedYear: 1998, isPublic: false, headquarters: 'Palo Alto, CA' },
  'servicenow': { fundingStage: 'public', companySize: '10000+', industry: 'Enterprise Software', foundedYear: 2004, stockTicker: 'NOW', isPublic: true, headquarters: 'Santa Clara, CA' },
  'workday': { fundingStage: 'public', companySize: '10000+', industry: 'Enterprise Software', foundedYear: 2005, stockTicker: 'WDAY', isPublic: true, headquarters: 'Pleasanton, CA' },
  'splunk': { fundingStage: 'acquired', companySize: '5001-10000', industry: 'Data Analytics', foundedYear: 2003, isPublic: false, headquarters: 'San Francisco, CA' },
  'atlassian': { fundingStage: 'public', companySize: '5001-10000', industry: 'Developer Tools', foundedYear: 2002, stockTicker: 'TEAM', isPublic: true, headquarters: 'Sydney, Australia' },
  'spotify': { fundingStage: 'public', companySize: '5001-10000', industry: 'Entertainment', foundedYear: 2006, stockTicker: 'SPOT', isPublic: true, headquarters: 'Stockholm, Sweden' },
  'shopify': { fundingStage: 'public', companySize: '5001-10000', industry: 'E-commerce', foundedYear: 2006, stockTicker: 'SHOP', isPublic: true, headquarters: 'Ottawa, Canada' },
  'square': { fundingStage: 'public', companySize: '5001-10000', industry: 'Fintech', foundedYear: 2009, stockTicker: 'SQ', isPublic: true, headquarters: 'San Francisco, CA' },
  'block': { fundingStage: 'public', companySize: '5001-10000', industry: 'Fintech', foundedYear: 2009, stockTicker: 'SQ', isPublic: true, headquarters: 'San Francisco, CA' },
  'snap': { fundingStage: 'public', companySize: '5001-10000', industry: 'Social Media', foundedYear: 2011, stockTicker: 'SNAP', isPublic: true, headquarters: 'Santa Monica, CA' },
  'snapchat': { fundingStage: 'public', companySize: '5001-10000', industry: 'Social Media', foundedYear: 2011, stockTicker: 'SNAP', isPublic: true, headquarters: 'Santa Monica, CA' },
  'pinterest': { fundingStage: 'public', companySize: '1001-5000', industry: 'Social Media', foundedYear: 2009, stockTicker: 'PINS', isPublic: true, headquarters: 'San Francisco, CA' },
  'twitter': { fundingStage: 'acquired', companySize: '1001-5000', industry: 'Social Media', foundedYear: 2006, isPublic: false, headquarters: 'San Francisco, CA' },
  'x': { fundingStage: 'acquired', companySize: '1001-5000', industry: 'Social Media', foundedYear: 2006, isPublic: false, headquarters: 'San Francisco, CA' },
  'dropbox': { fundingStage: 'public', companySize: '1001-5000', industry: 'Cloud Storage', foundedYear: 2007, stockTicker: 'DBX', isPublic: true, headquarters: 'San Francisco, CA' },
  'zoom': { fundingStage: 'public', companySize: '5001-10000', industry: 'Communications', foundedYear: 2011, stockTicker: 'ZM', isPublic: true, headquarters: 'San Jose, CA' },
  'slack': { fundingStage: 'acquired', companySize: '1001-5000', industry: 'Communications', foundedYear: 2009, isPublic: false, headquarters: 'San Francisco, CA' },
  'instacart': { fundingStage: 'public', companySize: '1001-5000', industry: 'Delivery', foundedYear: 2012, stockTicker: 'CART', isPublic: true, headquarters: 'San Francisco, CA' },
  'reddit': { fundingStage: 'public', companySize: '1001-5000', industry: 'Social Media', foundedYear: 2005, stockTicker: 'RDDT', isPublic: true, headquarters: 'San Francisco, CA' },
};

/**
 * Main enrichment function - orchestrates all data sources
 */
export async function enrichCompany(
  companyName: string,
  jobDescription?: string
): Promise<CompanyEnrichment> {
  const normalizedName = normalizeCompanyName(companyName);
  const sources: string[] = [];

  // Start with default values
  let result: CompanyEnrichment = {
    fundingStage: 'unknown',
    fundingStageConfidence: 0,
    companySize: 'unknown',
    companySizeConfidence: 0,
    industry: null,
    foundedYear: null,
    headquarters: null,
    description: null,
    stockTicker: null,
    isPublic: false,
    sources: [],
    enrichedAt: new Date().toISOString(),
  };

  // 1. Check known companies first (fastest)
  const known = KNOWN_COMPANIES[normalizedName];
  if (known) {
    result = { ...result, ...known, sources: ['known-database'] };
    result.fundingStageConfidence = 1;
    result.companySizeConfidence = 0.9;
    return result;
  }

  // 2. Parse job description if provided
  if (jobDescription) {
    const jobParsed = parseJobDescription(jobDescription);
    if (jobParsed.fundingStage !== 'unknown') {
      result.fundingStage = jobParsed.fundingStage;
      result.fundingStageConfidence = Math.max(result.fundingStageConfidence, jobParsed.confidence);
      sources.push('job-description');
    }
    if (jobParsed.companySize !== 'unknown') {
      result.companySize = jobParsed.companySize;
      result.companySizeConfidence = Math.max(result.companySizeConfidence, jobParsed.sizeConfidence);
    }
    if (jobParsed.industry) {
      result.industry = jobParsed.industry;
    }
  }

  // 3. Try Wikidata for structured data
  try {
    const wikidataResult = await fetchWikidataInfo(companyName);
    if (wikidataResult) {
      if (wikidataResult.foundedYear && !result.foundedYear) {
        result.foundedYear = wikidataResult.foundedYear;
      }
      if (wikidataResult.stockTicker) {
        result.stockTicker = wikidataResult.stockTicker;
        result.isPublic = true;
        result.fundingStage = 'public';
        result.fundingStageConfidence = 1;
      }
      if (wikidataResult.industry && !result.industry) {
        result.industry = wikidataResult.industry;
      }
      if (wikidataResult.headquarters && !result.headquarters) {
        result.headquarters = wikidataResult.headquarters;
      }
      if (wikidataResult.employeeCount) {
        result.companySize = employeeCountToSize(wikidataResult.employeeCount);
        result.companySizeConfidence = 0.8;
      }
      sources.push('wikidata');
    }
  } catch (e) {
    console.error('Wikidata fetch error:', e);
  }

  // 4. Try DuckDuckGo instant answers for description
  try {
    const ddgResult = await fetchDuckDuckGoInfo(companyName);
    if (ddgResult) {
      if (ddgResult.description && !result.description) {
        result.description = ddgResult.description;
      }
      // Parse description for funding clues
      if (ddgResult.description && result.fundingStage === 'unknown') {
        const parsed = parseDescriptionForFunding(ddgResult.description);
        if (parsed.fundingStage !== 'unknown') {
          result.fundingStage = parsed.fundingStage;
          result.fundingStageConfidence = parsed.confidence;
        }
      }
      sources.push('duckduckgo');
    }
  } catch (e) {
    console.error('DuckDuckGo fetch error:', e);
  }

  // 5. Infer from company name patterns
  const nameInference = inferFromCompanyName(companyName);
  if (nameInference.industry && !result.industry) {
    result.industry = nameInference.industry;
  }

  result.sources = sources;
  return result;
}

/**
 * Parse job description for company signals
 */
function parseJobDescription(text: string): {
  fundingStage: FundingStage;
  confidence: number;
  companySize: CompanySize;
  sizeConfidence: number;
  industry: string | null;
} {
  const lower = text.toLowerCase();
  let fundingStage: FundingStage = 'unknown';
  let confidence = 0;
  let companySize: CompanySize = 'unknown';
  let sizeConfidence = 0;
  let industry: string | null = null;

  // Funding stage patterns
  const fundingPatterns: { pattern: RegExp; stage: FundingStage; conf: number }[] = [
    { pattern: /\bipo\b|\bpublic(?:ly traded)?\b|\bnyse\b|\bnasdaq\b|\bstock (?:ticker|symbol)\b/i, stage: 'public', conf: 0.95 },
    { pattern: /\bseries\s*[e-z]\b|\blate[- ]stage\b|\bgrowth[- ]stage\b/i, stage: 'late-stage', conf: 0.85 },
    { pattern: /\bseries\s*d\b/i, stage: 'series-d+', conf: 0.9 },
    { pattern: /\bseries\s*c\b/i, stage: 'series-c', conf: 0.9 },
    { pattern: /\bseries\s*b\b/i, stage: 'series-b', conf: 0.9 },
    { pattern: /\bseries\s*a\b/i, stage: 'series-a', conf: 0.9 },
    { pattern: /\bseed[- ](?:stage|round|funded)\b|\bpre[- ]seed\b/i, stage: 'seed', conf: 0.85 },
    { pattern: /\bbootstrapped\b|\bself[- ]funded\b|\bprofitable since day\b/i, stage: 'bootstrapped', conf: 0.8 },
    { pattern: /\bacquired by\b|\bsubsidiary of\b|\bpart of\b.*\b(?:group|corporation)\b/i, stage: 'acquired', conf: 0.85 },
    { pattern: /\bwell[- ]funded\b|\bheavily[- ]funded\b|\b\$\d+[mb]\s*(?:raised|funding)\b/i, stage: 'late-stage', conf: 0.6 },
    { pattern: /\bearly[- ]stage\b|\bstartup\b/i, stage: 'seed', conf: 0.5 },
  ];

  for (const { pattern, stage, conf } of fundingPatterns) {
    if (pattern.test(lower)) {
      if (conf > confidence) {
        fundingStage = stage;
        confidence = conf;
      }
    }
  }

  // Company size patterns
  const sizePatterns: { pattern: RegExp; size: CompanySize; conf: number }[] = [
    { pattern: /\b(?:over|more than|\>)\s*10,?000\s*employees/i, size: '10000+', conf: 0.9 },
    { pattern: /\b(?:5,?000|5k)\s*(?:to|-)\s*(?:10,?000|10k)\s*employees/i, size: '5001-10000', conf: 0.9 },
    { pattern: /\b(?:1,?000|1k)\s*(?:to|-)\s*(?:5,?000|5k)\s*employees/i, size: '1001-5000', conf: 0.9 },
    { pattern: /\b(?:500|501)\s*(?:to|-)\s*(?:1,?000|1k)\s*employees/i, size: '501-1000', conf: 0.9 },
    { pattern: /\b(?:200|201)\s*(?:to|-)\s*500\s*employees/i, size: '201-500', conf: 0.9 },
    { pattern: /\b(?:50|51)\s*(?:to|-)\s*200\s*employees/i, size: '51-200', conf: 0.9 },
    { pattern: /\b(?:10|11)\s*(?:to|-)\s*50\s*employees/i, size: '11-50', conf: 0.9 },
    { pattern: /\bsmall team\b|\bunder 10\b|\bfounding team\b/i, size: '1-10', conf: 0.7 },
    { pattern: /\blarge (?:company|organization|enterprise)\b|\benterprise\b/i, size: '1001-5000', conf: 0.5 },
    { pattern: /\bsmall (?:company|startup)\b|\bscrappy\b/i, size: '11-50', conf: 0.5 },
    { pattern: /\bglobal (?:team|company|organization)\b/i, size: '501-1000', conf: 0.4 },
  ];

  for (const { pattern, size, conf } of sizePatterns) {
    if (pattern.test(lower)) {
      if (conf > sizeConfidence) {
        companySize = size;
        sizeConfidence = conf;
      }
    }
  }

  // Industry detection
  const industryPatterns: { pattern: RegExp; industry: string }[] = [
    { pattern: /\bfintech\b|\bfinancial (?:technology|services)\b|\bbanking\b|\bpayments?\b/i, industry: 'Fintech' },
    { pattern: /\bhealthcare\b|\bhealth ?tech\b|\bmedical\b|\bbiotech\b/i, industry: 'Healthcare' },
    { pattern: /\bedtech\b|\beducation\b|\blearning\b/i, industry: 'Education' },
    { pattern: /\be-?commerce\b|\bretail\b|\bmarketplace\b/i, industry: 'E-commerce' },
    { pattern: /\bsaas\b|\benterprise software\b|\bb2b\b/i, industry: 'Enterprise Software' },
    { pattern: /\bcyber ?security\b|\bsecurity\b|\binfosec\b/i, industry: 'Cybersecurity' },
    { pattern: /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b/i, industry: 'AI/ML' },
    { pattern: /\bcloud\b|\binfrastructure\b|\bdevops\b/i, industry: 'Cloud/Infrastructure' },
    { pattern: /\breal estate\b|\bproptech\b/i, industry: 'Real Estate' },
    { pattern: /\blogistics\b|\bsupply chain\b|\bshipping\b/i, industry: 'Logistics' },
    { pattern: /\bgaming\b|\bgames?\b|\besports\b/i, industry: 'Gaming' },
    { pattern: /\bmedia\b|\bentertainment\b|\bstreaming\b/i, industry: 'Media/Entertainment' },
    { pattern: /\bhr\b|\bhuman resources\b|\brecruiting\b|\btalent\b/i, industry: 'HR Tech' },
    { pattern: /\blegal ?tech\b|\blaw\b/i, industry: 'Legal Tech' },
    { pattern: /\bclimate\b|\bcleantech\b|\bsustainability\b|\benergy\b/i, industry: 'Climate/Energy' },
    { pattern: /\bcrypto\b|\bblockchain\b|\bweb3\b|\bdefi\b/i, industry: 'Crypto/Web3' },
    { pattern: /\bdefense\b|\baerospace\b|\bmilitary\b/i, industry: 'Defense/Aerospace' },
    { pattern: /\bfood ?tech\b|\bfood delivery\b|\brestaurant\b/i, industry: 'Food Tech' },
    { pattern: /\btravel\b|\bhospitality\b|\btourism\b/i, industry: 'Travel' },
    { pattern: /\bsocial\b|\bcommunity\b|\bnetworking\b/i, industry: 'Social' },
    { pattern: /\bdeveloper tools?\b|\bdev ?tools?\b|\bcode\b/i, industry: 'Developer Tools' },
  ];

  for (const { pattern, industry: ind } of industryPatterns) {
    if (pattern.test(lower)) {
      industry = ind;
      break;
    }
  }

  return { fundingStage, confidence, companySize, sizeConfidence, industry };
}

/**
 * Fetch company info from Wikidata
 */
async function fetchWikidataInfo(companyName: string): Promise<{
  foundedYear: number | null;
  stockTicker: string | null;
  industry: string | null;
  headquarters: string | null;
  employeeCount: number | null;
} | null> {
  try {
    // First, search for the company entity
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(companyName)}&language=en&format=json&limit=3&type=item`;

    const searchResponse = await fetch(searchUrl, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!searchResponse.ok) return null;

    const searchData = await searchResponse.json();
    const results = searchData.search || [];

    // Find the most likely company match
    let entityId: string | null = null;
    for (const result of results) {
      const desc = (result.description || '').toLowerCase();
      if (desc.includes('company') || desc.includes('corporation') ||
          desc.includes('business') || desc.includes('tech') ||
          desc.includes('software') || desc.includes('startup')) {
        entityId = result.id;
        break;
      }
    }

    if (!entityId && results.length > 0) {
      entityId = results[0].id;
    }

    if (!entityId) return null;

    // Fetch entity details
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims&format=json`;

    const entityResponse = await fetch(entityUrl, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!entityResponse.ok) return null;

    const entityData = await entityResponse.json();
    const entity = entityData.entities?.[entityId];
    if (!entity) return null;

    const claims = entity.claims || {};

    // P571 = inception date (founded)
    let foundedYear: number | null = null;
    if (claims.P571?.[0]?.mainsnak?.datavalue?.value?.time) {
      const timeStr = claims.P571[0].mainsnak.datavalue.value.time;
      const match = timeStr.match(/^\+?(\d{4})/);
      if (match) foundedYear = parseInt(match[1], 10);
    }

    // P414 = stock exchange, P249 = ticker symbol
    let stockTicker: string | null = null;
    if (claims.P249?.[0]?.mainsnak?.datavalue?.value) {
      stockTicker = claims.P249[0].mainsnak.datavalue.value;
    }

    // P452 = industry (need to resolve the entity label)
    let industry: string | null = null;
    if (claims.P452?.[0]?.mainsnak?.datavalue?.value?.id) {
      const industryId = claims.P452[0].mainsnak.datavalue.value.id;
      try {
        const labelUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${industryId}&props=labels&languages=en&format=json`;
        const labelResponse = await fetch(labelUrl, {
          headers: { 'User-Agent': 'NewGradRadar/1.0' },
          signal: AbortSignal.timeout(3000),
        });
        if (labelResponse.ok) {
          const labelData = await labelResponse.json();
          industry = labelData.entities?.[industryId]?.labels?.en?.value || null;
        }
      } catch {
        // Ignore label fetch errors
      }
    }

    // P159 = headquarters location
    let headquarters: string | null = null;
    if (claims.P159?.[0]?.mainsnak?.datavalue?.value?.id) {
      const hqId = claims.P159[0].mainsnak.datavalue.value.id;
      try {
        const labelUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hqId}&props=labels&languages=en&format=json`;
        const labelResponse = await fetch(labelUrl, {
          headers: { 'User-Agent': 'NewGradRadar/1.0' },
          signal: AbortSignal.timeout(3000),
        });
        if (labelResponse.ok) {
          const labelData = await labelResponse.json();
          headquarters = labelData.entities?.[hqId]?.labels?.en?.value || null;
        }
      } catch {
        // Ignore label fetch errors
      }
    }

    // P1128 = employees
    let employeeCount: number | null = null;
    if (claims.P1128?.[0]?.mainsnak?.datavalue?.value?.amount) {
      employeeCount = parseInt(claims.P1128[0].mainsnak.datavalue.value.amount, 10);
    }

    return { foundedYear, stockTicker, industry, headquarters, employeeCount };
  } catch (e) {
    console.error('Wikidata error:', e);
    return null;
  }
}

/**
 * Fetch company info from DuckDuckGo instant answers
 */
async function fetchDuckDuckGoInfo(companyName: string): Promise<{
  description: string | null;
} | null> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(companyName + ' company')}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();

    let description = data.Abstract || data.AbstractText || null;

    // Clean up description
    if (description) {
      // Truncate if too long
      if (description.length > 500) {
        description = description.substring(0, 497) + '...';
      }
    }

    return { description };
  } catch (e) {
    console.error('DuckDuckGo error:', e);
    return null;
  }
}

/**
 * Parse a description for funding signals
 */
function parseDescriptionForFunding(description: string): {
  fundingStage: FundingStage;
  confidence: number;
} {
  const lower = description.toLowerCase();

  // Check for public company indicators
  if (/(?:publicly traded|public company|listed on|nyse|nasdaq|stock exchange)/i.test(lower)) {
    return { fundingStage: 'public', confidence: 0.9 };
  }

  // Check for acquisition
  if (/(?:acquired by|subsidiary of|owned by)/i.test(lower)) {
    return { fundingStage: 'acquired', confidence: 0.85 };
  }

  // Check for funding mentions
  const seriesMatch = lower.match(/series\s*([a-f])/i);
  if (seriesMatch) {
    const letter = seriesMatch[1].toLowerCase();
    const stageMap: Record<string, FundingStage> = {
      'a': 'series-a',
      'b': 'series-b',
      'c': 'series-c',
      'd': 'series-d+',
      'e': 'late-stage',
      'f': 'late-stage',
    };
    return { fundingStage: stageMap[letter] || 'unknown', confidence: 0.7 };
  }

  // Check for startup indicators
  if (/(?:startup|early[- ]stage|founded in 202[0-6])/i.test(lower)) {
    return { fundingStage: 'seed', confidence: 0.4 };
  }

  return { fundingStage: 'unknown', confidence: 0 };
}

/**
 * Infer information from company name patterns
 */
function inferFromCompanyName(name: string): {
  industry: string | null;
} {
  const lower = name.toLowerCase();

  const patterns: { pattern: RegExp; industry: string }[] = [
    { pattern: /\bai\b|\blabs?\b/, industry: 'AI/ML' },
    { pattern: /\bfinancial\b|\bcapital\b|\bpay\b|\bbank\b/, industry: 'Fintech' },
    { pattern: /\bhealth\b|\bmed\b|\bcare\b/, industry: 'Healthcare' },
    { pattern: /\bsecurity\b|\bcyber\b|\bguard\b/, industry: 'Cybersecurity' },
    { pattern: /\bdata\b|\banalytics\b/, industry: 'Data/Analytics' },
    { pattern: /\bcloud\b/, industry: 'Cloud' },
    { pattern: /\bgames?\b|\bstudio\b/, industry: 'Gaming' },
    { pattern: /\benergy\b|\bpower\b|\bsolar\b/, industry: 'Energy' },
    { pattern: /\bspace\b|\baero\b/, industry: 'Aerospace' },
    { pattern: /\brobo\b|\bauto\b/, industry: 'Robotics/Automation' },
  ];

  for (const { pattern, industry } of patterns) {
    if (pattern.test(lower)) {
      return { industry };
    }
  }

  return { industry: null };
}

/**
 * Convert employee count to size bucket
 */
function employeeCountToSize(count: number): CompanySize {
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  if (count <= 500) return '201-500';
  if (count <= 1000) return '501-1000';
  if (count <= 5000) return '1001-5000';
  if (count <= 10000) return '5001-10000';
  return '10000+';
}

/**
 * Normalize company name for lookup
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]inc$/i, '')
    .replace(/[,.]llc$/i, '')
    .replace(/[,.]ltd$/i, '')
    .replace(/[,.]corp$/i, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Get funding stage risk level for new grads
 */
export function getFundingRiskLevel(stage: FundingStage): {
  risk: 'low' | 'medium' | 'high';
  description: string;
} {
  const riskMap: Record<FundingStage, { risk: 'low' | 'medium' | 'high'; description: string }> = {
    'public': { risk: 'low', description: 'Established public company with stable revenue' },
    'acquired': { risk: 'low', description: 'Backed by larger parent company' },
    'late-stage': { risk: 'low', description: 'Well-funded with proven business model' },
    'series-d+': { risk: 'low', description: 'Mature startup with significant funding' },
    'series-c': { risk: 'medium', description: 'Growing startup with substantial runway' },
    'series-b': { risk: 'medium', description: 'Scaling startup, some execution risk' },
    'series-a': { risk: 'medium', description: 'Early growth stage, moderate risk' },
    'seed': { risk: 'high', description: 'Early stage, higher uncertainty' },
    'pre-seed': { risk: 'high', description: 'Very early, significant risk' },
    'bootstrapped': { risk: 'high', description: 'Self-funded, runway depends on revenue' },
    'unknown': { risk: 'medium', description: 'Unable to determine funding status' },
  };

  return riskMap[stage];
}

/**
 * Format funding stage for display
 */
export function formatFundingStage(stage: FundingStage): string {
  const labels: Record<FundingStage, string> = {
    'bootstrapped': 'Bootstrapped',
    'pre-seed': 'Pre-Seed',
    'seed': 'Seed',
    'series-a': 'Series A',
    'series-b': 'Series B',
    'series-c': 'Series C',
    'series-d+': 'Series D+',
    'late-stage': 'Late Stage',
    'public': 'Public',
    'acquired': 'Acquired',
    'unknown': 'Unknown',
  };
  return labels[stage];
}
