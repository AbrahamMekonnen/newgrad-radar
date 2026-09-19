# Unattended Auto-Apply Architecture

Status: Proposed implementation plan  
Last updated: 2026-09-18  
Scope: HireRadar backend, responsive web application, Windows runner, browser integration, mobile intervention, application tracking, and rollout

## 1. Purpose

HireRadar should let a user start Auto Apply from the Job Hub on a desktop or phone and have a paired computer complete supported applications with minimal intervention. The backend performs matching, document selection, answer generation, validation, scheduling, and synchronization. A user-owned runner performs browser-dependent form work through the user's device and network. The existing HireRadar website remains the complete interface on desktop and mobile.

The system prioritizes accurate, relevant applications. It must never count a prepared form, a clicked submit button, or an unverified automation result as a submitted application.

## 2. Product principles

1. **One product interface.** The responsive HireRadar website is the source of truth. Interview Prep, recruiter information, settings, analytics, notifications, the Answer Bank, and application history are not duplicated inside the extension.
2. **Backend intelligence.** Expensive and data-heavy work happens on the backend before a browser tab opens.
3. **User-owned execution by default.** Browser-dependent submission runs on the paired computer when possible, using a dedicated HireRadar browser profile and the user's network.
4. **Verified outcomes.** Only a strong ATS confirmation signal changes an application to `submitted`.
5. **Truth over guessing.** The system never invents sensitive facts, legal acknowledgements, citizenship, sponsorship, government employment, criminal history, disability, demographic answers, or other facts that require the user.
6. **No security-control bypass.** CAPTCHA, MFA, device verification, and login challenges pause the affected application for user intervention.
7. **Adaptive throughput.** The runner uses the laptop's measured capacity and ATS reliability rather than a fixed concurrency limit.
8. **Graceful interruption.** Sleep, network loss, browser crashes, and phone intervention must not create duplicate submissions or corrupt queue state.
9. **Minimal secrets.** The extension and runner never receive Supabase service-role, AI-provider, notification-provider, or employer-owned ATS keys.
10. **Auditable automation.** Every transition includes a timestamp, actor, reason, attempt identifier, and sanitized evidence.

## 3. Current system versus target system

### Current behavior

- The backend prepares application data and stores queue records.
- Extension version 0.3.0 can receive a short-lived handoff, fill supported forms, submit after prior user intent, and report success after detecting a confirmation page.
- The extension requires an open browser and cannot operate after the browser or computer is closed.
- The legacy Python worker contains historical browser automation. Headless submission is disabled because it cannot provide reliable review or verified ATS acceptance.
- There is no paired desktop runner, wake scheduling, phone intervention session, or adaptive local scheduler yet.

### Target behavior

- A user can tap Auto Apply from any signed-in browser, including a phone.
- The backend prepares and validates the application continuously.
- A paired desktop runner wakes a sleeping computer, receives work, and starts a dedicated browser profile.
- The runner executes multiple supported applications concurrently according to measured capacity.
- Missing factual answers appear as simple prompts on the HireRadar website.
- CAPTCHA, MFA, login, and unusual controls can be completed through a short-lived remote browser session opened from the phone.
- Live progress appears under Applications > Auto Apply.
- Only verified submissions affect submitted counts, analytics, weekly goals, and notifications.

## 4. System boundaries

### 4.1 HireRadar web application

The responsive Next.js application remains the complete interface:

- Job Hub, job cards, and Auto Apply controls
- application queue, history, and live progress
- missing-answer prompts and remote intervention
- Interview Prep and recruiter information
- resumes, profile data, and Answer Bank
- notification and device settings
- analytics based on verified application events

It may be installed as a Progressive Web App, but installation is optional. A normal mobile browser remains sufficient for opening links and answering questions.

### 4.2 Backend control plane

The backend owns:

- authentication and authorization
- matching and eligibility rules
- ATS schema normalization
- resume selection and tailoring
- answer retrieval, generation, and validation
- sensitive-question policy enforcement
- queue ordering, leases, and retries
- device routing and signed task packages
- realtime events and notifications
- intervention signaling
- idempotency and duplicate prevention
- receipt verification, synchronization, and analytics

### 4.3 Desktop runner

The installed, signed runner contains a Windows service and a per-user process. It provides:

- device registration and heartbeat
- automatic startup and scheduled wake
- queue subscription and job leasing
- adaptive concurrency
- browser lifecycle and profile management
- local document staging
- extension/native-messaging bridge
- browser-window streaming for intervention
- resource monitoring, recovery, and reporting

The service handles wake, updates, and recovery. Browser interaction runs in the signed-in user's session because a Session 0 service cannot safely present a normal user browser.

### 4.4 Browser integration

The browser component stays narrow:

- ATS/page detection and schema observation
- field mapping and native change events
- dynamic and multipage forms
- resume and cover-letter uploads
- validation and submission
- challenge and confirmation detection
- communication with the local runner

Its popup only needs connection status, current application, progress, pause/resume, Request help on phone, and Open HireRadar.

### 4.5 Phone control surface

No native iOS or Android app is required. The website provides:

- Auto Apply initiation
- runner availability and last heartbeat
- queue and live progress
- simple missing-answer forms
- push-notification destinations
- short-lived remote intervention
- pause, cancel, skip, and retry
- verified submission receipts

Web Push is primary where available. Email and Telegram are required fallbacks. On iOS, onboarding must explain the Home Screen requirement.

## 5. End-to-end flows

### 5.1 Start from phone or desktop

1. The user clicks Auto Apply.
2. The API validates authentication, job state, duplicate rules, and user settings.
3. The backend creates one application and immutable attempt ID.
4. Preparation selects a resume, reads the full ATS schema, assembles answers, and evaluates required fields.
5. Unknown factual or sensitive fields move the attempt to `needs_answer`.
6. A complete package moves to `ready`.
7. Device routing selects an eligible paired runner.
8. An offline runner leaves the attempt at `waiting_for_runner` and the UI shows its last heartbeat.
9. The runner leases the job and opens a dedicated browser tab.
10. It fills, validates, submits, and verifies.
11. An idempotent finalization synchronizes the queue, saved jobs, analytics, notifications, and Answer Bank.

### 5.2 Missing answer

1. Preparation or the browser emits `needs_answer` with a normalized question, choices, sensitivity class, and context.
2. Only that application pauses.
3. Web Push, email, or Telegram links to an authenticated HireRadar page.
4. The user answers on their phone.
5. The answer is stored with an explicit reuse policy and appropriate global, company, role, or jurisdiction scope.
6. The runner receives it through its existing outbound connection.
7. The same browser tab continues.

### 5.3 CAPTCHA, MFA, login, or unusual controls

1. The runner detects a blocking challenge and emits `needs_intervention`.
2. That tab pauses while unrelated tabs continue.
3. The runner prevents sleep for a bounded intervention window.
4. The backend creates a one-time token and sends a notification.
5. The user authenticates on the intervention page.
6. The phone establishes WebRTC with the runner. Backend signaling coordinates it; TURN relays traffic when direct connectivity fails.
7. The phone displays only the application browser surface.
8. The user controls the existing laptop session and personally completes the challenge.
9. The runner detects clearance, revokes remote access, validates, and resumes.
10. Expiration returns the attempt to a recoverable paused state, never submitted.

The intervention system does not solve, outsource, or bypass CAPTCHA.

## 6. Communication architecture

### Web to backend

- HTTPS for commands and queries
- Supabase Realtime or authenticated WebSocket for progress
- service worker and VAPID-backed Web Push
- standard session authentication and row-level access rules

### Runner to backend

The runner opens an outbound TLS WebSocket. No inbound laptop port or router setup is required. It carries heartbeat, capability updates, lease messages, progress, intervention events, diagnostics, receipts, and updater instructions.

Large files use short-lived signed URLs scoped to one application and document.

### Runner to extension

Use browser native messaging where supported. Messages are length-prefixed, schema-versioned JSON with a strict extension-origin allowlist.

```json
{
  "version": 1,
  "type": "application.start",
  "attemptId": "uuid",
  "jobUrl": "https://employer.example/apply",
  "packageToken": "short-lived-token"
}
```

```json
{
  "version": 1,
  "type": "application.progress",
  "attemptId": "uuid",
  "state": "filling",
  "completedFields": 18,
  "totalFields": 22
}
```

### Phone intervention

- HTTPS authenticates and obtains a one-time token.
- WebSocket performs signaling.
- WebRTC carries the browser stream and input.
- TURN handles restrictive networks.
- The session is scoped to one attempt and one browser surface.
- Clipboard, arbitrary file transfer, and general desktop access are disabled.

Guacamole or noVNC can support the first implementation. A browser-window-only WebRTC stream is preferred long term because it exposes less of the desktop.

## 7. Pairing and device identity

1. Settings > Auto Apply Devices shows a temporary pairing code or QR code.
2. The runner exchanges it for a device identity.
3. It creates a hardware-backed device key when available.
4. The backend stores the public key, owner, name, OS, version, and capabilities.
5. Task packages are signed and addressed to one device.
6. The device can be revoked remotely.

Several computers may be paired. Routing prefers an online, powered, capable, user-designated primary device. Only one device can lease an attempt.

## 8. Wake, sleep, restart, and locked sessions

After explicit onboarding consent, the installer configures:

- automatic service startup
- wake-enabled scheduled tasks
- wake timers while plugged in
- runner startup after login/restart
- execution-state wake locks during active work
- return to the previous sleep behavior when idle

Recommended cycle:

1. Wake during the configured application window.
2. Connect and check for work.
3. Sleep again when no work exists.
4. Process until the queue is empty, quiet hours begin, or resource policy stops the run.

The runner cannot execute when fully powered off, out of battery, blocked by firmware, disconnected from the network, or lacking a usable signed-in session. The UI must show these conditions.

## 9. Adaptive concurrency

There is no fixed seven-tab ceiling. The scheduler starts conservatively and grows while the device and ATS lanes remain healthy.

### Inputs

- logical CPU count and sustained utilization
- total and available memory
- learned memory per active tab
- browser responsiveness and navigation latency
- thermal state and throttling when available
- power source and battery
- network latency and failure rate
- ATS latency, errors, throttling, and challenge frequency
- active intervention count

Temperature APIs vary by laptop, so temperature supplements CPU throttling and responsiveness rather than acting as the only control.

### Ramp algorithm

1. Start with three active work units after wake.
2. Observe health during a stabilization interval.
3. Add one unit when CPU, memory, responsiveness, power, and ATS health remain inside policy.
4. Continue until the measured capacity budget is reached.
5. Reduce promptly under sustained pressure.
6. Pause new leases under severe pressure while preserving checkpoints.

### Weighted work

- simple single-page form: 1 unit
- dynamic Greenhouse, Lever, or Ashby form: 1–2 units
- complex Workday or Taleo flow: 3 units
- active document conversion/upload: additional unit
- phone intervention: low CPU weight but retains a session slot

A typical laptop may reach 6–10 lightweight tabs; a high-end desktop may exceed that. Use an initial advanced safety ceiling of 20 active attempts and revise it from evidence.

### ATS lanes

- one active application per employer
- independent ATS lanes
- ATS-specific backoff after throttling or repeated challenges
- one blocked tab does not stop unrelated lanes
- duplicate prevention spans sources and devices

Concurrency serves throughput and resource efficiency. The system does not add fingerprint spoofing, fake behavior, CAPTCHA bypass, or deceptive identity manipulation.

## 10. Canonical state model

```text
queued
  -> matching
  -> preparing
  -> needs_answer
  -> ready
  -> waiting_for_runner
  -> leased
  -> opening_form
  -> filling
  -> needs_intervention
  -> validating
  -> submitting
  -> verifying
  -> submitted
```

Alternate or terminal states:

- `not_eligible`
- `unsupported`
- `cancelled`
- `expired`
- `failed_recoverable`
- `failed_final`
- `duplicate`
- `job_closed`

`prepared` is readiness, not submission. `submitting` means the action began. `submitted` requires verified evidence.

Every attempt includes an immutable ID, user/job uniqueness key, idempotency key, lease and expiration, state reason, retry count, snapshot versions, runner/session IDs, transition timestamps, and sanitized confirmation metadata.

## 11. Verification policy

A successful click is insufficient. Acceptable evidence includes:

- ATS API receipt
- confirmation page with a recognized success signal and no active form
- stable application or confirmation ID
- verified confirmation email correlated to the attempt
- candidate dashboard showing the submitted application

Store signal type, timestamp, normalized URL, adapter version, and sanitized text hash. Screenshots are optional diagnostics and redact sensitive data by default.

Ambiguous submission remains `verifying` or `failed_recoverable`; it never becomes `submitted`.

## 12. Profile, Answer Bank, and synchronization

The backend is authoritative. Each application references immutable profile, resume, Answer Bank, job-description, model, and prompt versions.

- Updates before leasing regenerate relevant package data.
- Active forms preserve user edits.
- Intervention answers store source, confidence, sensitivity, scope, and reuse consent.
- Company-specific answers do not silently become global.
- AI narratives remain editable and retain provenance.
- Salary answers follow job/company evidence and user strategy, never arbitrary defaults.
- Unknown sensitive facts always pause.

## 13. Notifications and mobile UX

Notify for:

- runner offline while work is ready
- question needed
- CAPTCHA/login intervention
- verified submission
- recoverable or final failure
- daily completion summary
- new matching jobs according to preferences

Web Push, email, and Telegram delivery are tracked separately from application truth.

Applications > Auto Apply is the single live destination. Filters cover all, preparing, waiting for runner, needs user, actively applying, verifying, submitted, and failed. Each row shows its latest event, runner, attempt time, required action, and receipt.

## 14. Security and privacy

Required controls:

- signed desktop binaries and automatic updates
- TLS and short-lived scoped task tokens
- device-bound keys
- encrypted local browser profile and document cache
- operating-system protected secret storage
- user-scoped database policies
- strict native-messaging origin allowlist
- one-time intervention tokens and reauthentication
- audit records for pairing, intervention, submission, and revocation
- retention limits and remote device revocation

Secrets never sent to the extension:

- Supabase service-role key
- Gemini, Groq, or other model keys
- notification-provider credentials
- server signing keys
- employer ATS credentials

Remote intervention shows only the application browser, disables clipboard and arbitrary transfer, expires quickly, terminates after clearance, and provides visible local status and immediate termination.

## 15. Browser and ATS strategy

Abstract the browser engine. Chromium/Edge is first because it provides broad ATS compatibility and matches the current extension. Firefox is secondary; WebKit follows where useful.

Changing browsers does not guarantee fewer challenges. Reliability comes from stable sessions, the user's device and network, accurate form behavior, validation, conservative matching, and bounded retries.

The ATS registry records domains, tested engines, schema extraction, account requirements, pages, uploads, dynamic controls, confirmation signals, challenge behavior, retry safety, adapter version, and fixtures.

Direct ATS APIs are used only with valid authorization. Greenhouse, Lever, and Ashby submission APIs require organization-controlled credentials unavailable from applicant browsers.

## 16. Reliability and recovery

### Idempotency

- one logical application per user/job
- one immutable attempt ID
- destination idempotency keys where supported
- confirmation and candidate-history checks before ambiguous retries
- no second submit until ambiguity is resolved or an adapter proves retry is safe

### Leases

- bounded runner leases with renewal
- lost leases recover only after the prior session is unavailable
- two devices cannot execute the same attempt

### Checkpoints

Persist stage, URL, non-sensitive completed-field signatures, uploads, pending question/challenge, submit initiation, and verification state.

### Failure isolation

A tab failure does not crash the scheduler. ATS backoff does not block other lanes. Notification failure does not change application truth. Analytics failure after verified submission enters a repair queue.

## 17. Proposed data additions

Design exact migrations against the current schema before implementation.

### `runner_devices`

Device ID, user ID, name, platform, public key, version, capabilities, status, last heartbeat, and revocation.

### `application_attempts`

Attempt ID, queue/user/job IDs, state/reason, idempotency key, runner, lease, snapshot versions, attempt count, confirmation type/reference, and timestamps.

### `application_events`

Attempt ID, monotonically increasing sequence, event type, actor, sanitized payload, and timestamp.

### `application_interventions`

Attempt ID, type, status, normalized question signature, expiration, resolver, and resolution time.

### `push_subscriptions`

User ID, endpoint, encryption keys, user agent, last success, and disabled time.

All tables require user-scoped policies. Service-role operations remain in trusted backend processes.

## 18. Component plan

### Backend

- orchestration and preparation services
- ATS connector registry
- device gateway and lease manager
- event and verification services
- intervention signaling and TURN integration
- Web Push and notification router
- synchronization repair worker

### Web

- Auto Apply command API
- device settings
- responsive queue and timeline
- missing-answer page
- remote intervention page
- notification onboarding
- runner-offline states and receipt display

### Windows runner

- installer/updater
- service and signed-in user agent
- wake scheduler and resource monitor
- adaptive scheduler and browser manager
- native-messaging host
- encrypted local storage
- intervention host
- crash recovery and diagnostics

### Browser integration

- background coordinator
- ATS adapters
- field/validation engine
- upload bridge
- confirmation detector
- runner client
- minimal popup

## 19. Implementation phases

### Phase 0: correctness baseline

Consolidate states, ensure only verified submissions count, remove false-success paths, preserve the current handoff, and add ATS fixtures.

Exit: analytics, queue, saved jobs, and notifications agree on verified submissions.

### Phase 1: device foundation

Build schema and pairing, Windows service/user agent, authenticated outbound connection, heartbeat UI, task leasing, and runner-extension native messaging.

Exit: a phone Auto Apply command reliably reaches a paired laptop and opens the correct form once.

### Phase 2: local execution

Add a dedicated browser profile, wake scheduling, adaptive weighted concurrency, ATS lanes, backoff, and checkpoints.

Exit: supported applications survive sleep/wake and browser restart without duplication.

### Phase 3: phone questions and notifications

Implement Web Push, email and Telegram routing, mobile question flow, scoped Answer Bank writes, and same-tab resume.

Exit: a phone answer resumes the laptop application without restarting it.

### Phase 4: remote intervention

Implement one-time sessions, initial noVNC/Guacamole browser view, WebRTC signaling, TURN, restricted surface control, and automatic resume.

Exit: a user completes a controlled test challenge from a phone in the original laptop browser session.

### Phase 5: coverage and hardening

Expand adapters, add Firefox fallback, improve multipage recovery, correlate confirmation email, sign updates, and run failure-injection tests.

Exit: reliability targets are met per ATS before unattended submission is enabled.

### Phase 6: authorized integrations

Pursue ATS/employer partnerships and replace browser execution with authorized APIs where possible.

## 20. Testing strategy

Unit tests cover state transitions, sensitive-answer policy, capacity, deduplication, token scope, and confirmation classification.

Adapter fixtures cover dynamic fields, conditional questions, select validation, uploads, multipage transitions, success pages, and ambiguous pages.

Integration tests cover phone-to-runner leasing, native messaging, answer round trips, Web Push, intervention tokens, direct and TURN WebRTC, sleep/wake, reconnect, and revocation.

Controlled end-to-end tests cover multiple tabs, adaptive ramping, one paused lane while others continue, browser crashes, network loss around submission, ambiguous confirmation, duplicate commands, and cross-system synchronization. Real employer submissions are not automated test fixtures.

## 21. Observability

Track preparation completeness, required-answer frequency, fill success, intervention frequency, submit initiation, verified submission rate, ambiguity, deduplication, p50/p95 completion time, retries, resource cost, runner online rate, and notification delivery by ATS and adapter version.

Public success claims must distinguish preparation, attempted submission, and verified submission.

## 22. Remaining decisions

1. Runner stack: .NET, Rust/Tauri, or another signed Windows stack.
2. Initial remote control: Guacamole, noVNC, or purpose-built streaming.
3. Browser capture/input reliability while Windows is locked.
4. One dedicated profile versus ATS-specific profiles.
5. Local encryption for browser state and downloaded resumes.
6. Intervention timeout and safe resume behavior.
7. Initial concurrency ceiling and benchmark duration.
8. TURN hosting and bandwidth cost.
9. Code signing, updates, and rollback.
10. Exact migrations and compatibility with existing queue rows.
11. Browser-store distribution versus runner-managed installation.
12. Whether diagnostics prohibit intervention recordings entirely.

## 23. Explicit non-goals

- extracting employer-owned ATS keys
- CAPTCHA solving or bypass
- fingerprint spoofing
- deceptive browser/network identity manipulation
- unrestricted remote desktop access
- counting prepared or attempted applications as submitted
- guessing sensitive or legally significant facts
- duplicating HireRadar inside the extension

## 24. Research references

- Greenhouse Job Board API: https://docs.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Ashby submission: https://developers.ashbyhq.com/reference/applicationformsubmit
- Chrome service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Playwright authentication state: https://playwright.dev/docs/auth
- Browserless sessions: https://docs.browserless.io/baas/session-management
- Browserbase contexts: https://www.browserbase.com/templates/context
- Apache Guacamole: https://guacamole.apache.org/doc/gug/introduction.html
- noVNC: https://novnc.com/
- WebRTC TURN: https://webrtc.org/getting-started/turn-server
- Web Push: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Apple Web Push: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- UiPath browser modes: https://docs.uipath.com/activities/other/latest/ui-automation/browser-automation-mode
- Microsoft hosted RPA: https://learn.microsoft.com/en-us/power-automate/desktop-flows/hosted-rpa-overview
- Simplify Autopilot: https://help.simplify.jobs/articles/1784339-getting-started-with-autopilot
- LoopCV methods: https://loopcv.freshdesk.com/support/solutions/articles/103000399849-knowledge-base

## 25. Definition of success

A user can tap Auto Apply from a phone, put the phone down, and later see a truthful result. The backend performs preparation; the paired laptop wakes and executes supported forms; the user receives a phone prompt only when their knowledge or direct action is required; unrelated applications continue; and HireRadar records submission only after verifiable ATS acceptance.
