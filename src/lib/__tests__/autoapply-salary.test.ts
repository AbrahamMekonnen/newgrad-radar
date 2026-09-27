import { salaryAnswerForField, salaryEvidence } from '../autoapply-salary';

describe('auto-apply salary evidence', () => {
  it('prefers the posted range over profile fallback', () => {
    expect(salaryEvidence({ salary_min: 130000, salary_max: 160000 }, { salary_type: 'specific', salary_target: 100000 }))
      .toEqual({ min: 130000, max: 160000, source: 'job_posting' });
  });
  it('uses explicit user targets when the posting has no range', () => {
    expect(salaryAnswerForField('Expected salary amount', 'number', {}, { salary_type: 'specific', salary_target: 140000 }))
      .toBe('140000');
  });
  it('returns a range when prose is accepted', () => {
    expect(salaryAnswerForField('Compensation expectations', 'text', { salary_min: 120000, salary_max: 150000 }, {}))
      .toBe('$120,000 - $150,000 base');
  });
  it('does not invent a market number without posted or explicit evidence', () => {
    expect(salaryAnswerForField('Expected salary', 'text', {}, { salary_type: 'market_rate' })).toBeNull();
  });
});
