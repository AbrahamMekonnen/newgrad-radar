/* eslint-disable @typescript-eslint/no-require-imports */
const ATS = require('../../../extension/ats-adapters.js');

describe('browser ATS adapters', () => {
  it.each([
    ['https://job-boards.greenhouse.io/acme/jobs/123', 'greenhouse'],
    ['https://jobs.lever.co/acme/abc/apply', 'lever'],
    ['https://jobs.ashbyhq.com/acme/abc', 'ashby'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/jobs/role', 'workday'],
    ['https://jobs.smartrecruiters.com/acme/123', 'smartrecruiters'],
  ])('detects %s as %s', (url, expected) => {
    expect(ATS.detect(url).type).toBe(expected);
  });

  it('lets Lever read the surrounding question instead of select option text', () => {
    const row = {
      querySelector: () => ({ textContent: 'Receive information about training opportunities?' }),
      textContent: 'Receive information about training opportunities? Select... Yes No',
    };
    const element = { closest: () => row };
    expect(ATS.adapters.lever.labelFor(element)).toBe('Receive information about training opportunities?');
  });
  it('prefers the Lever application-question container over a textarea card class', () => {
    const question = {
      querySelector: () => null,
      textContent: 'What other languages do you speak and what is the level?',
    };
    const fieldItself = { querySelector: () => null, textContent: '' };
    const element = {
      closest: (selector: string) => selector.includes('application-question') ? question : fieldItself,
    };
    expect(ATS.adapters.lever.labelFor(element))
      .toBe('What other languages do you speak and what is the level?');
  });
  it('maps a detailed degree to an option the ATS actually exposes', () => {
    expect(ATS.matchOption('Degree', 'Bachelor of Science in Computer Science', [
      'Associate degree / college diploma', "Bachelor's degree", "Master's degree",
    ])).toBe("Bachelor's degree");
  });

  it('uses stable question identity across React-generated names', () => {
    const a = ATS.stableFieldKey({ name: 'react-1', label: 'Are you Hispanic/Latino?', type: 'combobox' });
    const b = ATS.stableFieldKey({ name: 'react-99', label: 'Are you Hispanic/Latino?', type: 'combobox' });
    expect(a).toBe(b);
  });

  it('stops a field after two rejected attempts and locks verified fields', () => {
    const field = { name: 'degree--0', label: 'Degree', type: 'combobox' };
    const ledger = ATS.createFieldLedger(2);
    expect(ledger.begin(field)).toBe(true);
    ledger.reject(field);
    expect(ledger.begin(field)).toBe(true);
    ledger.reject(field);
    expect(ledger.begin(field)).toBe(false);
    expect(ledger.get(field).status).toBe('needs_user');
    expect(ledger.get(field).failures).toEqual(['not_retained', 'not_retained']);

    const accepted = { name: 'ethnicity', label: 'Ethnicity', type: 'combobox' };
    expect(ledger.begin(accepted)).toBe(true);
    ledger.verify(accepted, { answerSource: 'saved' });
    expect(ledger.begin(accepted)).toBe(false);
    expect(ledger.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'needs_user', lastFailure: 'not_retained' }),
      expect.objectContaining({ status: 'verified', retained: true, answerSource: 'saved' }),
    ]));
  });

  it('maps Ashby data-field-path containers to controls and validates required entries', () => {
    const control = { value: '', type: 'text', willValidate: false, checkValidity: () => true };
    const heading = { className: 'ashby-required', textContent: 'Start date*' };
    const entry = {
      getAttribute: (name: string) => name === 'data-field-path' ? 'start-date-id' : null,
      querySelector: (selector: string) => selector.includes('question-title') ? heading : control,
      querySelectorAll: () => [control],
    };
    const root = {
      querySelectorAll: (selector: string) => selector === '[data-field-path]' ? [entry] : [control],
    };
    expect(ATS.adapters.ashby.findField(root, { name: 'start-date-id' })).toBe(control);
    expect(ATS.adapters.ashby.findInvalid(root)).toBe(control);
    control.value = '2026-10-01';
    expect(ATS.adapters.ashby.findInvalid(root)).toBeNull();
  });
  it('explicitly selects and verifies Ashby false-valued Yes/No answers', () => {
    let pressed = false;
    const option = {
      click: () => { pressed = true; },
      getAttribute: (name: string) => name === 'aria-pressed' && pressed ? 'true' : 'false',
    };
    const yesNo = {
      querySelector: (selector: string) => selector.includes('data-option="no"') || (pressed && selector.includes('aria-pressed="true"')) ? option : null,
    };
    const entry = {
      querySelector: (selector: string) => selector.includes('input-yesno-option') ? option
        : selector.includes('input-yesno') ? yesNo : null,
    };
    const checkbox = { type: 'checkbox', closest: () => entry };
    expect(ATS.adapters.ashby.fillCheckbox(checkbox, 'No')).toBe(true);
    expect(ATS.adapters.ashby.fieldAccepted(checkbox, 'No')).toBe(true);
  });
  it('allows Ashby past a stale upload indicator after five stable seconds with a retained file', () => {
    const input = { files: [{ name: 'resume.pdf' }] };
    const entry = {
      getAttribute: () => '_systemfield_resume',
      querySelector: () => input,
    };
    const doc = { querySelectorAll: () => [entry] };
    expect(ATS.adapters.ashby.uploadReadyOverride(doc, 4999)).toBe(false);
    expect(ATS.adapters.ashby.uploadReadyOverride(doc, 5000)).toBe(true);
    input.files = [];
    expect(ATS.adapters.ashby.uploadReadyOverride(doc, 60000)).toBe(false);
  });
  it('confirms Ashby only after the form is replaced by a positive receipt', () => {
    const panel = {
      textContent: 'Thank you for your interest. Our team will review your application.',
      querySelectorAll: () => [],
    };
    const doc = { querySelector: () => panel };
    expect(ATS.adapters.ashby.submissionComplete(doc)).toBe(true);
    panel.textContent = 'Submitting your application...';
    expect(ATS.adapters.ashby.submissionComplete(doc)).toBe(false);
    panel.textContent = 'Your form needs corrections. Missing entry for required field.';
    expect(ATS.adapters.ashby.submissionComplete(doc)).toBe(false);
  });
  it('finds Ashby submit controls inside its non-form application panel', () => {
    const submit = {
      textContent: 'Submit Application', value: '',
      getClientRects: () => [1],
      getAttribute: () => null,
      closest: (selector: string) => selector.includes('#form') ? panel : null,
    };
    const panel = { querySelectorAll: () => [submit] };
    const doc = { querySelector: () => panel };
    expect(ATS.adapters.ashby.findSubmit(doc)).toBe(submit);
    expect(ATS.adapters.ashby.validationRoot(submit)).toBe(panel);
  });
  it('provides ATS-specific multistep controls for Workday and SmartRecruiters', () => {
    const workdayNext = {};
    const smartNext = {};
    expect(ATS.adapters.workday.findNext({ querySelector: () => workdayNext })).toBe(workdayNext);
    expect(ATS.adapters.smartrecruiters.findNext({ querySelector: () => smartNext })).toBe(smartNext);
  });
  it('matches location suggestions by city when ATS expands state abbreviations', () => {
    expect(ATS.matchLocationOption('Georgetown, TX', [
      'Georgetown, Kentucky, United States',
      'Georgetown, Texas, United States',
    ])).toBe('Georgetown, Texas, United States');
    expect(ATS.matchLocationOption('San Francisco, CA', [
      'San Francisco, California, United States',
    ])).toBe('San Francisco, California, United States');
  });

  it('allows Greenhouse past a stale upload status after retaining every visible file', () => {
    const ready = { files: [{ name: 'resume.pdf' }], getClientRects: () => [1] };
    const doc = { querySelectorAll: () => [ready] };
    expect(ATS.adapters.greenhouse.uploadReadyOverride(doc, 4999)).toBe(false);
    expect(ATS.adapters.greenhouse.uploadReadyOverride(doc, 5000)).toBe(true);
    ready.files = [];
    expect(ATS.adapters.greenhouse.uploadReadyOverride(doc, 6000)).toBe(false);
  });
  it('requires positive ATS success evidence', () => {
    expect(ATS.successEvidence('https://boards.greenhouse.io/acme/jobs/1', 'Application form').confirmed).toBe(false);
    expect(ATS.successEvidence('https://boards.greenhouse.io/acme/jobs/1', 'Thank you for applying').confirmed).toBe(true);
    expect(ATS.successEvidence('https://jobs.ashbyhq.com/acme/1', 'Thank you for submitting your application. We will be in touch if there is a fit.').confirmed).toBe(true);
  });

  it('infers US phone country only from structured contact facts', () => {
    expect(ATS.inferCountry([
      { category: 'phone', value: '+1 408 555 0100' },
      { category: 'location', value: 'San Francisco, CA' },
    ])).toBe('United States');
  });
});
