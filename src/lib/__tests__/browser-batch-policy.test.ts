/* eslint-disable @typescript-eslint/no-require-imports */
const policy = require('../../../extension/batch-policy.js');

describe('browser batch canary policy', () => {
  it('promotes a new version through 1, 3, and 7 application stages', () => {
    expect(policy.capacity({ canaryCompleted: 0 }, 7)).toBe(1);
    expect(policy.capacity({ canaryCompleted: 1 }, 7)).toBe(3);
    expect(policy.capacity({ canaryCompleted: 4 }, 7)).toBe(7);
  });
  it('blocks additional claims after an engine failure', () => {
    const failed = policy.outcome({ canaryCompleted: 2 }, 'failed');
    expect(failed.canaryFailed).toBe(true);
    expect(policy.capacity(failed, 7)).toBe(0);
  });
  it('counts completed and user-input terminal runs as conformance evidence', () => {
    expect(policy.outcome({ canaryCompleted: 0 }, 'waiting_for_user').canaryCompleted).toBe(1);
    expect(policy.outcome({ canaryCompleted: 1 }, 'submitted').canaryCompleted).toBe(2);
  });
});