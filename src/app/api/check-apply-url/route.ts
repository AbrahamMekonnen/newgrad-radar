import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, url, apply_url, source')
    .eq('is_active', true)
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    jobs: jobs?.map(j => ({
      id: j.id,
      url: j.url?.substring(0, 60),
      apply_url: j.apply_url?.substring(0, 60),
      source: j.source,
      has_apply_url: !!j.apply_url,
      urls_different: j.url !== j.apply_url,
    })),
  });
}
