/**
 * Tests for deadline-detector.ts
 * Run with: npx tsx src/lib/deadline-detector.test.ts
 */

import {
  detectDeadline,
  detectDeadlines,
  isDeadlineApproaching,
  isDeadlinePassed,
  formatDeadline,
} from './deadline-detector';

interface TestCase {
  name: string;
  description: string;
  expected: {
    deadline: string | null;
    confidenceMin: 'high' | 'medium' | 'low';
  };
}

// Get current year for realistic test dates
const currentYear = new Date().getFullYear();
const nextYear = currentYear + 1;

const testCases: TestCase[] = [
  // Test Case 1: "Apply by December 15, 2027" (future date)
  {
    name: 'Apply by with full date',
    description: `This is a great opportunity at Google. Apply by December 15, ${nextYear} to be considered.`,
    expected: {
      deadline: `${nextYear}-12-15`,
      confidenceMin: 'high',
    },
  },
  // Test Case 2: "Deadline: 01/15/2027"
  {
    name: 'Deadline with US date format',
    description: `Software Engineer position. Deadline: 01/15/${nextYear}. Must have 2+ years experience.`,
    expected: {
      deadline: `${nextYear}-01-15`,
      confidenceMin: 'high',
    },
  },
  // Test Case 3: "Applications close on Jan 20" (no year - will infer next occurrence)
  {
    name: 'Applications close with month name no year',
    description: 'Join our team! Applications close on Jan 20. We offer competitive salary.',
    expected: {
      deadline: null, // Will be inferred based on current date
      confidenceMin: 'high',
    },
  },
  // Test Case 4: No deadline mentioned
  {
    name: 'No deadline mentioned',
    description: 'We are looking for a talented software engineer to join our team. Great benefits and work-life balance.',
    expected: {
      deadline: null,
      confidenceMin: 'low',
    },
  },
  // Additional test cases for various formats
  {
    name: 'ISO date format',
    description: `Position deadline: ${nextYear}-03-15. Apply now!`,
    expected: {
      deadline: `${nextYear}-03-15`,
      confidenceMin: 'high',
    },
  },
  {
    name: 'European date format (dots)',
    description: `Closing date: 15.06.${nextYear} for summer internship.`,
    expected: {
      deadline: `${nextYear}-06-15`,
      confidenceMin: 'high',
    },
  },
  {
    name: 'Day Month Year format',
    description: `Submit by 20 March ${nextYear} for full consideration.`,
    expected: {
      deadline: `${nextYear}-03-20`,
      confidenceMin: 'high',
    },
  },
  {
    name: 'Rolling/filled should return null',
    description: 'Open until filled. No specific deadline.',
    expected: {
      deadline: null,
      confidenceMin: 'low',
    },
  },
  {
    name: 'Application deadline with colon',
    description: `Application deadline: February 28, ${nextYear}`,
    expected: {
      deadline: `${nextYear}-02-28`,
      confidenceMin: 'high',
    },
  },
  {
    name: 'Due date format',
    description: `Applications due: March 1, ${nextYear}. Late submissions not accepted.`,
    expected: {
      deadline: `${nextYear}-03-01`,
      confidenceMin: 'high',
    },
  },
];

function runTests(): { passed: boolean; results: string[]; failures: string[] } {
  const results: string[] = [];
  const failures: string[] = [];
  let allPassed = true;

  console.log('='.repeat(60));
  console.log('Deadline Detection Tests');
  console.log('='.repeat(60));

  for (const testCase of testCases) {
    const result = detectDeadline(testCase.description);

    // For the "no year" case, we need to check if a date was inferred
    let passed: boolean;
    if (testCase.name === 'Applications close with month name no year') {
      // Should detect Jan 20 with an inferred year
      const deadlineMatches = result.deadline !== null && result.deadline.endsWith('-01-20');
      passed = deadlineMatches && result.confidence === 'high';
      if (passed) {
        results.push(`PASS: ${testCase.name} - Detected ${result.deadline} (year inferred)`);
      } else {
        failures.push(`FAIL: ${testCase.name} - Expected Jan 20 with inferred year, got ${result.deadline}`);
        allPassed = false;
      }
    } else if (testCase.expected.deadline === null) {
      passed = result.deadline === null;
      if (passed) {
        results.push(`PASS: ${testCase.name} - Correctly returned null`);
      } else {
        failures.push(`FAIL: ${testCase.name} - Expected null, got ${result.deadline}`);
        allPassed = false;
      }
    } else {
      passed = result.deadline === testCase.expected.deadline;
      if (passed) {
        results.push(`PASS: ${testCase.name} - ${result.deadline} (confidence: ${result.confidence})`);
      } else {
        failures.push(`FAIL: ${testCase.name} - Expected ${testCase.expected.deadline}, got ${result.deadline}`);
        allPassed = false;
      }
    }

    // Log details
    console.log(`\nTest: ${testCase.name}`);
    console.log(`Input: "${testCase.description.substring(0, 60)}..."`);
    console.log(`Result: ${result.deadline || 'null'} (confidence: ${result.confidence})`);
    console.log(`Matched pattern: ${result.matchedPattern || 'none'}`);
    console.log(`Raw text: ${result.rawText || 'none'}`);
    console.log(passed ? 'STATUS: PASS' : 'STATUS: FAIL');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Batch Processing');
  console.log('='.repeat(60));

  // Test batch mode
  const batchJobs = [
    { id: 'job-1', description: `Apply by December 15, ${nextYear}` },
    { id: 'job-2', description: 'No deadline here' },
    { id: 'job-3', description: `Deadline: 01/15/${nextYear}` },
  ];

  const batchResults = detectDeadlines(batchJobs);
  console.log('\nBatch results:');
  for (const { id, result } of batchResults) {
    console.log(`  ${id}: ${result.deadline || 'null'} (${result.confidence})`);
  }

  const batchPassed =
    batchResults[0].result.deadline === `${nextYear}-12-15` &&
    batchResults[1].result.deadline === null &&
    batchResults[2].result.deadline === `${nextYear}-01-15`;

  if (batchPassed) {
    results.push('PASS: Batch processing works correctly');
  } else {
    failures.push('FAIL: Batch processing returned unexpected results');
    allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Helper Functions');
  console.log('='.repeat(60));

  // Test helper functions
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 5);
  const pastDateStr = pastDate.toISOString().split('T')[0];

  // isDeadlineApproaching tests
  const approachingTest = isDeadlineApproaching(futureDateStr, 7);
  console.log(`\nisDeadlineApproaching('${futureDateStr}', 7): ${approachingTest}`);
  if (approachingTest) {
    results.push('PASS: isDeadlineApproaching returns true for date 5 days from now');
  } else {
    failures.push('FAIL: isDeadlineApproaching should return true for date 5 days from now');
    allPassed = false;
  }

  // isDeadlinePassed tests
  const passedTest = isDeadlinePassed(pastDateStr);
  console.log(`isDeadlinePassed('${pastDateStr}'): ${passedTest}`);
  if (passedTest) {
    results.push('PASS: isDeadlinePassed returns true for past date');
  } else {
    failures.push('FAIL: isDeadlinePassed should return true for past date');
    allPassed = false;
  }

  // formatDeadline tests
  console.log(`\nformatDeadline tests:`);
  console.log(`  null: "${formatDeadline(null)}"`);
  console.log(`  ${futureDateStr}: "${formatDeadline(futureDateStr)}"`);
  console.log(`  ${pastDateStr}: "${formatDeadline(pastDateStr)}"`);

  const formatNullTest = formatDeadline(null) === 'No deadline';
  const formatPastTest = formatDeadline(pastDateStr) === 'Deadline passed';
  const formatFutureTest = formatDeadline(futureDateStr).includes('days left');

  if (formatNullTest && formatPastTest && formatFutureTest) {
    results.push('PASS: formatDeadline works correctly');
  } else {
    failures.push('FAIL: formatDeadline has issues');
    allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total tests: ${results.length + failures.length}`);
  console.log(`Passed: ${results.length}`);
  console.log(`Failed: ${failures.length}`);
  console.log(allPassed ? '\nALL TESTS PASSED!' : '\nSOME TESTS FAILED!');

  return { passed: allPassed, results, failures };
}

// Run tests
const testResult = runTests();

// Exit with appropriate code
process.exit(testResult.passed ? 0 : 1);
