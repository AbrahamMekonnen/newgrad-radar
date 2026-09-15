'use client';

import { useEffect, useState, useCallback } from 'react';
import { ToastContainer, useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface Field {
  label: string; name: string; type: string; value: string | null;
  source: string; required: boolean; category?: string;
}
interface App {
  id: string; job_id: string; job_title: string; company_name: string;
  job_url: string; ats_type: string; ready_pct: number;
  needs_user: Field[] | null; prepared_data: Field[] | null;
}

const AUTO_SOURCES = new Set(['profile', 'matched', 'eeo', 'file']);

export default function AutoApplyInboxPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auto-apply/inbox');
      const data = await res.json();
      setApps(data.applications || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: 'applied' | 'skipped') => {
    setApps((prev) => prev.filter((a) => a.id !== id)); // optimistic
    await fetch('/api/auto-apply/inbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    showToast(status === 'applied' ? 'Marked as applied.' : 'Skipped.', 'success');
  };

  const saveEdits = async (app: App) => {
    const e = edits[app.id] || {};
    const fields = (app.prepared_data || []).map((f) =>
      e[f.name] !== undefined ? { ...f, value: e[f.name], source: f.source === 'ai_needed' ? 'ai_drafted' : f.source } : f
    );
    await fetch('/api/auto-apply/inbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: app.id, prepared_data: fields }),
    });
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, prepared_data: fields } : a)));
    showToast('Answers saved.', 'success');
  };

  const copy = (text: string) => { navigator.clipboard?.writeText(text); showToast('Copied.', 'info'); };

  if (loading) return <div className="max-w-3xl mx-auto p-8 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ready to Submit</h1>
          <a href="/settings/auto-apply" className="text-sm font-medium text-indigo-600 dark:text-indigo-400 shrink-0">
            Edit criteria
          </a>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {apps.length === 0
            ? 'No prepared applications yet. Set your criteria in Settings → Auto-Apply and we’ll prepare matches here.'
            : `${apps.length} application${apps.length === 1 ? '' : 's'} prepared from your criteria. Review, then open each to submit (you clear the final captcha).`}
        </p>
      </header>

      <div className="space-y-3">
        {apps.map((app) => {
          const fields = app.prepared_data || [];
          const drafted = fields.filter((f) => f.source === 'ai_drafted' || f.source === 'ai_needed');
          const auto = fields.filter((f) => AUTO_SOURCES.has(f.source));
          const needs = fields.filter((f) => f.source === 'user_needed' && f.required);
          const isOpen = openId === app.id;
          return (
            <div key={app.id} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <button onClick={() => setOpenId(isOpen ? null : app.id)}
                      className="w-full flex items-center justify-between gap-3 p-4 text-left">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{app.job_title}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{app.company_name}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                    app.ready_pct >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400')}>
                    {app.ready_pct}% filled
                  </span>
                  {drafted.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {drafted.length} AI
                    </span>
                  )}
                  {needs.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
                      {needs.length} needs you
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-slate-700 p-4 space-y-4">
                  {/* AI-drafted answers — editable, the time-savers */}
                  {drafted.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-gray-400 mb-2">AI-drafted answers (review & edit)</p>
                      <div className="space-y-3">
                        {drafted.map((f) => (
                          <div key={f.name}>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{f.label}</label>
                              <button onClick={() => copy(edits[app.id]?.[f.name] ?? f.value ?? '')}
                                      className="text-xs text-indigo-600 dark:text-indigo-400">Copy</button>
                            </div>
                            <textarea
                              defaultValue={f.value || ''} rows={4}
                              onChange={(e) => setEdits((prev) => ({ ...prev, [app.id]: { ...(prev[app.id] || {}), [f.name]: e.target.value } }))}
                              placeholder={f.source === 'ai_needed' ? 'Not drafted — add your answer' : ''}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                            />
                          </div>
                        ))}
                      </div>
                      <Button onClick={() => saveEdits(app)} variant="outline" className="mt-2 text-sm">Save answers</Button>
                    </div>
                  )}

                  {/* Auto-filled fields — read-only summary */}
                  {auto.length > 0 && (
                    <details>
                      <summary className="text-xs font-semibold uppercase text-gray-400 cursor-pointer">
                        {auto.length} auto-filled from your profile
                      </summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                        {auto.map((f) => (
                          <div key={f.name} className="text-sm flex gap-2">
                            <span className="text-gray-500 dark:text-gray-400">{f.label}:</span>
                            <span className="text-gray-800 dark:text-gray-200 truncate">{String(f.value || '—')}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {needs.length > 0 && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Needs your input on the form: {needs.map((f) => f.label).join(', ')}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <a href={app.job_url} target="_blank" rel="noopener noreferrer"
                       className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">
                      Open application →
                    </a>
                    <Button onClick={() => setStatus(app.id, 'applied')} variant="outline" className="text-sm">Mark applied</Button>
                    <Button onClick={() => setStatus(app.id, 'skipped')} variant="ghost" className="text-sm">Skip</Button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Open the form, paste the drafted answers above (standard fields are already known),
                    clear the captcha, and submit. Then mark it applied.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
