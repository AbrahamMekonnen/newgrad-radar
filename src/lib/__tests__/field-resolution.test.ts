import { exactSuppliedOption, findSavedAnswer, isSensitiveFact, mayUseAi, optionSetHash } from '../field-resolution';
describe('field resolution policy', () => {
  it('allows AI for prose only on the final bounded attempt', () => {
    expect(mayUseAi({ name: 'why', label: 'Why us?', attempt: 1 })).toBe(false);
    expect(mayUseAi({ name: 'why', label: 'Why us?', attempt: 2 })).toBe(true);
  });
  it('never allows AI to infer sensitive facts', () => {
    expect(isSensitiveFact('Will you require visa sponsorship?')).toBe(true);
    expect(mayUseAi({ name: 'visa', label: 'Will you require visa sponsorship?', attempt: 3, options: ['Yes', 'No'] })).toBe(false);
  });
  it('constrains categorical AI output to a supplied option', () => {
    const field = { name: 'source', label: 'How did you hear?', options: ['LinkedIn', 'Referral'] };
    expect(exactSuppliedOption(field, 'LinkedIn')).toBe('LinkedIn');
    expect(exactSuppliedOption(field, 'Indeed')).toBeNull();
  });
  it('produces stable option hashes', () => {
    const field = { name: 'degree', label: 'Degree', options: ['Bachelor', 'Master'] };
    expect(optionSetHash(field)).toBe(optionSetHash({ ...field }));
  });
  it('matches a saved answer when an ATS appends explanatory text', () => {
    const saved = { 'are you a current government employee': 'No' };
    expect(findSavedAnswer(saved, 'Are you a current government employee? Exceptions: teachers and assistants')).toBe('No');
  });
});


