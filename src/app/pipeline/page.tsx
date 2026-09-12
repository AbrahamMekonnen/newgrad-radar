'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Application, PipelineStage, PIPELINE_STAGES } from '@/lib/types';
import { KanbanBoard } from '@/components/pipeline/KanbanBoard';
import { PipelineStats, CompanyInsight } from '@/components/pipeline/PipelineStats';
import { cn } from '@/lib/utils';

type ViewMode = 'kanban' | 'stats';

export default function PipelinePage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [companyInsights, setCompanyInsights] = useState<CompanyInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [stageChanging, setStageChanging] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Fetch applications on load
  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }

      const response = await fetch('/api/applications');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch applications');
      }

      const data = await response.json();
      setApplications(data.applications || []);

      // Calculate company insights
      const insights = calculateCompanyInsights(data.applications || []);
      setCompanyInsights(insights);
    } catch (err) {
      console.error('Error fetching applications:', err);
      setError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Calculate company insights from applications
  function calculateCompanyInsights(apps: Application[]): CompanyInsight[] {
    const companyMap = new Map<string, {
      company_slug: string;
      company_name: string;
      logo_url: string | null;
      applications: Application[];
    }>();

    apps.forEach((app) => {
      if (!app.job) return;

      const slug = app.job.company_slug;
      if (!companyMap.has(slug)) {
        companyMap.set(slug, {
          company_slug: slug,
          company_name: app.job.company_name,
          logo_url: null, // Would need to fetch from companies table
          applications: [],
        });
      }
      companyMap.get(slug)!.applications.push(app);
    });

    return Array.from(companyMap.values()).map((company) => {
      const apps = company.applications;
      const interviews = apps.filter((a) =>
        ['oa', 'phone_screen', 'technical', 'onsite', 'offer'].includes(a.stage)
      ).length;

      // Response = any progress beyond applied
      const responded = apps.filter((a) =>
        a.stage !== 'saved' && a.stage !== 'applied' && a.stage !== 'withdrawn'
      ).length;
      const applied = apps.filter((a) =>
        a.stage !== 'saved' && a.stage !== 'withdrawn'
      ).length;

      // Average days to response (from applied_at to first stage change beyond applied)
      let totalDays = 0;
      let daysCount = 0;
      apps.forEach((app) => {
        if (app.applied_at && app.stage !== 'applied') {
          const appliedDate = new Date(app.applied_at);
          const activityDate = new Date(app.last_activity || app.updated_at);
          const days = Math.floor(
            (activityDate.getTime() - appliedDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (days >= 0) {
            totalDays += days;
            daysCount++;
          }
        }
      });

      return {
        company_slug: company.company_slug,
        company_name: company.company_name,
        logo_url: company.logo_url,
        application_count: apps.length,
        interview_count: interviews,
        response_rate: applied > 0 ? (responded / applied) * 100 : 0,
        avg_days_to_response: daysCount > 0 ? Math.round(totalDays / daysCount) : 0,
      };
    });
  }

  // Handle stage change
  const handleStageChange = useCallback(
    async (applicationId: string, newStage: PipelineStage) => {
      setStageChanging(applicationId);

      // Optimistic update
      setApplications((prev) =>
        prev.map((app) =>
          app.id === applicationId
            ? { ...app, stage: newStage, last_activity: new Date().toISOString() }
            : app
        )
      );

      try {
        const response = await fetch(`/api/applications/${applicationId}/stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update stage');
        }

        const data = await response.json();

        // Update with server response
        setApplications((prev) =>
          prev.map((app) =>
            app.id === applicationId ? data.application : app
          )
        );
      } catch (err) {
        console.error('Error updating stage:', err);
        // Revert optimistic update
        fetchApplications();
      } finally {
        setStageChanging(null);
      }
    },
    [fetchApplications]
  );

  // Handle application click
  const handleApplicationClick = useCallback((application: Application) => {
    // Could open a modal or navigate to application detail page
    console.log('Application clicked:', application);
  }, []);

  // Calculate stats for header
  const stats = {
    total: applications.length,
    active: applications.filter((a) =>
      !['rejected', 'withdrawn'].includes(a.stage)
    ).length,
    offers: applications.filter((a) => a.stage === 'offer').length,
    interviewing: applications.filter((a) =>
      ['oa', 'phone_screen', 'technical', 'onsite'].includes(a.stage)
    ).length,
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Title and Stats */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Application Pipeline
              </h1>
              <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>{stats.total} total</span>
                <span>{stats.active} active</span>
                <span className="text-cyan-600 dark:text-cyan-400">
                  {stats.interviewing} interviewing
                </span>
                <span className="text-green-600 dark:text-green-400">
                  {stats.offers} offers
                </span>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-slate-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('kanban')}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-md transition-all',
                  viewMode === 'kanban'
                    ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                <span className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                    />
                  </svg>
                  Kanban
                </span>
              </button>
              <button
                onClick={() => setViewMode('stats')}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-md transition-all',
                  viewMode === 'stats'
                    ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                <span className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  Stats
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
              <svg
                className="animate-spin h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Loading applications...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-red-500 dark:text-red-400 mb-4">
              <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
            <button
              onClick={fetchApplications}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && applications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <svg
                className="w-10 h-10 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No applications yet
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-6">
              Start by saving or applying to jobs. Your application pipeline will appear here.
            </p>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Browse Jobs
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && applications.length > 0 && (
          <>
            {viewMode === 'kanban' ? (
              <KanbanBoard
                applications={applications}
                onStageChange={handleStageChange}
                onApplicationClick={handleApplicationClick}
              />
            ) : (
              <PipelineStats
                applications={applications}
                companyInsights={companyInsights}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
