import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This endpoint is meant to be called by a cron job (e.g., Supabase Edge Function, Vercel Cron, or GitHub Actions)
// It finds saved jobs with deadlines approaching in 3 days and sends reminder notifications

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key');

interface DeadlineReminder {
  userId: string;
  userEmail: string;
  jobs: Array<{
    id: string;
    title: string;
    company: string;
    deadline: string;
    daysUntil: number;
    url: string;
  }>;
}

interface SavedJobWithJob {
  id: string;
  user_id: string;
  job_id: string;
  status: string;
  job: {
    id: string;
    title: string;
    company_name: string;
    deadline: string | null;
    url: string;
  } | null;
}

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate the date 3 days from now
    const now = new Date();
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const targetDate = threeDaysFromNow.toISOString().split('T')[0];

    // Get all saved jobs with deadlines exactly 3 days from now
    // Also get jobs with deadlines in 1 day for urgent reminders
    const oneDayFromNow = new Date(now);
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);
    const urgentDate = oneDayFromNow.toISOString().split('T')[0];

    const { data: savedJobsWithDeadlines, error: savedJobsError } = await supabase
      .from('saved_jobs')
      .select(`
        id,
        user_id,
        job_id,
        status,
        job:jobs(
          id,
          title,
          company_name,
          deadline,
          url
        )
      `)
      .in('status', ['saved', 'applied']) // Only remind for active job applications
      .not('job.deadline', 'is', null);

    if (savedJobsError) {
      console.error('Error fetching saved jobs:', savedJobsError);
      return NextResponse.json({ error: 'Failed to fetch saved jobs' }, { status: 500 });
    }

    // Filter jobs with deadlines in 1 or 3 days
    // Supabase returns joined data as arrays, so we need to normalize it
    const typedSavedJobs = (savedJobsWithDeadlines || []).map((row) => {
      const jobArray = row.job as unknown as Array<{ id: string; title: string; company_name: string; deadline: string | null; url: string }>;
      return {
        ...row,
        job: Array.isArray(jobArray) && jobArray.length > 0 ? jobArray[0] : null,
      } as SavedJobWithJob;
    });
    const jobsNeedingReminders = typedSavedJobs.filter(sj => {
      if (!sj.job?.deadline) return false;
      return sj.job.deadline === targetDate || sj.job.deadline === urgentDate;
    });

    if (jobsNeedingReminders.length === 0) {
      console.log('[Deadline Reminders] No jobs with upcoming deadlines found');
      return NextResponse.json({
        success: true,
        message: 'No reminders needed',
        remindersProcessed: 0
      });
    }

    // Group jobs by user
    const remindersByUser = new Map<string, DeadlineReminder>();

    for (const savedJob of jobsNeedingReminders) {
      const job = savedJob.job!;
      const userId = savedJob.user_id;

      const deadlineDate = new Date(job.deadline!);
      const daysUntil = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (!remindersByUser.has(userId)) {
        // Fetch user email
        const { data: userData } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('user_id', userId)
          .single();

        remindersByUser.set(userId, {
          userId,
          userEmail: userData?.email || '',
          jobs: [],
        });
      }

      const reminder = remindersByUser.get(userId)!;
      reminder.jobs.push({
        id: job.id,
        title: job.title,
        company: job.company_name,
        deadline: job.deadline!,
        daysUntil,
        url: job.url,
      });
    }

    // Process reminders for each user
    const results: Array<{ userId: string; status: string; jobCount: number }> = [];

    for (const [userId, reminder] of Array.from(remindersByUser.entries())) {
      try {
        // For now, we log the reminder and store in a notifications table
        // In production, you could integrate with:
        // - Supabase Edge Functions for email
        // - ntfy.sh for push notifications (already set up in this project)
        // - SendGrid/Resend for email

        console.log(`[Deadline Reminder] User ${userId}:`, {
          email: reminder.userEmail,
          jobCount: reminder.jobs.length,
          jobs: reminder.jobs.map(j => ({
            title: j.title,
            company: j.company,
            daysUntil: j.daysUntil,
          })),
        });

        // Check user preferences for notifications
        const { data: prefs } = await supabase
          .from('user_preferences')
          .select('email_enabled, push_enabled, ntfy_topic')
          .eq('user_id', userId)
          .single();

        // Send ntfy push notification if enabled
        if (prefs?.push_enabled && prefs?.ntfy_topic) {
          const urgentJobs = reminder.jobs.filter(j => j.daysUntil <= 1);
          const normalJobs = reminder.jobs.filter(j => j.daysUntil > 1);

          const title = urgentJobs.length > 0
            ? `URGENT: ${urgentJobs.length} deadline${urgentJobs.length > 1 ? 's' : ''} tomorrow!`
            : `${normalJobs.length} deadline${normalJobs.length > 1 ? 's' : ''} in 3 days`;

          const body = reminder.jobs
            .sort((a, b) => a.daysUntil - b.daysUntil)
            .slice(0, 5)
            .map(j => `${j.company} - ${j.title} (${j.daysUntil === 1 ? 'TOMORROW' : `${j.daysUntil} days`})`)
            .join('\n');

          try {
            await fetch(`https://ntfy.sh/${prefs.ntfy_topic}`, {
              method: 'POST',
              headers: {
                'Title': title,
                'Priority': urgentJobs.length > 0 ? 'high' : 'default',
                'Tags': 'calendar,warning',
              },
              body,
            });
            console.log(`[ntfy] Sent notification to ${prefs.ntfy_topic}`);
          } catch (ntfyError) {
            console.error('[ntfy] Failed to send:', ntfyError);
          }
        }

        // Store notification record in database for UI display
        const { error: notifError } = await supabase
          .from('user_notifications')
          .insert({
            user_id: userId,
            type: 'job_alert',  // deadline_reminder maps to job_alert type
            title: `${reminder.jobs.length} application deadline${reminder.jobs.length > 1 ? 's' : ''} approaching`,
            body: JSON.stringify(reminder.jobs),
            reference_type: 'deadline_reminder',
            reference_id: new Date().toISOString().split('T')[0],  // Date as reference
          });

        if (notifError) {
          console.error('Failed to store notification in user_notifications:', notifError);
        }

        results.push({ userId, status: 'success', jobCount: reminder.jobs.length });
      } catch (userError) {
        console.error(`[Deadline Reminder] Error for user ${userId}:`, userError);
        results.push({ userId, status: 'error', jobCount: reminder.jobs.length });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} user(s) with deadline reminders`,
      remindersProcessed: results.length,
      details: results,
    });

  } catch (error) {
    console.error('[Deadline Reminder] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for manual testing / status check
export async function GET(_request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Calculate dates
  const now = new Date();
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  // Get count of jobs with upcoming deadlines
  const { data: upcomingDeadlines, error } = await supabase
    .from('saved_jobs')
    .select(`
      id,
      job:jobs!inner(deadline)
    `)
    .gte('job.deadline', now.toISOString().split('T')[0])
    .lte('job.deadline', sevenDaysFromNow.toISOString().split('T')[0]);

  if (error) {
    return NextResponse.json({ error: 'Failed to check deadlines' }, { status: 500 });
  }

  return NextResponse.json({
    status: 'ok',
    upcomingDeadlines: {
      next7Days: upcomingDeadlines?.length || 0,
      checkDate: now.toISOString(),
    },
    usage: 'POST to this endpoint with CRON_SECRET to send reminders',
  });
}
