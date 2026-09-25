/* eslint-disable @typescript-eslint/no-require-imports */
import scenarios from '../__fixtures__/autoapply-form-scenarios.json';
import { classifyApplicationQuestion } from '../autoapply-question-policy';
const recipes = require('../../../extension/ats-recipes.js');
const ATS = require('../../../extension/ats-adapters.js');

describe('sanitized multi-step ATS fixtures', () => {
  it.each(scenarios)('classifies every step for $ats before any live run', (scenario) => {
    expect(recipes.detect(scenario.url)?.type).toBe(scenario.ats);
    const attempted: string[] = [];
    for (const step of scenario.steps) {
      for (const field of step) {
        attempted.push(field.label);
        expect(classifyApplicationQuestion(field.label)?.id).toBe(field.expected);
      }
    }
    expect(attempted).toHaveLength(scenario.steps.flat().length);
  });

  it('continues after one control fails and records every outcome', () => {
    const ledger = ATS.createFieldLedger(1);
    const fields = scenarios[0].steps.flat().map((field, index) => ({ ...field, name: `field-${index}`, type: 'combobox' }));
    fields.forEach((field, index) => {
      expect(ledger.begin(field)).toBe(true);
      if (index === 0) ledger.reject(field, 'not_retained');
      else ledger.verify(field, { answerSource: 'profile' });
    });
    const snapshot = ledger.snapshot();
    expect(snapshot).toHaveLength(fields.length);
    expect(snapshot[0]).toEqual(expect.objectContaining({ status: 'needs_user', lastFailure: 'not_retained' }));
    expect(snapshot[1]).toEqual(expect.objectContaining({ status: 'verified', answerSource: 'profile' }));
  });
});