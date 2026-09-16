import {
  getInterviewSourceFilter,
  INTERVIEW_SOURCE_OPTIONS,
} from './interview-sources';

describe('interview source filters', () => {
  it('groups the two LeetCode sources', () => {
    expect(getInterviewSourceFilter('leetcode')).toEqual({
      mode: 'any',
      values: ['leetcode_company_wise', 'leetcode_discuss'],
    });
  });

  it('uses a prefix for Telegram channels', () => {
    expect(getInterviewSourceFilter('telegram')).toEqual({
      mode: 'prefix',
      value: 'telegram:',
    });
  });

  it('exposes the requested exact sources', () => {
    expect(INTERVIEW_SOURCE_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: 'hackernews', label: 'Hacker News' },
        { value: 'github_gist', label: 'GitHub Gists' },
        { value: 'leetcode', label: 'LeetCode' },
      ])
    );
  });

  it('rejects unknown filter keys', () => {
    expect(getInterviewSourceFilter('not-a-source')).toBeUndefined();
  });
});
