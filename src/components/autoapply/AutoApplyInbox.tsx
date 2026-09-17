'use client';

import { useEffect, useState, useCallback } from 'react';
import { ToastContainer, useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { recordApplicationActivity } from '@/hooks/useStreak';

interface Opt { label: string; value: string }
interface Field {
  label: string; name: string; type: string; value: string | null;
  source: string; required: boolean; category?: string; values?: Opt[];
}

// Show the human label for a stored option value (so "1" reads as "Yes").
function displayValue(f: Field): string {
  const v = f.value;
  if (v === null || v === undefined || v === '') return '-';
  const opt = (f.values || []).find((o) => String(o.value) === String(v));
  return opt ? opt.label : String(v);
}
interface SubmitLog { status?: string; detail?: string; at?: string }
interface App {
  id: string; job_id: string; job_title: string; company_name: string;
  job_url: string; ats_type: string; ready_pct: number; status?: string;
  needs_user: Field[] | null; prepared_data: Field[] | null;
  submit_log?: SubmitLog | null; prepare_log?: SubmitLog | null; submitted_at?: string | null;
}

const AUTO_SOURCES = new Set(['profile', 'matched', 'market', 'eeo', 'file']);

export function AutoApplyInbox({ embedded = false }: { embedded?: boolean }) {
  const { toasts, showToast, removeToast } = useToast();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'ready' | 'submitted' | 'attention'>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/auto-apply/inbox');
      const data = await res.json();
      setApps(data.applications || []);
    } catch { /* ignore */ }
    if (!silent) setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Poll while anything is queued/submitting so cards flip to their result on
  // their own. Stops when nothing is in flight, or after ~2.5 min (a run with
  // no dispatch token only drains on the hourly schedule - no point polling on).
  const pending = apps.some((a) => ['pending', 'processing', 'submit_requested', 'submitting'].includes(a.status || ''));
  const groupFor = (a: App) => {
    if (['pending', 'processing', 'submit_requested', 'submitting'].includes(a.status || '')) return 'active';
    if (a.status === 'submitted' || a.status === 'applied') return 'submitted';
    if (a.status === 'prepared' && !(a.prepared_data || []).some((f) => f.required && f.source === 'user_needed')) return 'ready';
    return 'attention';
  };
  const visibleApps = statusFilter === 'all' ? apps : apps.filter((a) => groupFor(a) === statusFilter);
  useEffect(() => {
    if (!pending) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 30) { clearInterval(t); return; }
      load(true);
    }, 5000);
    return () => clearInterval(t);
  }, [pending, load]);

  const setStatus = async (id: string, status: 'applied' | 'skipped') => {
    setApps((prev) => status === 'skipped'
      ? prev.filter((a) => a.id !== id)
      : prev.map((a) => (a.id === id ? { ...a, status: 'applied' } : a))); // optimistic
    const response = await fetch('/api/auto-apply/inbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!response.ok) {
      await load(true);
      showToast('Could not update the application status.', 'error');
      return;
    }
    if (status === 'applied') recordApplicationActivity();
    showToast(status === 'applied' ? 'Marked as applied.' : 'Skipped.', 'success');
  };

  const retryPreparation = async (app: App) => {
    setBusy((prev) => new Set(prev).add(app.id));
    try {
      const res = await fetch('/api/auto-apply/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: app.job_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: 'pending' } : a)));
      showToast(data.message || 'Retry queued.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not retry preparation.', 'error');
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(app.id); return next; });
    }
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

  // Queue for the background submit worker. It submits captcha-free forms and
  // bounces captcha-gated ones back here with a note - never bypasses a captcha.
  const submit = async (body: { id?: string; all?: boolean }, ids: string[]) => {
    setBusy((prev) => { const n = new Set(prev); ids.forEach((i) => n.add(i)); return n; });
    try {
      const res = await fetch('/api/auto-apply/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      showToast(data.message || 'Queued for submission.', 'info');
      // Optimistically mark queued; the polling effect above picks it up and
      // flips each card to its result (submitted / captcha note) on its own.
      setApps((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, status: 'submit_requested' } : a)));
    } catch {
      showToast('Could not queue for submission.', 'error');
    }
    setBusy((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n; });
  };
  const openPreparedApplication = async (app: App) => {
    setBusy((prev) => new Set(prev).add(app.id));
    try {
      const preparedText = (app.prepared_data || [])
        .filter((field) => field.value !== null && field.value !== undefined && field.value !== '')
        .map((field) => `${field.label}: ${displayValue(field)}`).join('\n');
      if (preparedText) await navigator.clipboard?.writeText(preparedText).catch(() => undefined);
      const response = await fetch('/api/auto-apply/handoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: app.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not create browser handoff');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      showToast('Opening the prepared form. The browser helper will fill it; answers were also copied as a fallback.', 'info');
    } catch (error) {
      window.open(app.job_url, '_blank', 'noopener,noreferrer');
      showToast(error instanceof Error ? `${error.message}. Prepared answers were copied.` : 'Opened the application and copied prepared answers.', 'error');
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(app.id); return next; });
    }
  };

  const readyIds = () => apps.filter((a) => {
    const hasMissing = (a.prepared_data || []).some((f) => f.required && f.source === 'user_needed');
    return (a.status ?? 'prepared') === 'prepared'
      && !hasMissing
      && a.submit_log?.status !== 'needs_captcha';
  }).map((a) => a.id);

  // Complete the missing required fields IN-APP, then finish the application:
  // merge the answers into prepared_data (source 'user'), persist, and submit.
  // No back-and-forth to a blank ATS page for the parts we can collect here.
  const completeAndSubmit = async (app: App, missing: Field[]) => {
    const given = answers[app.id] || {};
    const unanswered = missing.filter((f) => !given[f.name] || given[f.name].trim() === '');
    if (unanswered.length) {
      showToast(`Still need: ${unanswered.map((f) => f.label).join(', ')}`, 'error');
      return;
    }
    const fields = (app.prepared_data || []).map((f) =>
      given[f.name] !== undefined ? { ...f, value: given[f.name], source: 'user' } : f
    );
    const learnedAnswers = Object.fromEntries(missing.map((f) => {
      const raw = given[f.name];
      const option = (f.values || []).find((o) => String(o.value) === String(raw));
      return [f.label, option?.label || raw];
    }));
    setApps((prev) => prev.map((a) => (a.id === app.id ? {
      ...a, prepared_data: fields, ready_pct: 100, needs_user: [],
    } : a)));
    const saved = await fetch('/api/auto-apply/inbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: app.id, prepared_data: fields, ready_pct: 100,
        needs_user: [], learned_answers: learnedAnswers,
      }),
    });
    if (!saved.ok) {
      showToast('Could not save your answers.', 'error');
      return;
    }
    if (app.submit_log?.status === 'needs_captcha') {
      showToast('Answers saved for future applications. Use "Open & finish" to complete the captcha.', 'success');
      return;
    }
    await submit({ id: app.id }, [app.id]);
  };

  if (loading) return <div className="max-w-3xl mx-auto p-8 text-gray-500">Loading...</div>;

  return (
    <div className={embedded ? "w-full" : "max-w-3xl mx-auto px-4 sm:px-6 py-8"}>
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auto-Apply Queue</h1>
          <div className="flex items-center gap-3 shrink-0">
            {readyIds().length > 0 && (
              <button
                onClick={() => submit({ all: true }, readyIds())}
                className="text-sm font-medium px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
                Submit all ({readyIds().length})
              </button>
            )}
            <a href="/settings/auto-apply" className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              Edit criteria
            </a>
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {apps.length === 0
            ? 'No applications are in the queue yet. Choose Auto Apply on a job card or set criteria in Settings.'
            : `${apps.length} application${apps.length === 1 ? '' : 's'} in your live queue.`}
        </p>
        {pending && (
          <p className="mt-2 flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Preparing or submitting in the background - results will appear here automatically.
          </p>
        )}
      </header>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-3 scrollbar-hide">
        {([
          ['all', 'All'], ['active', 'In progress'], ['ready', 'Ready'],
          ['attention', 'Needs attention'], ['submitted', 'Submitted'],
        ] as const).map(([value, label]) => {
          const count = value === 'all' ? apps.length : apps.filter((a) => groupFor(a) === value).length;
          return (
            <button key={value} onClick={() => setStatusFilter(value)}
              className={cn('px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap',
                statusFilter === value ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300')}>
              {label}{count > 0 && <span className="ml-1.5 opacity-75">({count})</span>}
            </button>
          );
        })}
      </div>
      <div className="space-y-3">
        {visibleApps.map((app) => {
          const fields = app.prepared_data || [];
          const drafted = fields.filter((f) => f.source === 'ai_drafted' || f.source === 'ai_needed');
          const auto = fields.filter((f) => AUTO_SOURCES.has(f.source));
          const needs = fields.filter((f) => f.source === 'user_needed' && f.required);
          const knownCaptcha = app.submit_log?.status === 'needs_captcha';
          const preparing = app.status === 'pending' || app.status === 'processing';
          const completed = app.status === 'submitted' || app.status === 'applied';
          const retryable = app.status === 'error' || app.status === 'form_fetch_failed';
          const unavailable = ['form_unavailable', 'unsupported', 'job_missing'].includes(app.status || '');
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
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200">
                    {(app.status || 'pending').replace('_', ' ')}
                  </span>
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
                  {/* AI-drafted answers - editable, the time-savers */}
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
                              placeholder={f.source === 'ai_needed' ? 'Not drafted - add your answer' : ''}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                            />
                          </div>
                        ))}
                      </div>
                      <Button onClick={() => saveEdits(app)} variant="outline" className="mt-2 text-sm">Save answers</Button>
                    </div>
                  )}

                  {/* Auto-filled fields - read-only summary */}
                  {auto.length > 0 && (
                    <details>
                      <summary className="text-xs font-semibold uppercase text-gray-400 cursor-pointer">
                        {auto.length} auto-filled from your profile
                      </summary>
                      <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                        {auto.map((f) => (
                          <div key={f.name} className="text-sm flex gap-2">
                            <span className="text-gray-500 dark:text-gray-400">{f.label}:</span>
                            <span className="text-gray-800 dark:text-gray-200 truncate">{displayValue(f)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Complete the missing required fields here - no trip to a blank ATS page. */}
                  {needs.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-gray-400 mb-2">
                        Complete the rest ({needs.length}) - we finish it for you
                      </p>
                      <div className="space-y-3">
                        {needs.map((f) => {
                          const val = answers[app.id]?.[f.name] ?? '';
                          const set = (v: string) => setAnswers((prev) => ({
                            ...prev, [app.id]: { ...(prev[app.id] || {}), [f.name]: v },
                          }));
                          const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700';
                          return (
                            <div key={f.name}>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {f.label}{f.required && <span className="text-red-500"> *</span>}
                              </label>
                              {f.category === 'consent' ? (
                                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                  <input type="checkbox" checked={!!val}
                                    onChange={(e) => set(e.target.checked ? (f.values?.[0]?.value ?? 'Yes') : '')} />
                                  I have read and acknowledge this.
                                </label>
                              ) : (f.values && f.values.length > 0) ? (
                                <select value={val} onChange={(e) => set(e.target.value)} className={inputCls}>
                                  <option value="">Select...</option>
                                  {f.values.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              ) : f.category === 'age' ? (
                                <select value={val} onChange={(e) => set(e.target.value)} className={inputCls}>
                                  <option value="">Select...</option>
                                  <option value="Yes">Yes</option>
                                  <option value="No">No</option>
                                </select>
                              ) : (f.type || '').includes('textarea') ? (
                                <textarea value={val} rows={3} onChange={(e) => set(e.target.value)} className={inputCls} />
                              ) : (
                                <input type="text" value={val} onChange={(e) => set(e.target.value)} className={inputCls} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <Button onClick={() => completeAndSubmit(app, needs)} className="mt-3 text-sm">
                        Complete &amp; submit
                      </Button>
                    </div>
                  )}

                  {/* Result of the last background submit attempt, if any */}
                  {app.submit_log?.status === 'needs_captcha' && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      This form requires a browser CAPTCHA. Open it with the browser helper to fill your saved answers, then review and submit.
                    </p>
                  )}
                  {(app.submit_log?.status === 'submit_failed' || app.submit_log?.status === 'incomplete') && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Auto-submit did not complete ({app.submit_log?.detail}). Open the form to submit it yourself.
                    </p>
                  )}

                  {(retryable || unavailable) && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Preparation needs attention{app.prepare_log?.detail ? ': ' + app.prepare_log.detail : '.'}
                    </p>
                  )}
                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {preparing ? (
                      <Button disabled variant="outline" className="text-sm">Preparing...</Button>
                    ) : completed ? (
                      <Button disabled variant="outline" className="text-sm">Submitted</Button>
                    ) : retryable ? (
                      <Button disabled={busy.has(app.id)} onClick={() => retryPreparation(app)} className="text-sm">
                        {busy.has(app.id) ? 'Retrying...' : 'Retry preparation'}
                      </Button>
                    ) : unavailable ? (
                      <Button disabled variant="outline" className="text-sm">Manual application needed</Button>
                    ) : knownCaptcha ? (
                      <Button disabled={busy.has(app.id)} onClick={() => openPreparedApplication(app)} className="text-sm">
                        {busy.has(app.id) ? 'Preparing browser...' : 'Open & finish'}
                      </Button>
                    ) : (app.status === 'submit_requested' || app.status === 'submitting' || busy.has(app.id)) ? (
                      <Button disabled variant="outline" className="text-sm">Submitting...</Button>
                    ) : (
                      <Button disabled={needs.length > 0}
                        onClick={() => submit({ id: app.id }, [app.id])} className="text-sm">
                        {needs.length > 0 ? 'Complete required answers first' : 'Submit for me'}
                      </Button>
                    )}
                    {!knownCaptcha && (
                      <a href={app.job_url} target="_blank" rel="noopener noreferrer"
                         className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 text-sm font-medium">
                        Open application
                      </a>
                    )}
                    <Button onClick={() => setStatus(app.id, 'applied')} variant="outline" className="text-sm">Mark applied</Button>
                    <Button onClick={() => setStatus(app.id, 'skipped')} variant="ghost" className="text-sm">Skip</Button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Complete CAPTCHA in your browser. The autofill helper transfers prepared answers into supported ATS forms.
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
