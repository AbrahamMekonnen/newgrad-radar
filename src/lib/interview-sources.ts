export type InterviewSourceFilter =
  | { mode: 'exact'; value: string }
  | { mode: 'any'; values: readonly string[] }
  | { mode: 'prefix'; value: string };

const SOURCE_DEFINITIONS: ReadonlyArray<{
  value: string;
  label: string;
  filter: InterviewSourceFilter | null;
}> = [
  { value: 'all', label: 'All Sources', filter: null },
  {
    value: 'leetcode',
    label: 'LeetCode',
    filter: { mode: 'any', values: ['leetcode_company_wise', 'leetcode_discuss'] },
  },
  {
    value: 'hackernews',
    label: 'Hacker News',
    filter: { mode: 'exact', value: 'hackernews' },
  },
  {
    value: 'github_gist',
    label: 'GitHub Gists',
    filter: { mode: 'exact', value: 'github_gist' },
  },
  {
    value: 'github_guides',
    label: 'GitHub Interview Guides',
    filter: {
      mode: 'any',
      values: ['github_tech-interview-handbook', 'github_system-design-primer'],
    },
  },
  {
    value: 'telegram',
    label: 'Telegram Communities',
    filter: { mode: 'prefix', value: 'telegram:' },
  },
  { value: 'qiita', label: 'Qiita', filter: { mode: 'exact', value: 'qiita' } },
  {
    value: 'bootcamp_leaked',
    label: 'Bootcamp Question Sets',
    filter: { mode: 'exact', value: 'bootcamp_leaked' },
  },
  { value: 'atcoder', label: 'AtCoder', filter: { mode: 'exact', value: 'atcoder' } },
  { value: 'blind', label: 'Blind', filter: { mode: 'exact', value: 'blind' } },
  {
    value: 'codeforces',
    label: 'Codeforces',
    filter: { mode: 'exact', value: 'codeforces' },
  },
  {
    value: 'glassdoor',
    label: 'Glassdoor',
    filter: { mode: 'exact', value: 'glassdoor' },
  },
];

export const INTERVIEW_SOURCE_OPTIONS = SOURCE_DEFINITIONS.map(({ value, label }) => ({
  value,
  label,
}));

export function getInterviewSourceFilter(value: string): InterviewSourceFilter | null | undefined {
  return SOURCE_DEFINITIONS.find((definition) => definition.value === value)?.filter;
}

const SOURCE_HOSTS: Record<string, readonly string[]> = {
  leetcode_company_wise: ['leetcode.com'],
  leetcode_discuss: ['leetcode.com'],
  hackernews: ['news.ycombinator.com', 'ycombinator.com'],
  github_gist: ['gist.github.com', 'github.com'],
  'github_tech-interview-handbook': ['github.com', 'techinterviewhandbook.org'],
  'github_system-design-primer': ['github.com'],
  qiita: ['qiita.com'],
  atcoder: ['atcoder.jp'],
  blind: ['teamblind.com'],
  codeforces: ['codeforces.com'],
  glassdoor: ['glassdoor.com'],
};

export function hasVerifiedInterviewSource(sourceName: string | null, sourceUrl: string | null): boolean {
  if (!sourceName || !sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const expectedHosts = sourceName.startsWith('telegram:')
      ? ['t.me', 'telegram.me']
      : SOURCE_HOSTS[sourceName];
    return Boolean(expectedHosts?.some((host) =>
      url.hostname === host || url.hostname.endsWith('.' + host)
    ));
  } catch {
    return false;
  }
}
