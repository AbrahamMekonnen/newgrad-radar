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

    const accepted = { name: 'ethnicity', label: 'Ethnicity', type: 'combobox' };
    expect(ledger.begin(accepted)).toBe(true);
    ledger.verify(accepted);
    expect(ledger.begin(accepted)).toBe(false);
  });

  it('requires positive ATS success evidence', () => {
    expect(ATS.successEvidence('https://boards.greenhouse.io/acme/jobs/1', 'Application form').confirmed).toBe(false);
    expect(ATS.successEvidence('https://boards.greenhouse.io/acme/jobs/1', 'Thank you for applying').confirmed).toBe(true);
  });

  it('infers US phone country only from structured contact facts', () => {
    expect(ATS.inferCountry([
      { category: 'phone', value: '+1 408 555 0100' },
      { category: 'location', value: 'San Francisco, CA' },
    ])).toBe('United States');
  });
});
