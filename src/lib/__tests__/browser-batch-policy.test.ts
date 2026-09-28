/* eslint-disable @typescript-eslint/no-require-imports */
const policy = require('../../../extension/batch-policy.js');

describe('browser batch canary policy', () => {
  it('keeps the requested parallel capacity during a campaign', () => {
    expect(policy.capacity({ canaryCompleted: 0 }, 7)).toBe(7);
    expect(policy.capacity({ canaryCompleted: 4 }, 7)).toBe(7);
  });
  it('isolates one application failure without stopping the cohort', () => {
    const failed = policy.outcome({ canaryCompleted: 2 }, 'failed');
    expect(failed.canaryFailed).toBe(false);
    expect(failed.failedCount).toBe(1);
    expect(policy.capacity(failed, 7)).toBe(7);
  });
  it('counts completed and user-input terminal runs as conformance evidence', () => {
    expect(policy.outcome({ canaryCompleted: 0 }, 'waiting_for_user').canaryCompleted).toBe(1);
    expect(policy.outcome({ canaryCompleted: 1 }, 'submitted').canaryCompleted).toBe(2);
  });
});
