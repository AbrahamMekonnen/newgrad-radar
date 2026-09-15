# Auto-Apply Architecture Research

## Overview

This document compares different architectural approaches for implementing auto-apply functionality that fills job application forms across various ATS (Applicant Tracking System) platforms. The goal is to enable users to automatically fill and optionally submit job applications with their profile data.

## Current Implementation

HireRadar currently has two approaches in `/auto-apply`:

1. **v1 (Node.js + Playwright)**: Deterministic form filling with ATS-specific adapters
2. **v2 (Python + browser-use + LLM)**: AI-powered intelligent form filling

Both run as local scripts requiring the user to have Node.js/Python installed locally.

---

## Architecture Comparison

### 1. Chrome Extension Approach

A Chrome extension runs directly in the user's browser, injecting content scripts into job application pages.

#### Technical Capabilities

| Feature | Description |
|---------|-------------|
| **Direct DOM Access** | Content scripts can read/modify any element on the page |
| **Cross-Origin Requests** | Background service worker can make requests to any domain with proper permissions |
| **Storage APIs** | `chrome.storage.local/sync` for profile data (100KB sync, 10MB local) |
| **Background Processing** | Service workers persist across tabs, can coordinate multi-page flows |
| **Native Messaging** | Can communicate with local executables for file operations |
| **Tab Control** | Can open, navigate, and manipulate browser tabs |

#### Architecture

```
+------------------+     +-------------------+     +------------------+
|   Popup UI       |     | Background Worker |     |  Content Script  |
|   (React/Vue)    |<--->| (Service Worker)  |<--->| (DOM Injection)  |
|                  |     |                   |     |                  |
| - Profile editor |     | - Profile storage |     | - Field detection|
| - Job queue      |     | - Tab management  |     | - Form filling   |
| - Status display |     | - API calls       |     | - Submit handling|
+------------------+     +-------------------+     +------------------+
                                  |
                                  v
                         +------------------+
                         |  Supabase API    |
                         | - Sync profile   |
                         | - Track status   |
                         +------------------+
```

#### Pros

| Advantage | Details |
|-----------|---------|
| **Zero Server Costs** | All processing happens client-side |
| **Full Page Access** | Can fill ANY form, even custom/proprietary ATS |
| **Handle Dynamic Forms** | Can respond to JavaScript-rendered content |
| **Resume Upload** | Direct file picker access via `<input type="file">` |
| **Session Cookies** | Uses user's existing logged-in sessions |
| **Instant Response** | No network latency for form filling operations |
| **Works Offline** | Profile data stored locally |
| **Privacy** | Sensitive data never leaves user's machine (unless synced) |

#### Cons

| Disadvantage | Details |
|--------------|---------|
| **Browser Lock-in** | Must build separate extensions for Chrome, Firefox, Safari |
| **Review Process** | Chrome Web Store review can take 1-2 weeks initially |
| **Update Distribution** | Extension updates require store approval |
| **Manifest V3 Limits** | Service workers have 5-minute timeout, limited `eval()` |
| **Security Scrutiny** | Extensions requesting broad permissions face user skepticism |
| **Debugging Complexity** | Content scripts run in isolated world, harder to debug |
| **Mobile Gap** | No extension support on mobile browsers |

#### Implementation Complexity

```
Effort Breakdown:
- Initial Setup (manifest, build pipeline):  2 days
- Content Script (ATS adapters):              5-7 days (per ATS)
- Background Worker (state management):       2-3 days  
- Popup UI (profile editor):                  3-4 days
- Supabase Integration:                       1-2 days
- Testing across ATS platforms:               3-5 days
- Chrome Store Submission:                    1-2 days

Total: ~3-4 weeks for MVP
```

---

### 2. Web-Based Approach

A purely web-based solution using only APIs and server-side automation.

#### Option A: API-Only Filling

Some modern ATS platforms expose submission APIs that allow direct application without browser automation.

| ATS | API Support | Notes |
|-----|-------------|-------|
| Greenhouse | Yes | `POST /applications` with resume upload |
| Lever | Yes | `POST /applications` with OAuth |
| Ashby | Limited | Webhook-based, no direct submit API |
| Workday | No | Proprietary, no public API |
| iCIMS | No | Enterprise only |
| Taleo | No | SOAP-based, deprecated |
| Jobvite | No | No public API |

**Reality Check**: Only ~30% of job postings use ATS platforms with public APIs. The rest require browser automation.

#### Option B: Server-Side Automation (Puppeteer/Playwright on Server)

Run headless browsers on a server to fill applications remotely.

```
+------------------+     +-------------------+     +------------------+
|  Web Dashboard   |     |  Backend Server   |     |  Headless Browser|
|  (Next.js)       |---->| (Node.js/Python)  |---->| (Puppeteer/PW)   |
|                  |     |                   |     |                  |
| - Profile CRUD   |     | - Job queue       |     | - Navigate to URL|
| - Job selection  |     | - Worker pool     |     | - Fill forms     |
| - Status view    |     | - Retry logic     |     | - Submit apps    |
+------------------+     +-------------------+     +------------------+
```

**Pros**:
- Works from any device (mobile, tablet, desktop)
- Centralized updates (no extension store approval)
- Can parallelize applications across multiple workers
- User doesn't need technical setup

**Cons**:
- **High Server Costs**: Headless browser instances are CPU/RAM intensive
  - ~0.5-1 GB RAM per browser instance
  - ~$50-200/month for 10-20 concurrent users
- **CAPTCHA/Bot Detection**: Server IPs are flagged by anti-bot systems
- **Resume Upload**: Must store user resumes server-side (privacy concern)
- **Session Handling**: Cannot use user's existing login sessions
- **Latency**: Application filling takes 30s-2min depending on server load

#### Option C: Cloud Browser Services

Use managed browser automation services like BrowserBase, Browserless, or AWS Lambda with Puppeteer.

| Service | Pricing | Concurrent Sessions | Notes |
|---------|---------|---------------------|-------|
| BrowserBase | $100/mo | 10 concurrent | Stealth mode, anti-detection |
| Browserless | $200/mo | Unlimited | Self-hosted option |
| AWS Lambda + Puppeteer | ~$0.01/run | 1000 concurrent | Cold start latency |
| Apify | $49/mo | 8 concurrent | Actor-based architecture |

#### Iframe Limitations

**Why iframes don't work for auto-apply:**

```javascript
// This WILL fail due to Same-Origin Policy:
const iframe = document.createElement('iframe');
iframe.src = 'https://boards.greenhouse.io/company/jobs/123/apply';
iframe.onload = () => {
  // SecurityError: Blocked a frame with origin "https://newgrad-radar.com"
  // from accessing a cross-origin frame.
  const nameField = iframe.contentDocument.querySelector('#first_name');
  nameField.value = 'John';
};
```

Modern browsers strictly enforce the Same-Origin Policy. A web page cannot access or modify content inside an iframe from a different domain.

**Workarounds (all have major limitations):**
- `postMessage` API - requires cooperation from the ATS (they won't)
- Proxy server - would need to rewrite all HTML/JS/CSS (breaks functionality)
- Custom protocol handlers - not viable for web apps

---

### 3. Hybrid Approaches

#### Option A: Extension + Web Dashboard

Combine a lightweight extension with a feature-rich web dashboard.

```
+------------------+     +-------------------+     +------------------+
|  Web Dashboard   |     |  Supabase Backend |     |  Chrome Extension|
|  (newgrad-radar) |<--->|  (Postgres + API) |<--->|  (content script)|
|                  |     |                   |     |                  |
| - Profile CRUD   |     | - User data       |     | - Auto-fill forms|
| - Job browsing   |     | - Job tracking    |     | - Status updates |
| - Apply queue    |     | - Sync state      |     | - Resume upload  |
+------------------+     +-------------------+     +------------------+
```

**User Flow:**
1. User browses jobs on newgrad-radar.com
2. Clicks "Apply" on a job
3. Extension detects navigation to ATS page
4. Extension fills form using synced profile data
5. Extension reports status back to dashboard

**Pros:**
- Web dashboard handles complex UI (profile editing, job browsing)
- Extension handles what only extensions can do (DOM manipulation)
- Best of both worlds: web flexibility + browser power

**Cons:**
- Must maintain two codebases
- Extension required for core functionality

#### Option B: Extension + Fallback to Browser-Use Agent

When extension is not available (mobile, Firefox), fall back to local agent execution.

```
+------------------+
|     User         |
+--------+---------+
         |
    +----+----+
    |Extension |-----> Fill directly in browser
    |installed?|
    +----+----+
         |No
         v
+------------------+
| Download Agent   |-----> Run locally with browser-use
| (Python script)  |
+------------------+
```

#### Option C: WebExtension + Native Messaging for File Operations

Use native messaging to handle resume uploads and local file operations.

```json
// manifest.json
{
  "permissions": ["nativeMessaging"],
  "background": {
    "service_worker": "background.js"
  }
}
```

```javascript
// Native messaging for file operations
chrome.runtime.connectNative('com.newgrad_radar.helper').postMessage({
  type: 'get_resume',
  path: profile.resumePath
});
```

---

## Recommendation

### Primary Architecture: Chrome Extension + Web Dashboard

**Rationale:**

1. **Cost-Effective**: Zero ongoing server costs for automation
2. **Universal ATS Support**: Can fill forms on any ATS, not just API-enabled ones
3. **User Privacy**: Resume/profile stays local unless user opts into sync
4. **Existing Infrastructure**: HireRadar already has Supabase backend
5. **Mobile Fallback**: Users can still browse jobs on mobile, apply on desktop

### Implementation Plan

```
Phase 1: Core Extension (2-3 weeks)
├── Manifest V3 setup with Vite/webpack
├── Content script for major ATS (Greenhouse, Lever, Ashby, Workday)
├── Popup UI for profile management
├── Local storage for profile data
└── Basic form detection and filling

Phase 2: Web Integration (1-2 weeks)
├── Supabase sync for profile data
├── Job queue from web dashboard
├── Real-time status updates
└── Apply tracking integration

Phase 3: Intelligence Layer (2-3 weeks)
├── AI-powered question answering (via API call)
├── Adaptive field detection
├── Error recovery and retry logic
└── Performance analytics

Phase 4: Polish (1-2 weeks)
├── Firefox port (WebExtension API is mostly compatible)
├── Onboarding flow
├── Chrome Web Store submission
└── Documentation
```

### Recommended Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Extension Build | Vite + CRXJS | Modern tooling, hot reload, TypeScript |
| Extension UI | React + Tailwind | Matches web dashboard stack |
| State Management | Zustand | Lightweight, persists to chrome.storage |
| Content Scripts | TypeScript | Type safety for DOM operations |
| ATS Adapters | Modular pattern | Easy to add new ATS support |
| Web Integration | Supabase JS Client | Already used in dashboard |

### Migration Path from Current Implementation

The current `/auto-apply` implementations can be preserved as fallbacks:

1. **v1 (Playwright scripts)**: Convert to extension content scripts
   - DOM selectors are reusable
   - Logic flow translates directly

2. **v2 (browser-use agent)**: Keep as local CLI tool
   - Power users can run locally
   - Useful for debugging/development

### File Structure

```
chrome-extension/
├── manifest.json
├── vite.config.ts
├── src/
│   ├── background/
│   │   ├── index.ts          # Service worker entry
│   │   ├── jobQueue.ts       # Pending applications
│   │   └── supabaseSync.ts   # Profile sync
│   ├── content/
│   │   ├── index.ts          # Content script entry
│   │   ├── detector.ts       # ATS detection
│   │   ├── fillers/
│   │   │   ├── greenhouse.ts
│   │   │   ├── lever.ts
│   │   │   ├── ashby.ts
│   │   │   ├── workday.ts
│   │   │   └── generic.ts    # Fallback heuristic filler
│   │   └── fields.ts         # Field detection utilities
│   ├── popup/
│   │   ├── App.tsx           # Popup UI
│   │   ├── Profile.tsx       # Profile editor
│   │   ├── Queue.tsx         # Job queue view
│   │   └── Status.tsx        # Application status
│   └── shared/
│       ├── types.ts          # Shared types
│       └── storage.ts        # Chrome storage wrapper
├── public/
│   └── icons/
└── package.json
```

---

## Alternative Considerations

### When to Consider Server-Side Automation Instead

- **High Volume**: Processing 100+ applications per user per day
- **Anonymization**: Need to mask user identity/IP
- **Mobile-First**: User base primarily mobile
- **Enterprise**: B2B product where client IT controls browsers

### When API-Only is Sufficient

- **Narrow Focus**: Only targeting ATS platforms with APIs
- **Simple Forms**: Applications with standard fields only
- **Integration Play**: Building into existing recruiting tools

---

## Security Considerations

### Chrome Extension Security

| Risk | Mitigation |
|------|------------|
| Data exfiltration | Request minimal permissions, CSP in manifest |
| XSS in content scripts | Use isolated world, sanitize inputs |
| Profile data theft | Encrypt sensitive data in storage |
| Malicious updates | Code signing, gradual rollout |

### Server-Side Security (if implemented)

| Risk | Mitigation |
|------|------------|
| Resume storage | Encrypt at rest, delete after processing |
| Credential handling | Never store ATS passwords, use OAuth when available |
| IP reputation | Rotate IPs, use residential proxies |
| Rate limiting | Implement backoff, respect robots.txt |

---

## Conclusion

For HireRadar's use case, a **Chrome Extension with Web Dashboard integration** provides the best balance of:

1. **Cost efficiency**: No server costs for automation
2. **ATS coverage**: Works with any ATS platform
3. **User experience**: Seamless integration with existing web app
4. **Privacy**: User data stays local by default
5. **Development velocity**: Can reuse existing codebase and infrastructure

The current Playwright/browser-use implementations serve as excellent references for the extension's content script logic. The migration path is straightforward, and the extension architecture allows for future enhancements like AI-powered question answering without requiring server infrastructure.
