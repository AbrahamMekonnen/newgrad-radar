'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface AlertJob { id: string; title: string; company_name: string; location?: string | null; url: string; }
interface Match { id: string; job_id: string; delivery_status: string; delivery_mode: string; delivered_at?: string | null; created_at: string; alert_names: string[]; job: AlertJob; }

export function AlertedJobs() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts/history', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok) setMatches(data.matches || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const queue = async (match: Match) => {
    setBusy((prev) => new Set(prev).add(match.job_id));
    try {
      const response = await fetch('/api/auto-apply/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: match.job_id }),
      });
      const data = await response.json();
      setMessages((prev) => ({ ...prev, [match.job_id]: data.message || (response.ok ? 'Added to Auto-Apply.' : 'Could not queue.') }));
    } catch {
      setMessages((prev) => ({ ...prev, [match.job_id]: 'Could not queue this application.' }));
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(match.job_id); return next; });
    }
  };

  if (loading) return <p className="py-10 text-center text-gray-500">Loading notified jobs...</p>;
  if (!matches.length) return <div className="py-12 text-center"><h3 className="font-semibold text-gray-900 dark:text-white">No notified jobs yet</h3><p className="mt-2 text-sm text-gray-500">Jobs that match your alerts will appear here after delivery.</p></div>;

  return <div className="space-y-3">
    <p className="text-sm text-gray-500 dark:text-gray-400">These jobs triggered your push or email alerts. Apply manually or add a supported form to Auto-Apply.</p>
    {matches.map((match) => <article key={match.id} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white">{match.job.title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{match.job.company_name}{match.job.location ? ` - ${match.job.location}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {match.alert_names.map((name) => <span key={name} className="rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-1">{name}</span>)}
            <span className="rounded-full bg-gray-100 dark:bg-slate-700 px-2 py-1 text-gray-600 dark:text-gray-300">{match.delivery_status}</span>
            <span className="text-gray-400 py-1">{new Date(match.delivered_at || match.created_at).toLocaleString()}</span>
          </div>
          {messages[match.job_id] && <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">{messages[match.job_id]}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button onClick={() => queue(match)} disabled={busy.has(match.job_id)} className="text-sm">
            {busy.has(match.job_id) ? 'Adding...' : 'Auto Apply'}
          </Button>
          <a href={match.job.url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-gray-200">Open job</a>
        </div>
      </div>
    </article>)}
  </div>;
}
