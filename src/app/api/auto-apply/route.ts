import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { jobId, jobUrl, applyUrl, priority = 3 } = body;

  if (!jobId || !jobUrl) {
    return NextResponse.json({ error: 'Missing jobId or jobUrl' }, { status: 400 });
  }

  // Get job details
  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Use apply_url if available
  const targetUrl = applyUrl || job.apply_url || jobUrl;

  // Add to the auto-apply queue
  const { data: queueEntry, error: queueError } = await supabase
    .from('autoapply_job_queue')
    .insert({
      user_id: user.id,
      job_id: jobId,
      job_title: job.title,
      company_slug: job.company_slug,
      company_name: job.company_name,
      job_url: targetUrl,
      ats_type: job.source || 'unknown',
      priority,
      status: 'pending',
    })
    .select()
    .single();

  if (queueError) {
    // Check if it's a duplicate
    if (queueError.code === '23505') {
      return NextResponse.json({
        error: 'Application already in queue',
        status: 'duplicate',
      }, { status: 409 });
    }
    console.error('Queue insert error:', queueError);
    return NextResponse.json({ error: 'Failed to queue application' }, { status: 500 });
  }

  // Update application_logs status
  await supabase
    .from('application_logs')
    .update({ status: 'pending' })
    .eq('user_id', user.id)
    .eq('job_id', jobId);

  return NextResponse.json({
    success: true,
    message: 'Application queued',
    queueId: queueEntry.id,
    targetUrl,
    jobId,
    status: 'pending',
    position: await getQueuePosition(supabase, queueEntry.id),
  });
}

async function getQueuePosition(supabase: Awaited<ReturnType<typeof createClient>>, queueId: string): Promise<number> {
  const { count } = await supabase
    .from('autoapply_job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('created_at', new Date().toISOString());

  return (count || 0) + 1;
}

// GET endpoint to check queue status
export async function GET(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: queue } = await supabase
    .from('autoapply_job_queue')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const pending = queue?.filter(q => q.status === 'pending').length || 0;
  const processing = queue?.filter(q => q.status === 'processing').length || 0;
  const completed = queue?.filter(q => q.status === 'completed').length || 0;
  const failed = queue?.filter(q => q.status === 'failed').length || 0;

  return NextResponse.json({
    queue,
    stats: { pending, processing, completed, failed },
  });
}
