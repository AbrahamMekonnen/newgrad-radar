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
  const usable = options.filter((option) => norm(option) && !/^(select|choose)( an?| one| option)?$/.test(norm(option)));
  const exact = usable.find((option) => norm(option) === target);
  if (exact) return exact;

  const q = norm(question);

  const privacyDecline = /decline|self identify|prefer not|do not wish|don't wish|not wish to answer/.test(target);
  if (privacyDecline) {
    const option = usable.find((candidate) =>
      /decline|prefer not|do not wish|don t wish|not wish to answer|choose not to disclose/.test(norm(candidate)));
    if (option) return option;
  }

  if (/country/.test(q)) {
    const aliases: Record<string, string> = {
      us: 'united states', usa: 'united states', 'u s': 'united states',
      uk: 'united kingdom', 'u k': 'united kingdom',
    };
    const country = aliases[target] || target;
    const option = usable.find((candidate) => norm(candidate) === country);
    if (option) return option;
  }

  if (/state|province|region/.test(q)) {
    const states: Record<string, string> = {
      ca: 'california', ny: 'new york', tx: 'texas', wa: 'washington', ma: 'massachusetts',
      dc: 'district of columbia', va: 'virginia', md: 'maryland', nj: 'new jersey',
      fl: 'florida', il: 'illinois', pa: 'pennsylvania', co: 'colorado', ga: 'georgia', nc: 'north carolina',
    };
    const state = states[target] || target;
    const option = usable.find((candidate) => norm(candidate) === state);
    if (option) return option;
  }

  if (/work authori[sz]ation|authori[sz]ed to work|eligible to work|employment authori[sz]ation/.test(q)) {
    const noSponsor = ['us citizen', 'permanent resident', 'green card', 'authorized without employer sponsorship'];
    const futureSponsor = ['visa holder', 'student visa', 'f1', 'opt', 'cpt', 'authorized now but will require employer sponsorship'];
    if (noSponsor.some((intent) => target.includes(intent))) {
      const option = usable.find((candidate) => /authorized.*without.*sponsor|citizen|permanent resident|green card/.test(norm(candidate)));
      if (option) return option;
      const yes = usable.find((candidate) => norm(candidate) === 'yes');
      if (yes) return yes;
    }
    if (futureSponsor.some((intent) => target.includes(intent))) {
      const option = usable.find((candidate) => /authorized.*require.*sponsor|future.*sponsor|time limited visa/.test(norm(candidate)));
      if (option) return option;
    }
  }
  if (/hear about|heard about|learn about|source/.test(q) && /company careers|company website|careers page/.test(target)) {
    const option = usable.find((candidate) => /careers? (website|site|page)|company (website|site)|website/.test(norm(candidate)));
    if (option) return option;
    const other = usable.find((candidate) => /^(other|other source|not listed)$/.test(norm(candidate)));
    if (other) return other;
  }

  if (/previously worked|ever worked at|worked at .* before|former employee|current or former/.test(q) && target === 'no') {
    const option = usable.find((candidate) => /^(no|never worked|not previously)/.test(norm(candidate)));
    if (option) return option;
  }
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

export function matchFirstAvailablePreference(question: unknown, wanted: unknown, options: string[]): string | null {
  const aliases: Record<string, string> = {
    pyton: 'Python 3', python: 'Python 3', python3: 'Python 3',
    js: 'Javascript', javascript: 'Javascript', ts: 'Typescript', typescript: 'Typescript',
    cpp: 'C++', 'c plus plus': 'C++', csharp: 'C#', 'c sharp': 'C#',
  };
  for (const raw of String(wanted || '').split(/[,;|/]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const matched = matchAvailableOption(question, aliases[norm(value)] || value, options);
    if (matched) return matched;
  }
  return null;
}
