# Browser-First Auto-Apply Architecture

Status: Selected implementation architecture

Last updated: 2026-09-19

Supersedes the desktop runner as HireRadar's primary execution model.

## 1. Decision

HireRadar will use a user-browser execution architecture:

1. The backend discovers jobs and prepares complete application packages.
2. A direct Auto Apply click or standing watchlist rule authorizes submission.
3. The browser extension is the preferred submission executor.
4. It submits from the user's normal browser session and network.
5. If the browser is unavailable, the attempt waits in `waiting_for_browser`.
6. HireRadar never silently moves an account-bound attempt to a cloud browser.
7. Cloud execution is a separately authorized option for eligible public employer forms.
8. No Windows or macOS native desktop application is required.

HireRadar applies to the jobs the user selected. Match scores may influence ordering and recommendations, but do not cancel an explicitly authorized application.

The Windows and macOS runner designs remain research references only.

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

The selected model prioritizes account safety by preparing applications in the cloud and executing them in the user's browser. Preparation continues while user devices are off, but submission waits for an authorized browser unless the user separately enables cloud execution for eligible public employer forms.

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

## 4. Authorization and execution policy

Job selection is controlled by the user.

An application is authorized through either:

- **Direct authorization:** the user clicks Auto Apply on a specific job.
- **Standing authorization:** the user enables Auto Apply for a saved search, watchlist, company rule, or filter.

HireRadar does not ask for another per-job approval after either authorization. It prepares and queues the application automatically.

Execution policy is separate from selection:

- prefer the user's browser extension whenever available;
- hold the attempt in `waiting_for_browser` while unavailable;
- do not substitute cloud execution for an account-bound site;
- use cloud execution only after separate user authorization and only for eligible public employer forms;
- stop for CAPTCHA, MFA, identity verification, unknown facts, or legally meaningful attestations;
- never use stealth, rotating identity, fingerprint spoofing, or security bypasses.

Running in the user's browser may reduce centralized risk signals, but does not guarantee that automation is undetectable or authorized. HireRadar must disclose that risk and remotely disable unsafe execution paths.

## 5. Selected topology

```text
Phone or desktop web
        |
        | direct click or standing watchlist authorization
        v
Next.js control plane
        |
        v
Supabase durable application queue
        |
        v
Cloud preparation workers
  job data, answers, resume, documents, field plan
        |
        v
Prepared application package
        |
        +-------------------------------+
        |                               |
        v                               v
User browser extension             Optional cloud browser
preferred executor                 public employer forms only
normal session and network         separate authorization
        |                               |
        +---------------+---------------+
                        |
                 confirmation evidence
                        |
                        v
             one live application timeline
```

The web application remains the control surface on phones and desktops. The extension works across supported desktop browsers, so no operating-system-specific installer is required.

## 6. Execution channels

### 6.1 User-browser extension

This is the preferred channel. Use it when the extension is paired and online, the user authorized the job directly or through a standing rule, the adapter supports the destination, and no unresolved user-only question blocks submission.

The backend sends a short-lived package. The extension opens an isolated application tab, fills fields, uploads documents, validates required controls, submits automatically under the recorded authorization, and reports confirmation evidence. Per-job review is optional, not required by default.

### 6.2 Waiting for browser

If the extension or computer is unavailable:

- preparation continues;
- the attempt enters `waiting_for_browser`;
- the lease remains unclaimed;
- the timeline explains why it is waiting;
- the extension claims it after reconnecting;
- jobs remain ordered by deadline, user priority, and queue age.

A browser extension cannot execute while the computer is asleep, powered off, or the browser is closed. A phone click can create and prepare the attempt immediately, but submission begins when the paired browser becomes available.

### 6.3 Standing watchlist execution

When a job matches a watchlist with Auto Apply enabled:

1. create one idempotent attempt;
2. record the standing rule that authorized it;
3. prepare answers and documents;
4. place it in the browser queue;
5. notify the extension when online;
6. submit without another approval;
7. notify the user of the confirmed result or intervention.

### 6.4 Optional cloud browser

Cloud submission is not an automatic fallback. It requires separate opt-in, an eligible public employer or ATS form, no transferred account session, and a permitting domain policy. Account-bound jobs remain `waiting_for_browser` even when cloud capacity exists.

### 6.5 Manual-only

Use manual-only when automation cannot proceed safely or reliably. HireRadar still prepares answers and documents and tracks the outcome without claiming submission.

### 6.6 Result states

- `submitted` only after verified confirmation
- `waiting_for_browser` when the preferred executor is offline
- `intervention_required` for a user-resolvable blocker
- `needs_answer` for an unknown factual answer
- `manual_only` when automation is inappropriate
- `failed` for a terminal technical failure
- `ambiguous` when submission may have occurred but confirmation is unavailable

## 7. Optional cloud browser design

This section applies only to separately authorized cloud execution for eligible public employer forms. It is not the default executor and never receives account-bound browser cookies.

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

## 8. Intervention and phone control

### 8.1 Browser-side intervention

When the extension encounters CAPTCHA, MFA, consent, identity verification, or an unknown factual answer, it checkpoints the tab, sets `intervention_required`, and sends the configured notification. The user returns to the same tab, resolves the blocker, and the extension resumes. Prepared values remain in place.

### 8.2 Phone control

The phone can create an attempt, display all states, answer non-page-specific questions, pause or cancel work, and receive results. If the paired browser is online, commands reach it through Realtime plus a durable command row. If offline, they remain queued.

Remote control of the exact local browser tab can be evaluated later, but the first release does not require desktop-wide access.

### 8.3 Cloud-session intervention

For a separately authorized cloud attempt, intervention may continue through a short-lived authenticated live view of the same session. Raw provider debug URLs are never exposed or logged.

## 9. CAPTCHA, challenge, and account-safety policy

HireRadar cannot guarantee that a platform will never detect automation or restrict an account. It reduces avoidable risk without claiming to be undetectable.

Controls:

1. prefer the user's established browser session and normal network;
2. never upload browser cookies;
3. never rotate proxies, spoof fingerprints, or disguise the executor;
4. allow at most one active flow per account-bound platform;
5. allow at most one active flow per employer or ATS domain by default;
6. permit broader concurrency only across independent destinations;
7. stop new work after CAPTCHA, rate-limit, verification, or block signals;
8. require user action for CAPTCHA, MFA, identity, consent, and unknown facts;
9. prevent duplicates with idempotent attempts and confirmation checks;
10. keep profile facts consistent and truthful;
11. expose Pause and Emergency Stop;
12. remotely disable a domain or adapter when challenge or failure rates rise.

Every authorized job stays queued. Safety controls regulate timing and concurrency; they do not silently discard selected jobs.

A capable device may run five to seven application tabs across independent destinations, but never five to seven simultaneous flows against one account or employer.

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

No executor may transition directly from `filling` to `submitted`. The browser path uses this sequence:

```text
queued
preparing
ready
waiting_for_browser (browser path only)
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

## 12. Extension executor

Retain the Manifest V3 extension and make it the preferred submission executor.

It should:

- pair and authenticate with HireRadar;
- maintain an online heartbeat and capabilities;
- reconcile durable commands after reconnecting;
- claim short-lived prepared packages;
- open isolated application tabs;
- fill fields, upload documents, and navigate multipage forms;
- submit under direct or standing authorization;
- pause for unresolved user-only fields;
- report adapter-specific confirmation;
- checkpoint recoverable state;
- synchronize every transition;
- provide Pause and Emergency Stop.

It must not:

- store service-role credentials or provider API keys;
- export browser cookies;
- claim submission without confirmation;
- retry an ambiguous submit automatically;
- rotate fingerprints, proxies, or identities;
- bypass CAPTCHA, MFA, access controls, or platform protections;
- run simultaneous flows against one account-bound platform;
- continue after authorization is revoked.

Publish through browser extension stores for automatic cross-platform updates. Restrict host permissions where practical and request optional site permissions only when needed. This requires no Apple Developer membership.

## 13. Security boundaries

- Both extension and cloud executors receive attempt-scoped tokens.
- Extension packages expire quickly and are bound to the paired device and attempt.
- Browser cookies remain on the user device and are never included in packages.
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

### Milestone A: truthful queue and authorization

- finish attempts, events, leases, and finalization RPCs
- record `direct_click` or `standing_rule` authorization
- add `waiting_for_browser`
- ensure prepared never counts as submitted

### Milestone B: extension executor vertical slice

- extension pairing and heartbeat
- durable command reconciliation
- short-lived package protocol
- Greenhouse fixture
- deterministic fill, validation, submission, and confirmation

### Milestone C: watchlist dispatch and recovery

- create attempts idempotently from matching rules
- queue while browser is offline
- claim after reconnect
- recover extension and browser restart
- cancellation and Emergency Stop
- browser-side intervention

### Milestone D: account-safety controls

- per-platform and per-domain semaphores
- adaptive device concurrency
- challenge and rate-limit circuit breakers
- duplicate and ambiguous-submit protection
- remote adapter disablement

### Milestone E: adapter expansion

- Ashby
- Lever
- SmartRecruiters
- Workday
- iCIMS and Taleo

### Milestone F: optional cloud execution

- separate user opt-in
- public-form eligibility policy
- isolated headed browser worker
- same package and event protocol
- no silent browser-to-cloud fallback

## 15. Acceptance criteria

The first browser-executor beta must demonstrate:

- A manual click creates one authorized attempt.
- A standing watchlist creates attempts without asking again.
- Every authorized job remains queued until completed, cancelled, or visibly made manual-only.
- An online browser claims and begins prepared work.
- An offline browser produces `waiting_for_browser`.
- No native desktop installer is required.
- Greenhouse, Ashby, and Lever fixtures reach verified final states.
- Unknown factual questions pause instead of being invented.
- CAPTCHA, MFA, verification, and block signals stop automation.
- At most one flow runs per account-bound platform.
- Five to seven independent fixture tabs run on capable hardware without state crossover.
- Browser cookies never leave the device.
- A click never counts as confirmed submission.
- Reconnects and crashes cannot duplicate an application.
- Every attempt shows its authorization source and execution channel.
- Credentials and application values are absent from logs.
- A remote flag can disable any adapter or domain.

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

Do not start native Windows or macOS runner implementation.

First:

1. add direct-click and standing-rule authorization fields;
2. add `waiting_for_browser` to the state machine and UI;
3. connect the existing extension to durable commands and heartbeat;
4. implement one Greenhouse extension-executor fixture end to end;
5. require adapter-specific confirmation before `submitted`;
6. add per-domain concurrency and challenge circuit breakers;
7. route watchlist matches into the browser queue;
8. keep cloud execution behind a separate explicit opt-in.

## 18. Extension implementation blueprint

### 18.1 Current prototype

The repository already has the first browser handoff:

- `extension/manifest.json` injects `content.js` into supported ATS pages.
- `extension/content.js` reads a short-lived handoff, fills prepared values, optionally clicks Submit, detects generic success text, and reports the result.
- `src/app/api/auto-apply/handoff/route.ts` creates ten-minute handoff tokens and records browser-confirmed submissions.
- `src/app/api/auto-apply/queue/route.ts` creates an idempotent queue row for a direct job-card click.
- Standing rules and direct clicks already converge on `autoapply_job_queue`.

This proves browser-side filling, but it is not yet a durable browser executor. It depends on opening a tokenized application URL, has no background service worker, does not claim queued jobs, excludes required file uploads, and uses generic confirmation detection.

### 18.2 Target extension structure

```text
extension/
  manifest.json
  background.js
  content.js
  adapters/
    base.js
    greenhouse.js
    ashby.js
    lever.js
    smartrecruiters.js
    workday.js
  popup/
    popup.html
    popup.js
  shared/
    protocol.js
    redaction.js
    validation.js
```

Responsibilities:

- `background.js` owns pairing, command reconciliation, tab creation, leases, concurrency, restart recovery, and global controls.
- `content.js` owns page discovery, filling, validation, submission, and confirmation observation.
- ATS adapters contain selectors, multipage behavior, submit controls, and confirmation evidence.
- The popup shows device status, queue count, active work, Pause, and Emergency Stop.

### 18.3 Manifest V3 capabilities

Add:

- a background service worker;
- `storage` for non-sensitive extension state;
- `tabs` for application tab creation and tracking;
- `alarms` for durable queue reconciliation;
- `notifications` only for browser-local status when useful;
- narrowly scoped ATS host permissions;
- optional host permissions for attended use outside the default registry.

Do not rely on the service worker staying alive. Manifest V3 may suspend it. Every operation must recover from durable backend state and browser events.

### 18.4 Secure pairing

Pairing flow:

1. User selects Connect to HireRadar in the extension.
2. Extension opens an authenticated HireRadar pairing route.
3. Extension generates an ECDSA P-256 key through WebCrypto.
4. The private key is non-exportable and stored through IndexedDB.
5. Backend stores the public key, browser ID, user ID, version, and capabilities.
6. Extension proves possession by signing server nonces.
7. Backend issues short-lived device-scoped tokens.
8. User can revoke the paired browser in Settings.

The extension never stores:

- a Supabase service-role key;
- Groq, Gemini, or provider API keys;
- the user's ATS password;
- exported site cookies;
- long-lived application handoff tokens.

### 18.5 Authorization record

Every attempt stores its authorization source.

Direct click:

```json
{
  "authorization_source": "direct_click",
  "authorization_rule_id": null,
  "execution_channel": "user_browser"
}
```

Standing watchlist:

```json
{
  "authorization_source": "standing_rule",
  "authorization_rule_id": "uuid",
  "execution_channel": "user_browser"
}
```

The backend rejects submission commands without active authorization. Disabling a standing rule follows the user's configured policy for already-prepared attempts: finish them or cancel those that have not submitted.

### 18.6 Durable command delivery

The database is authoritative. Realtime is only a wake hint.

The extension reconciles work:

- on browser startup;
- after pairing;
- after network reconnection;
- when the user clicks Auto Apply;
- on a periodic `chrome.alarms` event;
- after completing an attempt;
- after a Realtime hint when the service worker is active.

The extension calls an authenticated claim endpoint. The backend atomically:

1. selects one eligible `waiting_for_browser` attempt;
2. verifies device, user, authorization, and adapter compatibility;
3. creates a bounded lease;
4. records browser ID and execution channel;
5. returns an attempt-scoped package token.

A dropped event cannot lose work because the next reconciliation finds the durable row.

### 18.7 Tab ownership

The background worker opens the direct application URL with `chrome.tabs.create()` and stores:

```text
tab_id
attempt_id
lease_id
adapter
current_stage
last_heartbeat_at
```

The mapping lives in `chrome.storage.session` for worker suspension recovery and in the backend for browser restart recovery.

The token is not placed in the employer URL. On every supported page load:

1. content script sends `PAGE_READY` with URL and detected ATS;
2. background worker checks tab ownership;
3. it returns the attempt-scoped prepared package;
4. content script verifies that the job identity matches the attempt.

A stable tab ID allows the same attempt to survive multipage navigation and redirects.

### 18.8 Prepared package

The package is immutable and versioned:

```json
{
  "schemaVersion": 1,
  "attemptId": "uuid",
  "leaseId": "uuid",
  "authorizationSource": "direct_click",
  "adapter": {
    "name": "greenhouse",
    "version": "2026.09.1"
  },
  "job": {
    "id": "job-id",
    "url": "https://...",
    "company": "Example",
    "title": "Software Engineer"
  },
  "fields": [],
  "documents": [],
  "submissionAuthorized": true,
  "expiresAt": "ISO-8601"
}
```

It contains no provider keys, browser cookies, or unrelated profile data. The extension receives only values needed for that attempt.

### 18.9 Form execution

The ATS adapter:

1. waits for the form and dynamic framework controls;
2. inventories visible and required fields;
3. matches the package using stable names, IDs, labels, option values, and normalized aliases;
4. preserves values the user entered manually;
5. fills text, textarea, select, radio, checkbox, combobox, date, and multiselect controls;
6. dispatches the framework's expected input, change, blur, and click events;
7. handles conditional questions;
8. uploads required documents;
9. navigates multipage forms;
10. validates after every mutation and page transition;
11. checkpoints after each stage.

Deterministic selectors and mappings run before any AI-based interpretation.

### 18.10 Document uploads

For each required document:

1. Extension requests a short-lived, attempt-bound download.
2. It downloads the content as a Blob.
3. It creates a browser File with the expected name and MIME type.
4. It assigns the file through a DataTransfer object.
5. It dispatches the expected change events.
6. The adapter verifies that the ATS displays the uploaded filename.
7. The extension releases the Blob and URL after use.

If the ATS rejects programmatic assignment, the attempt becomes `intervention_required` instead of pretending the upload succeeded.

### 18.11 Pre-submit validation

Submission requires all of the following:

- active authorization;
- valid unexpired lease;
- expected job identity;
- all required controls completed;
- selected values belong to available options;
- required documents visibly attached;
- no unresolved user-only fact;
- no CAPTCHA, MFA, identity, consent, rate-limit, or block signal;
- no existing ambiguous submit checkpoint;
- enabled adapter and domain policy.

Review is optional. A user may configure review for selected fields or categories without changing the default automatic flow.

### 18.12 Scheduling and concurrency

The browser scheduler uses weighted work units.

Defaults:

- start with three independent application tabs;
- permit expansion toward five to seven on capable devices;
- one active flow per account-bound platform;
- one active flow per employer or ATS domain by default;
- no new work while the browser is under memory or CPU pressure;
- multiplicative backoff after slow actions, challenges, rate limits, or adapter errors.

Every authorized job stays in the queue. Scheduling controls when it runs, not whether it is discarded.

### 18.13 Submission

Before the final click, the content script writes a pre-submit checkpoint containing:

- attempt and lease IDs;
- adapter and job identity;
- page URL;
- validation result;
- timestamp;
- idempotency key.

It then clicks the adapter's specific final submission control once.

The extension never retries automatically after losing contact during the submission window. That attempt becomes `ambiguous` until confirmation is resolved.

### 18.14 Confirmation evidence

Generic success phrases alone are insufficient. Each adapter defines an evidence rule combining signals such as:

- final submit control disappeared;
- known confirmation container appeared;
- URL matches an ATS confirmation pattern;
- application-specific success heading appeared;
- expected job identity remains correlated;
- known successful network outcome is observable without reading prohibited data.

The extension reports a typed event:

```json
{
  "attemptId": "uuid",
  "leaseId": "uuid",
  "idempotencyKey": "uuid",
  "event": "submission_confirmed",
  "adapter": "greenhouse",
  "adapterVersion": "2026.09.1",
  "evidenceType": "confirmation_page"
}
```

An atomic backend function updates the attempt, queue, saved job, application history, analytics, and notification outbox exactly once.

### 18.15 Interruption and recovery

If the service worker is suspended, the content script can wake it with a runtime message. If the browser closes or the device sleeps:

- pre-submit work returns to `waiting_for_browser` after lease expiry;
- browser restart triggers reconciliation;
- recoverable pages resume from the last checkpoint;
- tabs are matched to attempts when possible;
- an attempt interrupted after the submit click becomes `ambiguous`;
- ambiguous attempts are never automatically resubmitted;
- completed attempts ignore duplicate callbacks.

### 18.16 Live progress

Every stage appends a durable event. Applications → Auto Apply displays:

```text
Preparing
Waiting for browser
Opening application
Filling page 1 of 3
Uploading resume
Needs your answer
Waiting for CAPTCHA or verification
Submitting
Verifying submission
Submitted
Ambiguous
Failed
Cancelled
```

Phone commands are durable. If the browser is online, Realtime wakes it immediately. If offline, the command waits for the next reconciliation.

### 18.17 Account-safety behavior

The extension uses the user's normal browser session and network but makes no promise of invisibility.

It must:

- keep cookies on-device;
- avoid proxy rotation and fingerprint spoofing;
- avoid simultaneous flows on one account-bound platform;
- stop after challenges or block signals;
- preserve truthful consistent profile facts;
- avoid duplicate employer applications;
- expose active work and Emergency Stop;
- honor remote adapter shutdowns;
- record the authorization source for every submission.

## 19. Migration from the current prototype

Implement incrementally:

1. Add `background.js` and Manifest V3 service-worker registration.
2. Add extension pairing, device records, heartbeat, and revocation.
3. Add `waiting_for_browser` and durable browser-command tables.
4. Replace URL-fragment handoff with tab-owned package delivery.
5. Extract current field matching into `adapters/base.js`.
6. Build Greenhouse-specific navigation and confirmation.
7. Add document upload and required-field validation.
8. Add leases, checkpoints, and ambiguous-submit handling.
9. Route direct clicks through the browser command queue.
10. Route standing watchlist matches through the same queue.
11. Add adaptive cross-domain concurrency and circuit breakers.
12. Add Ashby and Lever only after Greenhouse passes fixtures and canaries.

The existing handoff path remains available during migration and is removed only after the durable extension executor passes end-to-end recovery and confirmation tests.

## 14. ATS adapter execution contract

Every supported ATS must implement the same observable contract before live-volume testing:

1. Detect the ATS from the declared type and current hostname.
2. Discover the application form and enumerate visible controls.
3. Normalize the candidate's verified intent to an option that exists on the page.
4. Track fields by normalized question text and type so React-generated IDs cannot restart work.
5. Fill a field at most twice and lock it after the ATS retains the value.
6. Use deterministic profile facts for identity, education, authorization, legal, EEO, salary, location, and preferences.
7. Use AI only for non-sensitive prose on the second and final bounded attempt.
8. Run native validation, then invoke an ATS-specific repair only for the exact invalid control.
9. Select the highest-confidence submit control inside the application form.
10. Make one submission attempt and require positive ATS success evidence.
11. Record submission idempotently in the queue and saved-job pipeline.
12. Emit a diagnostic containing the field label, offered options, attempted intent, validation message, adapter, and terminal state when user input is required.

The generic DOM implementation is a fallback for discovery and diagnostics. Greenhouse, Lever, Ashby, Workday, and SmartRecruiters use named adapters. A named adapter owns only behavior that differs from the common runner.

### 14.1 Field state machine

Each field follows:

discovered -> planned -> filling -> verified

A failed fill may transition once to retry. A second failure transitions to needs_user. DOM mutation never moves a verified field back to planned.

Sensitive facts are never inferred. Missing sensitive facts transition directly to needs_user; a user-confirmed answer may be stored in the reusable fact bank.

### 14.2 Current implementation

Extension v0.10.0 introduces extension/ats-adapters.js with:

- named adapters for Greenhouse, Lever, Ashby, Workday, and SmartRecruiters
- stable field identities
- two-attempt field ledgers
- deterministic option matching for degree, country, and yes/no intent
- ATS submit-control scoring
- positive submission-evidence checks
- Greenhouse phone-country repair
- idempotent browser submission receipts

The profile stores reusable government, service, onsite, travel, coding-language, clearance, citizenship/residency, and optional EEO answers in custom_answers. These values are used only when explicitly supplied.

### 14.3 Adapter rollout gate

Test adapters in this order: Greenhouse, Lever, Ashby, SmartRecruiters, then Workday. Before a live application, each adapter must pass fixtures for:

- native text, radio, checkbox, select, and file controls
- React or portal dropdowns
- conditional fields
- required hidden proxy controls
- native validation diagnostics
- exact submit-control selection
- success-page detection
- duplicate success reporting
- missing sensitive facts

A live test is successful only when the ATS confirms receipt and both autoapply_job_queue and saved_jobs agree. Filled or clicked forms do not count as submitted.