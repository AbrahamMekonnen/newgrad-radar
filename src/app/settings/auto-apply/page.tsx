'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPERIENCE_LABELS, TIER_LABELS, ExperienceLevel, Tier, RoleType } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { ToastContainer, useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Record<RoleType, string> = {
  swe: 'Software Engineer', ml: 'ML / AI', backend: 'Backend', frontend: 'Frontend',
  fullstack: 'Full Stack', infra: 'Infrastructure', data: 'Data', security: 'Security', mobile: 'Mobile',
};

const LEVELS: ExperienceLevel[] = ['intern', 'new_grad', 'entry_level', 'junior', 'mid', 'senior', 'staff', 'principal'];
const ROLES = Object.keys(ROLE_LABELS) as RoleType[];
const TIERS = Object.keys(TIER_LABELS) as Tier[];

interface Criteria {
  roles: string[];
  experience_levels: string[];
  tiers: string[];
  us_only: boolean;
  sponsorship: boolean;      // require companies that sponsor
  salary_min: number | null;
  keywords: string[];        // title must contain one of these
  exclude_keywords: string[];
}

const EMPTY: Criteria = {
  roles: [], experience_levels: [], tiers: [], us_only: true,
  sponsorship: false, salary_min: null, keywords: [], exclude_keywords: [],
};

function Chips({ options, labels, selected, onToggle }: {
  options: string[]; labels: Record<string, string>; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onToggle(o)}
          className={cn(
            'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
            selected.includes(o)
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:border-indigo-400'
          )}
        >
          {labels[o] || o}
        </button>
      ))}
    </div>
  );
}

export default function AutoApplyCriteriaPage() {
  const supabase = createClient();
  const { toasts, showToast, removeToast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [minMatch, setMinMatch] = useState(0);
  const [c, setC] = useState<Criteria>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase.from('user_profiles')
        .select('auto_apply_rules_enabled, auto_apply_filters, auto_apply_min_match')
        .eq('user_id', user.id).maybeSingle();
      if (data) {
        setEnabled(!!data.auto_apply_rules_enabled);
        setMinMatch(data.auto_apply_min_match || 0);
        setC({ ...EMPTY, ...(data.auto_apply_filters || {}) });
      }
      setLoading(false);
    })();
  }, [supabase]);

  const toggle = useCallback((key: keyof Criteria, v: string) => {
    setC((prev) => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] };
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from('user_profiles').update({
      auto_apply_rules_enabled: enabled,
      auto_apply_min_match: minMatch,
      auto_apply_filters: c,
    }).eq('user_id', user.id);
    if (error) {
      setSaving(false);
      showToast('Could not save. Try again.', 'error');
      return;
    }
    // Kick off matching + preparation right away (don't wait for the schedule).
    let msg = 'Auto-apply criteria saved.';
    if (enabled) {
      try {
        const res = await fetch('/api/auto-apply/run', { method: 'POST' });
        const data = await res.json();
        if (data?.message) msg = data.message;
      } catch { /* falls back to the scheduled run */ }
    }
    setSaving(false);
    showToast(msg, 'success');
  };

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auto-Apply Criteria</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Set your filters once. We&apos;ll prepare an application for every new job that matches —
        you just review and submit. (Your Watchlist companies are handled separately.)
      </p>

      <label className="mt-6 flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-slate-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               className="w-5 h-5 accent-indigo-600" />
        <span className="font-medium text-gray-900 dark:text-white">Enable filter-based auto-apply</span>
      </label>

      <div className={cn('mt-6 space-y-6', !enabled && 'opacity-50 pointer-events-none')}>
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Roles</h2>
          <Chips options={ROLES} labels={ROLE_LABELS} selected={c.roles} onToggle={(v) => toggle('roles', v)} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Experience levels</h2>
          <Chips options={LEVELS} labels={EXPERIENCE_LABELS} selected={c.experience_levels} onToggle={(v) => toggle('experience_levels', v)} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Company tiers</h2>
          <Chips options={TIERS} labels={TIER_LABELS} selected={c.tiers} onToggle={(v) => toggle('tiers', v)} />
        </section>

        <section className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={c.us_only} onChange={(e) => setC({ ...c, us_only: e.target.checked })}
                   className="w-4 h-4 accent-indigo-600" /> US locations only
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={c.sponsorship} onChange={(e) => setC({ ...c, sponsorship: e.target.checked })}
                   className="w-4 h-4 accent-indigo-600" /> Only companies that sponsor visas
          </label>
        </section>

        <section className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-1">Title must include (any)</label>
            <input
              value={c.keywords.join(', ')}
              onChange={(e) => setC({ ...c, keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="backend, python"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-1">Exclude titles containing</label>
            <input
              value={c.exclude_keywords.join(', ')}
              onChange={(e) => setC({ ...c, exclude_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="senior, staff, manager"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-1">Minimum salary (optional)</label>
            <input
              type="number" value={c.salary_min ?? ''}
              onChange={(e) => setC({ ...c, salary_min: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 120000"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-1">
              Minimum resume match: {minMatch}%
            </label>
            <input type="range" min={0} max={100} step={5} value={minMatch}
                   onChange={(e) => setMinMatch(Number(e.target.value))} className="w-full accent-indigo-600" />
            <p className="text-xs text-gray-400">Only apply to jobs at least this good a fit (0 = no limit).</p>
          </div>
        </section>
      </div>

      <div className="mt-8">
        <Button onClick={save} disabled={saving} variant="primary">
          {saving ? 'Saving…' : 'Save criteria'}
        </Button>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
