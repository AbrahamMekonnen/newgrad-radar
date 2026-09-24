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

  const set = <K extends keyof UserProfile>(field: K, value: UserProfile[K] | null, label: string) => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return;
    if (!isEmpty(existing[field])) return; // never overwrite user-entered data
    updates[field] = value as UserProfile[K];
    filled.push({ field: field as string, label });
  };

  // Name -> first / last
  if (resume.name && (isEmpty(existing.first_name) || isEmpty(existing.last_name))) {
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
    if (priors.length && isEmpty(existing.prior_employers)) {
      updates.prior_employers = priors;
      filled.push({ field: 'prior_employers', label: 'Prior employers' });
    }
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

  const missing = MANUAL_FIELDS.filter((m) => isEmpty(existing[m.field]) && isEmpty(updates[m.field]));

  return { updates, filled, missing };
}
