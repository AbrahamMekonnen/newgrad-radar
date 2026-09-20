import { AUTOAPPLY_SUPPORTED_ATS, browserApplyUrl, isAutoApplySupported, validApplyTarget } from './autoapply-support';

describe('browser auto-apply support', () => {
  it('exposes only ATS providers supported by both preparation and the extension', () => {
    expect(AUTOAPPLY_SUPPORTED_ATS).toEqual([
      'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters',
    ]);
  });

  it.each(['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters'])(
    'supports %s',
    (ats) => expect(isAutoApplySupported(ats)).toBe(true),
  );

  it.each(['bamboohr', 'jobvite', 'jazzhr', 'recruitee', 'breezyhr', 'icims', 'taleo', 'unknown'])(
    'does not advertise %s until the extension supports it',
    (ats) => expect(isAutoApplySupported(ats)).toBe(false),
  );

  it('opens Lever and Greenhouse at their actual application forms', () => {
    expect(browserApplyUrl('lever', 'https://jobs.lever.co/acme/1ebcedcb-82ba-4d19-ac88-aa73a812dd81'))
      .toBe('https://jobs.lever.co/acme/1ebcedcb-82ba-4d19-ac88-aa73a812dd81/apply');
    expect(browserApplyUrl('lever', 'https://jobs.lever.co/acme/id/apply'))
      .toBe('https://jobs.lever.co/acme/id/apply');
    expect(browserApplyUrl('greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/123456'))
      .toBe('https://job-boards.greenhouse.io/acme/jobs/123456#app');
  });

  it('requires a specific job URL for every supported ATS', () => {
    expect(validApplyTarget('greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/123456')).toBe(true);
    expect(validApplyTarget('lever', 'https://jobs.lever.co/acme/1ebcedcb-82ba-4d19-ac88-aa73a812dd81')).toBe(true);
    expect(validApplyTarget('ashby', 'https://jobs.ashbyhq.com/acme/1ebcedcb-82ba-4d19-ac88-aa73a812dd81')).toBe(true);
    expect(validApplyTarget('workday', 'https://acme.wd1.myworkdayjobs.com/en-US/acme/job/City/Role_R123')).toBe(true);
    expect(validApplyTarget('smartrecruiters', 'https://jobs.smartrecruiters.com/Acme/78366121')).toBe(true);
  });
});
