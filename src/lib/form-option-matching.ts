const norm = (value: unknown) => String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';

function degreeLevel(value: unknown): string {
  const text = norm(value);
  if (/\b(phd|ph d|doctor|doctorate)\b/.test(text)) return 'doctorate';
  if (/\b(master|masters|ms|m s|mba|ma|m a)\b/.test(text)) return 'master';
  if (/\b(bachelor|bachelors|bs|b s|ba|b a)\b/.test(text)) return 'bachelor';
  if (/\b(associate|associates|aa|a a|as|a s)\b/.test(text)) return 'associate';
  if (/\b(high school|secondary|ged)\b/.test(text)) return 'high_school';
  return '';
}

export function matchAvailableOption(question: unknown, wanted: unknown, options: string[]): string | null {
  const target = norm(wanted);
  if (!target) return null;
  const usable = options.filter((option) => norm(option) && !/^select\b|^choose\b/.test(norm(option)));
  const exact = usable.find((option) => norm(option) === target);
  if (exact) return exact;

  const q = norm(question);
  if (/degree|education level|qualification/.test(q)) {
    const level = degreeLevel(target);
    if (level) {
      const semantic = usable.find((option) => degreeLevel(option) === level);
      if (semantic) return semantic;
    }
  }

  const contained = usable.filter((option) => {
    const candidate = norm(option);
    return candidate.includes(target) || target.includes(candidate);
  });
  return contained.length === 1 ? contained[0] : null;
}