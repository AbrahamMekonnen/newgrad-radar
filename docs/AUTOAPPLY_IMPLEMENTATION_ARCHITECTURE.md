# Auto-Apply Implementation Architecture

Status: Engineering design for implementation

Last updated: 2026-09-18
Parent design: [Unattended Auto-Apply Architecture](./UNATTENDED_AUTOAPPLY_ARCHITECTURE.md)

## 1. Objective

This document converts the product architecture into an implementable system for the current HireRadar repository. It selects concrete technologies, defines process and trust boundaries, specifies protocols and storage, describes the Windows runner and browser engine, and provides an ordered delivery plan.

The implementation must support this core scenario:

1. A user taps Auto Apply from HireRadar on a phone or desktop.
2. Backend workers prepare a complete, truthful application package.
3. A paired Windows laptop wakes if sleeping.
4. Its runner leases the application and opens a dedicated browser session.
5. Several independent applications may execute concurrently according to measured device capacity.
6. Simple missing answers are resolved from the website.
7. CAPTCHA, MFA, login, and unusual controls can be handled from a secure phone takeover page in the same browser session.
8. Only verified ATS acceptance becomes `submitted`.

## 2. Existing system constraints

The implementation extends the current stack instead of replacing it:

- Next.js 16 and React 19 deployed on Vercel
- Supabase Auth, PostgreSQL, Storage, and Realtime
- Python preparation and submission modules under `scraper/autoapply`
- Supabase-backed `autoapply_job_queue`
- Manifest V3 extension under `extension`
- Existing handoff and queue routes under `src/app/api/auto-apply`
- Current migrations through `048_submission_truth.sql`
- Existing Greenhouse, Lever, Ashby, Workday, iCIMS, Taleo, SmartRecruiters, Jobvite, and other adapters
- Existing answer generation, Answer Bank, user profile, resume, salary, and notification work

The implementation preserves working preparation logic while replacing unsupported or unreliable submission paths incrementally.

## 3. Selected technology stack

### 3.1 Web and control plane

Use the existing Next.js application for:

- user commands
- device pairing
- application timelines
- answer prompts
- remote takeover page
- settings and notification onboarding
- authenticated REST endpoints
- server-side token issuance

Keep Vercel request handlers short. They validate, transact, enqueue, and return. Browser work and long-running AI preparation do not execute in a Vercel request.

### 3.2 Durable data and realtime

Use Supabase for:

- PostgreSQL as canonical application state
- Auth for people
- Storage for resumes and bounded diagnostic artifacts
- private Realtime Broadcast channels for low-latency device messages
- Realtime Presence for slow-changing runner online state
- database triggers for user-facing event broadcasts
- Cron for lease repair, expired interventions, and synchronization repair

Realtime messages are hints and commands, not the source of truth. A dropped broadcast cannot lose an application because runners recover from the database.

Do not create a separate WebSocket gateway in the first version. Supabase Realtime already supports authenticated private channels, Broadcast, Presence, replay, and C# clients. A dedicated gateway is introduced only if measured connection limits, routing needs, or cost require it.

### 3.3 Backend workers

Keep Python for preparation because the existing ATS adapters, AI drafting, resume parsing, and field knowledge base are already Python.

Run workers as a containerized long-running service on a worker platform such as Fly.io, Railway, Render, or an equivalent container host. Do not place the worker loop in Vercel Functions or Supabase Edge Functions:

- Vercel functions are request-duration constrained.
- Supabase Edge Functions have strict wall-clock, memory, and CPU limits.
- preparation workers need retry loops, controlled concurrency, Python dependencies, and predictable process lifetime.

The worker deployment contains separate process roles from one image:

- `prepare-worker`
- `notification-worker`
- `repair-worker`

Scale each role independently later. Initially, one container may run preparation and notifications if metrics show sufficient isolation.

### 3.4 Windows runner

Use **.NET 10 LTS** and C#.

Rationale:

- .NET 10 is supported through November 2028.
- Microsoft provides first-class Worker Service and Windows Service support.
- Playwright has official .NET bindings.
- Windows wake and execution-state APIs are directly accessible.
- DPAPI provides user-bound local secret protection.
- Supabase provides a maintained C# client including Realtime.
- A self-contained signed executable avoids requiring users to install a runtime.
- C# is a better fit for Windows services, scheduled tasks, named pipes, process supervision, Event Log, and installer integration than adding a Node or Python runtime.

The runner has two executables:

1. **HireRadar.Runner.Service**
   - runs as LocalService
   - starts at boot
   - owns updates, wake tasks, health, and user-agent supervision
   - never holds user browser cookies or resumes
   - cannot manipulate browser UI from Session 0

2. **HireRadar.Runner.Agent**
   - runs in the signed-in user's session
   - owns Supabase user/device session, browser profile, Playwright, local documents, scheduling, and phone intervention
   - starts automatically at login and is relaunched by the service
   - displays the tray UI and privacy indicator

A local named pipe connects the service and user agent. The pipe uses an ACL restricted to the installed service SID and the paired Windows user.

### 3.5 Browser engine

Use **Playwright .NET with bundled Chromium** as the primary unattended engine.

Configuration:

- headed browser process by default
- dedicated persistent user-data directory under the runner data directory
- never attach to the user's default Chrome or Edge profile
- one persistent context per paired HireRadar user
- multiple pages/tabs inside that context
- one application controller per page
- bundled Chromium version pinned to the Playwright package
- optional Edge channel only after compatibility testing
- Firefox added as a per-ATS fallback after Chromium behavior is stable

Chrome 136 and later do not permit remote debugging against the default Chrome data directory. Playwright also warns against automating a normal default profile. A separate profile is required for reliability and credential isolation.

### 3.6 Extension role

Do not make the extension a dependency of the desktop runner.

The runner controls its dedicated browser directly with Playwright. This avoids:

- extension service-worker lifetime issues
- user installation and update mismatch
- Chrome/Edge removal of extension side-load flags
- native-messaging registration as a requirement for core execution
- duplicating Playwright and extension orchestration

Retain the extension as an **attended mode**:

- fills an application the user opened in their normal browser
- supports manual review and handoff
- reports verified completion
- offers an alternative when the desktop runner is not installed
- can communicate with the runner later through native messaging if a concrete attended use case requires it

Extract shared ATS rules into versioned JSON/TypeScript schema packages where practical. Do not attempt to execute the same DOM code unchanged in Python, C#, and an extension.

### 3.7 Packaging and updates

Package the Windows runner as signed MSIX with an `.appinstaller` update feed.

- publish self-contained `win-x64` first
- add `win-arm64` after x64 stability
- sign binaries and packages with a CA-trusted certificate or Azure Artifact Signing
- host package and App Installer metadata over HTTPS
- use staged update rings: internal, beta, stable
- keep the previous package available for rollback
- verify runner/backend protocol compatibility before activation

MSIX provides clean install/uninstall and update support. If service registration or browser payload constraints prove incompatible in a prototype, use a signed WiX bootstrapper while preserving the same executable boundaries.

## 4. Repository layout

Add these top-level areas:

```text
runner/
  HireRadar.Runner.sln
  Directory.Build.props
  Directory.Packages.props
  src/
    HireRadar.Runner.Contracts/
    HireRadar.Runner.Core/
    HireRadar.Runner.Service/
    HireRadar.Runner.Agent/
    HireRadar.Runner.Browser/
    HireRadar.Runner.Intervention/
    HireRadar.Runner.Tray/
  tests/
    HireRadar.Runner.UnitTests/
    HireRadar.Runner.IntegrationTests/
    HireRadar.Runner.BrowserTests/
  packaging/
    msix/
    scripts/

packages/
  autoapply-protocol/
    schemas/
    generated/
    fixtures/

scraper/autoapply/
  adapters/
  preparation/
  workers/

src/
  app/
    api/
      auto-apply/
      runner/
      interventions/
      push/
    applications/
    settings/
      devices/
    intervene/
  lib/
    autoapply/
    runner/
    notifications/
```

Do not move all existing files before behavior is covered by tests. Introduce new directories and migrate adapter logic incrementally.

## 5. Canonical data model

The existing `autoapply_job_queue` remains the user-facing queue during migration. New normalized tables hold attempts, events, devices, and interventions.

### 5.1 Runner devices

```sql
create table runner_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('windows')),
  architecture text not null,
  public_key text not null,
  key_fingerprint text not null,
  runner_version text not null,
  protocol_version integer not null,
  capabilities jsonb not null default '{}',
  status text not null default 'offline',
  last_seen_at timestamptz,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key_fingerprint)
);
```

### 5.2 Application attempts

```sql
create table application_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references autoapply_job_queue(id),
  user_id uuid not null references auth.users(id),
  job_id text not null references jobs(id),
  attempt_number integer not null default 1,
  state text not null,
  state_reason text,
  idempotency_key uuid not null default gen_random_uuid(),
  runner_device_id uuid references runner_devices(id),
  lease_token_hash text,
  lease_expires_at timestamptz,
  profile_version bigint,
  answer_version bigint,
  resume_id uuid,
  adapter_name text,
  adapter_version text,
  browser_engine text,
  browser_session_id text,
  confirmation_type text,
  confirmation_reference text,
  confirmation_evidence jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id),
  unique (idempotency_key)
);
```

During migration, the uniqueness policy must account for jobs that users intentionally reapply to after a defined interval. Initial behavior remains one application per user/job.

### 5.3 Application events

```sql
create table application_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references application_attempts(id) on delete cascade,
  sequence integer not null,
  event_type text not null,
  actor_type text not null,
  actor_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (attempt_id, sequence)
);
```

Use an RPC to append events and transition state atomically. Clients never calculate the next sequence themselves.

### 5.4 Interventions

```sql
create table application_interventions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references application_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  type text not null,
  status text not null default 'pending',
  prompt jsonb,
  token_hash text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  resolved_at timestamptz,
  resolution jsonb,
  created_at timestamptz not null default now()
);
```

### 5.5 Device commands

Do not use Realtime alone for commands. Store commands durably:

```sql
create table runner_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references runner_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  command_type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  not_before timestamptz not null default now(),
  expires_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
```

A private Realtime broadcast tells the device that work exists. The device claims the durable command using an RPC. If Broadcast is lost, periodic reconciliation finds it.

### 5.6 Push subscriptions

Store Web Push subscriptions separately from notification preferences. Encrypt or tightly restrict endpoint and key access. Disable subscriptions after permanent delivery errors.

## 6. Database functions and transactional rules

Implement SECURITY DEFINER functions with fixed `search_path`, explicit ownership, and narrow grants.

Required RPCs:

- `pair_runner_device(pairing_code, public_key, capabilities)`
- `issue_runner_challenge(device_id)`
- `claim_runner_command(device_id)`
- `ack_runner_command(command_id, result)`
- `claim_application_attempt(device_id, capabilities)`
- `renew_application_lease(attempt_id, lease_token)`
- `transition_application(attempt_id, lease_token, expected_state, next_state, event)`
- `release_application_lease(attempt_id, reason)`
- `create_intervention(attempt_id, type, prompt)`
- `resolve_intervention(intervention_id, resolution)`
- `finalize_verified_submission(attempt_id, evidence)`
- `expire_stale_leases()`
- `repair_submission_sync()`

Every transition checks:

- authenticated actor or device identity
- ownership
- expected current state
- active lease when required
- allowed state-machine edge
- monotonic event sequence
- idempotency key
- payload size and allowed keys

`finalize_verified_submission` performs one transaction:

1. verify the attempt is in `verifying`;
2. validate evidence type;
3. transition to `submitted`;
4. update `autoapply_job_queue`;
5. upsert `saved_jobs` as applied;
6. append the final event;
7. enqueue notification work;
8. enqueue analytics synchronization.

A repeated call with the same attempt and evidence returns the existing result.

## 7. Authentication and trust model

### 7.1 People

Continue using Supabase Auth in the website.

### 7.2 Device pairing

1. Authenticated user requests a one-use pairing code.
2. Backend stores only its hash and a five-minute expiration.
3. Runner generates an ECDSA P-256 device key pair locally.
4. Runner sends code, public key, version, and capabilities.
5. Backend consumes the code and creates the device.
6. Runner stores the private key with Windows DPAPI under `CurrentUser`.
7. Device proves possession by signing backend nonces.

### 7.3 Runner access tokens

Do not store a Supabase service key or a long-lived user password on the runner.

- Runner signs a nonce with its device key.
- A runner-token endpoint validates device status and signature.
- Backend issues a short-lived JWT containing `sub=user_id`, `device_id`, `aud=runner`, and narrow claims.
- Runner refreshes before expiration.
- Supabase Realtime private-channel policies authorize topics using these claims.
- Revoking the device prevents new tokens and disconnects it on token expiry.

Use current Supabase publishable/secret key conventions when migrating from legacy anon/service-role naming. Secret keys remain server-side.

### 7.4 Topic design

Use unguessable IDs and private channels:

- `runner:device:<device_id>`
- `application:<attempt_id>`
- `intervention:<intervention_id>`
- `user:<user_id>:applications`

Presence is used only for slow runner state. Broadcast carries wake hints, progress hints, and WebRTC signaling. Durable event rows remain authoritative.

## 8. Backend preparation pipeline

Split preparation into deterministic stages:

1. **Load snapshot**
   - job, company, user profile, resume, Answer Bank, preferences
2. **Eligibility gate**
   - role, level, location, work authorization, exclusions, compensation
3. **ATS schema**
   - cached schema or adapter fetch
4. **Deterministic mapping**
   - profile facts and verified answers
5. **Narrative generation**
   - batch AI prompts for unresolved non-sensitive text questions
6. **Validation**
   - required fields, option membership, date formats, lengths, consistency
7. **Document preparation**
   - select or create resume and cover letter
8. **Intervention decision**
   - ask user or mark ready
9. **Package signing**
   - immutable manifest and short-lived document access
10. **Dispatch**
   - select runner and create command

Each stage records its input version and result. A retry starts from the last valid stage rather than regenerating everything.

### 8.1 Application package

The runner receives metadata plus a signed package token. It fetches:

```json
{
  "schemaVersion": 1,
  "attemptId": "uuid",
  "job": {
    "id": "job-id",
    "url": "https://...",
    "title": "Software Engineer",
    "company": "Example"
  },
  "adapter": {
    "name": "greenhouse",
    "version": "2026.09.1"
  },
  "profileSnapshot": 42,
  "fields": [],
  "documents": [],
  "submissionAuthorized": true,
  "expiresAt": "2026-09-18T12:00:00Z"
}
```

The package never contains provider keys. Document URLs are single-purpose, short-lived, and bound to the attempt.

## 9. Runner process architecture

### 9.1 Service

Hosted services:

- `AgentSupervisor`
- `WakeTaskManager`
- `UpdateManager`
- `MachineHealthReporter`
- `NamedPipeServer`
- `CrashRecoveryManager`

The service does not connect to ATS pages or read user documents.

### 9.2 User agent

Hosted services:

- `DeviceSessionManager`
- `RealtimeChannelManager`
- `CommandReconciler`
- `ApplicationScheduler`
- `BrowserHost`
- `ResourceSampler`
- `InterventionHost`
- `ArtifactManager`
- `TrayStatePublisher`

Use `System.Threading.Channels` for in-process queues and cancellation tokens for every long-running operation. Do not coordinate components through mutable global state.

### 9.3 Local storage

```text
%LOCALAPPDATA%/HireRadar/
  config/
    device.json.dpapi
    preferences.json
  browser/
    chromium-profile/
  jobs/
    <attempt-id>/
      package.json.dpapi
      documents/
      checkpoint.json.dpapi
  logs/
  updates/
```

Rules:

- device private keys and refresh material use DPAPI CurrentUser
- downloaded documents are encrypted at rest or removed immediately after the attempt
- filenames are randomized
- browser profile permissions are limited to the Windows user
- logs contain IDs and field categories, not field values
- cleanup runs after completion and at startup
- retention defaults are configurable and conservative

## 10. Browser execution architecture

### 10.1 Browser host

Start one Playwright persistent Chromium context per HireRadar user. Run several pages in the same context, subject to ATS isolation rules.

Advantages:

- one browser process tree
- shared stable device profile
- lower memory than separate browsers
- straightforward tab monitoring
- persistent cookies and local storage

Risks:

- one browser crash affects all pages
- shared cookies may couple employers using the same ATS
- a modal or browser-level prompt may affect multiple pages

Mitigation:

- checkpoint every stage
- supervise and restart the browser
- use per-ATS contexts only when an adapter proves shared state harmful
- cap simultaneous heavy pages
- recover ambiguous submission carefully

### 10.2 Adapter interface

```csharp
public interface IAtsAdapter
{
    string Name { get; }
    Version AdapterVersion { get; }
    bool CanHandle(Uri url);
    Task<FormSnapshot> InspectAsync(IPage page, CancellationToken ct);
    Task<FillResult> FillAsync(IPage page, ApplicationPackage package, CancellationToken ct);
    Task<ValidationResult> ValidateAsync(IPage page, CancellationToken ct);
    Task<SubmitResult> SubmitAsync(IPage page, CancellationToken ct);
    Task<VerificationResult> VerifyAsync(IPage page, CancellationToken ct);
    Task<Checkpoint> CaptureCheckpointAsync(IPage page, CancellationToken ct);
}
```

The first runner adapters should be:

1. Greenhouse
2. Ashby
3. Lever
4. SmartRecruiters
5. Workday

Start with ATSs already represented by current fixtures and production data. Workday enters unattended mode only after multipage recovery is demonstrated.

### 10.3 Field strategy

Use this resolution order:

1. stable ATS field IDs
2. ATS-specific structured schema
3. associated label and ARIA relationship
4. exact normalized label
5. category aliases
6. semantic classifier
7. ask user or fail closed

Do not let AI directly manipulate the DOM. AI classifies or drafts structured values; deterministic adapter code performs interactions.

### 10.4 Validation

Before submission:

- all required controls valid
- values belong to declared option sets
- conditional fields reevaluated
- uploads complete
- no visible unresolved error summary
- form action still belongs to the expected job
- application package unexpired
- lease valid
- submission authorization still enabled
- job not already submitted

### 10.5 Confirmation

Verification uses adapter-specific evidence with confidence levels:

- API response captured from the page: strongest
- confirmation ID or candidate dashboard: strong
- success heading plus missing active form: acceptable
- URL change alone: insufficient
- submit button click: insufficient

## 11. Adaptive scheduler implementation

Use additive-increase/multiplicative-decrease rather than a fixed tab count.

### 11.1 Capacity model

Every five seconds sample:

- process and system CPU
- available physical memory
- browser working set
- page responsiveness heartbeat
- navigation and selector latency
- power source and battery
- thermal throttling when available
- current ATS errors and interventions

Compute:

```text
memory_capacity =
  floor((available_memory - reserve_memory) / learned_mb_per_unit)

cpu_capacity =
  floor(logical_processors * configured_cpu_factor)

effective_capacity =
  min(user_ceiling, safety_ceiling, memory_capacity, cpu_capacity, ats_capacity)
```

Initial values:

- reserve memory: max(3 GB, 20% of physical memory)
- starting units: 3
- safety ceiling: 20
- healthy CPU target: below 70% sustained
- pressure CPU threshold: above 82% for 30 seconds
- stabilization window: 60 seconds
- additive increase: +1 unit
- pressure decrease: multiply target by 0.6
- severe pressure: stop leasing and preserve active tabs

These are starting values, not product promises. Device telemetry and controlled benchmarks determine production defaults.

### 11.2 Work weights

Maintain an exponentially weighted moving average for memory, duration, and failure rate by adapter and stage. Start with static weights from the parent architecture and replace them with learned local estimates.

### 11.3 Semaphores

Enforce:

- global weighted capacity
- per-ATS capacity
- one active attempt per employer
- one intervention stream per user by default
- bounded document conversions
- bounded AI generation on backend workers

## 12. Phone answer implementation

Create `/applications/interventions/[id]`.

The page renders one of:

- yes/no
- single select
- multi-select
- short factual text
- date
- consent acknowledgment
- remote browser takeover

Resolution endpoint:

1. authenticate user;
2. verify intervention ownership and expiration;
3. validate answer against schema;
4. store normalized answer and reuse decision;
5. atomically mark intervention resolved;
6. append application event;
7. broadcast `intervention.resolved`;
8. runner reconciles from database and resumes.

The browser tab remains leased and open during the configured window. If the window expires, checkpoint and transition to a recoverable state.

## 13. Remote browser takeover

### 13.1 Selected MVP

Build a browser-surface relay instead of full remote desktop.

Runner:

1. opens a CDP session for the exact application page;
2. starts a low-frame-rate screencast;
3. sends compressed frames over a WebRTC data channel;
4. receives normalized touch, mouse, keyboard, and viewport events;
5. dispatches those events to the same page;
6. exposes no other tab or desktop surface;
7. stops immediately when intervention resolves.

Phone:

1. renders frames into a canvas;
2. maps phone coordinates to page viewport coordinates;
3. sends input events with monotonic sequence numbers;
4. provides an on-screen keyboard and explicit Submit/Done controls;
5. reconnects within the token lifetime after brief network loss.

Start at 3–5 frames per second and increase only while interaction requires it. CAPTCHA and login intervention do not need video-call frame rates. This avoids FFmpeg and lowers laptop, relay, and mobile-data cost.

### 13.2 WebRTC implementation

Use SIPSorcery in the .NET agent for WebRTC, ICE, STUN, TURN, and data channels. Use the browser's native `RTCPeerConnection` in the HireRadar page.

Signaling messages pass over a private Supabase Realtime channel and contain only SDP, ICE candidates, and session IDs. They are ephemeral. The intervention database row remains durable.

TURN credentials are short-lived and minted for one intervention. Never ship permanent TURN credentials to a browser or runner.

### 13.3 Security controls

- user must be authenticated
- require recent authentication for remote control
- one-use token stored as a hash
- five-minute initial claim window
- bounded active session, extendable by explicit user activity
- only one controlling phone client
- runner confirms attempt and page URL before accepting input
- no clipboard, downloads, arbitrary navigation, devtools, or desktop access
- visible tray indicator and Stop control
- input/event rate limits
- complete connection audit without recording sensitive screen content
- no intervention video recording by default

### 13.4 Prototype gates

Before committing to the MVP, prove:

- screencast continues when the laptop display is off
- required rendering continues while Windows is locked
- input reaches the intended page in that state
- the same ATS session remains valid
- direct and TURN-relayed connections work on iOS and Android browsers
- reconnect does not duplicate input
- challenge completion can be observed without storing challenge content

If locked-session behavior fails, wake the laptop and keep its dedicated browser session active while still streaming only the page. Do not fall back to unrestricted desktop access automatically.

## 14. Wake and power implementation

### 14.1 Scheduled wake

The service creates a Windows Task Scheduler task with `WakeToRun=true`. The task starts or signals the user agent during user-configured application windows.

### 14.2 Active work

The agent calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` while active work or intervention exists. It does not require `ES_DISPLAY_REQUIRED` unless a tested browser/rendering path needs the display awake.

Always clear the execution requirement in `finally`, process-exit handling, and service recovery.

### 14.3 Power policy

Defaults:

- full adaptive concurrency while plugged in
- reduced user-configurable capacity on battery
- stop new leases below battery threshold
- finish or checkpoint active attempts before sleep
- never change lid-close behavior silently
- onboarding explains wake permissions and lets users opt out

## 15. Notifications

Implement one notification outbox table and channel adapters:

- Web Push
- email
- Telegram

The application transaction inserts an outbox record. A worker claims and delivers it. Each delivery has independent status, retries, provider ID, and final error.

Web Push:

- use VAPID
- store per-browser subscriptions
- send only user-visible notifications
- handle expired subscriptions
- route clicks to a specific HireRadar page
- explain iOS Home Screen setup

Email and Telegram are fallbacks and summaries. Notification delivery does not define application success.

## 16. Deployment topology

```text
Vercel
  Next.js web and short API routes

Supabase
  Auth
  PostgreSQL
  Storage
  Realtime
  Cron

Container worker host
  prepare-worker
  notification-worker
  repair-worker

User Windows device
  Runner.Service
  Runner.Agent
  Playwright Chromium
  optional attended extension

TURN service
  managed TURN initially
  self-hosted coturn only after measured cost justifies operations
```

### 16.1 Environments

Maintain separate:

- local
- staging
- production

Each has distinct Supabase project, VAPID keys, TURN credentials, signing configuration, and Realtime topics. Runner beta builds default to staging and cannot accept production tasks.

### 16.2 CI/CD

GitHub Actions pipelines:

- web: existing Vercel integration plus TypeScript, Jest, and build
- Python workers: lint, unit tests, adapter fixtures, container build, vulnerability scan, deploy
- runner: restore, build, unit/integration tests, package, sign, publish update metadata
- protocol: validate JSON schemas and generate TypeScript/C# models
- migrations: lint and apply to ephemeral/local Supabase before production approval

Never place signing certificates or production secrets in repository files. Use GitHub OIDC and managed signing where available.

## 17. Protocol versioning

Every command, package, and event includes:

- `schemaVersion`
- `runnerVersion`
- `adapterVersion`
- `attemptId`
- `messageId`
- `sentAt`
- optional `correlationId`

Rules:

- additive fields remain backward compatible
- breaking changes increment the schema major version
- backend advertises minimum supported runner version
- runner rejects unknown required fields
- update may be required before leasing new work
- active attempts finish under the protocol version with which they started

Define contracts as JSON Schema and generate TypeScript and C# models in CI.

## 18. Error taxonomy

Use stable codes, not free-form messages:

- `RUNNER_OFFLINE`
- `RUNNER_VERSION_UNSUPPORTED`
- `BROWSER_LAUNCH_FAILED`
- `BROWSER_CRASHED`
- `PAGE_LOAD_TIMEOUT`
- `JOB_CLOSED`
- `ATS_UNSUPPORTED`
- `FORM_SCHEMA_CHANGED`
- `FIELD_REQUIRED_UNKNOWN`
- `FIELD_VALUE_REJECTED`
- `UPLOAD_FAILED`
- `LOGIN_REQUIRED`
- `CAPTCHA_REQUIRED`
- `MFA_REQUIRED`
- `CONSENT_REQUIRED`
- `SUBMIT_REJECTED`
- `SUBMIT_AMBIGUOUS`
- `CONFIRMATION_TIMEOUT`
- `LEASE_LOST`
- `PACKAGE_EXPIRED`
- `NETWORK_OFFLINE`
- `RESOURCE_PRESSURE`

Each code declares whether retry is safe, whether user action is needed, and whether the browser session should remain open.

## 19. Observability

### Backend

Use structured JSON logs with attempt ID, stage, adapter, worker, duration, and error code. Never log answers, resume content, tokens, or field values.

Metrics:

- queue age
- stage duration
- preparation completeness
- runner availability
- lease expiry
- adaptive capacity
- per-ATS fill/submit/verification rates
- intervention and response rates
- ambiguous submissions
- duplicate prevention
- notification delivery

### Runner

- local rolling logs with redaction
- Windows Event Log for service lifecycle
- bounded diagnostic upload after user consent
- crash dumps disabled by default when they might include sensitive memory
- heartbeat carries summarized health, not browsing content

### Tracing

Use `attempt_id` as the cross-system trace identifier. OpenTelemetry can be introduced after the first vertical slice; do not block MVP on a full tracing platform.

## 20. Testing implementation

### 20.1 Local ATS fixture server

Build controlled Greenhouse-, Ashby-, Lever-, Workday-, and generic-style fixtures with:

- delayed dynamic fields
- conditional questions
- file uploads
- multi-page navigation
- validation errors
- challenge placeholder
- confirmation and ambiguous outcomes

Fixtures never submit to real employers.

### 20.2 Runner tests

- scheduler AIMD behavior
- memory/CPU pressure
- service-agent pipe ACL
- DPAPI round trip
- device pairing and revocation
- lease loss
- browser crash and restart
- sleep/wake
- multiple tab isolation
- intervention reconnect and duplicate-input protection
- update rollback

### 20.3 Contract tests

Each deployed backend version runs package and event fixtures against the minimum and latest runner versions.

### 20.4 Production canaries

Enable unattended execution per adapter and per user cohort:

1. internal test accounts
2. explicit beta users
3. small percentage rollout
4. general availability after reliability targets

A remote feature flag can disable one adapter, runner version, or submission action without disabling preparation.

## 21. Efficient delivery plan

### Milestone A: truthful vertical slice

Deliver:

- normalized attempts/events schema
- atomic transition and finalization RPCs
- responsive live timeline
- no runner yet
- current extension writes through the new state model

Purpose: make submission truth correct before adding another executor.

### Milestone B: paired runner skeleton

Deliver:

- .NET solution
- service and user agent
- MSIX development package
- pairing and device tokens
- heartbeat/presence
- durable commands
- phone Auto Apply reaches runner

Purpose: validate security, installation, communication, and wake before browser complexity.

### Milestone C: one ATS end to end

Deliver Greenhouse:

- dedicated Chromium profile
- one tab
- package fetch
- deterministic fill
- upload
- validation
- submit
- confirmation
- verified finalization

Purpose: prove the entire production path with one high-value adapter.

### Milestone D: questions and recovery

Deliver:

- phone question prompt
- Answer Bank write
- same-tab resume
- checkpoints
- browser restart recovery
- lease repair

### Milestone E: adaptive parallel execution

Deliver:

- resource sampler
- weighted scheduler
- ATS semaphores
- additive increase/multiplicative decrease
- five or more controlled fixture applications
- expansion above seven on capable hardware

### Milestone F: phone takeover

Deliver:

- CDP screencast prototype
- WebRTC data channel
- TURN
- mobile canvas and input
- short-lived session security
- controlled challenge fixture

### Milestone G: adapter expansion

Order:

1. Ashby
2. Lever
3. SmartRecruiters
4. Workday
5. iCIMS and Taleo
6. remaining registry adapters

An adapter enters unattended mode only after fixture, failure, and confirmation tests pass.

### Milestone H: production packaging

Deliver:

- code signing
- stable MSIX
- staged updater
- rollback
- privacy and diagnostics controls
- beta rollout

## 22. Build-versus-buy decisions

### Use existing services

- Supabase Auth, DB, Storage, Realtime, Cron
- Vercel for web
- managed TURN initially
- Playwright browser binaries
- Windows MSIX update support

### Build internally

- application state machine
- runner
- ATS adapters
- adaptive scheduler
- browser-surface takeover
- answer policy
- confirmation verification
- device and application protocols

### Defer

- dedicated WebSocket gateway
- native phone apps
- cloud-browser fleet
- unrestricted remote desktop
- macOS runner
- self-hosted TURN
- official ATS integrations without partner access

This minimizes new infrastructure while concentrating engineering on HireRadar-specific behavior.

## 23. Critical prototypes before full implementation

Run these prototypes in order:

1. .NET 10 service launches and supervises a per-user agent after wake.
2. Dedicated Playwright Chromium profile persists ATS cookies across restart.
3. Five fixture tabs complete concurrently without state crossover.
4. Supabase C# Realtime private channel authenticates with device-scoped JWT.
5. Database command remains recoverable after missed broadcast.
6. CDP screencast and input work while display is off.
7. Same behavior while Windows is locked.
8. Phone WebRTC connects directly and through TURN.
9. MSIX installs service, agent, scheduled task, and update cleanly.
10. Verified finalization remains idempotent during repeated acknowledgments.

A failed prototype changes the design before large implementation begins.

## 24. Known risks and mitigations

### Locked-session rendering

Risk: browser rendering or interaction may degrade when Windows locks.

Mitigation: prototype first; keep browser in user session; use CDP page rendering; provide a clear local policy requirement if Windows prevents reliable operation.

### ATS schema changes

Risk: forms change without notice.

Mitigation: version adapters, fixture snapshots, canaries, remote disable flags, schema-change error code, no guessed submissions.

### Shared browser failure

Risk: one browser crash affects tabs.

Mitigation: checkpoints, process supervision, controlled restart, ambiguity checks before resubmission.

### Device-token theft

Risk: stolen local token impersonates a runner.

Mitigation: device key challenge, DPAPI, short-lived JWTs, revocation, signed packages, no service key.

### Duplicate submission

Risk: retries after uncertain response submit twice.

Mitigation: immutable attempt, lease, state CAS, confirmation checks, adapter-specific safe retry policy, no automatic retry after `SUBMIT_AMBIGUOUS`.

### Intervention privacy

Risk: remote screen exposes unrelated content.

Mitigation: stream the specific Playwright page only, never the desktop; disable other capabilities; no recording.

### Operational complexity

Risk: too many new services slow development.

Mitigation: reuse Supabase Realtime; one worker image; one Windows codebase; managed TURN; one ATS vertical slice before expansion.

## 25. Engineering acceptance criteria

The first production-capable release must demonstrate:

- phone Auto Apply creates one durable attempt
- paired sleeping laptop wakes and claims it
- runner uses no backend secret keys
- browser profile survives restart
- at least five fixture applications execute concurrently
- scheduler increases above seven on capable hardware and backs off under pressure
- user can answer a missing question from a phone
- answer resumes the same browser tab
- user can control the exact browser page from a phone through TURN
- unrelated tabs continue during intervention
- a submit click without confirmation does not count
- a verified confirmation updates all application surfaces exactly once
- reboot, network loss, missed broadcasts, and repeated callbacks do not duplicate submission
- device revocation prevents new work
- logs and diagnostics contain no resume text, answers, credentials, or tokens

## 26. Research basis

- .NET support policy: https://dotnet.microsoft.com/en-us/platform/support/policy
- .NET Windows Service: https://learn.microsoft.com/en-us/dotnet/core/extensions/windows-service
- Windows execution state: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate
- Playwright .NET persistent context: https://playwright.dev/dotnet/docs/api/class-browsertype
- Playwright browser support: https://playwright.dev/dotnet/docs/browsers
- Chrome remote-debugging profile change: https://developer.chrome.com/blog/remote-debugging-port
- Playwright extension limitation: https://playwright.dev/docs/next/chrome-extensions
- Supabase Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Supabase Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Supabase Presence: https://supabase.com/docs/guides/realtime/presence
- Supabase C# SDK: https://github.com/supabase/supabase-csharp
- Supabase Queues: https://supabase.com/docs/guides/queues
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Vercel Function limits: https://vercel.com/docs/functions/limitations
- Windows DPAPI: https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata
- MSIX auto-update: https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview
- Windows code signing: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
- WebRTC TURN: https://webrtc.org/getting-started/turn-server
- Chrome DevTools input: https://chromedevtools.github.io/devtools-protocol/1-3/Input/
- SIPSorcery WebRTC: https://github.com/sipsorcery-org/sipsorcery

## 27. Immediate next work

Implementation begins with Milestone A and the first five prototypes. Do not begin with the installer UI, broad ATS coverage, or remote takeover. Submission truth, device identity, durable commands, and one complete Greenhouse path form the critical dependency chain for everything else.
