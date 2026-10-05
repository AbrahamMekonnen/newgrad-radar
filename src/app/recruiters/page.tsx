'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Recruiter } from '@/lib/types';
import { RecruiterList } from '@/components/recruiters/RecruiterList';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { searchCompanies } from '@/lib/companySearch';
import { EmailComposeMenu } from '@/components/recruiters/EmailComposeMenu';

interface CompanyRow {
  slug: string;
  name: string;
  logo_url: string | null;
}

type Focus = 'all' | 'new_grad' | 'experienced';

const FOCUS_TABS: { value: Focus; label: string }[] = [
  { value: 'all', label: 'All Recruiters' },
  { value: 'new_grad', label: 'New Grad / Campus' },
  { value: 'experienced', label: 'Experienced / Technical' },
];

// Which recruiters to show for the selected focus. 'generic' recruiters fit any
// focus, so they always show unless viewing "all".
function filterByFocus(recruiters: Recruiter[], focus: Focus): Recruiter[] {
  if (focus === 'all') return recruiters;
  return recruiters.filter((r) => !r.role_focus || r.role_focus === 'generic' || r.role_focus === focus);
}

export default function RecruitersPage() {
  const supabase = createClient();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CompanyRow[]>([]);
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [focus, setFocus] = useState<Focus>('all');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Signed-out visitors get a redacted teaser (count + titles only, no names/
  // emails) so the page entices sign-up without leaking the payoff.
  const [isGuest, setIsGuest] = useState(false);
  const [preview, setPreview] = useState<{ id: string; title: string | null; role_focus: string | null; hasEmail: boolean; hasLinkedin: boolean }[]>([]);
  const [previewCount, setPreviewCount] = useState(0);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setIsGuest(!data.user)); }, [supabase]);

  // Live company-name suggestions as the user types.
  const runSuggest = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setMatches([]);
      return;
    }
    const ranked = await searchCompanies<CompanyRow>(supabase, q, {
      select: 'slug, name, logo_url',
      limit: 8,
    });
    setMatches(ranked);
  }, [supabase]);

  const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setSelected(null);
    setSearched(false);
    setRequested(false);
    setReqError(null);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSuggest(v), 200);
  };

  // Pressing Enter should just search — pick the best match instead of forcing
  // the user to click a suggestion. If suggestions are already shown, take the
  // top one; otherwise run the search now (the debounce may not have fired yet).
  const onSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (debounce.current) clearTimeout(debounce.current);
    if (matches.length > 0) {
      selectCompany(matches[0]);
      return;
    }
    const q = query.trim();
    if (q.length < 2) return;
    const results = await searchCompanies<CompanyRow>(supabase, q, {
      select: 'slug, name, logo_url',
      limit: 8,
    });
    if (results.length > 0) {
      selectCompany(results[0]);
    } else {
      setMatches([]);
      setSearched(true); // shows the "not available / request" panel
    }
  };

  const selectCompany = useCallback(async (company: CompanyRow) => {
    setSelected(company);
    setMatches([]);
    setQuery(company.name);
    setLoading(true);
    setSearched(true);
    setRequested(false);
    setReqError(null);
    if (isGuest) {
      // Load the redacted teaser from the server — never the raw rows (emails).
      setRecruiters([]);
      try {
        const res = await fetch(`/api/recruiters?company_slug=${encodeURIComponent(company.slug)}`);
        const body = await res.json().catch(() => ({}));
        setPreview(body.preview || []);
        setPreviewCount(body.count || 0);
      } catch {
        setPreview([]); setPreviewCount(0);
      }
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('recruiters')
      .select('*')
      .eq('company_slug', company.slug)
      .order('email_verified', { ascending: false });
    setRecruiters((data as Recruiter[]) || []);
    setLoading(false);
  }, [supabase, isGuest]);

  const requestCompany = async () => {
    const name = selected?.name || query.trim();
    if (!name) return;
    setRequesting(true);
    setReqError(null);
    try {
      const res = await fetch('/api/recruiter-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companySlug: selected?.slug || null, companyName: name }),
      });
      if (res.ok) {
        setRequested(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setReqError(body?.error || 'Could not submit the request. Please try again.');
      }
    } catch {
      setReqError('Network error — please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const shown = filterByFocus(recruiters, focus);

  // "Email all recruiters": one compose window pre-addressed to every listed
  // recruiter, with a ready-to-send draft. The EmailComposeMenu offers
  // Gmail/Outlook web compose + mailto + copy so it works regardless of the
  // user's setup.
  const shownEmails = Array.from(
    new Set(shown.map((r) => (r.email || '').trim()).filter(Boolean))
  ).slice(0, 25);
  const emailAllSubject = selected ? `Interest in opportunities at ${selected.name}` : '';
  const emailAllBody = selected
    ? `Hi there,\n\n` +
      `I'm reaching out about early-career software engineering opportunities at ${selected.name}. ` +
      `I'd love to learn more about any open roles that could be a fit for my background, ` +
      `and I've attached my resume for your reference.\n\n` +
      `Would you have a few minutes to connect?\n\n` +
      `Thanks so much for your time,\n[Your Name]\n[Your LinkedIn / phone]`
    : '';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recruiters</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Find recruiters at a company and reach out directly. Each has likely work
          emails and a LinkedIn — email all the listed addresses so at least one lands.
        </p>
      </header>

      {/* Company search */}
      <div className="relative">
        <Input
          id="recruiter-company-search"
          label=""
          placeholder="Search a company (e.g. Stripe, Databricks)…"
          value={query}
          onChange={onQueryChange}
          onKeyDown={onSearchKeyDown}
          autoComplete="off"
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-auto">
            {matches.map((m) => (
              <li key={m.slug}>
                <button
                  onClick={() => selectCompany(m)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                  {m.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.logo_url} alt="" className="w-5 h-5 rounded" />
                  ) : (
                    <span className="w-5 h-5 rounded bg-gray-200 dark:bg-slate-600" />
                  )}
                  <span className="text-sm text-gray-900 dark:text-white">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Focus filter */}
      {selected && !isGuest && (
        <div className="mt-4 flex flex-wrap gap-2">
          {FOCUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setFocus(t.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                focus === t.value
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="mt-6">
        {loading && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading recruiters…</p>
        )}

        {!loading && selected && shown.length > 0 && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {shown.length} recruiter{shown.length === 1 ? '' : 's'} at{' '}
                <span className="font-medium text-gray-900 dark:text-white">{selected.name}</span>
              </p>
              {shownEmails.length > 0 && (
                <EmailComposeMenu
                  emails={shownEmails}
                  subject={emailAllSubject}
                  body={emailAllBody}
                  label={`Email all ${shownEmails.length}`}
                />
              )}
            </div>
            <RecruiterList recruiters={shown} maxVisible={shown.length} />
          </>
        )}

        {/* Guest teaser: real count + blurred rows, contacts gated behind sign-in. */}
        {isGuest && !loading && selected && previewCount > 0 && (
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              <span className="font-semibold text-gray-900 dark:text-white">{previewCount} recruiter{previewCount === 1 ? '' : 's'}</span> at{' '}
              <span className="font-medium text-gray-900 dark:text-white">{selected.name}</span> — with likely work emails and LinkedIn.
            </p>
            <div className="relative">
              <ul className="space-y-2" aria-hidden="true">
                {preview.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-slate-700 p-3">
                    <div className="min-w-0">
                      <div className="h-4 w-40 max-w-[50vw] rounded bg-gray-200 dark:bg-slate-700 blur-[2px]" />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">{r.title || 'Recruiter'}</p>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400">
                      {r.hasEmail && <span className="text-xs rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 blur-[2px]">email</span>}
                      {r.hasLinkedin && <span className="text-xs rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 blur-[2px]">in</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="absolute inset-x-0 bottom-0 top-8 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-slate-900 dark:via-slate-900/90 rounded-lg p-4">
                <p className="text-center text-sm font-semibold text-gray-900 dark:text-white">
                  Sign in to reveal {previewCount} recruiter{previewCount === 1 ? '' : 's'}&apos; names, titles, and verified emails.
                </p>
                <div className="flex items-center gap-3">
                  <Link href="/auth/signup?redirect=/recruiters" className="inline-flex items-center px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm">
                    Create account to reveal
                  </Link>
                  <Link href="/auth/login?redirect=/recruiters" className="text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline">
                    or sign in
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && searched && selected && recruiters.length === 0 && (!isGuest || previewCount === 0) && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              We don&apos;t have recruiters for{' '}
              <span className="font-medium">{selected.name}</span> yet.
            </p>
            {requested ? (
              <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                Requested — we&apos;ll source them on the next update. Check back soon.
              </p>
            ) : (
              <>
                <Button onClick={requestCompany} disabled={requesting} className="mt-3">
                  {requesting ? 'Requesting…' : 'Request recruiters for this company'}
                </Button>
                {reqError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{reqError}</p>
                )}
              </>
            )}
          </div>
        )}

        {!loading && selected && recruiters.length > 0 && shown.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No {focus === 'new_grad' ? 'campus/new-grad' : 'experienced/technical'} recruiters
            for {selected.name}. Try “All Recruiters”.
          </p>
        )}

        {!selected && query.trim().length >= 2 && matches.length === 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              No company matches “{query.trim()}”.
            </p>
            {requested ? (
              <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                Requested — we&apos;ll try to source recruiters for it.
              </p>
            ) : (
              <>
                <Button onClick={requestCompany} disabled={requesting} className="mt-3">
                  {requesting ? 'Requesting…' : `Request recruiters for “${query.trim()}”`}
                </Button>
                {reqError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{reqError}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
