import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key')
);

// Bulk interview-question counts per company, in ONE request.
//
// Replaces the old per-card fetch (every job card hit /api/interview-questions
// on mount — an N+1 storm that made cards lag badly while scrolling). The page
// calls this once and looks each card's count up from the returned map.
//
// Returns { counts: { [company_slug]: n, [company_name_lower]: n }, total }.
// Both slug and lowercased name are keyed so a card can match by whichever it has.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const monthsBack = parseInt(searchParams.get('months_back') || '6', 10);

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const counts: Record<string, number> = {};
    let total = 0;

    // Page through just the two columns we need to tally (cheap: no text bodies).
    const PAGE = 1000;
    let start = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('interview_questions')
        .select('company_slug, company_name')
        .eq('is_duplicate', false)
        .eq('is_junk', false)
        .or(`interview_date.gte.${cutoffStr},interview_date.is.null`)
        .range(start, start + PAGE - 1);
      if (error) {
        console.error('company-counts query error:', error);
        return NextResponse.json({ counts: {}, total: 0 }, { status: 200 });
      }
      const rows = data || [];
      for (const r of rows) {
        total += 1;
        if (r.company_slug) counts[r.company_slug] = (counts[r.company_slug] || 0) + 1;
        if (r.company_name) {
          const k = r.company_name.toLowerCase();
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      if (rows.length < PAGE) break;
      start += PAGE;
    }

    return NextResponse.json(
      { counts, total },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    );
  } catch (error) {
    console.error('company-counts error:', error);
    return NextResponse.json({ counts: {}, total: 0 }, { status: 200 });
  }
}
