'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { cn } from '@/lib/utils';

export default function ProfilePage() {
  return (
    <AuthGuard>
      {(user) => <ProfileContent userId={user.id} email={user.email || ''} />}
    </AuthGuard>
  );
}

// A card linking to one of the profile's sub-pages, matching the settings-card
// visual pattern.
function LinkCard({
  title, description, href, cta, colorClass, icon,
}: {
  title: string; description: string; href: string; cta: string;
  colorClass: string; icon: React.ReactNode;
}) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">{title}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>
      <Link
        href={href}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
          colorClass
        )}
      >
        {icon}
        {cta}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}

function ProfileContent({ userId, email }: { userId: string; email: string }) {
  const [weeklyGoal, setWeeklyGoal] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchGoal = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_profiles')
      .select('weekly_goal')
      .eq('user_id', userId)
      .single();
    if (data?.weekly_goal) setWeeklyGoal(data.weekly_goal);
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => { fetchGoal(); }, [fetchGoal]);

  // Saves immediately (no separate button), matching the previous behavior.
  const saveWeeklyGoal = async (goal: number) => {
    setWeeklyGoal(goal);
    const { error } = await supabase
      .from('user_profiles')
      .update({ weekly_goal: goal })
      .eq('user_id', userId);
    if (error) {
      await supabase.from('user_profiles').insert({ user_id: userId, weekly_goal: goal });
    }
  };

  const docIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">My Profile</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Your details, resume, and job-search assets
        </p>
      </div>

      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-slate-700/50 divide-y divide-gray-200 dark:divide-slate-700">
        {/* Identity */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Account</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Signed in as <span className="font-medium text-gray-900 dark:text-white">{email}</span>
          </p>
        </div>

        {/* Weekly Goal */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Weekly Goal</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Set your target number of applications per week
          </p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {[5, 10, 15, 20, 25].map((goal) => (
                <button
                  key={goal}
                  onClick={() => saveWeeklyGoal(goal)}
                  disabled={loading}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                    weeklyGoal === goal
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                  )}
                >
                  {goal}
                </button>
              ))}
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
            <input
              type="number"
              min="1"
              max="100"
              value={weeklyGoal}
              onChange={(e) => setWeeklyGoal(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              onBlur={(e) => saveWeeklyGoal(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="w-20 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">apps/week</span>
          </div>
        </div>

        <LinkCard
          title="Auto-Apply"
          description="Set up your profile to automatically fill out job applications"
          href="/settings/profile"
          cta="Configure Auto-Apply Profile"
          colorClass="text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
        />

        <LinkCard
          title="Resume"
          description="Build your base resume. AI will tailor it for each job you apply to."
          href="/settings/resume"
          cta="Resume Builder"
          colorClass="text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30"
          icon={docIcon}
        />

        <LinkCard
          title="Answer Bank"
          description="View and manage your generated application answers"
          href="/settings/answers"
          cta="Answer Bank Dashboard"
          colorClass="text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30"
          icon={docIcon}
        />

        <LinkCard
          title="Job Alerts"
          description="Create alerts for specific roles, companies, or locations and get notified the moment a match is posted."
          href="/settings/alerts"
          cta="Manage Job Alerts"
          colorClass="text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
        />
      </div>
    </div>
  );
}
