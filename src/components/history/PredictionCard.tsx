'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { HiringPrediction, MONTH_NAMES } from '@/lib/types';

export interface PredictionCardProps {
  prediction: HiringPrediction;
  companyName: string;
}

function getUrgencyConfig(monthsAway: number): {
  borderColor: string;
  bgColor: string;
  label: string;
  showUrgentMessage: boolean;
} {
  if (monthsAway <= 1) {
    return {
      borderColor: 'border-red-500 dark:border-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
      label: 'Imminent',
      showUrgentMessage: true,
    };
  }
  if (monthsAway <= 2) {
    return {
      borderColor: 'border-orange-500 dark:border-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-950/30',
      label: 'Soon',
      showUrgentMessage: false,
    };
  }
  if (monthsAway <= 3) {
    return {
      borderColor: 'border-yellow-500 dark:border-yellow-400',
      bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
      label: 'Upcoming',
      showUrgentMessage: false,
    };
  }
  return {
    borderColor: 'border-gray-200 dark:border-gray-700',
    bgColor: 'bg-white dark:bg-gray-800',
    label: 'Predicted',
    showUrgentMessage: false,
  };
}

function getMonthsAway(predictedMonth: number): number {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Assume prediction is for current year or next year
  let monthsAway = predictedMonth - currentMonth;
  if (monthsAway < 0) {
    monthsAway += 12; // Next year
  }

  return monthsAway;
}

function getPredictedYear(predictedMonth: number): number {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // If predicted month has passed this year, it's for next year
  if (predictedMonth < currentMonth) {
    return currentYear + 1;
  }
  return currentYear;
}

export function PredictionCard({ prediction, companyName }: PredictionCardProps) {
  const { monthsAway, urgencyConfig, predictedYear } = useMemo(() => {
    const monthsAway = getMonthsAway(prediction.predicted_month);
    const urgencyConfig = getUrgencyConfig(monthsAway);
    const predictedYear = getPredictedYear(prediction.predicted_month);

    return { monthsAway, urgencyConfig, predictedYear };
  }, [prediction.predicted_month]);

  const confidencePercent = Math.round(prediction.confidence * 100);
  const monthName = MONTH_NAMES[prediction.predicted_month - 1];

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-5 transition-all duration-200',
        urgencyConfig.borderColor,
        urgencyConfig.bgColor
      )}
    >
      {/* Header with company name and confidence */}
      <div className="flex items-start justify-between mb-4">
        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
          {companyName}
        </h4>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {confidencePercent}%
          </span>
          <div className="w-12 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                prediction.confidence >= 0.8
                  ? 'bg-green-500'
                  : prediction.confidence >= 0.6
                  ? 'bg-yellow-500'
                  : 'bg-orange-500'
              )}
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Large month/year display */}
      <div className="mb-4">
        <div className="text-3xl font-bold text-gray-900 dark:text-white">
          {monthName}
        </div>
        <div className="text-xl text-gray-600 dark:text-gray-400">
          {predictedYear}
        </div>
      </div>

      {/* Expected role count */}
      <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Expected:{' '}
        <span className="font-medium text-gray-900 dark:text-white">
          ~{Math.round(prediction.historical_avg_jobs)} roles
        </span>
        {prediction.trend === 'increasing' && (
          <span className="ml-2 text-green-600 dark:text-green-400">
            (trending up)
          </span>
        )}
        {prediction.trend === 'decreasing' && (
          <span className="ml-2 text-red-600 dark:text-red-400">
            (trending down)
          </span>
        )}
      </div>

      {/* Urgency message for imminent hiring */}
      {urgencyConfig.showUrgentMessage && (
        <div className="mt-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/50 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0"
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
            <span className="text-sm font-medium text-red-700 dark:text-red-300">
              Hiring window starts soon - prepare your resume
            </span>
          </div>
        </div>
      )}

      {/* Timing badge */}
      <div className="mt-4 flex items-center justify-between">
        <span
          className={cn(
            'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
            monthsAway <= 1
              ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
              : monthsAway <= 2
              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
              : monthsAway <= 3
              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
          )}
        >
          {urgencyConfig.label}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {monthsAway === 0
            ? 'This month'
            : monthsAway === 1
            ? 'Next month'
            : `In ${monthsAway} months`}
        </span>
      </div>
    </div>
  );
}

export default PredictionCard;
