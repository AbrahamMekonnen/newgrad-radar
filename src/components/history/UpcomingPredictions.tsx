'use client';

import { useMemo } from 'react';
import { HiringPrediction, Company } from '@/lib/types';
import { PredictionCard } from './PredictionCard';

export interface UpcomingPredictionsProps {
  predictions: HiringPrediction[];
  companies: Record<string, Company>;
}

function getMonthsAway(predictedMonth: number): number {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  let monthsAway = predictedMonth - currentMonth;
  if (monthsAway < 0) {
    monthsAway += 12;
  }

  return monthsAway;
}

export function UpcomingPredictions({
  predictions,
  companies,
}: UpcomingPredictionsProps) {
  // Filter to: next 6 months, confidence >= 0.5, limit 10
  const filteredPredictions = useMemo(() => {
    return predictions
      .filter(p => {
        const monthsAway = getMonthsAway(p.predicted_month);
        return monthsAway <= 6 && p.confidence >= 0.5;
      })
      .sort((a, b) => {
        // Sort by months away (ascending), then by confidence (descending)
        const monthsA = getMonthsAway(a.predicted_month);
        const monthsB = getMonthsAway(b.predicted_month);
        if (monthsA !== monthsB) return monthsA - monthsB;
        return b.confidence - a.confidence;
      })
      .slice(0, 10);
  }, [predictions]);

  if (filteredPredictions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No Upcoming Predictions
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          We don&apos;t have high-confidence hiring predictions for the next 6 months yet.
          Check back as more historical data becomes available.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Upcoming Hiring Windows
        </h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {filteredPredictions.length} prediction{filteredPredictions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPredictions.map(prediction => {
          const company = companies[prediction.company_slug];
          const companyName = company?.name || prediction.company_slug;

          return (
            <PredictionCard
              key={`${prediction.company_slug}-${prediction.predicted_month}`}
              prediction={prediction}
              companyName={companyName}
            />
          );
        })}
      </div>
    </div>
  );
}

export default UpcomingPredictions;
