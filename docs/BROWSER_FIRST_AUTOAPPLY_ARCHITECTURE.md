# Browser-First Auto-Apply Architecture

Status: Selected implementation architecture

Last updated: 2026-09-19

Supersedes the desktop runner as HireRadar's primary execution model.

## 1. Decision

HireRadar will use a browser-first hybrid:

1. Backend services prepare, route, and track every application.
2. Cloud browser workers submit supported public company career-site forms.
3. A phone-accessible live cloud browser handles human intervention in the same session.
4. The existing browser extension provides attended autofill and tracking.
5. HireRadar does not automate authenticated job boards whose terms prohibit outside automation.
6. No Windows or macOS desktop application is required.

The Windows and macOS runner designs remain research references only. They are not on the implementation critical path.

## 2. Why the architecture changed

The desktop-runner design can perform work from a user's own machine, but it creates product obligations unrelated to HireRadar's main value:

- two operating-system implementations
- installers, signing, notarization, and update systems
- sleep, wake, lock, battery, and thermal behavior
- local browser-profile lifecycle
- a requirement that the user's laptop remain available
- difficult phone-to-laptop intervention
- Apple Developer membership for smooth public macOS distribution
- a much larger security and support surface

Competitor research shows that this complexity is avoidable. Products generally choose one of three models:

- attended browser-extension autofill
- unattended cloud application workers
- a hybrid where cloud workers handle compatible forms and an extension handles attended cases

The hybrid is the best fit for HireRadar because the product must operate while the user's devices are off while still offering a browser-side fallback.

## 3. Competitor findings

### 3.1 Assisted browser products

Simplify Copilot documents an extension that detects application forms, fills profile information, and keeps the user responsible for reviewing and submitting. Careerflow similarly places autofill and tracking in an extension overlay on pages the user visits. LazyApply runs automation from a Chrome extension.

These products simplify form completion but cannot guarantee work while the user's browser and computer are off.

### 3.2 Unattended cloud products

Sonara and JobCopilot advertise continuous or daily unattended application submission. JobCopilot narrows its public scope to verified jobs on official company career pages.

This model avoids requiring a user's device but needs server-hosted browser execution and strict confirmation tracking.

### 3.3 Hybrid products

LoopCV explicitly documents three paths:

- automatic email applications
- automatic form applications
- extension-required applications for authenticated job boards

It also states that its cloud loop continues when the user's browser is closed. Extension-required jobs wait until the user uses the extension.

This is the clearest public evidence for the selected HireRadar split.

## 4. Terms-aware routing

HireRadar must route based on both technical support and platform authorization.

LinkedIn's current User Agreement prohibits unauthorized bots and automated methods and restricts browser plugins used to scrape or copy the service. Indeed's current terms prohibit outside automation for Indeed Apply and automated bulk submission without written permission.

Therefore:

- LinkedIn and Indeed are discovery and attended-assistance channels unless HireRadar receives written authorization.
- The extension may help users transfer prepared answers while the user remains in control.
- It must not crawl, mass-submit, or disguise automation on those platforms.
- Cloud submission focuses on company career sites and ATS-hosted forms whose applicable rules permit the action.
- The adapter registry contains a per-domain policy and can remotely disable execution.

Technical capability does not override a site's terms.

## 5. Selected topology

```text
Phone or desktop web
        |
        v
Next.js control plane
        |
        v
Supabase
  Auth
  PostgreSQL
  Storage
  Realtime
  durable queues
        |
        +---------------------------+
        |                           |
        v                           v
Preparation workers          Browser workers
Python                       headed Playwright
AI answers                   encrypted profiles
documents                    ATS adapters
validation                   confirmation evidence
        |                           |
        +-------------+-------------+
                      |
             intervention required
                      |
                      v
           authenticated live session
             in HireRadar web UI

Optional extension
  attended autofill
  user review
  manual submission
  verified tracking
```

## 6. Execution channels

Every job receives one channel before preparation completes.

### 6.1 Cloud browser

Use when:

- the application is on a supported company career site or ATS domain
- no prohibited authenticated job-board automation is involved
- the field schema can be inspected
- the worker can preserve one browser session through completion
- the user has authorized submission for the attempt

Result states:

- `submitted` only after verified confirmation
- `intervention_required` for a user-resolvable blocker
- `needs_answer` for an unknown factual answer
- `manual_only` when automation is not appropriate
- `failed` for a terminal technical failure
- `ambiguous` when submit may have occurred but confirmation is unavailable

### 6.2 Extension attended mode

Use when:

- site policy requires the user's direct browser interaction
- the user opens the application manually
- the cloud browser route is disabled
- the user wants to review before submission

The extension receives a short-lived prepared package. It fills the page, highlights uncertain fields, and records confirmation after the user submits. It uses the same attempt and event model as the cloud worker.

### 6.3 Manual-only

Use when:

- the site prohibits the planned automation
- identity verification cannot be delegated
- a legal attestation requires direct user action
- the application cannot be verified safely
- the form requests facts HireRadar does not know and the user does not answer

Manual-only jobs remain useful: HireRadar prepares answers and documents, deep-links to the form, and tracks the outcome without claiming submission.

## 7. Cloud browser design

### 7.1 Initial implementation

Reuse the existing Python Playwright and ATS adapter work in a long-running container worker.

Run:

- headed Chromium under a virtual display
- one isolated browser context per user
- one page per application attempt
- bounded concurrency per worker and per ATS
- deterministic selectors before AI-driven visual control
- encrypted storage for persistent session state
- short-lived document download URLs
- network and console instrumentation with value redaction

Do not run browser jobs in Vercel Functions or Supabase Edge Functions.

### 7.2 Profiles

Most public ATS forms do not need user login. Start with ephemeral contexts for those forms.

Create a persistent encrypted profile only when a supported site requires durable state. Profiles are:

- keyed by HireRadar user and execution domain
- encrypted at rest
- unavailable to other tenants
- versioned and revocable
- excluded from diagnostics
- deleted when the user disconnects the channel

Do not ask users for LinkedIn or Indeed passwords.

### 7.3 Worker isolation

Each worker container runs a small number of browser contexts. The scheduler considers:

- memory and CPU
- browser action latency
- ATS-specific concurrency
- recent block or challenge rate
- per-user application policy
- deadline and job quality
- uncertain-submit recovery

Start with a conservative concurrency of three pages per worker. Increase only from measured fixture and production-canary evidence.

## 8. Human intervention from phone

The intervention continues the same cloud browser session.

Flow:

1. Worker reaches CAPTCHA, MFA, consent, login, or unknown answer.
2. It checkpoints the page and sets `intervention_required`.
3. The backend sends push, email, Telegram, or in-app notification according to settings.
4. The user opens an authenticated HireRadar route on any phone or computer.
5. HireRadar exchanges a one-use intervention token for a short-lived live-session URL.
6. The user sees and controls only that browser session.
7. The worker detects completion and resumes.
8. The live URL expires and cannot be reopened.

Do not expose a provider's raw debug URL directly. Place HireRadar authorization in front of it, bind it to one attempt and user, keep it out of logs, and revoke it after use.

Browserless and Steel both document interactive live browser sessions intended for human-in-the-loop workflows. Prototype both before selecting a provider.

## 9. CAPTCHA and challenge policy

HireRadar does not promise that every challenge can be automated.

Preferred order:

1. avoid generating challenges through normal rates and stable sessions
2. let the user complete the challenge through live takeover
3. use a provider-supported challenge service only where its use is lawful and permitted
4. route to manual-only when completion is unsafe or prohibited

Never mark a prepared form as submitted because a challenge is visible. Never silently replace user action for attestations or facts that require the user's knowledge.

## 10. Managed browser versus self-hosted browser

### 10.1 Prototype path

Use the existing self-hosted Playwright worker for ordinary automated fixtures and public ATS forms. Test a managed browser provider for live intervention.

Candidate managed capabilities:

- Browserless interactive `liveURL`
- Steel WebRTC live sessions
- Browserbase sessions and managed browser capacity

### 10.2 Selection gate

Run the same Greenhouse, Lever, and Ashby fixture suite on each candidate. Measure:

- session startup time
- form compatibility
- live phone input
- session persistence
- isolation guarantees
- intervention security controls
- concurrency
- browser-hour cost
- egress and proxy cost
- failure recovery
- data retention controls

Select from measurements rather than marketing claims.

### 10.3 Cost strategy

Managed browsers remove infrastructure work but charge by browser time and concurrency. Self-hosting reduces per-hour cost at scale but adds operations.

Begin with the lowest-complexity provider that passes the security and fixture gates. Revisit self-hosting only after real browser-hour and intervention-frequency data shows a clear saving.

## 11. Application state and submission truth

The existing durable attempt model remains valid.

A cloud worker must not transition directly from `filling` to `submitted`. Required sequence:

```text
queued
preparing
ready
leased
opening
filling
validating
intervention_required | submitting
verifying
submitted | ambiguous | failed | cancelled
```

Verified evidence may include:

- ATS confirmation identifier
- confirmation page with adapter-specific markers
- known success response tied to the attempt
- application appearing in an authenticated ATS candidate account when permitted
- confirmation email correlated to the job and user

A click, navigation, or network request alone is insufficient.

## 12. Extension scope

Retain the existing Manifest V3 extension, but reduce its responsibilities.

It should:

- authenticate to HireRadar
- request one short-lived prepared package for the active application
- inspect and fill the active tab
- surface unanswered or uncertain fields
- let the user review
- observe and report confirmation
- sync status to the same attempt timeline

It should not:

- serve as the unattended scheduler
- stay running for 24/7 automation
- store service-role credentials
- receive provider API keys
- crawl prohibited job boards
- attempt to evade bot controls
- claim submission without confirmation

Publish through the Chrome Web Store when ready. Restrict host permissions to supported ATS domains where practical and use optional permissions for broader attended use.

## 13. Security boundaries

- Browser workers receive attempt-scoped tokens.
- No service-role key is present in a browser container.
- Each browser context belongs to one user.
- Documents use short-lived, single-purpose URLs.
- Persistent state is envelope-encrypted with a managed KMS key.
- Live-session links are bearer secrets behind HireRadar authentication.
- Logs exclude field values, cookies, tokens, resumes, and screenshots by default.
- Session replay is disabled by default for real applications.
- Diagnostic capture requires explicit user permission and redaction.
- All state transitions use atomic database functions.

## 14. Implementation sequence

### Milestone A: truthful queue

- finish attempts, events, leases, and finalization RPCs
- make every UI use the same state
- ensure prepared never counts as submitted

### Milestone B: one cloud ATS

- containerized headed Playwright worker
- ephemeral browser context
- Greenhouse fixture and canary
- deterministic fill and validation
- verified finalization

### Milestone C: answers and intervention

- question prompt in web UI
- Answer Bank feedback
- same-session continuation
- managed live-session provider prototype
- phone interaction

### Milestone D: adapter expansion

- Ashby
- Lever
- SmartRecruiters
- Workday
- iCIMS and Taleo

Each adapter needs fixture, challenge, failure, and confirmation tests before unattended enablement.

### Milestone E: extension fallback

- short-lived package protocol
- attended fill
- review and submit
- confirmation event
- policy-aware domain routing

### Milestone F: production scale

- encrypted persistent profiles where necessary
- adaptive worker concurrency
- per-domain circuit breakers
- notification outbox
- cost and reliability dashboards
- controlled beta rollout

## 15. Acceptance criteria

The first browser-first beta must demonstrate:

- Auto Apply works while the user's devices are off.
- No desktop installer is required.
- Greenhouse, Ashby, and Lever fixtures reach verified final states.
- Unknown factual questions pause instead of being invented.
- A user can intervene from a phone in the same cloud session.
- The worker resumes after intervention.
- A challenge or click never counts as submission.
- Duplicate callbacks and worker crashes cannot duplicate an application.
- LinkedIn and Indeed are not automatically submitted without written permission.
- Extension and cloud attempts appear in one timeline.
- Credentials and application values are absent from logs.
- A remote flag can disable any adapter or domain immediately.

## 16. Sources

Competitor product documentation:

- Simplify Copilot: https://help.simplify.jobs/en/help/articles/1749022-installing-and-setting-up-copilot
- Simplify continuous autofill: https://help.simplify.jobs/articles/8686025-manage-autofill-settings-in-the-simplify-extension
- Careerflow extension: https://www.careerflow.ai/browser-extension
- LazyApply extension: https://lazyapply.com/download-extension
- LoopCV auto-apply: https://www.loopcv.pro/autoapply/
- LoopCV execution routing: https://loopcv.freshdesk.com/support/solutions/articles/103000399849-knowledge-base
- Sonara: https://www.sonara.ai/
- JobCopilot: https://jobcopilot.com/
- Massive mobile product: https://apps.apple.com/us/app/massive-swipe-apply/id6642717648

Browser infrastructure:

- Browserless live sessions: https://docs.browserless.io/bap/session-management/live-url
- Steel live sessions: https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions
- Browserbase pricing and concurrency: https://www.browserbase.com/pricing

Platform rules:

- LinkedIn User Agreement: https://www.linkedin.com/legal/user-agreement
- Indeed Terms: https://www.indeed.com/legal
- Chrome extension permissions: https://support.google.com/chrome_webstore/answer/186213

## 17. Immediate next work

Do not start Windows Service, macOS LaunchDaemon, MSIX, `.pkg`, wake, or desktop update implementation.

First:

1. extract the Greenhouse adapter behind a browser-worker interface
2. create a headed container fixture
3. prove verified submission against a local fixture
4. compare Browserless and Steel live intervention on a phone
5. add domain execution policy to the adapter registry
6. route one application from the existing web queue through the cloud worker
