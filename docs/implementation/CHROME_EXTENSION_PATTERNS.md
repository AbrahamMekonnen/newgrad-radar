# Chrome Extension Form-Fill Patterns (Manifest V3)

This document covers patterns and best practices for building a Chrome extension that fills job application forms under Manifest V3 constraints.

## Table of Contents
1. [Manifest V3 Overview](#manifest-v3-overview)
2. [Project Structure](#project-structure)
3. [Manifest Configuration](#manifest-configuration)
4. [Content Scripts](#content-scripts)
5. [Storage Patterns](#storage-patterns)
6. [Message Passing](#message-passing)
7. [Form Detection and Filling](#form-detection-and-filling)
8. [Cross-Origin Handling](#cross-origin-handling)
9. [UI Patterns](#ui-patterns)
10. [Security Considerations](#security-considerations)
11. [Example Implementations](#example-implementations)

---

## Manifest V3 Overview

### Key Changes from Manifest V2

| Feature | Manifest V2 | Manifest V3 |
|---------|-------------|-------------|
| Background scripts | Persistent background pages | Service workers (event-driven) |
| Remote code | Allowed | Prohibited |
| Host permissions | In `permissions` | Separate `host_permissions` |
| Content Security Policy | Flexible | Stricter, no `unsafe-eval` |
| Web Request API | Blocking allowed | Use `declarativeNetRequest` |

### Implications for Form Fillers

1. **Service workers** terminate when idle - cannot maintain persistent state in memory
2. **No remote code execution** - all logic must be bundled in extension
3. **Stricter CSP** - cannot use `eval()` or dynamic code generation
4. **Storage becomes critical** - use `chrome.storage` for persistence

---

## Project Structure

```
extension/
├── manifest.json           # Extension configuration
├── service-worker.js       # Background service worker
├── popup/
│   ├── popup.html          # Popup UI
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic
├── content/
│   ├── content.js          # Main content script
│   ├── form-detector.js    # Form field detection
│   └── form-filler.js      # Form filling logic
├── options/
│   ├── options.html        # Settings page
│   └── options.js          # Settings logic
├── lib/
│   └── storage.js          # Storage utilities
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── styles/
    └── inject.css          # Styles injected into pages
```

---

## Manifest Configuration

### Complete manifest.json for Form Filler

```json
{
  "manifest_version": 3,
  "name": "NewGrad Radar Auto-Fill",
  "version": "1.0.0",
  "description": "Auto-fill job application forms with your profile data",
  
  "permissions": [
    "storage",
    "activeTab",
    "scripting",
    "tabs",
    "contextMenus"
  ],
  
  "host_permissions": [
    "https://jobs.lever.co/*",
    "https://boards.greenhouse.io/*",
    "https://*.workday.com/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.icims.com/*",
    "https://*.taleo.net/*",
    "https://*.smartrecruiters.com/*",
    "https://*.ashbyhq.com/*",
    "https://*.bamboohr.com/*",
    "https://*.recruitee.com/*",
    "https://*.jobvite.com/*",
    "https://*.breezy.hr/*",
    "https://*.applytojob.com/*"
  ],
  
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "NewGrad Radar Auto-Fill"
  },
  
  "content_scripts": [
    {
      "matches": [
        "https://jobs.lever.co/*",
        "https://boards.greenhouse.io/*",
        "https://*.workday.com/*",
        "https://*.myworkdayjobs.com/*"
      ],
      "js": ["content/content.js"],
      "css": ["styles/inject.css"],
      "run_at": "document_idle"
    }
  ],
  
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  },
  
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  
  "web_accessible_resources": [
    {
      "resources": ["styles/inject.css", "icons/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### Permission Explanations

| Permission | Purpose |
|------------|---------|
| `storage` | Store user profile data locally |
| `activeTab` | Access current tab when user clicks extension |
| `scripting` | Programmatically inject scripts |
| `tabs` | Query tab information |
| `contextMenus` | Right-click context menu |

---

## Content Scripts

### Main Content Script (content.js)

```javascript
// content/content.js
(function() {
  'use strict';

  // Avoid re-injection
  if (window.__newgradRadarInjected) return;
  window.__newgradRadarInjected = true;

  // Form field mapping for common ATS platforms
  const FIELD_SELECTORS = {
    // Generic selectors
    firstName: [
      'input[name*="first" i][name*="name" i]',
      'input[name="firstName"]',
      'input[id*="first" i][id*="name" i]',
      'input[autocomplete="given-name"]',
      'input[placeholder*="first name" i]'
    ],
    lastName: [
      'input[name*="last" i][name*="name" i]',
      'input[name="lastName"]',
      'input[id*="last" i][id*="name" i]',
      'input[autocomplete="family-name"]',
      'input[placeholder*="last name" i]'
    ],
    email: [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]'
    ],
    phone: [
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[autocomplete="tel"]'
    ],
    linkedin: [
      'input[name*="linkedin" i]',
      'input[id*="linkedin" i]',
      'input[placeholder*="linkedin" i]'
    ],
    github: [
      'input[name*="github" i]',
      'input[id*="github" i]',
      'input[placeholder*="github" i]'
    ],
    website: [
      'input[name*="website" i]',
      'input[name*="portfolio" i]',
      'input[id*="website" i]',
      'input[type="url"]'
    ],
    location: [
      'input[name*="location" i]',
      'input[name*="city" i]',
      'input[id*="location" i]',
      'input[autocomplete="address-level2"]'
    ]
  };

  // Find a field using multiple selectors
  function findField(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        return element;
      }
    }
    return null;
  }

  // Check if element is visible
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           element.offsetParent !== null;
  }

  // Fill a single field with proper event dispatching
  function fillField(element, value) {
    if (!element || !value) return false;

    // Focus the element
    element.focus();

    // Clear existing value
    element.value = '';

    // Set new value
    element.value = value;

    // Dispatch events to trigger React/Vue/Angular handlers
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    // For React controlled components
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));

    return true;
  }

  // Fill all detected form fields
  async function fillForm(profile) {
    const results = {
      filled: [],
      notFound: [],
      errors: []
    };

    const fieldMappings = {
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      linkedin: profile.linkedin,
      github: profile.github,
      website: profile.website,
      location: profile.location
    };

    for (const [fieldName, value] of Object.entries(fieldMappings)) {
      if (!value) continue;

      try {
        const field = findField(FIELD_SELECTORS[fieldName]);
        if (field) {
          fillField(field, value);
          results.filled.push(fieldName);
        } else {
          results.notFound.push(fieldName);
        }
      } catch (error) {
        results.errors.push({ field: fieldName, error: error.message });
      }
    }

    return results;
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fillForm') {
      fillForm(message.profile)
        .then(results => sendResponse({ success: true, results }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicates async response
    }

    if (message.action === 'detectFields') {
      const detected = detectFormFields();
      sendResponse({ fields: detected });
      return false;
    }

    if (message.action === 'ping') {
      sendResponse({ status: 'ready' });
      return false;
    }
  });

  // Detect available form fields on page
  function detectFormFields() {
    const detected = {};
    for (const [fieldName, selectors] of Object.entries(FIELD_SELECTORS)) {
      const field = findField(selectors);
      if (field) {
        detected[fieldName] = {
          found: true,
          selector: field.tagName + (field.id ? '#' + field.id : '') + 
                   (field.name ? '[name="' + field.name + '"]' : ''),
          currentValue: field.value
        };
      }
    }
    return detected;
  }

  // Auto-detect page type and show indicator
  function init() {
    const detected = detectFormFields();
    const fieldCount = Object.keys(detected).length;
    
    if (fieldCount > 0) {
      // Notify background script that form was detected
      chrome.runtime.sendMessage({
        action: 'formDetected',
        fieldCount,
        url: window.location.href
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### Platform-Specific Detection (form-detector.js)

```javascript
// content/form-detector.js

// ATS-specific field mappings
const ATS_CONFIGS = {
  lever: {
    hostname: 'jobs.lever.co',
    selectors: {
      firstName: 'input[name="name"]', // Lever uses single name field
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      linkedin: 'input[name="urls[LinkedIn]"]',
      github: 'input[name="urls[GitHub]"]',
      website: 'input[name="urls[Portfolio]"]',
      resume: 'input[name="resume"]'
    },
    splitName: true // Lever uses single name field
  },
  
  greenhouse: {
    hostname: 'boards.greenhouse.io',
    selectors: {
      firstName: '#first_name',
      lastName: '#last_name',
      email: '#email',
      phone: '#phone',
      linkedin: 'input[id*="linkedin"]',
      resume: 'input[type="file"]'
    }
  },
  
  workday: {
    hostname: '.workday.com',
    selectors: {
      firstName: 'input[data-automation-id="legalNameSection_firstName"]',
      lastName: 'input[data-automation-id="legalNameSection_lastName"]',
      email: 'input[data-automation-id="email"]',
      phone: 'input[data-automation-id="phone-number"]',
      country: 'button[data-automation-id="countryDropdown"]'
    },
    requiresWait: true, // Workday loads forms dynamically
    waitSelector: '[data-automation-id="legalNameSection_firstName"]'
  },
  
  icims: {
    hostname: '.icims.com',
    selectors: {
      firstName: 'input[id*="FirstName"]',
      lastName: 'input[id*="LastName"]',
      email: 'input[id*="Email"]',
      phone: 'input[id*="Phone"]'
    }
  },
  
  ashby: {
    hostname: '.ashbyhq.com',
    selectors: {
      firstName: 'input[name="_systemfield_name"]',
      email: 'input[name="_systemfield_email"]',
      phone: 'input[name="_systemfield_phone"]',
      linkedin: 'input[name="linkedInUrl"]',
      github: 'input[name="githubUrl"]'
    }
  }
};

// Detect which ATS we're on
function detectATS() {
  const hostname = window.location.hostname;
  
  for (const [atsName, config] of Object.entries(ATS_CONFIGS)) {
    if (hostname.includes(config.hostname.replace('.', ''))) {
      return { name: atsName, config };
    }
  }
  
  return null;
}

// Wait for dynamic forms to load (for Workday, etc.)
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error('Element not found: ' + selector));
    }, timeout);
  });
}

export { ATS_CONFIGS, detectATS, waitForElement };
```

---

## Storage Patterns

### Storage Utility (lib/storage.js)

```javascript
// lib/storage.js

// Profile schema
const DEFAULT_PROFILE = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedin: '',
  github: '',
  website: '',
  location: '',
  
  // Additional fields
  school: '',
  degree: '',
  graduationYear: '',
  major: '',
  gpa: '',
  
  // Work authorization
  workAuthorization: '',
  requiresSponsorship: null,
  
  // Demographics (optional)
  gender: '',
  ethnicity: '',
  veteranStatus: '',
  disabilityStatus: '',
  
  // Custom fields for specific applications
  customFields: {}
};

// Storage keys
const STORAGE_KEYS = {
  PROFILE: 'userProfile',
  SETTINGS: 'settings',
  FILL_HISTORY: 'fillHistory',
  FIELD_MAPPINGS: 'fieldMappings'
};

// Save profile to storage
async function saveProfile(profile) {
  const dataToSave = {
    ...DEFAULT_PROFILE,
    ...profile,
    updatedAt: Date.now()
  };
  
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROFILE]: dataToSave
  });
  
  return dataToSave;
}

// Get profile from storage
async function getProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PROFILE);
  return result[STORAGE_KEYS.PROFILE] || DEFAULT_PROFILE;
}

// Save settings
async function saveSettings(settings) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: {
      ...settings,
      updatedAt: Date.now()
    }
  });
}

// Get settings
async function getSettings() {
  const defaultSettings = {
    autoFill: false,
    showNotifications: true,
    enabledSites: [],
    disabledSites: []
  };
  
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...defaultSettings, ...result[STORAGE_KEYS.SETTINGS] };
}

// Log fill history
async function logFill(url, fields, success) {
  const history = await getFillHistory();
  
  history.unshift({
    url,
    fields,
    success,
    timestamp: Date.now()
  });
  
  // Keep last 100 entries
  if (history.length > 100) {
    history.pop();
  }
  
  await chrome.storage.local.set({
    [STORAGE_KEYS.FILL_HISTORY]: history
  });
}

// Get fill history
async function getFillHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FILL_HISTORY);
  return result[STORAGE_KEYS.FILL_HISTORY] || [];
}

// Export/Import profile
async function exportProfile() {
  const profile = await getProfile();
  return JSON.stringify(profile, null, 2);
}

async function importProfile(jsonString) {
  try {
    const profile = JSON.parse(jsonString);
    await saveProfile(profile);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Sync storage for cross-device (optional)
async function syncProfile() {
  const localProfile = await getProfile();
  
  // Use chrome.storage.sync for cross-device sync
  // Note: 8KB per item limit, 100KB total
  await chrome.storage.sync.set({
    profile: {
      firstName: localProfile.firstName,
      lastName: localProfile.lastName,
      email: localProfile.email,
      phone: localProfile.phone,
      linkedin: localProfile.linkedin,
      github: localProfile.github
    }
  });
}

export {
  DEFAULT_PROFILE,
  STORAGE_KEYS,
  saveProfile,
  getProfile,
  saveSettings,
  getSettings,
  logFill,
  getFillHistory,
  exportProfile,
  importProfile,
  syncProfile
};
```

### Storage Quota Considerations

```javascript
// Check storage usage
async function checkStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse();
  const quota = chrome.storage.local.QUOTA_BYTES; // ~10MB for local
  
  return {
    used: bytesInUse,
    quota: quota,
    percentUsed: (bytesInUse / quota * 100).toFixed(2)
  };
}
```

---

## Message Passing

### Service Worker (service-worker.js)

```javascript
// service-worker.js
import { getProfile, logFill } from './lib/storage.js';

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'fillForm',
    title: 'Fill form with NewGrad Radar',
    contexts: ['page', 'editable']
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
  
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'getProfile':
      return await getProfile();
      
    case 'formDetected':
      // Update badge to show form was detected
      await chrome.action.setBadgeText({
        text: String(message.fieldCount),
        tabId: sender.tab?.id
      });
      await chrome.action.setBadgeBackgroundColor({
        color: '#4CAF50',
        tabId: sender.tab?.id
      });
      return { success: true };
      
    case 'fillComplete':
      await logFill(message.url, message.fields, message.success);
      return { success: true };
      
    default:
      throw new Error('Unknown action: ' + message.action);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'fillForm') {
    const profile = await getProfile();
    
    // Inject content script if needed, then fill
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
    } catch (e) {
      // Script might already be injected
    }
    
    // Send fill command
    chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      profile
    });
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'fill-form') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const profile = await getProfile();
      chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        profile
      });
    }
  }
});
```

### Popup Communication (popup/popup.js)

```javascript
// popup/popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const fillButton = document.getElementById('fillButton');
  const detectButton = document.getElementById('detectButton');
  const statusDiv = document.getElementById('status');
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Check if content script is ready
  async function checkContentScript() {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      return response?.status === 'ready';
    } catch {
      return false;
    }
  }
  
  // Inject content script if needed
  async function ensureContentScript() {
    const isReady = await checkContentScript();
    if (!isReady) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
      // Wait a moment for script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Fill form button
  fillButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Filling form...';
    
    try {
      await ensureContentScript();
      
      // Get profile from storage
      const profile = await chrome.runtime.sendMessage({ action: 'getProfile' });
      
      // Send fill command to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        profile
      });
      
      if (response.success) {
        const { filled, notFound } = response.results;
        statusDiv.textContent = `Filled ${filled.length} fields`;
        if (notFound.length > 0) {
          statusDiv.textContent += ` (${notFound.length} not found)`;
        }
      } else {
        statusDiv.textContent = 'Error: ' + response.error;
      }
    } catch (error) {
      statusDiv.textContent = 'Error: ' + error.message;
    }
  });
  
  // Detect fields button
  detectButton.addEventListener('click', async () => {
    try {
      await ensureContentScript();
      
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'detectFields'
      });
      
      displayDetectedFields(response.fields);
    } catch (error) {
      statusDiv.textContent = 'Error: ' + error.message;
    }
  });
  
  function displayDetectedFields(fields) {
    const fieldList = document.getElementById('fieldList');
    fieldList.innerHTML = '';
    
    for (const [name, info] of Object.entries(fields)) {
      const li = document.createElement('li');
      li.textContent = `${name}: ${info.selector}`;
      li.className = info.currentValue ? 'has-value' : '';
      fieldList.appendChild(li);
    }
  }
});
```

---

## Form Detection and Filling

### Advanced Form Filling with React/Vue Support

```javascript
// content/form-filler.js

// Handle React controlled inputs
function setReactValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (valueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
  
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

// Handle select dropdowns
async function fillSelect(element, value) {
  // For native select
  if (element.tagName === 'SELECT') {
    const option = Array.from(element.options).find(opt => 
      opt.value.toLowerCase().includes(value.toLowerCase()) ||
      opt.textContent.toLowerCase().includes(value.toLowerCase())
    );
    
    if (option) {
      element.value = option.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  
  // For custom dropdowns (React Select, etc.)
  // Click to open, then find and click option
  element.click();
  await sleep(100);
  
  const options = document.querySelectorAll('[class*="option"], [role="option"]');
  for (const opt of options) {
    if (opt.textContent.toLowerCase().includes(value.toLowerCase())) {
      opt.click();
      return true;
    }
  }
  
  return false;
}

// Handle radio buttons
function fillRadio(name, value) {
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  
  for (const radio of radios) {
    const label = document.querySelector(`label[for="${radio.id}"]`);
    const labelText = label?.textContent || radio.value;
    
    if (labelText.toLowerCase().includes(value.toLowerCase())) {
      radio.click();
      return true;
    }
  }
  
  return false;
}

// Handle checkboxes
function fillCheckbox(element, shouldCheck) {
  if (element.checked !== shouldCheck) {
    element.click();
  }
}

// Handle file inputs (resume upload)
async function fillFileInput(element, fileUrl) {
  // Note: Cannot programmatically set file input due to security
  // Best we can do is highlight it for user
  element.style.outline = '3px solid #4CAF50';
  element.setAttribute('data-autofill-pending', 'true');
  
  // Show tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'autofill-tooltip';
  tooltip.textContent = 'Click to upload your resume';
  element.parentElement.appendChild(tooltip);
  
  return false; // Indicate manual action needed
}

// Utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { setReactValue, fillSelect, fillRadio, fillCheckbox, fillFileInput };
```

### Smart Field Matching with ML-like Heuristics

```javascript
// content/field-matcher.js

// Keywords for field detection
const FIELD_KEYWORDS = {
  firstName: ['first', 'fname', 'given', 'forename'],
  lastName: ['last', 'lname', 'surname', 'family'],
  email: ['email', 'e-mail', 'mail'],
  phone: ['phone', 'tel', 'mobile', 'cell', 'contact'],
  linkedin: ['linkedin', 'linked-in'],
  github: ['github', 'git-hub'],
  website: ['website', 'portfolio', 'url', 'site', 'homepage'],
  location: ['location', 'city', 'address', 'where'],
  school: ['school', 'university', 'college', 'institution', 'education'],
  degree: ['degree', 'major', 'field', 'study'],
  gpa: ['gpa', 'grade', 'cgpa'],
  graduation: ['graduation', 'grad', 'year', 'expected'],
  workAuth: ['authorization', 'authorisation', 'sponsor', 'visa', 'eligible'],
  gender: ['gender', 'sex'],
  ethnicity: ['race', 'ethnicity', 'ethnic'],
  veteran: ['veteran', 'military', 'service'],
  disability: ['disability', 'disabled', 'accommodation']
};

// Score how well an element matches a field type
function scoreFieldMatch(element, fieldType) {
  const keywords = FIELD_KEYWORDS[fieldType] || [];
  let score = 0;
  
  // Check various attributes
  const checkText = [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    getAssociatedLabel(element)
  ].filter(Boolean).join(' ').toLowerCase();
  
  for (const keyword of keywords) {
    if (checkText.includes(keyword)) {
      score += 10;
    }
  }
  
  // Autocomplete attribute is authoritative
  const autocomplete = element.getAttribute('autocomplete');
  if (autocomplete) {
    const autocompleteMap = {
      'given-name': 'firstName',
      'family-name': 'lastName',
      'email': 'email',
      'tel': 'phone',
      'url': 'website',
      'address-level2': 'location'
    };
    
    if (autocompleteMap[autocomplete] === fieldType) {
      score += 50;
    }
  }
  
  return score;
}

// Get associated label text
function getAssociatedLabel(element) {
  // Check for label with 'for' attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent;
  }
  
  // Check for parent label
  const parentLabel = element.closest('label');
  if (parentLabel) return parentLabel.textContent;
  
  // Check for nearby text
  const parent = element.parentElement;
  if (parent) {
    const text = parent.textContent.replace(element.value, '').trim();
    if (text.length < 100) return text;
  }
  
  return '';
}

// Find best match for each profile field
function matchFields(profile) {
  const inputs = document.querySelectorAll('input, select, textarea');
  const matches = {};
  
  for (const [fieldType, value] of Object.entries(profile)) {
    if (!value) continue;
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const input of inputs) {
      const score = scoreFieldMatch(input, fieldType);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = input;
      }
    }
    
    if (bestMatch && bestScore >= 10) {
      matches[fieldType] = {
        element: bestMatch,
        score: bestScore,
        value: value
      };
    }
  }
  
  return matches;
}

export { scoreFieldMatch, matchFields, getAssociatedLabel };
```

---

## Cross-Origin Handling

### Handling iFrames

```javascript
// content/iframe-handler.js

// Detect and handle iframes (common in Workday, Taleo)
async function handleIframes() {
  const iframes = document.querySelectorAll('iframe');
  
  for (const iframe of iframes) {
    try {
      // Check if same-origin
      const iframeDoc = iframe.contentDocument;
      if (iframeDoc) {
        // Can access - inject our logic
        injectIntoFrame(iframeDoc);
      }
    } catch (e) {
      // Cross-origin - need to use chrome.scripting
      if (iframe.src) {
        notifyCrossOriginFrame(iframe.src);
      }
    }
  }
}

function injectIntoFrame(doc) {
  // Clone our field detection logic into the iframe
  const script = doc.createElement('script');
  script.textContent = `
    window.addEventListener('message', (event) => {
      if (event.data.action === 'fillField') {
        const field = document.querySelector(event.data.selector);
        if (field) {
          field.value = event.data.value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  `;
  doc.head.appendChild(script);
}

function notifyCrossOriginFrame(src) {
  // Need declarative content script for cross-origin frames
  chrome.runtime.sendMessage({
    action: 'registerFrameScript',
    url: src
  });
}

export { handleIframes };
```

### Manifest for Cross-Origin Frame Access

```json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "all_frames": true,
      "match_about_blank": true,
      "match_origin_as_fallback": true
    }
  ]
}
```

---

## UI Patterns

### Popup UI (popup/popup.html)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      width: 320px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    }
    
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .header img {
      width: 32px;
      height: 32px;
    }
    
    .header h1 {
      font-size: 16px;
      margin: 0;
    }
    
    .button-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    button {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    
    .primary {
      background: #2563eb;
      color: white;
    }
    
    .primary:hover {
      background: #1d4ed8;
    }
    
    .secondary {
      background: #f1f5f9;
      color: #334155;
    }
    
    .secondary:hover {
      background: #e2e8f0;
    }
    
    .status {
      margin-top: 12px;
      padding: 8px;
      background: #f8fafc;
      border-radius: 4px;
      font-size: 13px;
      color: #64748b;
    }
    
    .field-list {
      margin-top: 12px;
      list-style: none;
      padding: 0;
    }
    
    .field-list li {
      padding: 4px 0;
      font-size: 12px;
      color: #64748b;
    }
    
    .field-list li.has-value {
      color: #22c55e;
    }
    
    .footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
    }
    
    .footer a {
      color: #2563eb;
      text-decoration: none;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="../icons/icon32.png" alt="Logo">
    <h1>NewGrad Radar</h1>
  </div>
  
  <div class="button-group">
    <button id="fillButton" class="primary">Fill Form</button>
    <button id="detectButton" class="secondary">Detect Fields</button>
  </div>
  
  <div id="status" class="status">Ready to fill</div>
  
  <ul id="fieldList" class="field-list"></ul>
  
  <div class="footer">
    <a href="#" id="settingsLink">Edit Profile</a>
  </div>
  
  <script src="popup.js"></script>
</body>
</html>
```

### Sidebar Panel Alternative (Manifest V3)

```json
{
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "permissions": ["sidePanel"]
}
```

```javascript
// Open side panel programmatically
chrome.sidePanel.open({ windowId: window.id });

// Set panel behavior
chrome.sidePanel.setOptions({
  tabId: tab.id,
  path: 'sidepanel/sidepanel.html',
  enabled: true
});
```

### Floating Widget (Injected UI)

```javascript
// content/widget.js

function createFloatingWidget() {
  const widget = document.createElement('div');
  widget.id = 'newgrad-radar-widget';
  widget.innerHTML = `
    <style>
      #newgrad-radar-widget {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      }
      
      .nr-widget-button {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #2563eb;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
      }
      
      .nr-widget-button:hover {
        transform: scale(1.1);
      }
      
      .nr-widget-menu {
        position: absolute;
        bottom: 70px;
        right: 0;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        padding: 8px 0;
        min-width: 160px;
        display: none;
      }
      
      .nr-widget-menu.open {
        display: block;
      }
      
      .nr-menu-item {
        padding: 10px 16px;
        cursor: pointer;
        transition: background 0.2s;
      }
      
      .nr-menu-item:hover {
        background: #f1f5f9;
      }
    </style>
    
    <div class="nr-widget-menu" id="nr-menu">
      <div class="nr-menu-item" data-action="fill">Fill Form</div>
      <div class="nr-menu-item" data-action="detect">Detect Fields</div>
      <div class="nr-menu-item" data-action="settings">Settings</div>
    </div>
    
    <button class="nr-widget-button" id="nr-button">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.59L18 11l-6 6z"/>
      </svg>
    </button>
  `;
  
  document.body.appendChild(widget);
  
  // Toggle menu
  document.getElementById('nr-button').addEventListener('click', () => {
    document.getElementById('nr-menu').classList.toggle('open');
  });
  
  // Handle menu actions
  widget.querySelectorAll('.nr-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      handleWidgetAction(action);
      document.getElementById('nr-menu').classList.remove('open');
    });
  });
}

function handleWidgetAction(action) {
  switch (action) {
    case 'fill':
      chrome.runtime.sendMessage({ action: 'fillFromWidget' });
      break;
    case 'detect':
      // Show detected fields
      break;
    case 'settings':
      chrome.runtime.sendMessage({ action: 'openSettings' });
      break;
  }
}

export { createFloatingWidget };
```

---

## Security Considerations

### Content Security Policy

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### Secure Storage Practices

```javascript
// Never store sensitive data in plain text
// Use encryption for passwords or API keys

async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(JSON.stringify(data));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    dataBuffer
  );
  
  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted))
  };
}
```

### Input Sanitization

```javascript
// Sanitize values before filling to prevent XSS
function sanitizeValue(value) {
  if (typeof value !== 'string') return '';
  
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}
```

---

## Example Implementations

### Notable Open Source Form Fillers

1. **Autofill** - Basic form filler with profile management
   - GitHub: search "chrome-autofill-extension"
   - Pattern: Simple selector matching

2. **Bitwarden** - Password manager with form filling
   - GitHub: bitwarden/clients
   - Pattern: Content script injection, secure storage
   - Key file: `apps/browser/src/autofill/`

3. **LastPass** - Enterprise form filling patterns
   - Pattern: Notification-based UI, iframe handling

4. **Dashlane** - Advanced field detection
   - Pattern: ML-based field classification

5. **Simplify** - Job application specific
   - Pattern: ATS-specific selectors, resume parsing

### Minimal Working Example

```javascript
// Minimal content script
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === 'fill') {
    document.querySelectorAll('input').forEach(input => {
      const name = input.name.toLowerCase();
      if (name.includes('email')) input.value = msg.profile.email;
      if (name.includes('name')) input.value = msg.profile.name;
    });
    respond({ done: true });
  }
});
```

### Production Checklist

- [ ] Handle dynamic forms (MutationObserver)
- [ ] Support React/Vue/Angular controlled inputs
- [ ] Handle iframes and shadow DOM
- [ ] Implement error boundaries
- [ ] Add telemetry/analytics (privacy-respecting)
- [ ] Support keyboard navigation
- [ ] Add undo functionality
- [ ] Handle multiple profiles
- [ ] Export/import profiles
- [ ] Auto-update field mappings

---

## Resources

- [Chrome Extensions Manifest V3 Documentation](https://developer.chrome.com/docs/extensions/mv3/)
- [Content Scripts Guide](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)
- [Storage API Reference](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Message Passing](https://developer.chrome.com/docs/extensions/mv3/messaging/)
- [Service Workers in Extensions](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
