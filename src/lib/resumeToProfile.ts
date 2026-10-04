import { UserProfile } from '@/lib/types';
import { ResumeData } from '@/lib/resume-templates';

/**
 * Map parsed resume data onto the auto-apply profile.
 *
 * Deterministic (no LLM) — the LLM already did the hard extraction into
 * ResumeData; this just maps those fields onto UserProfile. Rules:
 *  - Only fill fields the user hasn't already set (never overwrite their input).
 *  - Only fill values that pass a basic validity check.
 *  - Report which fields were filled, and which important ones still need the
 *    user (things a resume can't tell us: work auth, sponsorship, etc.).
 */

export interface ResumeMapResult {
  updates: Partial<UserProfile>;
  filled: { field: string; label: string }[];
  updated: { field: string; label: string }[];
  missing: { field: string; label: string }[];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function normUrl(u: string | undefined | null, host?: string): string | null {
  if (!u) return null;
  let s = u.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(s);
    if (host && !parsed.hostname.toLowerCase().includes(host)) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function looksLikeEmail(s: string | undefined | null): boolean {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Split "City, ST" / "City, State" into parts. */
function splitLocation(loc: string | undefined | null): { city: string | null; state: string | null } {
  if (!loc) return { city: null, state: null };
  const parts = loc.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state: parts[1] };
  if (parts.length === 1) return { city: parts[0], state: null };
  return { city: null, state: null };
}

/** "B.S. in Computer Science" -> { degree: "B.S.", major: "Computer Science" }. Best-effort. */
function splitDegree(degree: string | undefined | null): { degree: string | null; major: string | null } {
  if (!degree) return { degree: null, major: null };
  const d = degree.trim();
  // Split on " in " or a comma only — NOT " of ", so "Bachelor of Science in X"
  // keeps "Bachelor of Science" as the degree and "X" as the major.
  const m = d.match(/^(.*?)(?:\s+in\s+|,\s*)(.+)$/i);
  if (m && m[2]) return { degree: m[1].trim() || null, major: m[2].trim() };
  return { degree: d, major: null };
}

/** Take the end of a "Start - End" / "Start – End" date range. */
function endOfRange(date: string | undefined | null): string | null {
  if (!date) return null;
  const parts = date.split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : date.trim() || null;
}

// Important fields a resume simply can't provide — surfaced as "still needed".
const MANUAL_FIELDS: { field: keyof UserProfile; label: string }[] = [
  { field: 'work_authorization', label: 'Work authorization' },
  { field: 'require_sponsorship', label: 'Sponsorship requirement' },
  { field: 'years_experience', label: 'Years of experience' },
];

export function mapResumeToProfile(resume: ResumeData, existing: UserProfile): ResumeMapResult {
  const updates: Partial<UserProfile> = {};
  const filled: { field: string; label: string }[] = [];
  const updated: { field: string; label: string }[] = [];

  // Compare normalized, so cosmetic differences (case/whitespace) aren't "changes".
  const sameScalar = (a: unknown, b: unknown) =>
    String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const sameDeep = (a: unknown, b: unknown) => {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  };

  // Fill when empty, UPDATE when the résumé's value genuinely differs (so an
  // updated résumé actually corrects things), skip when unchanged. The caller
  // shows these for review before saving, so an update is a suggestion the user
  // confirms — not a silent overwrite.
  const set = <K extends keyof UserProfile>(field: K, value: UserProfile[K] | null, label: string) => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return;
    const cur = existing[field];
    if (isEmpty(cur)) { updates[field] = value as UserProfile[K]; filled.push({ field: field as string, label }); }
    else if (!sameScalar(cur, value)) { updates[field] = value as UserProfile[K]; updated.push({ field: field as string, label }); }
  };
  const setArray = <K extends keyof UserProfile>(field: K, value: UserProfile[K], label: string) => {
    if (!Array.isArray(value) || value.length === 0) return;
    const cur = existing[field];
    if (isEmpty(cur)) { updates[field] = value; filled.push({ field: field as string, label }); }
    else if (!sameDeep(cur, value)) { updates[field] = value; updated.push({ field: field as string, label }); }
  };

  // Name -> first / last
  if (resume.name) {
    const tokens = resume.name.trim().split(/\s+/);
    if (tokens.length >= 1) set('first_name', tokens[0], 'First name');
    if (tokens.length >= 2) set('last_name', tokens.slice(1).join(' '), 'Last name');
  }

  if (looksLikeEmail(resume.email)) set('email', resume.email.trim(), 'Email');
  if (resume.phone) set('phone', resume.phone.trim(), 'Phone');
  if (resume.location) set('location', resume.location.trim(), 'Location');

  const { city, state } = splitLocation(resume.location);
  set('city', city, 'City');
  set('state', state, 'State');

  set('linkedin_url', normUrl(resume.linkedin, 'linkedin.com'), 'LinkedIn');
  set('github_url', normUrl(resume.github, 'github.com'), 'GitHub');
  set('portfolio_url', normUrl(resume.portfolio), 'Portfolio');

  // Most-recent experience -> current company/title; the rest -> prior employers.
  const exp = resume.experience || [];
  if (exp.length) {
    set('current_company', exp[0].company, 'Current company');
    set('current_title', exp[0].title, 'Current title');
    const priors = Array.from(
      new Set(exp.slice(1).map((e) => (e.company || '').trim()).filter(Boolean)),
    );
    setArray('prior_employers', priors, 'Prior employers');
  }

  // Most-recent education.
  const edu = (resume.education || [])[0];
  if (edu) {
    set('education_school', edu.school, 'School');
    const { degree, major } = splitDegree(edu.degree);
    set('education_degree', degree, 'Degree');
    set('education_major', major, 'Major');
    set('education_graduation_date', endOfRange(edu.date), 'Graduation date');
    set('education_gpa', edu.gpa || null, 'GPA');
  }

  // Full structured history for ATS "re-enter each job / school" sections. Only
  // set when the user hasn't already built these, so résumé re-parses never clobber edits.
  const rng = (d?: string | null) => {
    const parts = (d || '').split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
    return parts.length >= 2
      ? { start: parts[0], end: parts.slice(1).join(' - ') }
      : { start: null, end: parts[0] || null };
  };
  if (exp.length) {
    setArray('work_experience', exp.map((e) => {
      const { start, end } = rng(e.date);
      return {
        company: e.company || null, title: e.title || null, location: e.location || null,
        start_date: start, end_date: end, current: /present|current/i.test(e.date || ''),
        bullets: Array.isArray(e.bullets) ? e.bullets : [],
      };
    }), `Work experience (${exp.length} role${exp.length === 1 ? '' : 's'})`);
  }
  const eduAll = resume.education || [];
  if (eduAll.length) {
    setArray('education_history', eduAll.map((ed) => {
      const { degree: deg, major: maj } = splitDegree(ed.degree);
      const { start, end } = rng(ed.date);
      return { school: ed.school || null, degree: deg, major: maj, location: ed.location || null, start_date: start, end_date: end, gpa: ed.gpa || null };
    }), `Education (${eduAll.length})`);
  }
  const projAll = resume.projects || [];
  if (projAll.length) {
    setArray('projects', projAll.map((p) => ({ name: p.name || null, technologies: p.technologies || null, date: p.date || null, bullets: Array.isArray(p.bullets) ? p.bullets : [] })), `Projects (${projAll.length})`);
  }
  const skillAll = resume.skills || [];
  if (skillAll.length) {
    setArray('skills_list', skillAll.map((s) => ({ category: s.category || null, items: Array.isArray(s.items) ? s.items : [] })), 'Skills');
  }

  // Sensitive/legal facts ONLY when the résumé explicitly stated them — the parser
  // returns null for anything it can't read verbatim (it never infers citizenship,
  // work auth, etc. from school/name/employer). Normalize the enum ones to the
  // profile's dropdown options so they render; store the rest as reusable facts.
  const sf = resume.stated_facts;
  if (sf) {
    const WORK_AUTH = ['US Citizen', 'Permanent Resident', 'Visa Holder (H1B, L1, etc.)', 'Student Visa (F1, OPT, CPT)', 'Other'];
    const CITIZEN = ['U.S. citizen', 'Lawful U.S. permanent resident', 'Other'];
    const ENGLISH = ['A1 (Beginner)', 'A2 (Pre-Intermediate)', 'B1 (Intermediate)', 'B2 (Upper-Intermediate)', 'C1 (Advanced)', 'C2 (Native)'];

    if (sf.work_authorization && WORK_AUTH.includes(sf.work_authorization)) {
      set('work_authorization', sf.work_authorization, 'Work authorization');
    }
    // Models sometimes return the boolean as the string "true"/"false" — accept both.
    const rawSponsor = sf.requires_sponsorship as unknown;
    const sponsor = typeof rawSponsor === 'boolean' ? rawSponsor
      : rawSponsor === 'true' ? true
      : rawSponsor === 'false' ? false : null;
    if (sponsor !== null) {
      if (isEmpty(existing.require_sponsorship)) {
        updates.require_sponsorship = sponsor;
        filled.push({ field: 'require_sponsorship', label: 'Sponsorship requirement' });
      } else if (existing.require_sponsorship !== sponsor) {
        updates.require_sponsorship = sponsor;
        updated.push({ field: 'require_sponsorship', label: 'Sponsorship requirement' });
      }
    }

    // Reusable facts live in custom_answers under __fact:<key> (same keys the
    // resolver reads). Fill when empty, update when the résumé now states a
    // different value.
    const factAdds: Record<string, string> = {};
    const addFact = (key: string, value: string | null | undefined, label: string) => {
      if (!value || !value.trim()) return;
      const cur = (existing.custom_answers || {})['__fact:' + key];
      if (isEmpty(cur)) { factAdds['__fact:' + key] = value.trim(); filled.push({ field: 'fact:' + key, label }); }
      else if (!sameScalar(cur, value)) { factAdds['__fact:' + key] = value.trim(); updated.push({ field: 'fact:' + key, label }); }
    };
    addFact('citizenship_status', sf.citizenship_status && CITIZEN.includes(sf.citizenship_status) ? sf.citizenship_status : null, 'Citizenship status');
    addFact('security_clearance', sf.security_clearance, 'Security clearance');
    addFact('military_service', sf.military_service, 'Military service');
    addFact('other_languages', sf.languages, 'Other languages');
    addFact('english_level', sf.english_proficiency && ENGLISH.includes(sf.english_proficiency) ? sf.english_proficiency : null, 'English proficiency');
    if (Object.keys(factAdds).length) {
      updates.custom_answers = { ...(existing.custom_answers || {}), ...factAdds };
    }
  }

  const missing = MANUAL_FIELDS.filter((m) => isEmpty(existing[m.field]) && isEmpty(updates[m.field]));

  return { updates, filled, updated, missing };
}
