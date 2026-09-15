# Anti-Detection and Human-Like Behavior

Research on avoiding bot detection while auto-applying to jobs. This guide covers detection methods used by ATS platforms and strategies to appear human.

---

## Part 1: Detection Methods Used by ATS

### 1.1 Typing Speed Analysis

ATS platforms analyze keystroke patterns to detect automation.

**What they measure:**
- Characters per minute (CPM) - humans average 200-300 CPM
- Keystroke intervals - humans have natural variance (50-200ms between keys)
- Error rate - humans make and correct typos
- Acceleration patterns - humans start slow, speed up, then slow at end
- Pause patterns - humans pause before difficult words or to think

**Red flags:**
- Uniform typing speed (every character at exact same interval)
- Instant field completion (0ms typing time)
- Superhuman speed (>600 CPM sustained)
- No backspace/delete usage
- No pauses mid-word

**How Playwright `.fill()` looks:**
The default `.fill()` method clears and sets the value instantly - this is trivially detectable. The field goes from empty to complete in a single frame.

### 1.2 Mouse Movement Patterns

Sophisticated detection tracks mouse behavior across the entire session.

**Human characteristics:**
- Curved, natural trajectories (not straight lines)
- Overshoot and correction (miss target, backtrack)
- Micro-movements while hovering
- Variable speed (accelerate, decelerate)
- Natural bezier curves, not linear interpolation
- Random small movements even when "still"

**Bot signatures:**
- Perfectly straight lines between elements
- Instant jumps (teleportation)
- No movement at all (direct clicks without approach)
- Mathematical curves (perfect arcs)
- Consistent speed throughout movement
- Starting position at exact center of elements

**Detection services:**
- PerimeterX / HUMAN Security
- Cloudflare Bot Management
- DataDome
- Arkose Labs

### 1.3 Time Between Fields

The pace of form completion reveals automation.

**Human timing patterns:**
```
Field 1 (name):      2.3 seconds
Field 2 (email):     4.1 seconds (longer - checking for typos)
Field 3 (phone):     3.5 seconds
Field 4 (dropdown):  1.8 seconds (click, scroll, select)
Field 5 (textarea):  45 seconds (thinking, typing, editing)
```

**Bot timing patterns:**
```
Field 1: 100ms
Field 2: 100ms
Field 3: 100ms
Field 4: 100ms
Field 5: 100ms
```

**What triggers detection:**
- Total form completion under 30 seconds for complex forms
- Uniform time between all fields
- No reading time before filling
- No scroll time on long pages
- Filling fields out of visual order (top-to-bottom expected)

### 1.4 Browser Fingerprinting

Modern detection uses extensive fingerprinting to identify automation.

**Navigator properties checked:**
```javascript
navigator.webdriver       // true for automated browsers
navigator.plugins         // empty or limited in automation
navigator.languages       // may be missing or generic
navigator.hardwareConcurrency  // often mismatched
navigator.deviceMemory    // may be undefined
```

**WebGL fingerprinting:**
- Renderer string (ANGLE, SwiftShader = headless)
- WebGL extensions list
- Rendering artifacts in canvas tests

**Canvas fingerprinting:**
- Drawing operations produce unique per-browser results
- Automated browsers produce consistent/detectable output
- Font rendering differences

**Audio fingerprinting:**
- AudioContext sample rate
- Oscillator output patterns
- Compressor characteristics

**Screen and window properties:**
```javascript
screen.width / screen.height   // Common automation sizes: 800x600, 1024x768
window.outerWidth - window.innerWidth  // Browser chrome detection
screen.availWidth vs screen.width      // Headless differences
```

**CDP/Automation detection:**
```javascript
window.cdc_adoQpoasnfa76pfcZLmcfl_Array  // ChromeDriver leak
window.cdc_adoQpoasnfa76pfcZLmcfl_Promise
document.$cdc_asdjflasutopfhvcZLmcfl_    // Another CDP marker
navigator.webdriver                       // Standard automation flag
```

### 1.5 CAPTCHA Triggers

CAPTCHA systems analyze cumulative behavior, not single actions.

**Risk factors that accumulate:**
- Fast form completion (add 10 points)
- Straight-line mouse movements (add 15 points)
- Missing hover events (add 5 points)
- No scroll events (add 10 points)
- Consistent timing (add 20 points)
- Known automation fingerprint (add 50 points)
- IP reputation (VPN, datacenter) (add 30 points)
- No historical session data (add 15 points)

**Threshold typically:** 70-100 points triggers CAPTCHA

**reCAPTCHA v3 scoring:**
- 0.9: Almost certainly human
- 0.5: Uncertain, may show challenge
- 0.1: Almost certainly bot

**What reCAPTCHA v3 tracks:**
- Mouse movements over time
- Keyboard usage patterns
- Touch events (mobile)
- Scroll behavior
- Time on page
- Historical behavior (cookies)
- Browser environment

### 1.6 Network and Request Analysis

Server-side detection examines request patterns.

**What they check:**
- Request headers order (browsers have specific orders)
- TLS fingerprinting (JA3/JA4 fingerprints)
- HTTP/2 settings and priorities
- Accept-Language consistency
- Referer chain validity
- Cookie presence and timing
- Request timing patterns (too regular = bot)

**IP-based signals:**
- Datacenter IP ranges (AWS, GCP, etc.)
- VPN exit node lists
- Proxy detection
- Geolocation vs timezone mismatch
- Multiple applications from same IP

---

## Part 2: Human-Like Behavior Simulation

### 2.1 Natural Typing Simulation

Replace `.fill()` with character-by-character typing.

**Implementation approach:**
```javascript
async function humanType(page, selector, text) {
  const element = await page.locator(selector);
  await element.click();
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Variable delay between keystrokes
    const baseDelay = 50 + Math.random() * 100; // 50-150ms
    
    // Slower at start of words
    const isWordStart = i === 0 || text[i-1] === ' ';
    const startBonus = isWordStart ? 50 : 0;
    
    // Occasional longer pauses (thinking)
    const thinkPause = Math.random() < 0.05 ? 200 + Math.random() * 300 : 0;
    
    // Occasional typo and correction
    if (Math.random() < 0.02 && text.length > 10) {
      const wrongChar = getAdjacentKey(char);
      await page.keyboard.type(wrongChar, { delay: 0 });
      await page.waitForTimeout(100 + Math.random() * 150);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(50 + Math.random() * 50);
    }
    
    await page.waitForTimeout(baseDelay + startBonus + thinkPause);
    await page.keyboard.type(char, { delay: 0 });
  }
}

// Helper: get adjacent keyboard key for realistic typos
function getAdjacentKey(char) {
  const adjacentMap = {
    'a': ['s', 'q', 'z'], 'b': ['v', 'n', 'g'],
    'c': ['x', 'v', 'd'], 'd': ['s', 'f', 'e'],
    // ... etc
  };
  const adjacent = adjacentMap[char.toLowerCase()] || [char];
  return adjacent[Math.floor(Math.random() * adjacent.length)];
}
```

**Typing speed profiles:**
```javascript
const typingProfiles = {
  fast: { baseDelay: 40, variance: 30 },    // 300-400 CPM
  normal: { baseDelay: 80, variance: 60 },  // 180-250 CPM
  slow: { baseDelay: 150, variance: 100 },  // 100-150 CPM
  careful: { baseDelay: 200, variance: 80 } // For emails, URLs
};
```

### 2.2 Random Pauses

Add natural thinking pauses throughout interactions.

**Pause injection points:**
```javascript
// Before filling a field (reading the label)
async function readFieldLabel(page, labelText) {
  // Time proportional to label length
  const readingTime = labelText.length * 30 + Math.random() * 500;
  await page.waitForTimeout(Math.min(readingTime, 1500));
}

// Between related fields (short pause)
async function fieldTransitionPause() {
  await page.waitForTimeout(200 + Math.random() * 400);
}

// Between sections (longer pause)
async function sectionPause() {
  await page.waitForTimeout(800 + Math.random() * 1200);
}

// Before submit (reviewing)
async function reviewPause() {
  await page.waitForTimeout(2000 + Math.random() * 3000);
}

// Random micro-pauses during typing
async function thinkingPause() {
  if (Math.random() < 0.1) {
    await page.waitForTimeout(500 + Math.random() * 1500);
  }
}
```

### 2.3 Mouse Movement Simulation

Generate human-like mouse trajectories.

**Bezier curve approach:**
```javascript
async function humanMouseMove(page, fromX, fromY, toX, toY) {
  // Generate control points for bezier curve
  const distance = Math.hypot(toX - fromX, toY - fromY);
  
  // Add some overshoot
  const overshoot = 0.1 + Math.random() * 0.1;
  const overshootX = toX + (toX - fromX) * overshoot;
  const overshootY = toY + (toY - fromY) * overshoot;
  
  // Control points for natural curve
  const cp1x = fromX + (toX - fromX) * 0.2 + (Math.random() - 0.5) * 50;
  const cp1y = fromY + (toY - fromY) * 0.2 + (Math.random() - 0.5) * 50;
  const cp2x = fromX + (toX - fromX) * 0.8 + (Math.random() - 0.5) * 50;
  const cp2y = fromY + (toY - fromY) * 0.8 + (Math.random() - 0.5) * 50;
  
  // Number of steps based on distance
  const steps = Math.max(10, Math.floor(distance / 10));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    
    // Cubic bezier calculation
    const x = cubicBezier(t, fromX, cp1x, cp2x, toX);
    const y = cubicBezier(t, fromY, cp1y, cp2y, toY);
    
    // Variable speed (slow at start and end)
    const speedFactor = Math.sin(t * Math.PI); // 0->1->0 curve
    const delay = 5 + (1 - speedFactor) * 10;
    
    await page.mouse.move(x, y);
    await page.waitForTimeout(delay);
  }
  
  // Overshoot and correct (sometimes)
  if (Math.random() < 0.2) {
    await page.mouse.move(overshootX, overshootY);
    await page.waitForTimeout(50 + Math.random() * 100);
    await page.mouse.move(toX, toY);
  }
}

function cubicBezier(t, p0, p1, p2, p3) {
  const oneMinusT = 1 - t;
  return oneMinusT**3 * p0 + 
         3 * oneMinusT**2 * t * p1 + 
         3 * oneMinusT * t**2 * p2 + 
         t**3 * p3;
}
```

**Mouse micro-movements while idle:**
```javascript
async function idleMouseMovement(page, centerX, centerY, duration) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < duration) {
    // Small random movements (1-5 pixels)
    const dx = (Math.random() - 0.5) * 6;
    const dy = (Math.random() - 0.5) * 6;
    
    await page.mouse.move(centerX + dx, centerY + dy);
    await page.waitForTimeout(50 + Math.random() * 150);
  }
}
```

### 2.4 Viewport Scrolling

Simulate natural page reading behavior.

**Human scroll patterns:**
```javascript
async function humanScroll(page, targetY) {
  const currentY = await page.evaluate(() => window.scrollY);
  const distance = targetY - currentY;
  const direction = distance > 0 ? 1 : -1;
  
  // Scroll in chunks (like mouse wheel)
  const chunkSize = 100 + Math.random() * 100; // 100-200px per "scroll"
  const chunks = Math.ceil(Math.abs(distance) / chunkSize);
  
  for (let i = 0; i < chunks; i++) {
    const scrollAmount = Math.min(chunkSize, Math.abs(distance) - i * chunkSize);
    
    await page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount * direction);
    
    // Variable delay between scrolls (reading time)
    const delay = 100 + Math.random() * 300;
    await page.waitForTimeout(delay);
    
    // Occasional pause (reading content)
    if (Math.random() < 0.15) {
      await page.waitForTimeout(500 + Math.random() * 1500);
    }
  }
}

// Scroll to element before interacting
async function scrollToElement(page, selector) {
  const element = await page.locator(selector);
  const box = await element.boundingBox();
  
  if (box) {
    const targetY = box.y - 200; // Keep element in upper-middle of viewport
    await humanScroll(page, Math.max(0, targetY));
    await page.waitForTimeout(200 + Math.random() * 300); // Reading pause
  }
}
```

### 2.5 Click Behavior

Human clicks are not at exact element centers.

```javascript
async function humanClick(page, selector) {
  const element = await page.locator(selector);
  const box = await element.boundingBox();
  
  if (!box) return false;
  
  // Calculate click position with natural variance
  // Humans click slightly off-center, usually toward the left side
  const offsetX = (Math.random() - 0.3) * box.width * 0.6;
  const offsetY = (Math.random() - 0.5) * box.height * 0.4;
  
  const clickX = box.x + box.width / 2 + offsetX;
  const clickY = box.y + box.height / 2 + offsetY;
  
  // Move to position first
  const currentPos = await page.evaluate(() => ({ x: 0, y: 0 })); // Approximate
  await humanMouseMove(page, currentPos.x, currentPos.y, clickX, clickY);
  
  // Small hover before click
  await page.waitForTimeout(50 + Math.random() * 100);
  
  // Click with slight hold time (humans don't instant-release)
  await page.mouse.down();
  await page.waitForTimeout(50 + Math.random() * 50);
  await page.mouse.up();
  
  return true;
}
```

---

## Part 3: Browser Fingerprint Evasion

### 3.1 Undetected Chromium Configuration

**Launch arguments to avoid detection:**
```javascript
const stealthArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--safebrowsing-disable-auto-update',
];

const browser = await chromium.launch({
  headless: false, // Headless is more detectable
  args: stealthArgs,
});
```

### 3.2 Navigator Property Patching

**Essential patches:**
```javascript
await page.addInitScript(() => {
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
  
  // Fix plugins (empty array is suspicious)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' },
    ],
  });
  
  // Fix languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });
  
  // Fix hardware concurrency (suspicious if undefined or 1)
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
  });
  
  // Fix device memory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
  });
  
  // Remove CDP markers
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
});
```

### 3.3 WebGL and Canvas Fingerprint Noise

**Add subtle noise to fingerprinting attempts:**
```javascript
await page.addInitScript(() => {
  // Modify canvas fingerprint
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attributes) {
    const context = originalGetContext.call(this, type, attributes);
    
    if (type === '2d') {
      const originalGetImageData = context.getImageData;
      context.getImageData = function() {
        const imageData = originalGetImageData.apply(this, arguments);
        // Add subtle noise to image data
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = imageData.data[i] ^ (Math.random() * 2 | 0);
        }
        return imageData;
      };
    }
    
    return context;
  };
  
  // Modify WebGL fingerprint
  const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    // Spoof renderer/vendor strings
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return originalGetParameter.call(this, param);
  };
});
```

### 3.4 Realistic Browser Context

**Create believable browser state:**
```javascript
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, // Common resolution
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'America/Los_Angeles',
  geolocation: { latitude: 37.7749, longitude: -122.4194 },
  permissions: ['geolocation'],
  colorScheme: 'light',
  hasTouch: false,
  isMobile: false,
  deviceScaleFactor: 2, // Retina
  javaScriptEnabled: true,
});
```

---

## Part 4: Speed vs Detection Tradeoff

### 4.1 Risk Levels

| Speed Level | Time per App | Detection Risk | Use Case |
|-------------|--------------|----------------|----------|
| Maximum | 5-10 sec | Very High | Testing only |
| Fast | 30-60 sec | High | Low-priority jobs |
| Normal | 1-2 min | Medium | Standard applications |
| Careful | 3-5 min | Low | Target companies |
| Ultra-Safe | 5-10 min | Very Low | Dream jobs |

### 4.2 Speed Configuration Profiles

```javascript
const speedProfiles = {
  fast: {
    typingDelay: { base: 30, variance: 20 },
    fieldDelay: { min: 100, max: 300 },
    sectionDelay: { min: 300, max: 600 },
    scrollDelay: { min: 50, max: 150 },
    mouseSpeed: 'fast',
    skipMouseMovement: true,
    parallelFill: true,
  },
  normal: {
    typingDelay: { base: 70, variance: 50 },
    fieldDelay: { min: 300, max: 800 },
    sectionDelay: { min: 800, max: 1500 },
    scrollDelay: { min: 100, max: 400 },
    mouseSpeed: 'normal',
    skipMouseMovement: false,
    parallelFill: false,
  },
  careful: {
    typingDelay: { base: 100, variance: 80 },
    fieldDelay: { min: 500, max: 1500 },
    sectionDelay: { min: 1500, max: 3000 },
    scrollDelay: { min: 200, max: 600 },
    mouseSpeed: 'slow',
    skipMouseMovement: false,
    parallelFill: false,
    addTypos: true,
    addPauses: true,
  },
  ultrasafe: {
    typingDelay: { base: 150, variance: 100 },
    fieldDelay: { min: 1000, max: 2500 },
    sectionDelay: { min: 2500, max: 5000 },
    scrollDelay: { min: 300, max: 800 },
    mouseSpeed: 'human',
    skipMouseMovement: false,
    parallelFill: false,
    addTypos: true,
    addPauses: true,
    simulateReading: true,
  },
};
```

### 4.3 Adaptive Speed

Adjust speed based on detected risk signals.

```javascript
async function getAdaptiveSpeed(page, baseProfile) {
  let riskScore = 0;
  
  // Check for reCAPTCHA presence
  const hasRecaptcha = await page.locator('[data-sitekey], .g-recaptcha').count() > 0;
  if (hasRecaptcha) riskScore += 30;
  
  // Check for known bot detection scripts
  const hasBotDetection = await page.evaluate(() => {
    return !!(window.Fingerprint2 || window.FingerprintJS || 
              window.PerimeterX || window.__cf_chl_opt);
  });
  if (hasBotDetection) riskScore += 40;
  
  // Check for DataDome
  const hasDataDome = await page.evaluate(() => {
    return document.cookie.includes('datadome');
  });
  if (hasDataDome) riskScore += 50;
  
  // Adjust profile based on risk
  if (riskScore >= 50) {
    return speedProfiles.ultrasafe;
  } else if (riskScore >= 30) {
    return speedProfiles.careful;
  } else if (riskScore >= 10) {
    return speedProfiles.normal;
  }
  
  return baseProfile;
}
```

---

## Part 5: Safe Defaults

### 5.1 Recommended Production Settings

```javascript
// config.js additions
export const antiDetection = {
  // Enable human-like behavior by default
  humanTyping: true,
  humanMouse: false,  // Expensive, enable for careful mode
  
  // Timing defaults (balanced speed/safety)
  delays: {
    typing: { base: 60, variance: 40 },
    betweenFields: { min: 200, max: 600 },
    betweenSections: { min: 600, max: 1200 },
    beforeSubmit: { min: 1500, max: 3000 },
    afterPageLoad: { min: 800, max: 1500 },
  },
  
  // Fingerprint evasion (always on)
  stealth: {
    patchNavigator: true,
    patchCanvas: false,      // Can break some sites
    patchWebGL: false,       // Can break some sites
    removeWebdriver: true,
    addPlugins: true,
  },
  
  // Behavior simulation
  behavior: {
    addTypos: false,         // Enable for careful mode
    addPauses: true,
    simulateReading: false,  // Enable for careful mode
    scrollBeforeFill: true,
  },
  
  // Risk thresholds
  captchaRetries: 2,         // Retry on CAPTCHA
  failOnDetection: true,     // Stop if definitely detected
};
```

### 5.2 Per-ATS Recommendations

| ATS | Detection Level | Recommended Profile |
|-----|-----------------|---------------------|
| Greenhouse | Low | Normal |
| Lever | Low | Normal |
| Ashby | Low | Normal |
| Jobvite | Medium | Careful |
| Workday | High | Ultra-Safe or Skip |
| iCIMS | Medium | Careful |
| Taleo | High | Ultra-Safe or Skip |
| Custom/Unknown | Unknown | Careful |

### 5.3 Session Management

Avoid patterns that indicate automation across applications.

```javascript
const sessionBestPractices = {
  // Rotate user agents between sessions
  rotateUserAgent: true,
  userAgentPool: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
    // etc
  ],
  
  // Add delays between applications
  minDelayBetweenApps: 30000,  // 30 seconds minimum
  maxAppsPerHour: 10,          // Rate limit
  
  // Clear state periodically
  clearCookiesPeriod: 5,       // Every 5 applications
  clearStoragePeriod: 10,      // Every 10 applications
  
  // Use different viewport sizes
  viewportVariation: true,
  viewportPool: [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 2560, height: 1440 },
  ],
};
```

---

## Part 6: Implementation Priority

### Phase 1: Essential (Do Now)

1. **Remove webdriver flag** - Trivial to implement, blocks basic detection
2. **Add realistic user agent** - Already done in browser.js
3. **Implement natural typing delays** - Replace `.fill()` with character-by-character
4. **Add field transition delays** - Already have basic delays, make them variable
5. **Scroll before interacting** - Easy win for believability

### Phase 2: Important (Do Soon)

1. **Variable timing profiles** - Add fast/normal/careful modes
2. **Per-ATS configuration** - Some need more care than others
3. **Session rate limiting** - Prevent bulk detection
4. **Basic fingerprint patches** - Navigator properties

### Phase 3: Advanced (Nice to Have)

1. **Full mouse movement simulation** - Expensive but effective
2. **Typo injection and correction** - Adds authenticity
3. **Reading time simulation** - For ultra-safe mode
4. **Canvas/WebGL fingerprint noise** - For high-security sites
5. **Adaptive speed based on detection** - Dynamic risk assessment

---

## Appendix: Detection Test Sites

Use these to verify evasion effectiveness:

- **bot.sannysoft.com** - Comprehensive automation detection
- **browserleaks.com** - Full fingerprint analysis
- **fingerprintjs.com/demo** - FingerprintJS detection
- **pixelscan.net** - Headless/automation detection
- **arh.antoinevastel.com/bots/areyouheadless** - Headless detection
- **abrahamjuliot.github.io/creepjs** - Advanced fingerprinting

**Testing methodology:**
1. Run detection tests with vanilla Playwright
2. Apply evasion techniques incrementally
3. Verify each technique reduces detection signals
4. Test against actual ATS platforms in dry-run mode

---

*Last updated: 2026-09-10*
*For use with the HireRadar auto-apply system*
