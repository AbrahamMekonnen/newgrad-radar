'use client';

import { useAnimatedNumber } from '@/hooks';
import { cn } from '@/lib/utils';
import { Application } from '@/lib/types';

export interface CompanyInsight {
  company_slug: string;
  company_name: string;
  logo_url: string | null;
  application_count: number;
  interview_count: number;
  response_rate: number;
  avg_days_to_response: number;
}

interface PipelineStatsProps {
  applications: Application[];
  companyInsights: CompanyInsight[];
}

interface SummaryCardProps {
  title: string;
  value: number;
  suffix?: string;
  color: 'blue' | 'purple' | 'cyan' | 'green';
  icon: React.ReactNode;
}

const colorStyles = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    text: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-900/50',
    border: 'border-blue-200 dark:border-blue-800',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    text: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-900/50',
    border: 'border-purple-200 dark:border-purple-800',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    text: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-900/50',
    border: 'border-cyan-200 dark:border-cyan-800',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    text: 'text-green-600 dark:text-green-400',
    iconBg: 'bg-green-100 dark:bg-green-900/50',
    border: 'border-green-200 dark:border-green-800',
  },
};

function SummaryCard({ title, value, suffix, color, icon }: SummaryCardProps) {
  const animatedValue = useAnimatedNumber(value, { duration: 800, decimals: suffix === '%' ? 1 : 0 });
  const styles = colorStyles[color];

  return (
    <div
      className={cn(
        'rounded-xl p-5 transition-all duration-200',
        'bg-white dark:bg-gray-800',
        'border',
        styles.border
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('p-2 rounded-lg', styles.iconBg, styles.text)}>
          {icon}
        </div>
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {title}
        </h3>
      </div>
      <div className={cn('text-3xl font-bold', styles.text)}>
        {animatedValue}
        {suffix && <span className="text-xl ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}

interface FunnelStageProps {
  label: string;
  count: number;
  total: number;
  color: string;
  conversionRate?: number;
  isLast?: boolean;
}

function FunnelStage({ label, count, total, color, conversionRate, isLast }: FunnelStageProps) {
  const animatedCount = useAnimatedNumber(count, { duration: 800 });
  const percentage = total > 0 ? (count / total) * 100 : 0;
  const size = Math.max(48, 48 + (percentage * 0.8)); // Scale from 48px to ~128px

  return (
    <div className="flex flex-col items-center">
      {/* Circle */}
      <div
        className={cn(
          'rounded-full flex items-center justify-center transition-all duration-500',
          'text-white font-bold',
          color
        )}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          fontSize: size > 80 ? '1.5rem' : '1rem',
        }}
      >
        {animatedCount}
      </div>

      {/* Label */}
      <span className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>

      {/* Conversion arrow */}
      {!isLast && conversionRate !== undefined && (
        <div className="mt-2 flex items-center text-gray-400 dark:text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span className="ml-1 text-xs font-medium">
            {conversionRate.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

function ApplicationFunnel({ applications }: { applications: Application[] }) {
  const applied = applications.filter(a =>
    ['applied', 'oa', 'phone_screen', 'technical', 'onsite', 'offer'].includes(a.stage)
  ).length;

  const interviewing = applications.filter(a =>
    ['oa', 'phone_screen', 'technical', 'onsite'].includes(a.stage)
  ).length;

  const offers = applications.filter(a => a.stage === 'offer').length;

  // For accepted, we check if there's an accepted event or salary_offered is set
  const accepted = applications.filter(
    a => a.stage === 'offer' && a.salary_offered !== null
  ).length;

  const total = applications.length;

  const funnelStages: Array<{
    label: string;
    count: number;
    color: string;
    conversionRate?: number;
  }> = [
    {
      label: 'Applied',
      count: applied,
      color: 'bg-blue-500',
      conversionRate: applied > 0 ? (interviewing / applied) * 100 : 0,
    },
    {
      label: 'Interview',
      count: interviewing,
      color: 'bg-purple-500',
      conversionRate: interviewing > 0 ? (offers / interviewing) * 100 : 0,
    },
    {
      label: 'Offer',
      count: offers,
      color: 'bg-cyan-500',
      conversionRate: offers > 0 ? (accepted / offers) * 100 : 0,
    },
    {
      label: 'Accepted',
      count: accepted,
      color: 'bg-green-500',
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-6">
        Application Funnel
      </h3>

      <div className="flex justify-around items-start">
        {funnelStages.map((stage, index) => (
          <FunnelStage
            key={stage.label}
            label={stage.label}
            count={stage.count}
            total={total}
            color={stage.color}
            conversionRate={stage.conversionRate}
            isLast={index === funnelStages.length - 1}
          />
        ))}
      </div>

      {/* Funnel visualization line */}
      <div className="mt-6 relative h-2">
        <div className="absolute inset-0 bg-gray-100 dark:bg-gray-700 rounded-full" />
        {applied > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 rounded-full transition-all duration-1000"
            style={{ width: `${Math.max(5, (accepted / applied) * 100)}%` }}
          />
        )}
      </div>
      <div className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
        {applied > 0 ? (
          <>Overall conversion: {((accepted / applied) * 100).toFixed(1)}%</>
        ) : (
          <>No applications yet</>
        )}
      </div>
    </div>
  );
}

function CompanyInsightsTable({ insights }: { insights: CompanyInsight[] }) {
  // Sort by response rate descending and take top 5
  const topCompanies = [...insights]
    .sort((a, b) => b.response_rate - a.response_rate)
    .slice(0, 5);

  if (topCompanies.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
          Top Companies by Response Rate
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <p className="text-sm">Apply to more companies to see insights</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
        Top Companies by Response Rate
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 font-medium">Company</th>
              <th className="text-center py-2 font-medium">Apps</th>
              <th className="text-center py-2 font-medium">Interviews</th>
              <th className="text-center py-2 font-medium">Response</th>
              <th className="text-right py-2 font-medium">Avg Days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {topCompanies.map((company, index) => (
              <tr key={company.company_slug} className="group">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 w-4">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                      {company.company_name}
                    </span>
                  </div>
                </td>
                <td className="py-3 text-center">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {company.application_count}
                  </span>
                </td>
                <td className="py-3 text-center">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {company.interview_count}
                  </span>
                </td>
                <td className="py-3 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      company.response_rate >= 50
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                        : company.response_rate >= 25
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                    )}
                  >
                    {company.response_rate.toFixed(0)}%
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {company.avg_days_to_response > 0
                      ? `${company.avg_days_to_response}d`
                      : '-'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calculateStats(applications: Application[]) {
  const total = applications.length;

  // Response = any stage beyond 'applied' (got OA, interview, offer, or explicit rejection)
  const responded = applications.filter(a =>
    ['oa', 'phone_screen', 'technical', 'onsite', 'offer', 'rejected'].includes(a.stage)
  ).length;

  // Interview = reached any interview stage
  const interviewed = applications.filter(a =>
    ['oa', 'phone_screen', 'technical', 'onsite', 'offer'].includes(a.stage)
  ).length;

  const offers = applications.filter(a => a.stage === 'offer').length;

  const applied = applications.filter(a =>
    a.stage !== 'saved' && a.stage !== 'withdrawn'
  ).length;

  return {
    total,
    responseRate: applied > 0 ? (responded / applied) * 100 : 0,
    interviewRate: applied > 0 ? (interviewed / applied) * 100 : 0,
    offers,
  };
}

export function PipelineStats({ applications, companyInsights }: PipelineStatsProps) {
  const stats = calculateStats(applications);

  return (
    <div className="space-y-6">
      {/* Summary Cards - 4 column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Applications"
          value={stats.total}
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Response Rate"
          value={stats.responseRate}
          suffix="%"
          color="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Interview Rate"
          value={stats.interviewRate}
          suffix="%"
          color="cyan"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Offers"
          value={stats.offers}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
        />
      </div>

      {/* Funnel and Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ApplicationFunnel applications={applications} />
        <CompanyInsightsTable insights={companyInsights} />
      </div>
    </div>
  );
}

export default PipelineStats;
