// Single source of truth for what the NEW auto-apply pipeline supports, shared
// by the job-card button and the queue API so the job section and the
// Auto-Apply section stay in sync. Mirrors scraper/autoapply (prepare.SUPPORTED
// + rules.apply_target_ok).

export const AUTOAPPLY_SUPPORTED_ATS = [
  'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters',
] as const;

export function isAutoApplySupported(ats?: string | null): boolean {
  return !!ats && AUTOAPPLY_SUPPORTED_ATS.includes(ats.toLowerCase() as never);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// TS mirror of rules.apply_target_ok — true only if the URL points at a
// SPECIFIC job we can prepare (not a board root, department page, or blog).
export function validApplyTarget(ats?: string | null, url?: string | null, slug = ''): boolean {
  const a = (ats || '').toLowerCase();
  const u = url || '';
  if (!u.startsWith('http')) return false;
  if (a === 'ashby' || a === 'lever') return UUID_RE.test(u);
  if (a === 'greenhouse') return /(gh_jid=\d{4,}|\/jobs\/\d{4,})/.test(u);
  if (a === 'workday') return /\.myworkdayjobs\.com\/.+\/(job|details)\/.+/.test(u);
  if (a === 'smartrecruiters') return /\/\d{6,}(?:[/?#]|$)/.test(u);
  // generic: non-trivial last path segment that isn't the org slug
  const segs = u.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
  const jid = segs.length ? segs[segs.length - 1] : '';
  return !!jid && jid.toLowerCase() !== (slug || '').toLowerCase() && jid.length >= 5
    && !['jobs', 'careers', 'apply', 'search', 'job'].includes(jid);
}

export function browserApplyUrl(ats?: string | null, url?: string | null): string {
  const a = (ats || '').toLowerCase();
  const value = url || '';
  if (a === 'lever' && /jobs\.lever\.co\//i.test(value) && !/\/apply(?:[/?#]|$)/i.test(value)) {
    return value.replace(/\/+$/, '') + '/apply';
  }
  if (a === 'greenhouse' && /careers\.roblox\.com/i.test(value)) {
    const id = value.match(/[?&]gh_jid=(\d+)/)?.[1] || value.match(/\/jobs\/(\d+)/)?.[1];
    if (id) return 'https://job-boards.greenhouse.io/roblox/jobs/' + id + '#app';
  }  if (a === 'greenhouse' && /greenhouse\.io/i.test(value) && !value.includes('#app')) {
    return value + '#app';
  }
  return value;
}
