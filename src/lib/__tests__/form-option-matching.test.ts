import { matchAvailableOption } from '../form-option-matching';

describe('matchAvailableOption', () => {
  const degrees = [
    'Associate degree / college diploma',
    "Bachelor's degree",
    "Master's degree",
    'Doctorate / PhD',
  ];

  it('maps a specific bachelor degree to the actual bachelor option', () => {
    expect(matchAvailableOption('Degree', 'Bachelor of Science in Computer Science', degrees))
      .toBe("Bachelor's degree");
  });

  it('never falls back to the first option when there is no semantic match', () => {
    expect(matchAvailableOption('Degree', 'Professional certificate', degrees)).toBeNull();
  });

  it('matches an exact available answer', () => {
    expect(matchAvailableOption('Work authorization', 'No', ['Yes', 'No'])).toBe('No');
  });

  it('maps confirmed authorization to a binary ATS choice', () => {
    expect(matchAvailableOption('Are you legally authorized to work in this country?', 'us_citizen', ['Yes', 'No']))
      .toBe('Yes');
  });

  it('maps internal work authorization values to an offered ATS choice', () => {
    const options = [
      'Authorized to work without employer sponsorship',
      'Authorized to work now, but will require employer sponsorship in the future',
      'Not currently authorized to work',
    ];
    expect(matchAvailableOption('What is your work authorization status?', 'us_citizen', options))
      .toBe('Authorized to work without employer sponsorship');
    expect(matchAvailableOption('What is your work authorization status?', 'student_visa', options))
      .toBe('Authorized to work now, but will require employer sponsorship in the future');
  });

  it('maps a saved company-careers source to the ATS careers-site wording', () => {
    expect(matchAvailableOption('How did you hear about this role?', 'Company careers page', [
      'LinkedIn', 'Verkada Careers Page', 'Referral',
    ])).toBe('Verkada Careers Page');
  });

  it('matches past-tense heard-about wording to a company website', () => {
    expect(matchAvailableOption('Please tell us how you heard about this opportunity.', 'Company careers page', [
      'LinkedIn', 'Palantir Website', 'Other',
    ])).toBe('Palantir Website');
  });

  it('uses Other when a company-careers source has no website choice', () => {
    expect(matchAvailableOption('How did you hear about this opportunity?', 'Company careers page', [
      'Referral', 'Campus event', 'Other',
    ])).toBe('Other');
  });

  it('maps no previous employment to a never-worked option', () => {
    expect(matchAvailableOption('Are you a current or former Alphabet employee?', 'No', [
      'Current Alphabet Employee', 'Former Alphabet Employee', 'Never worked at Alphabet',
    ])).toBe('Never worked at Alphabet');
    expect(matchAvailableOption('Have you ever worked at MongoDB before?', 'No', [
      'Yes', 'No',
    ])).toBe('No');
  });
  it('maps a saved state abbreviation to an ATS state option', () => {
    expect(matchAvailableOption('Please provide the state/region where you reside', 'CA', [
      'California', 'Colorado', 'New York',
    ])).toBe('California');
  });

  it('normalizes common country aliases only to available choices', () => {
    expect(matchAvailableOption('Country', 'USA', ['Canada', 'United States', 'Mexico']))
      .toBe('United States');
  });
});
