import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function generateApplyUrl(url: string, source: string): string {
  if (!url) return url;

  // Greenhouse: add #app anchor to scroll to application form
  if (source === 'greenhouse' || url.includes('greenhouse.io')) {
    return url.includes('#app') ? url : `${url}#app`;
  }

  // Lever: add /apply suffix to go to application page
  if (source === 'lever' || url.includes('lever.co')) {
    return url.endsWith('/apply') ? url : `${url.replace(/\/$/, '')}/apply`;
  }

  // Other ATS types - form is embedded on job page
  return url;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Get ALL jobs and update apply_url based on correct logic
  const { data: jobs, error: fetchError } = await supabase
    .from('jobs')
    .select('id, url, source, apply_url')
    .eq('is_active', true);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ message: 'No jobs found', updated: 0 });
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    const correctApplyUrl = generateApplyUrl(job.url, job.source);

    // Skip if already correct
    if (job.apply_url === correctApplyUrl) {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('jobs')
      .update({ apply_url: correctApplyUrl })
      .eq('id', job.id);

    if (updateError) {
      errors.push(`${job.id}: ${updateError.message}`);
    } else {
      updated++;
    }
  }

  return NextResponse.json({
    message: `Backfilled ${updated} jobs, skipped ${skipped} already correct`,
    updated,
    skipped,
    total: jobs.length,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}

// Also support GET to check status
export async function GET() {
  const supabase = await createClient();

  const { data: stats, error } = await supabase
    .from('jobs')
    .select('source, url, apply_url')
    .eq('is_active', true)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = {
    total: stats?.length || 0,
    withApplyUrl: stats?.filter(j => j.apply_url && j.apply_url !== j.url).length || 0,
    greenhouse: stats?.filter(j => j.source === 'greenhouse').map(j => ({
      url: j.url?.substring(0, 50),
      apply_url: j.apply_url?.substring(0, 50),
      correct: j.apply_url?.includes('#app'),
    })).slice(0, 5),
    lever: stats?.filter(j => j.source === 'lever').map(j => ({
      url: j.url?.substring(0, 50),
      apply_url: j.apply_url?.substring(0, 50),
      correct: j.apply_url?.endsWith('/apply'),
    })).slice(0, 5),
  };

  return NextResponse.json(summary);
}
