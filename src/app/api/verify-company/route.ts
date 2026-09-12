import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name || name.trim().length < 3) {
      return NextResponse.json({
        valid: false,
        error: 'Company name must be at least 3 characters'
      });
    }

    const companyName = name.trim();

    // For very short names (3-4 chars), require exact Wikidata match
    if (companyName.length <= 4) {
      const wikidataResult = await checkWikidataExact(companyName);
      if (!wikidataResult.found) {
        return NextResponse.json({
          valid: false,
          error: `"${companyName}" is too short. Please enter the full company name.`
        });
      }
      return NextResponse.json({ valid: true, source: 'wikidata' });
    }

    // For longer names, check multiple sources
    const wikidataResult = await checkWikidataExact(companyName);
    if (wikidataResult.found) {
      return NextResponse.json({ valid: true, source: 'wikidata' });
    }

    const wikiResult = await checkWikipediaStrict(companyName);
    if (wikiResult.found) {
      return NextResponse.json({ valid: true, source: 'wikipedia' });
    }

    // Try autocomplete from datahub.io company list
    const autocompleteResult = await checkAutocomplete(companyName);
    if (autocompleteResult.found) {
      return NextResponse.json({ valid: true, source: 'autocomplete' });
    }

    return NextResponse.json({
      valid: false,
      error: `"${companyName}" doesn't appear to be a recognized company. Please check the spelling.`
    });

  } catch (error) {
    console.error('Company verification error:', error);
    return NextResponse.json({
      valid: false,
      error: 'Could not verify company. Please try again.'
    });
  }
}

async function checkWikidataExact(companyName: string): Promise<{ found: boolean }> {
  try {
    // Search for exact company name match
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(companyName)}&language=en&format=json&limit=5&type=item`;

    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return { found: false };

    const data = await response.json();
    const results = data.search || [];

    // Check for exact or very close match
    const normalizedInput = companyName.toLowerCase().trim();

    for (const result of results) {
      const label = (result.label || '').toLowerCase();
      const description = (result.description || '').toLowerCase();

      // Exact match on label
      if (label === normalizedInput) {
        // Verify it's a company/organization by checking description
        if (isCompanyDescription(description)) {
          return { found: true };
        }
      }

      // Close match (input is part of label or vice versa)
      if (label.startsWith(normalizedInput) || normalizedInput.startsWith(label)) {
        if (isCompanyDescription(description)) {
          return { found: true };
        }
      }
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}

function isCompanyDescription(description: string): boolean {
  const companyKeywords = [
    'company', 'corporation', 'inc', 'llc', 'ltd', 'business',
    'enterprise', 'startup', 'firm', 'organization', 'organisation',
    'tech', 'technology', 'software', 'platform', 'service',
    'manufacturer', 'provider', 'developer', 'studio',
    'american', 'chinese', 'indian', 'british', 'german', 'japanese',
    'multinational', 'conglomerate', 'bank', 'financial'
  ];

  const lowerDesc = description.toLowerCase();
  return companyKeywords.some(keyword => lowerDesc.includes(keyword));
}

async function checkWikipediaStrict(companyName: string): Promise<{ found: boolean }> {
  try {
    // Search Wikipedia for the company
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('"' + companyName + '" company OR corporation OR Inc')}&format=json&srlimit=5`;

    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return { found: false };

    const data = await response.json();
    const results = data.query?.search || [];

    const normalizedName = companyName.toLowerCase();

    for (const result of results) {
      const title = result.title.toLowerCase();
      const snippet = (result.snippet || '').toLowerCase();

      // Title must contain the company name
      if (title.includes(normalizedName)) {
        // And snippet should indicate it's a company
        if (isCompanyDescription(snippet)) {
          return { found: true };
        }
      }
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}

async function checkAutocomplete(companyName: string): Promise<{ found: boolean }> {
  try {
    // Use DuckDuckGo instant answers as a fallback
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(companyName + ' company')}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'NewGradRadar/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return { found: false };

    const data = await response.json();

    // Check if we got a direct answer about a company
    const abstract = (data.Abstract || '').toLowerCase();
    const heading = (data.Heading || '').toLowerCase();
    const normalizedName = companyName.toLowerCase();

    if (heading.includes(normalizedName) && isCompanyDescription(abstract)) {
      return { found: true };
    }

    // Check related topics
    const topics = data.RelatedTopics || [];
    for (const topic of topics) {
      const text = (topic.Text || '').toLowerCase();
      if (text.includes(normalizedName) && isCompanyDescription(text)) {
        return { found: true };
      }
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}
