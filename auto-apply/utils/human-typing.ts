import { Page, Locator } from 'playwright';

// =============================================================================
// CONFIGURATION & TYPES
// =============================================================================

/**
 * Human-like typing configuration
 */
export interface HumanTypingConfig {
  // Base timing (milliseconds)
  baseDelay: number;              // Average delay between keystrokes (50-150ms typical)
  variancePercent: number;        // Variance as percentage of base (20-40% realistic)

  // Natural pauses
  wordBoundaryPause: number;      // Extra pause after space (100-300ms)
  sentencePause: number;          // Pause after . ! ? (200-500ms)
  thinkingPauseChance: number;    // Chance of random "thinking" pause (0.02-0.05)
  thinkingPauseDuration: number;  // Duration of thinking pause (300-1000ms)

  // Typo simulation
  typoRate: number;               // Chance of typo per character (0.01-0.05)
  typoDetectDelay: number;        // Time before "noticing" typo (100-500ms)
  backspaceDelay: number;         // Delay per backspace (30-80ms)

  // Burst typing (faster sequences within words)
  burstChance: number;            // Chance of entering a "burst" (0.1-0.2)
  burstSpeedMultiplier: number;   // How much faster during burst (0.5-0.7)
  burstLength: number;            // Characters in a burst (3-6)

  // Fatigue simulation
  fatigueEnabled: boolean;        // Whether typing slows over time
  fatigueRate: number;            // Slowdown per 100 characters (1.05-1.15)
  fatigueMax: number;             // Maximum slowdown multiplier (1.5-2.0)
}

export type TypingProfile = 'slow' | 'normal' | 'fast' | 'expert';

export type TypoType = 'adjacent' | 'transposition' | 'doubleStroke' | 'skip' | 'insert';

export interface PauseDecision {
  shouldPause: boolean;
  duration: number;
  reason: string;
}

// =============================================================================
// SPEED PROFILES
// =============================================================================

/**
 * Preset typing profiles
 */
export const TYPING_PROFILES: Record<TypingProfile, HumanTypingConfig> = {
  // Careful, methodical typist
  slow: {
    baseDelay: 120,
    variancePercent: 35,
    wordBoundaryPause: 250,
    sentencePause: 450,
    thinkingPauseChance: 0.04,
    thinkingPauseDuration: 800,
    typoRate: 0.02,
    typoDetectDelay: 350,
    backspaceDelay: 60,
    burstChance: 0.08,
    burstSpeedMultiplier: 0.7,
    burstLength: 4,
    fatigueEnabled: true,
    fatigueRate: 1.08,
    fatigueMax: 1.6,
  },

  // Average typist (recommended for most cases)
  normal: {
    baseDelay: 75,
    variancePercent: 30,
    wordBoundaryPause: 180,
    sentencePause: 350,
    thinkingPauseChance: 0.03,
    thinkingPauseDuration: 600,
    typoRate: 0.03,
    typoDetectDelay: 250,
    backspaceDelay: 50,
    burstChance: 0.12,
    burstSpeedMultiplier: 0.6,
    burstLength: 5,
    fatigueEnabled: true,
    fatigueRate: 1.06,
    fatigueMax: 1.4,
  },

  // Fast touch typist
  fast: {
    baseDelay: 45,
    variancePercent: 25,
    wordBoundaryPause: 100,
    sentencePause: 200,
    thinkingPauseChance: 0.02,
    thinkingPauseDuration: 400,
    typoRate: 0.04,
    typoDetectDelay: 150,
    backspaceDelay: 35,
    burstChance: 0.18,
    burstSpeedMultiplier: 0.5,
    burstLength: 6,
    fatigueEnabled: false,
    fatigueRate: 1.03,
    fatigueMax: 1.2,
  },

  // Very fast but error-prone (programmer typing familiar code)
  expert: {
    baseDelay: 30,
    variancePercent: 20,
    wordBoundaryPause: 60,
    sentencePause: 120,
    thinkingPauseChance: 0.01,
    thinkingPauseDuration: 300,
    typoRate: 0.05,
    typoDetectDelay: 100,
    backspaceDelay: 25,
    burstChance: 0.25,
    burstSpeedMultiplier: 0.4,
    burstLength: 8,
    fatigueEnabled: false,
    fatigueRate: 1.02,
    fatigueMax: 1.1,
  },
};

// =============================================================================
// STATISTICAL DISTRIBUTION FUNCTIONS
// =============================================================================

/**
 * Box-Muller transform for Gaussian random numbers
 * Returns value with mean 0 and standard deviation 1
 */
export function gaussianRandom(): number {
  let u1 = 0, u2 = 0;
  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();

  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0;
}

/**
 * Generate delay using Gaussian distribution
 * @param mean - Average delay in milliseconds
 * @param stdDev - Standard deviation (variability)
 * @param min - Minimum allowed delay
 * @param max - Maximum allowed delay
 */
export function gaussianDelay(
  mean: number,
  stdDev: number,
  min: number = 10,
  max: number = 500
): number {
  const gaussian = gaussianRandom();
  const delay = mean + gaussian * stdDev;
  return Math.max(min, Math.min(max, Math.round(delay)));
}

/**
 * Log-normal distribution for more natural delays
 * Human reaction times follow log-normal more than Gaussian
 */
export function logNormalDelay(
  median: number,
  sigma: number = 0.3,
  min: number = 10
): number {
  const gaussian = gaussianRandom();
  const delay = median * Math.exp(sigma * gaussian);
  return Math.max(min, Math.round(delay));
}

/**
 * Exponential distribution for inter-arrival times
 * Good for modeling pauses between thoughts
 */
export function exponentialDelay(mean: number, min: number = 50): number {
  const u = Math.random();
  const delay = -mean * Math.log(1 - u);
  return Math.max(min, Math.round(delay));
}

/**
 * Weibull distribution - flexible for modeling various human behaviors
 * Shape < 1: decreasing hazard (fast start, slow end)
 * Shape = 1: constant hazard (exponential)
 * Shape > 1: increasing hazard (slow start, fast end)
 */
export function weibullDelay(scale: number, shape: number = 1.5): number {
  const u = Math.random();
  const delay = scale * Math.pow(-Math.log(1 - u), 1 / shape);
  return Math.round(delay);
}

// =============================================================================
// TYPO INJECTION SYSTEM
// =============================================================================

/**
 * Keyboard layout for simulating realistic typos
 * Based on QWERTY - adjacent keys are common typo targets
 */
const KEYBOARD_ADJACENCY: Record<string, string[]> = {
  'a': ['q', 'w', 's', 'z'],
  'b': ['v', 'g', 'h', 'n'],
  'c': ['x', 'd', 'f', 'v'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'e': ['w', 's', 'd', 'r'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'i': ['u', 'j', 'k', 'o'],
  'j': ['h', 'u', 'i', 'k', 'm', 'n'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p', ';'],
  'm': ['n', 'j', 'k', ','],
  'n': ['b', 'h', 'j', 'm'],
  'o': ['i', 'k', 'l', 'p'],
  'p': ['o', 'l', ';', '['],
  'q': ['1', '2', 'w', 'a'],
  'r': ['e', 'd', 'f', 't'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  't': ['r', 'f', 'g', 'y'],
  'u': ['y', 'h', 'j', 'i'],
  'v': ['c', 'f', 'g', 'b'],
  'w': ['q', 'a', 's', 'e'],
  'x': ['z', 's', 'd', 'c'],
  'y': ['t', 'g', 'h', 'u'],
  'z': ['a', 's', 'x'],
  ' ': ['c', 'v', 'b', 'n', 'm'],
};

/**
 * Generate a realistic typo for a character
 */
export function generateTypo(
  char: string,
  nextChar?: string,
  _prevChar?: string
): { typoChar: string; typoType: TypoType } {
  const lowerChar = char.toLowerCase();
  const rand = Math.random();

  // 40% - Adjacent key typo (most common)
  if (rand < 0.4) {
    const adjacentKeys = KEYBOARD_ADJACENCY[lowerChar];
    if (adjacentKeys && adjacentKeys.length > 0) {
      const typoChar = adjacentKeys[Math.floor(Math.random() * adjacentKeys.length)];
      // Preserve case
      return {
        typoChar: char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar,
        typoType: 'adjacent',
      };
    }
  }

  // 25% - Transposition with next character
  if (rand < 0.65 && nextChar) {
    return { typoChar: nextChar, typoType: 'transposition' };
  }

  // 15% - Double stroke (typed twice)
  if (rand < 0.80) {
    return { typoChar: char + char, typoType: 'doubleStroke' };
  }

  // 10% - Skip character entirely
  if (rand < 0.90) {
    return { typoChar: '', typoType: 'skip' };
  }

  // 10% - Insert random adjacent character
  const adjacentKeys = KEYBOARD_ADJACENCY[lowerChar] || ['e', 'a', 'i', 'o', 'u'];
  const insertChar = adjacentKeys[Math.floor(Math.random() * adjacentKeys.length)];
  return { typoChar: char + insertChar, typoType: 'insert' };
}

/**
 * Calculate correction sequence for a typo
 */
export function calculateCorrection(
  originalChar: string,
  typoResult: { typoChar: string; typoType: TypoType },
  nextChar?: string
): string[] {
  const { typoType } = typoResult;
  const corrections: string[] = [];

  switch (typoType) {
    case 'adjacent':
      // Typed wrong key - backspace and retype
      corrections.push('Backspace', originalChar);
      break;

    case 'transposition':
      // Typed next char first - need to backspace and type both correctly
      corrections.push('Backspace', originalChar, nextChar!);
      break;

    case 'doubleStroke':
      // Typed twice - just backspace once
      corrections.push('Backspace');
      break;

    case 'skip':
      // Didn't type anything - just type it now (correction happens later)
      corrections.push(originalChar);
      break;

    case 'insert':
      // Typed extra char - backspace twice and retype
      corrections.push('Backspace', 'Backspace', originalChar);
      break;
  }

  return corrections;
}

/**
 * Decide whether to make a typo based on context
 */
export function shouldMakeTypo(
  char: string,
  position: number,
  totalLength: number,
  baseRate: number
): boolean {
  // Higher typo rate in the middle of words/text
  const middleBonus = (position > 2 && position < totalLength - 2) ? 1.3 : 1.0;

  // Lower rate for numbers and special characters
  const charPenalty = /[0-9@#$%^&*()]/.test(char) ? 0.3 : 1.0;

  // Higher rate for fast sequences (repeated patterns)
  const patternBonus = 1.0;

  const effectiveRate = baseRate * middleBonus * charPenalty * patternBonus;
  return Math.random() < effectiveRate;
}

// =============================================================================
// PAUSE PATTERN GENERATOR
// =============================================================================

/**
 * Characters that trigger sentence-end pauses
 */
const SENTENCE_ENDERS = new Set(['.', '!', '?']);

/**
 * Characters that trigger clause pauses
 */
const CLAUSE_MARKERS = new Set([',', ';', ':', '-']);

/**
 * Words that often precede thinking pauses
 */
const THINKING_TRIGGERS = new Set([
  'because', 'however', 'therefore', 'although', 'while',
  'since', 'when', 'where', 'which', 'what', 'how', 'why',
]);

/**
 * Analyze context and determine if a pause is needed
 */
export function analyzePauseContext(
  char: string,
  prevChar: string | null,
  _nextChar: string | null,
  currentWord: string,
  config: HumanTypingConfig
): PauseDecision {
  // Sentence end - longest pause
  if (SENTENCE_ENDERS.has(prevChar || '') && char === ' ') {
    return {
      shouldPause: true,
      duration: logNormalDelay(config.sentencePause, 0.4),
      reason: 'sentence_end',
    };
  }

  // Word boundary - moderate pause
  if (char === ' ') {
    // Check if previous word triggers thinking
    const wordLower = currentWord.toLowerCase();
    if (THINKING_TRIGGERS.has(wordLower) && Math.random() < config.thinkingPauseChance * 2) {
      return {
        shouldPause: true,
        duration: exponentialDelay(config.thinkingPauseDuration, 200),
        reason: 'thinking_word',
      };
    }

    return {
      shouldPause: true,
      duration: gaussianDelay(config.wordBoundaryPause, config.wordBoundaryPause * 0.3),
      reason: 'word_boundary',
    };
  }

  // Clause marker - brief pause
  if (CLAUSE_MARKERS.has(char)) {
    return {
      shouldPause: true,
      duration: gaussianDelay(config.wordBoundaryPause * 0.6, 30),
      reason: 'clause_marker',
    };
  }

  // Random thinking pause
  if (Math.random() < config.thinkingPauseChance) {
    return {
      shouldPause: true,
      duration: exponentialDelay(config.thinkingPauseDuration, 150),
      reason: 'random_thinking',
    };
  }

  return { shouldPause: false, duration: 0, reason: 'none' };
}

/**
 * Calculate hesitation before starting to type
 * Simulates reading the field label, thinking about what to type
 */
export function calculateInitialHesitation(
  fieldLabel: string,
  valueToType: string,
  _config: HumanTypingConfig
): number {
  // Base hesitation: time to "read" the label
  const readingTime = fieldLabel.length * 30; // ~30ms per character to read

  // Thinking time: longer for longer values
  const thinkingTime = Math.min(valueToType.length * 10, 500);

  // Add some randomness
  const totalBase = readingTime + thinkingTime;
  return logNormalDelay(totalBase, 0.3, 100);
}

/**
 * Simulate micro-pauses within words (finger reaching for keys)
 */
export function calculateKeyReachPause(
  currentChar: string,
  prevChar: string | null
): number {
  if (!prevChar) return 0;

  // Define "far" keys that require hand movement
  const leftKeys = new Set(['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b']);
  const rightKeys = new Set(['y', 'u', 'i', 'o', 'p', 'h', 'j', 'k', 'l', 'n', 'm']);

  const prevLower = prevChar.toLowerCase();
  const currLower = currentChar.toLowerCase();

  // Hand switch - slight pause
  const prevLeft = leftKeys.has(prevLower);
  const currLeft = leftKeys.has(currLower);

  if (prevLeft !== currLeft) {
    return gaussianDelay(15, 5, 5, 30);
  }

  // Same hand, far keys
  const farKeys = new Set(['q', 'p', 'z', 'm', '1', '0']);
  if (farKeys.has(currLower)) {
    return gaussianDelay(20, 8, 5, 40);
  }

  return 0;
}

// =============================================================================
// SPEED PROFILE UTILITIES
// =============================================================================

/**
 * Dynamic speed adjustment based on content
 */
export interface SpeedContext {
  position: number;
  totalLength: number;
  charsSinceLastPause: number;
  currentWord: string;
  isEmail: boolean;
  isUrl: boolean;
  isPhoneNumber: boolean;
}

/**
 * Get speed multiplier based on content type
 * People type familiar content faster
 */
export function getContentSpeedMultiplier(context: SpeedContext): number {
  // Typing email addresses - very familiar, faster
  if (context.isEmail) return 0.7;

  // URLs - semi-familiar patterns
  if (context.isUrl) return 0.8;

  // Phone numbers - numerical, methodical
  if (context.isPhoneNumber) return 0.9;

  // Start of text - slower (getting oriented)
  if (context.position < 5) return 1.2;

  // End of text - sometimes rushes
  if (context.position > context.totalLength - 5) return 0.95;

  // Long run without pause - fatigue
  if (context.charsSinceLastPause > 30) {
    return 1.0 + (context.charsSinceLastPause - 30) * 0.01;
  }

  return 1.0;
}

/**
 * Detect content type for speed adjustment
 */
export function detectContentType(value: string): {
  isEmail: boolean;
  isUrl: boolean;
  isPhoneNumber: boolean;
} {
  return {
    isEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    isUrl: /^https?:\/\/|www\./i.test(value),
    isPhoneNumber: /^[\d\s\-\(\)]{10,}$/.test(value),
  };
}

/**
 * Calculate inter-key delay with all adjustments
 */
export function calculateKeystrokeDelay(
  char: string,
  prevChar: string | null,
  context: SpeedContext,
  config: HumanTypingConfig,
  inBurst: boolean
): number {
  // Base delay with Gaussian variation
  const stdDev = config.baseDelay * (config.variancePercent / 100);
  let delay = gaussianDelay(config.baseDelay, stdDev, 15, 300);

  // Apply content-based speed adjustment
  const contentMultiplier = getContentSpeedMultiplier(context);
  delay *= contentMultiplier;

  // Burst typing - faster
  if (inBurst) {
    delay *= config.burstSpeedMultiplier;
  }

  // Key reach time
  delay += calculateKeyReachPause(char, prevChar);

  // Shift key adds time for capitals
  if (char !== char.toLowerCase() && /[A-Z]/.test(char)) {
    delay += gaussianDelay(40, 15, 20, 80);
  }

  // Numbers/symbols are slower (usually)
  if (/[0-9!@#$%^&*()]/.test(char)) {
    delay *= 1.15;
  }

  return Math.round(delay);
}

/**
 * Merge custom config with a profile
 */
export function createCustomProfile(
  base: TypingProfile,
  overrides: Partial<HumanTypingConfig>
): HumanTypingConfig {
  return { ...TYPING_PROFILES[base], ...overrides };
}

// =============================================================================
// PLAYWRIGHT INTEGRATION
// =============================================================================

/**
 * Main human typing function for Playwright
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  profile: TypingProfile | HumanTypingConfig = 'normal'
): Promise<void> {
  const config = typeof profile === 'string' ? TYPING_PROFILES[profile] : profile;
  const locator = page.locator(selector).first();

  await locator.click();
  await typeHumanLike(page, locator, text, config);
}

/**
 * Human typing on a Locator element
 */
export async function humanTypeLocator(
  page: Page,
  locator: Locator,
  text: string,
  profile: TypingProfile | HumanTypingConfig = 'normal'
): Promise<void> {
  const config = typeof profile === 'string' ? TYPING_PROFILES[profile] : profile;

  await locator.click();
  await typeHumanLike(page, locator, text, config);
}

/**
 * Core typing implementation
 */
async function typeHumanLike(
  page: Page,
  _locator: Locator,
  text: string,
  config: HumanTypingConfig
): Promise<void> {
  const contentType = detectContentType(text);
  let currentWord = '';
  let charsSinceLastPause = 0;
  let inBurst = false;
  let burstRemaining = 0;
  let fatigueMultiplier = 1.0;
  let typedCount = 0;

  // Initial hesitation (simulates reading/thinking)
  const initialDelay = calculateInitialHesitation('field', text, config);
  await page.waitForTimeout(initialDelay);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : null;
    const nextChar = i < text.length - 1 ? text[i + 1] : null;

    // Update current word tracking
    if (char === ' ') {
      currentWord = '';
    } else {
      currentWord += char;
    }

    // Check for burst typing mode
    if (!inBurst && Math.random() < config.burstChance) {
      inBurst = true;
      burstRemaining = Math.floor(Math.random() * config.burstLength) + 2;
    }

    if (inBurst) {
      burstRemaining--;
      if (burstRemaining <= 0) {
        inBurst = false;
      }
    }

    // Build context for speed calculation
    const context: SpeedContext = {
      position: i,
      totalLength: text.length,
      charsSinceLastPause,
      currentWord,
      ...contentType,
    };

    // Calculate delay for this keystroke
    let delay = calculateKeystrokeDelay(char, prevChar, context, config, inBurst);

    // Apply fatigue
    if (config.fatigueEnabled) {
      fatigueMultiplier = Math.min(
        config.fatigueMax,
        1.0 + (typedCount / 100) * (config.fatigueRate - 1)
      );
      delay *= fatigueMultiplier;
    }

    // Check for typo
    if (shouldMakeTypo(char, i, text.length, config.typoRate)) {
      await simulateTypoAndCorrection(page, char, nextChar, prevChar, config);

      // If typo was transposition, skip next char (we typed it already)
      // This is handled by the correction logic
    } else {
      // Normal keystroke
      await page.keyboard.type(char, { delay: 0 });
    }

    // Wait the calculated delay
    await page.waitForTimeout(delay);

    // Check for pause after this character
    const pauseDecision = analyzePauseContext(char, prevChar, nextChar, currentWord, config);
    if (pauseDecision.shouldPause) {
      await page.waitForTimeout(pauseDecision.duration);
      charsSinceLastPause = 0;
    } else {
      charsSinceLastPause++;
    }

    typedCount++;
  }
}

/**
 * Simulate a typo and its correction
 */
async function simulateTypoAndCorrection(
  page: Page,
  char: string,
  nextChar: string | null,
  prevChar: string | null,
  config: HumanTypingConfig
): Promise<void> {
  const typoResult = generateTypo(char, nextChar ?? undefined, prevChar ?? undefined);

  // Type the typo
  for (const c of typoResult.typoChar) {
    await page.keyboard.type(c, { delay: 0 });
    await page.waitForTimeout(gaussianDelay(config.baseDelay * 0.8, 15));
  }

  // Pause to "notice" the mistake
  await page.waitForTimeout(logNormalDelay(config.typoDetectDelay, 0.4, 50));

  // Correct the typo
  const corrections = calculateCorrection(char, typoResult, nextChar ?? undefined);
  for (const correction of corrections) {
    if (correction === 'Backspace') {
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(gaussianDelay(config.backspaceDelay, 15, 15, 100));
    } else {
      await page.keyboard.type(correction, { delay: 0 });
      await page.waitForTimeout(gaussianDelay(config.baseDelay, 20));
    }
  }
}

/**
 * Fill a field with human-like typing, clearing any existing content first
 */
export async function humanFill(
  page: Page,
  selector: string,
  text: string,
  profile: TypingProfile | HumanTypingConfig = 'normal'
): Promise<void> {
  const locator = page.locator(selector).first();

  // Click to focus
  await locator.click();

  // Select all and delete (human way to clear)
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(gaussianDelay(100, 30));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(gaussianDelay(150, 50));

  // Type the new content
  const config = typeof profile === 'string' ? TYPING_PROFILES[profile] : profile;
  await typeHumanLike(page, locator, text, config);
}

/**
 * Enhanced field filler that replaces Playwright's fill()
 */
export async function humanFillByLabel(
  page: Page,
  labelText: string,
  value: string,
  profile: TypingProfile | HumanTypingConfig = 'normal'
): Promise<boolean> {
  if (!value) return false;

  try {
    // Find the input associated with the label
    const strategies = [
      // Strategy 1: Label with for attribute
      async () => {
        const label = page.locator(`label:has-text("${labelText}")`).first();
        const forAttr = await label.getAttribute('for');
        if (forAttr) {
          const input = page.locator(`#${forAttr}`);
          await humanTypeLocator(page, input, value, profile);
          return true;
        }
        throw new Error('No for attribute');
      },
      // Strategy 2: Nested input in label
      async () => {
        const label = page.locator(`label:has-text("${labelText}")`).first();
        const input = label.locator('input, textarea').first();
        await humanTypeLocator(page, input, value, profile);
        return true;
      },
      // Strategy 3: Input with placeholder
      async () => {
        const input = page.locator(
          `input[placeholder*="${labelText}" i], textarea[placeholder*="${labelText}" i]`
        ).first();
        await humanTypeLocator(page, input, value, profile);
        return true;
      },
      // Strategy 4: Input with aria-label
      async () => {
        const input = page.locator(
          `input[aria-label*="${labelText}" i], textarea[aria-label*="${labelText}" i]`
        ).first();
        await humanTypeLocator(page, input, value, profile);
        return true;
      },
    ];

    for (const strategy of strategies) {
      try {
        await strategy();
        console.log(`[humanType] Filled field: "${labelText}"`);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  } catch (error) {
    console.log(`[humanType] Error filling "${labelText}": ${(error as Error).message}`);
    return false;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Main Playwright functions
  humanType,
  humanTypeLocator,
  humanFill,
  humanFillByLabel,

  // Profiles and config
  TYPING_PROFILES,
  createCustomProfile,

  // Distribution functions (for advanced usage)
  gaussianRandom,
  gaussianDelay,
  logNormalDelay,
  exponentialDelay,
  weibullDelay,

  // Typo system (for advanced usage)
  generateTypo,
  calculateCorrection,
  shouldMakeTypo,

  // Pause patterns (for advanced usage)
  analyzePauseContext,
  calculateInitialHesitation,
  calculateKeyReachPause,

  // Speed utilities (for advanced usage)
  getContentSpeedMultiplier,
  detectContentType,
  calculateKeystrokeDelay,
};
