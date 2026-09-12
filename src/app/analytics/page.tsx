'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AuthGuard } from '@/components/auth/AuthGuard';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  Area, AreaChart,
} from 'recharts';
import { format, subDays, eachDayOfInterval } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  saved: '#9CA3AF',
  pending: '#FBBF24',
  applied: '#3B82F6',
  submitted: '#3B82F6',
  in_review: '#A855F7',
  interviewing: '#8B5CF6',
  interview_scheduled: '#8B5CF6',
  rejected: '#EF4444',
  offer: '#10B981',
};

const TIER_COLORS: Record<string, string> = {
  faang: '#9333EA',
  ai: '#EF4444',
  unicorn: '#06B6D4',
  yc: '#F97316',
  fintech: '#22C55E',
  infra: '#6B7280',
};

const SOURCE_COLORS: Record<string, string> = {
  simplify: '#10B981',      // Emerald
  greenhouse: '#22C55E',    // Green
  lever: '#3B82F6',         // Blue
  ashby: '#8B5CF6',         // Purple
  workday: '#F97316',       // Orange
  jobvite: '#EC4899',       // Pink
  custom: '#6B7280',        // Gray
  unknown: '#9CA3AF',       // Light gray
};

// Custom tooltip with dark mode support
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color?: string }>; label?: string }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg p-3">
      {label && <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{label}</p>}
      {payload.map((entry, index) => (
        <p key={index} className="text-sm text-gray-600 dark:text-gray-300">
          <span style={{ color: entry.color }}>{entry.name}: </span>
          <span className="font-medium">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <AuthGuard>
      {(user) => <AnalyticsContent userId={user.id} />}
    </AuthGuard>
  );
}

interface ApplicationData {
  status: string;
  created_at: string;
  job?: {
    tier: string;
    company_name: string;
    role_types: string[];
    source: string;
  };
}

// Raw response from Supabase query with joined jobs table
interface RawApplicationLog {
  status: string;
  created_at: string;
  jobs: {
    tier: string;
    company_name: string;
    role_types: string[];
    source: string;
  } | null;
}

// Type guard function for RawApplicationLog
function isRawApplicationLog(data: unknown): data is RawApplicationLog {
  return typeof data === 'object' && data !== null && 'status' in data && 'created_at' in data;
}

type TierMetric = 'interviewRate' | 'responseRate' | 'offerRate';

function AnalyticsContent({ userId }: { userId: string }) {
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [tierMetric, setTierMetric] = useState<TierMetric>('interviewRate');
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!mounted) return;
      setLoading(true);

      let query = supabase
        .from('application_logs')
        .select('status, created_at, submitted_at, jobs(tier, company_name, role_types, source)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (timeRange !== 'all') {
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
        const startDate = subDays(new Date(), days).toISOString();
        query = query.gte('created_at', startDate);
      }

      const { data, error } = await query;

      if (!mounted) return;

      if (error) {
        console.error('Error fetching analytics:', error);
      } else {
        const rawData = (data || []) as unknown[];
        setApplications(rawData.filter(isRawApplicationLog).map((d) => ({
          status: d.status,
          created_at: d.created_at,
          job: d.jobs ? {
            tier: d.jobs.tier,
            company_name: d.jobs.company_name,
            role_types: d.jobs.role_types,
            source: d.jobs.source,
          } : undefined,
        })));
      }

      setLoading(false);
    };

    loadData();

    // Realtime subscription for live updates
    const channel = supabase
      .channel(`analytics-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId, timeRange, supabase]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-gray-200 rounded" />
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  // Calculate stats (application_logs uses: submitted, in_review, interview_scheduled, rejected, offer)
  const offers = applications.filter(a => a.status === 'offer').length;
  const currentlyInterviewing = applications.filter(a => ['interviewing', 'interview_scheduled'].includes(a.status)).length;
  const rejected = applications.filter(a => a.status === 'rejected').length;

  const stats = {
    total: applications.length,
    pending: applications.filter(a => a.status === 'pending').length,
    submitted: applications.filter(a => ['applied', 'submitted', 'in_review'].includes(a.status)).length,
    // "Got interviews" = currently interviewing + offers (you can't get an offer without interviewing)
    interviewing: currentlyInterviewing + offers,
    rejected,
    offers,
  };

  // Response rate = heard back (interview, rejection, or offer) - don't double count
  const responseRate = stats.total > 0
    ? ((currentlyInterviewing + rejected + offers) / stats.total * 100).toFixed(1)
    : '0';

  // Interview rate = got to interview stage out of those who applied
  const interviewRate = stats.submitted > 0
    ? ((currentlyInterviewing + offers) / stats.submitted * 100).toFixed(1)
    : '0';

  // Status breakdown for pie chart
  const statusData = [
    { name: 'Pending', value: stats.pending, color: STATUS_COLORS.pending },
    { name: 'Processing', value: stats.submitted, color: STATUS_COLORS.submitted },
    { name: 'Interviewing', value: stats.interviewing, color: STATUS_COLORS.interview_scheduled },
    { name: 'Rejected', value: stats.rejected, color: STATUS_COLORS.rejected },
    { name: 'Offers', value: stats.offers, color: STATUS_COLORS.offer },
  ].filter(d => d.value > 0);

  // Tier breakdown for bar chart
  const tierCounts: Record<string, number> = {};
  applications.forEach(a => {
    const tier = a.job?.tier || 'unknown';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  });

  const tierData = Object.entries(tierCounts)
    .map(([tier, count]) => ({
      name: tier.toUpperCase(),
      count,
      fill: TIER_COLORS[tier] || '#6B7280',
    }))
    .sort((a, b) => b.count - a.count);

  // Applications over time
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 90;
  const startDate = subDays(new Date(), days);
  const dateRange = eachDayOfInterval({ start: startDate, end: new Date() });

  const dailyData = dateRange.map(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayApps = applications.filter(a =>
      format(new Date(a.created_at), 'yyyy-MM-dd') === dateStr
    );
    return {
      date: format(date, 'MMM d'),
      applications: dayApps.length,
      interviews: dayApps.filter(a => ['interviewing', 'interview_scheduled'].includes(a.status)).length,
    };
  });

  // Success rate by tier
  const tierStats: Record<string, { total: number; responses: number; interviews: number; offers: number }> = {};
  applications.forEach(a => {
    const tier = a.job?.tier || 'unknown';
    if (!tierStats[tier]) {
      tierStats[tier] = { total: 0, responses: 0, interviews: 0, offers: 0 };
    }
    tierStats[tier].total++;
    if (['interview_scheduled', 'interviewing', 'rejected', 'offer'].includes(a.status)) {
      tierStats[tier].responses++;
    }
    if (['interview_scheduled', 'interviewing', 'offer'].includes(a.status)) {
      tierStats[tier].interviews++;
    }
    if (a.status === 'offer') {
      tierStats[tier].offers++;
    }
  });

  const tierSuccessData = Object.entries(tierStats)
    .map(([tier, stats]) => ({
      name: tier.toUpperCase(),
      total: stats.total,
      responseRate: stats.total > 0 ? Math.round((stats.responses / stats.total) * 100) : 0,
      interviewRate: stats.total > 0 ? Math.round((stats.interviews / stats.total) * 100) : 0,
      offerRate: stats.total > 0 ? Math.round((stats.offers / stats.total) * 100) : 0,
      fill: TIER_COLORS[tier] || '#6B7280',
    }))
    .filter(t => t.total >= 1)
    .sort((a, b) => b[tierMetric] - a[tierMetric]);

  // Source breakdown for pie chart
  const sourceCounts: Record<string, number> = {};
  applications.forEach(a => {
    const source = a.job?.source || 'unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  const sourceData = Object.entries(sourceCounts)
    .map(([source, count]) => ({
      name: source.charAt(0).toUpperCase() + source.slice(1),
      value: count,
      color: SOURCE_COLORS[source] || SOURCE_COLORS.unknown,
    }))
    .sort((a, b) => b.value - a.value);

  // Source response rates (which sources get best response rates)
  const sourceStats: Record<string, { total: number; responses: number; interviews: number }> = {};
  applications.forEach(a => {
    const source = a.job?.source || 'unknown';
    if (!sourceStats[source]) {
      sourceStats[source] = { total: 0, responses: 0, interviews: 0 };
    }
    sourceStats[source].total++;
    if (['interviewing', 'interview_scheduled', 'rejected', 'offer'].includes(a.status)) {
      sourceStats[source].responses++;
    }
    if (['interviewing', 'interview_scheduled', 'offer'].includes(a.status)) {
      sourceStats[source].interviews++;
    }
  });

  const sourceResponseData = Object.entries(sourceStats)
    .map(([source, stats]) => ({
      name: source.charAt(0).toUpperCase() + source.slice(1),
      responseRate: stats.total > 0 ? Math.round((stats.responses / stats.total) * 100) : 0,
      interviewRate: stats.total > 0 ? Math.round((stats.interviews / stats.total) * 100) : 0,
      total: stats.total,
      fill: SOURCE_COLORS[source] || SOURCE_COLORS.unknown,
    }))
    .sort((a, b) => b.responseRate - a.responseRate);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600">Track your application performance</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range === 'all' ? 'All Time' : range}
            </button>
          ))}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Applications" value={stats.total} color="blue" />
        <StatCard label="Interviews" value={stats.interviewing} color="purple" />
        <StatCard label="Offers" value={stats.offers} color="green" />
        <StatCard label="Response Rate" value={`${responseRate}%`} color="gray" />
      </div>

      {/* Source Stats */}
      {sourceData.length > 0 && (
        <SourceStats
          sourceData={sourceData}
          sourceResponseData={sourceResponseData}
        />
      )}

      {applications.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No applications yet</h3>
          <p className="text-gray-500">Start applying to jobs to see your analytics here</p>
        </div>
      ) : (
        <>
          {/* Charts grid */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Applications over time */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Applications Over Time</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="applications"
                      stroke="#3B82F6"
                      fill="#DBEAFE"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Status breakdown */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Application Status</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* By company tier */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">By Company Tier</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {tierData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Success Rate by Tier */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Success by Tier</h3>
                <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-1">
                  {([
                    { key: 'interviewRate', label: 'Interview' },
                    { key: 'responseRate', label: 'Response' },
                    { key: 'offerRate', label: 'Offer' },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setTierMetric(key)}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        tierMetric === key
                          ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierSuccessData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg p-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{label}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              Interview Rate: <span className="font-medium text-purple-600">{data.interviewRate}%</span>
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              Response Rate: <span className="font-medium">{data.responseRate}%</span>
                            </p>
                            {data.offerRate > 0 && (
                              <p className="text-sm text-gray-600 dark:text-gray-300">
                                Offer Rate: <span className="font-medium text-green-600">{data.offerRate}%</span>
                              </p>
                            )}
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              ({data.total} applications)
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey={tierMetric} radius={[0, 4, 4, 0]}>
                      {tierSuccessData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Jobs by Source */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Jobs by Source</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {sourceData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Source Response Rates */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Response Rate by Source</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceResponseData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg p-3">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{label}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              Response Rate: <span className="font-medium">{data.responseRate}%</span>
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              Interview Rate: <span className="font-medium">{data.interviewRate}%</span>
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              ({data.total} applications)
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="responseRate" radius={[0, 4, 4, 0]}>
                      {sourceResponseData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Funnel metrics */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Application Funnel</h3>
            <div className="flex items-center justify-between">
              <FunnelStep
                label="Applied"
                value={stats.submitted}
                percentage={100}
                color="blue"
              />
              <FunnelArrow />
              <FunnelStep
                label="Response"
                value={stats.interviewing + stats.rejected + stats.offers}
                percentage={parseFloat(responseRate)}
                color="purple"
              />
              <FunnelArrow />
              <FunnelStep
                label="Interview"
                value={stats.interviewing + stats.offers}
                percentage={parseFloat(interviewRate)}
                color="indigo"
              />
              <FunnelArrow />
              <FunnelStep
                label="Offer"
                value={stats.offers}
                percentage={stats.interviewing + stats.offers > 0
                  ? (stats.offers / (stats.interviewing + stats.offers) * 100)
                  : 0}
                color="green"
              />
            </div>
          </div>

          {/* Coming soon: Resume analysis */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Resume Analytics (Coming Soon)</h3>
                <p className="text-gray-600 mt-1">
                  Track which resume versions perform best. Our AI will analyze your applications
                  and suggest resume tweaks to improve your interview rate at different company tiers.
                </p>
                <div className="flex gap-2 mt-4">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                    A/B Test Resumes
                  </span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                    AI Suggestions
                  </span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                    Tier-Specific Tweaks
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
    green: 'bg-green-50 border-green-200',
    gray: 'bg-gray-50 border-gray-200',
  };

  const textClasses: Record<string, string> = {
    blue: 'text-blue-700',
    purple: 'text-purple-700',
    green: 'text-green-700',
    gray: 'text-gray-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${textClasses[color]}`}>{value}</p>
    </div>
  );
}

function FunnelStep({ label, value, percentage, color }: {
  label: string;
  value: number;
  percentage: number;
  color: string;
}) {
  const bgClasses: Record<string, string> = {
    blue: 'bg-blue-100',
    purple: 'bg-purple-100',
    indigo: 'bg-indigo-100',
    green: 'bg-green-100',
  };

  const textClasses: Record<string, string> = {
    blue: 'text-blue-700',
    purple: 'text-purple-700',
    indigo: 'text-indigo-700',
    green: 'text-green-700',
  };

  return (
    <div className="text-center flex-1">
      <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${bgClasses[color]} mb-2`}>
        <span className={`text-xl font-bold ${textClasses[color]}`}>{value}</span>
      </div>
      <p className="text-sm font-medium text-gray-900">{label}</p>
      <p className="text-xs text-gray-500">{percentage.toFixed(0)}%</p>
    </div>
  );
}

function FunnelArrow() {
  return (
    <svg className="w-6 h-6 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

interface SourceStatsProps {
  sourceData: Array<{ name: string; value: number; color: string }>;
  sourceResponseData: Array<{ name: string; responseRate: number; interviewRate: number; total: number; fill: string }>;
}

function SourceStats({ sourceData, sourceResponseData }: SourceStatsProps) {
  // Find top source by volume
  const topSource = sourceData[0];

  // Find best source by response rate (minimum 3 applications)
  const qualifiedSources = sourceResponseData.filter(s => s.total >= 3);
  const bestResponseSource = qualifiedSources.length > 0 ? qualifiedSources[0] : null;

  // Find best source by interview rate
  const sortedByInterview = [...qualifiedSources].sort((a, b) => b.interviewRate - a.interviewRate);
  const bestInterviewSource = sortedByInterview.length > 0 ? sortedByInterview[0] : null;

  // Count unique sources
  const uniqueSources = sourceData.length;

  return (
    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-800 dark:to-slate-700 rounded-lg border border-emerald-200 dark:border-slate-600 p-6 mb-8">
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        Source Analytics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Most Jobs From */}
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Most Jobs From</p>
          {topSource ? (
            <>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{topSource.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{topSource.value} applications</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">No data</p>
          )}
        </div>

        {/* Best Response Rate */}
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Best Response Rate</p>
          {bestResponseSource ? (
            <>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{bestResponseSource.name}</p>
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{bestResponseSource.responseRate}% response</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Need 3+ apps</p>
          )}
        </div>

        {/* Best Interview Rate */}
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Best Interview Rate</p>
          {bestInterviewSource ? (
            <>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{bestInterviewSource.name}</p>
              <p className="text-sm text-purple-600 dark:text-purple-400">{bestInterviewSource.interviewRate}% interviews</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Need 3+ apps</p>
          )}
        </div>

        {/* Sources Used */}
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Sources Used</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{uniqueSources}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">job boards</p>
        </div>
      </div>
    </div>
  );
}
