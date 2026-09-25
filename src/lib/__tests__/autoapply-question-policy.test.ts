import { AUTOAPPLY_QUESTION_POLICY_VERSION, classifyApplicationQuestion } from '../autoapply-question-policy';

const cases = [
  ['How did you hear about Twilio?', 'source'],
  ['Have you ever worked at MongoDB before?', 'previous_employment'],
  ['Are you currently located in Estonia?', 'location_confirmation'],
  ['What is your highest degree?', 'degree'],
  ['Will you require visa sponsorship?', 'sponsorship'],
  ['Describe a project you are proud of.', 'prose'],
] as const;

describe('shared auto-apply question policy', () => {
  it('loads a versioned policy contract', () => expect(AUTOAPPLY_QUESTION_POLICY_VERSION).toBe(1));
  it.each(cases)('classifies %s as %s', (label, expected) => {
    expect(classifyApplicationQuestion(label)?.id).toBe(expected);
  });
  it('does not route legal acknowledgements to AI', () => {
    const policy = classifyApplicationQuestion('Applicant Arbitration Agreement Acknowledgement');
    expect(policy?.id).toBe('acknowledgement');
    expect(policy?.sensitive).toBe(true);
    expect(policy?.resolution).toBe('confirmed_fact');
  });
});