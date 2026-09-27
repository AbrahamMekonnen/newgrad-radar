type SalaryJob = { salary_min?: number | null; salary_max?: number | null };
type SalaryProfile = {
  salary_type?: 'range' | 'specific' | 'negotiable' | 'market_rate' | null;
  salary_min?: number | null; salary_max?: number | null; salary_target?: number | null;
  salary_expectation?: string | null; salary_display_strategy?: string | null;
};

const valid = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value) && value >= 40_000 && value <= 1_000_000;
const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

export function salaryEvidence(job: SalaryJob | null | undefined, profile: SalaryProfile | null | undefined) {
  if (valid(job?.salary_min) && valid(job?.salary_max))
    return { min: job.salary_min, max: job.salary_max, source: 'job_posting' as const };
  if (valid(job?.salary_min))
    return { min: job.salary_min, max: Math.round(job.salary_min * 1.15 / 1000) * 1000, source: 'job_posting' as const };
  if (profile?.salary_type === 'specific' && valid(profile.salary_target))
    return { min: profile.salary_target, max: profile.salary_target, source: 'profile_target' as const };
  if (profile?.salary_type === 'range' && valid(profile.salary_min) && valid(profile.salary_max))
    return { min: profile.salary_min, max: profile.salary_max, source: 'profile_range' as const };
  return null;
}

export function salaryAnswerForField(label: unknown, type: unknown, job: SalaryJob | null | undefined,
  profile: SalaryProfile | null | undefined): string | null {
  const q = String(label || '').toLowerCase();
  if (profile?.salary_type === 'negotiable' || profile?.salary_display_strategy === 'show_negotiable')
    return 'Negotiable based on the role and total compensation';
  const evidence = salaryEvidence(job, profile);
  if (!evidence) return null; // never invent a market number without evidence
  const midpoint = Math.round((evidence.min + evidence.max) / 2 / 1000) * 1000;
  const numeric = /number|amount|minimum|single|desired salary/.test(q)
    || /number/.test(String(type || '').toLowerCase());
  if (numeric || evidence.min === evidence.max || profile?.salary_display_strategy === 'show_target') return String(midpoint);
  return `${money(evidence.min)} - ${money(evidence.max)} base`;
}
