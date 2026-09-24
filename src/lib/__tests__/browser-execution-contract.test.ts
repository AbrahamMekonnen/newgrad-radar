/* eslint-disable @typescript-eslint/no-require-imports */
const EXEC = require('../../../extension/execution-contract.js');

describe('browser execution contract', () => {
  const element = (text: string, extra: Record<string, unknown> = {}) => ({
    textContent: text,
    value: '',
    disabled: false,
    getClientRects: () => [1],
    getAttribute: (name: string) => name === 'aria-hidden' ? null : null,
    ...extra,
  });

  it.each([
    [['Resume is still uploading'], 'processing', true],
    [['Too many requests, try again'], 'temporary', true],
    [['Missing entry for required field'], 'validation', false],
    [['Please complete the CAPTCHA'], 'captcha', false],
    [['You already applied'], 'duplicate', false],
  ])('classifies ATS errors and retry safety', (errors, category, transient) => {
    expect(EXEC.classifyErrors(errors)).toEqual({ category, transient });
  });

  it('allows no more than two submit attempts and only for transient failures', () => {
    expect(EXEC.shouldRetrySubmit({ attempts: 1, errors: ['Uploading file'] }).retry).toBe(true);
    expect(EXEC.shouldRetrySubmit({ attempts: 2, errors: ['Uploading file'] }).retry).toBe(false);
    expect(EXEC.shouldRetrySubmit({ attempts: 1, errors: ['Required field'] }).retry).toBe(false);
  });

  it('emits diagnostic metadata without labels, values, answers, or resume content', () => {
    const result = EXEC.safeDiagnostic({
      code: 'required_field_unresolved', ats: 'ashby', fieldKey: 'work authorization|checkbox',
      controlType: 'checkbox', optionCount: 2, answerSource: 'profile', retained: false,
      value: 'private answer', label: 'private question', resume: 'private resume',
    });
    expect(result).toEqual({
      code: 'required_field_unresolved', ats: 'ashby', step: '', fieldKey: 'work authorization|checkbox',
      controlType: 'checkbox', optionCount: 2, answerSource: 'profile', retained: false,
      category: '', attempt: undefined,
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('discovers a visible multistep continuation action without choosing arbitrary buttons', () => {
    const cancel = element('Cancel');
    const next = element('Save and Continue');
    const doc = { querySelectorAll: () => [cancel, next] };
    expect(EXEC.findNextAction(doc)).toBe(next);
  });

  it('detects upload processing and native required-field failures', () => {
    const busy = element('', { getAttribute: (name: string) => name === 'aria-busy' ? 'true' : null });
    const doc = { querySelectorAll: () => [busy], body: { innerText: '' } };
    expect(EXEC.uploadPending(doc)).toBe(true);
    const staleCopy = { querySelectorAll: () => [], body: { innerText: 'Parsing your resume. Autofilling key fields...' } };
    expect(EXEC.uploadPending(staleCopy)).toBe(false);
    const hiddenProxy = element('', { willValidate: true, checkValidity: () => false,
      getAttribute: (name: string) => name === 'aria-hidden' ? 'true' : null });
    const invalid = element('', { willValidate: true, checkValidity: () => false });
    const root = { querySelectorAll: () => [hiddenProxy, invalid] };
    expect(EXEC.requiredInvalid(root)).toBe(invalid);
  });
});
