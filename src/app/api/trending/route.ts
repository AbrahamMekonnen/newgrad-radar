import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    // Use service role to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate date 7 days ago for weekly trending
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Fetch save counts (bypasses RLS with service role)
    const { data: saveCounts, error: saveError } = await supabase
      .from('saved_jobs')
      .select('job_id')
      .gte('created_at', weekAgo.toISOString());

    if (saveError) {
      console.error('Error fetching save counts:', saveError);
      return NextResponse.json({ trending: [], closingSoon: [] });
    }

    // Count saves per job
    const jobSaveCounts = new Map<string, number>();
    saveCounts?.forEach((save) => {
      const count = jobSaveCounts.get(save.job_id) || 0;
      jobSaveCounts.set(save.job_id, count + 1);
    });

    // Sort by count and get top 4
    const topJobIds = Array.from(jobSaveCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => id);

    let trendingJobs: any[] = [];
    if (topJobIds.length > 0) {
      const { data: trendingJobsData } = await supabase
        .from('jobs')
        .select('*')
        .in('id', topJobIds)
        .eq('is_active', true);

      trendingJobs = (trendingJobsData || []).map((job) => ({
        ...job,
        save_count: jobSaveCounts.get(job.id) || 0,
      }));
      trendingJobs.sort((a, b) => b.save_count - a.save_count);
    }

    // Fetch jobs closing soon
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: closingJobsData } = await supabase
      .from('jobs')
      .select('*')
      .eq('is_active', true)
      .not('deadline', 'is', null)
      .gte('deadline', today.toISOString().split('T')[0])
      .order('deadline', { ascending: true })
      .limit(4);

    const closingSoonJobs = (closingJobsData || []).map((job) => {
      const deadline = new Date(job.deadline);
      const diffTime = deadline.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return {
        ...job,
        days_remaining: Math.max(0, diffDays),
      };
    });

    return NextResponse.json({
      trending: trendingJobs,
      closingSoon: closingSoonJobs,
    });
  } catch (error) {
    console.error('Error in trending API:', error);
    return NextResponse.json({ trending: [], closingSoon: [] });
  }
}
