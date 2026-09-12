'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

type ReportType = 'bug' | 'feature' | 'feedback';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'wontfix';

interface FeedbackReport {
  id: string;
  user_id: string;
  type: ReportType;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  screenshot_url: string | null;
  created_at: string;
  updated_at: string;
}

const TYPE_OPTIONS: { value: ReportType; label: string; icon: string; description: string }[] = [
  { value: 'bug', label: 'Bug Report', icon: '!', description: 'Something is broken or not working' },
  { value: 'feature', label: 'Feature Request', icon: '+', description: 'Suggest a new feature or improvement' },
  { value: 'feedback', label: 'General Feedback', icon: '?', description: 'Share your thoughts or suggestions' },
];

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
];

const STATUS_LABELS: Record<Status, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  acknowledged: { label: 'Acknowledged', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  in_progress: { label: 'In Progress', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  wontfix: { label: "Won't Fix", color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
};

export default function FeedbackPage() {
  return (
    <AuthGuard>
      {() => <FeedbackContent />}
    </AuthGuard>
  );
}

function FeedbackContent() {
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<ReportType>('feedback');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [screenshotUrl, setScreenshotUrl] = useState('');

  const supabase = createClient();

  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('feedback_reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reports:', error);
    } else {
      setReports(data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const resetForm = () => {
    setType('feedback');
    setTitle('');
    setDescription('');
    setPriority('medium');
    setScreenshotUrl('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    if (!description.trim()) {
      setError('Please enter a description');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          type,
          title: title.trim(),
          description: description.trim(),
          priority,
          screenshot_url: screenshotUrl.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit report');
      }

      setSuccess('Your report has been submitted successfully!');
      resetForm();
      fetchReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Feedback</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Report bugs, request features, or share your thoughts
        </p>
      </div>

      {/* Submit Form */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-slate-700/50 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Submit a Report</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setType(option.value)}
                  className={cn(
                    'p-4 rounded-lg border text-center transition-colors',
                    type === option.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500'
                  )}
                >
                  <span className={cn(
                    'block text-2xl font-bold mb-1',
                    type === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
                  )}>
                    {option.icon}
                  </span>
                  <span className={cn(
                    'block text-sm font-medium',
                    type === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                  )}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <Input
            label="Title"
            id="feedback-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'bug' ? 'Brief description of the issue' : 'Brief summary of your request'}
            required
          />

          {/* Description */}
          <div>
            <label htmlFor="feedback-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              id="feedback-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === 'bug'
                ? 'What happened? What were you expecting? Steps to reproduce...'
                : 'Describe your suggestion in detail...'}
              rows={5}
              className="w-full px-3 py-2 border rounded-lg shadow-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 dark:border-slate-600"
              required
            />
          </div>

          {/* Priority (only show for bugs) */}
          {type === 'bug' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Priority
              </label>
              <div className="flex gap-2 flex-wrap">
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPriority(option.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      option.color,
                      priority === option.value
                        ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-slate-800'
                        : 'opacity-60 hover:opacity-100'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Screenshot URL */}
          <Input
            label="Screenshot URL (optional)"
            id="feedback-screenshot"
            value={screenshotUrl}
            onChange={(e) => setScreenshotUrl(e.target.value)}
            placeholder="https://imgur.com/... or any image URL"
            type="url"
          />

          {/* Error/Success messages */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
              {success}
            </div>
          )}

          {/* Submit button */}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Report'}
            </Button>
          </div>
        </form>
      </div>

      {/* Previous Reports */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-slate-700/50 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Your Reports</h2>

        {loading ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-8">
            <svg
              className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No reports yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Your submitted reports will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <div
                key={report.id}
                className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        report.type === 'bug' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        report.type === 'feature' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      )}>
                        {report.type === 'bug' ? 'Bug' : report.type === 'feature' ? 'Feature' : 'Feedback'}
                      </span>
                      <span className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        STATUS_LABELS[report.status].color
                      )}>
                        {STATUS_LABELS[report.status].label}
                      </span>
                      {report.type === 'bug' && (
                        <span className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          PRIORITY_OPTIONS.find(p => p.value === report.priority)?.color
                        )}>
                          {report.priority}
                        </span>
                      )}
                    </div>
                    <h3 className="font-medium text-gray-900 dark:text-white truncate">
                      {report.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {report.description}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {formatDate(report.created_at)}
                  </div>
                </div>
                {report.screenshot_url && (
                  <a
                    href={report.screenshot_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    View Screenshot
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
