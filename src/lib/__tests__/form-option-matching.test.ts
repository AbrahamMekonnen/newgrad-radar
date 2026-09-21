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
});