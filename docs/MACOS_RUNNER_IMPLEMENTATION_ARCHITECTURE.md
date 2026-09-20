# macOS Runner Implementation Architecture

> **Architecture decision:** This desktop-runner design is retained as research, but it is not the selected implementation. The selected architecture is [Browser-First Auto-Apply Architecture](./BROWSER_FIRST_AUTOAPPLY_ARCHITECTURE.md), using cloud browser workers plus an optional attended extension.

Status: First-release engineering design

Last updated: 2026-09-18

Parent design: [Auto-Apply Implementation Architecture](./AUTOAPPLY_IMPLEMENTATION_ARCHITECTURE.md)

## 1. Scope and release rule

macOS and Windows are simultaneous first-release targets. The macOS runner is not a later port. It uses the same application protocol, state machine, Playwright browser controllers, adapter behavior, retry policy, confirmation rules, intervention transport, and acceptance fixtures as Windows.

Only operating-system integration differs. Platform-specific code is restricted to lifecycle, secure storage, IPC, power management, resource measurement, installation, updates, notifications, and tray or menu-bar UI.

The supported baseline is macOS 13 Ventura or later because `SMAppService` provides the current Apple-supported registration and authorization model for bundled LaunchAgents and LaunchDaemons. Ship universal support for:

- `osx-arm64` on Apple Silicon
- `osx-x64` on Intel
- one installer that selects the matching self-contained payload

A runner feature cannot be marked complete when it works on only one desktop platform.

## 2. Shared and native boundaries

### 2.1 Shared .NET projects

These projects compile unchanged for Windows and macOS:

```text
HireRadar.Runner.Contracts
HireRadar.Runner.Core
HireRadar.Runner.Browser
HireRadar.Runner.Intervention
HireRadar.Runner.Protocol
```

They own:

- device and backend protocol models
- application attempt state machine
- durable command reconciliation
- adaptive scheduler
- Playwright persistent contexts and page controllers
- ATS adapters and confirmation evidence
- checkpoint and retry logic
- resource-policy decisions based on normalized samples
- WebRTC intervention session state
- structured logging and redaction

No shared project calls DPAPI, Keychain, Task Scheduler, IOKit, Windows Services, `launchd`, named pipes, or XPC directly.

### 2.2 Platform interfaces

`HireRadar.Runner.Platform` defines:

```csharp
public interface IDeviceSecretStore { /* create, sign, read, delete */ }
public interface IMachineBroker { /* wake schedule, update, agent health */ }
public interface IPowerCoordinator { /* hold, release, schedule, observe */ }
public interface IResourceSampler { /* CPU, memory, thermal, battery */ }
public interface IUserSession { /* locked, active, display state */ }
public interface IPlatformPaths { /* data, cache, logs, browser */ }
public interface IUpdateCoordinator { /* check, stage, activate, rollback */ }
public interface ILocalNotification { /* status and intervention alerts */ }
```

Platform implementations expose normalized values and typed failures. Shared code never branches on `OperatingSystem.IsMacOS()` outside composition startup.

### 2.3 Native Swift host

Use a small Swift app for APIs that are safest and most maintainable through Apple frameworks:

- `SMAppService` registration and status
- menu-bar UI and onboarding
- Keychain Services
- XPC listener and code-signing validation
- IOKit wake scheduling and power assertions
- `NSWorkspace` sleep and wake notifications
- update installation authorization
- macOS permission state and System Settings links

The Swift layer is a platform host, not a second implementation of auto-apply. It starts and supervises the self-contained .NET user agent and exchanges versioned protobuf messages through XPC.

## 3. Process architecture

### 3.1 Application bundle

```text
HireRadar.app/
  Contents/
    MacOS/
      HireRadar.MenuBar
      HireRadar.Runner.Agent
    Frameworks/
      shared self-contained .NET payload
    Resources/
      playwright/
      protocol/
    Library/
      LaunchAgents/com.hireradar.runner.agent.plist
      LaunchDaemons/com.hireradar.runner.daemon.plist
    Helpers/
      HireRadar.Runner.Daemon
      HireRadar.Updater
```

Every executable and nested bundle is signed before the outer app and installer are signed. CI verifies designated requirements recursively.

### 3.2 Privileged LaunchDaemon

`HireRadar.Runner.Daemon` is registered with `SMAppService.daemon(plistName:)` and requires explicit macOS authorization. It runs on demand as root and owns only machine-level operations:

- persistently schedule and cancel wake events
- inspect paired user-agent liveness without entering the user session
- stage and atomically activate signed updates
- maintain installation health
- expose a narrow XPC service
- write redacted lifecycle events to Unified Logging

It must not:

- access the browser profile
- hold Supabase user or device tokens
- read resumes or application answers
- connect to ATS sites
- synthesize UI input
- start a GUI process in the wrong login session

The daemon exits when idle where possible. `launchd` restarts it on demand.

### 3.3 Per-user LaunchAgent

`HireRadar.Runner.Agent` runs in the paired user's Aqua login session. It owns:

- device authentication and Supabase Realtime
- durable command reconciliation
- Playwright and the dedicated Chromium profile
- application pages and adaptive scheduling
- encrypted local checkpoints and temporary documents
- page-only intervention streaming
- user-session and browser health

Register it using `SMAppService.agent(plistName:)`. It starts at login, reconnects after wake and network changes, and can be stopped from the menu-bar app. The agent never runs as root.

### 3.4 Menu-bar app

The native menu-bar app provides:

- pairing and sign-out
- runner online, paused, applying, and intervention status
- concurrency and battery policy
- start-at-login and background-item authorization status
- browser profile reset
- diagnostics export with preview and redaction
- update status
- Pause, Stop Current Application, and Emergency Stop
- links to relevant System Settings panes

Closing its window does not stop the LaunchAgent. Choosing Quit pauses new work and explains whether active attempts will finish or checkpoint.

## 4. IPC and process authentication

Use NSXPC between the LaunchDaemon, Swift menu-bar app, and a native XPC bridge hosted beside the .NET agent. Define the protocol in protobuf and generate Swift and C# types from the same schema.

Every connection validates:

- Apple code signature
- Team ID
- bundle identifier or designated requirement
- protocol major version
- expected user audit token for user-scoped calls
- monotonic request ID and bounded payload size

The daemon permits only:

- `ScheduleWake`
- `CancelWake`
- `GetWakeState`
- `GetInstallState`
- `StageSignedUpdate`
- `ActivateUpdate`
- `GetAgentHealth`

It rejects arbitrary paths, shell commands, URLs, environment variables, and executable arguments. Update requests refer to a staged artifact ID whose manifest and signature the daemon validates independently.

No application field data crosses into the privileged daemon.

## 5. Device identity and Keychain

Generate the ECDSA P-256 private key through Security.framework and store it as a non-exportable Keychain key when supported. Store refresh material as a `kSecClassGenericPassword` item.

Keychain policy:

- service: `com.hireradar.runner.device`
- account: paired device UUID
- access group restricted to signed HireRadar components that require it
- `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` for unattended operation after reboot and first user unlock
- no iCloud synchronization
- no plaintext backup or diagnostics export
- delete credentials on unpair

The agent asks the Swift bridge to sign backend nonces. The raw private key never enters managed memory. Short-lived runner JWTs remain in memory unless a narrowly documented recovery need requires persistence.

This mirrors Windows device proof while substituting Keychain for DPAPI.

## 6. Browser execution on macOS

Use Playwright .NET and its pinned bundled Chromium build. Do not automate the user's normal Safari, Chrome, Edge, or Firefox profile.

```text
~/Library/Application Support/HireRadar/
  browser/chromium-profile/
  state/
  jobs/<attempt-id>/
  logs/
~/Library/Caches/HireRadar/
  playwright/
  downloads/
```

The profile belongs to the paired macOS user and uses POSIX mode `0700`. Temporary documents use randomized names and are removed after confirmation, terminal failure, or retention expiry.

Run a headed Chromium process in the user's Aqua session. A headed browser is required even when the display is off because forms, challenges, and rendering can differ in headless mode. The agent controls the dedicated context directly and streams only the selected page during intervention.

The same adapter artifact and fixture suite must produce the same field plan on Windows and macOS. Selectors, confirmation evidence, and answer policy cannot be forked by platform without an explicit compatibility record.

### 6.1 Lock and display behavior

Prototype these states separately:

- display off, user session unlocked
- screen locked with user still logged in
- fast user switching
- FileVault login screen after reboot
- clamshell mode with external power and display
- laptop lid closed without supported clamshell conditions

Do not assume browser rendering continues while locked until target macOS versions and hardware classes pass fixtures. If a state pauses rendering, the attempt checkpoints and the phone receives `DEVICE_INTERACTION_UNAVAILABLE`. The system does not start a hidden root browser or bypass the login window.

## 7. Power and wake

### 7.1 Active work assertion

While applications or interventions are active, the user agent asks the native bridge to create an IOKit assertion that prevents idle system sleep. Use a reason containing only a generic HireRadar operation ID. Release it in `finally`, cancellation, crash recovery, and shutdown paths.

The display may sleep. Requesting display wake is reserved for a measured browser compatibility need and is visible in settings.

### 7.2 Scheduled wake

The LaunchDaemon calls `IOPMSchedulePowerEvent` with `kIOPMAutoWake` or `kIOPMAutoWakeOrPowerOn`. Apple documents this API as persistent and root-only, which is why wake scheduling belongs in the privileged daemon.

Rules:

- schedule only the next bounded application window
- use the HireRadar bundle identifier as event owner
- cancel obsolete events when settings, pairing, or queue state changes
- reconcile scheduled events after update and boot
- apply short randomized jitter before fetching work
- never wake outside user-approved hours

The agent observes `NSWorkspaceDidWakeNotification`, waits for network reachability, refreshes its short-lived token, reconciles durable commands, then reports ready.

### 7.3 Shutdown and FileVault boundary

A sleeping Mac can be scheduled to wake. A manually powered-off Mac and a FileVault pre-login state cannot provide the user Keychain, Aqua session, or browser profile. Unattended work is available only when:

- the Mac is sleeping or awake
- the user has logged in once after boot
- background items remain authorized
- power policy and hardware allow wake

The UI reports `needs_first_unlock`, `background_item_disabled`, `wake_not_authorized`, or `offline` instead of claiming the runner is available.

### 7.4 Battery policy

Use IOKit power-source information and `ProcessInfo.thermalState`:

- plugged in: normal adaptive ceiling
- battery above configured threshold: reduced ceiling
- low battery: stop leasing and checkpoint active attempts
- serious thermal pressure: multiplicative backoff
- critical thermal pressure: pause new work and checkpoint safely

Never silently modify the user's sleep or lid-close preferences.

## 8. Resource sampling and adaptive concurrency

The macOS sampler reports:

- process and system CPU utilization
- available and pressure memory
- battery percentage and charging state
- `ProcessInfo.thermalState`
- browser process count and aggregate resident memory
- event-loop and page-action latency
- network reachability and round-trip time

Map native values into the shared `ResourceSample`. The shared AIMD scheduler makes the same decision on both platforms. Platform samplers provide evidence; they do not independently choose concurrency.

Initial safety ceilings:

- 8 GB memory: maximum 5 pages
- 16 GB memory: maximum 10 pages
- 24 GB or more: maximum 20 pages
- battery mode: configurable cap, default 3

These are ceilings, not starting concurrency. Start at three pages and increase only after healthy intervals. ATS-specific semaphores remain independent.

## 9. Phone intervention

The macOS agent uses the same page-only CDP screencast and WebRTC data-channel design as Windows:

- Supabase private Realtime for signaling
- ephemeral TURN credentials
- SIPSorcery in the shared .NET agent
- native browser WebRTC on the phone
- CDP input directed to the exact Playwright page

macOS Screen Recording permission is unnecessary because the runner captures its own Chromium page through CDP, not the desktop or another application. Accessibility permission is unnecessary because input goes through Playwright/CDP inside the owned browser process.

Desktop capture, global keyboard injection, Apple Events to other apps, or control of a normal browser are outside this architecture and would require a separate permission and security design.

## 10. Permissions and onboarding

The first-run flow:

1. Install the signed package.
2. Launch HireRadar.
3. Pair the device.
4. Register the LaunchDaemon and LaunchAgent with `SMAppService`.
5. Ask the user to approve background items in System Settings if status is `requiresApproval`.
6. Verify wake scheduling through a short test event.
7. Download or validate the Playwright browser payload.
8. Run a local fixture application without external submission.
9. Show Ready only after every check passes.

Do not request Accessibility, Screen Recording, Full Disk Access, Contacts, or Automation permission for the designed feature set.

The status page exposes:

- daemon registered and approved
- agent registered and running
- device key available
- backend authenticated
- browser installed and launchable
- wake event scheduled and verified
- current power constraints
- current version and update channel

## 11. Signing, notarization, and entitlements

Distribute outside the Mac App Store because the runner includes a privileged daemon, persistent user agent, bundled browser automation, and self-updating components.

Release pipeline:

1. build arm64 and x64 self-contained .NET payloads
2. build Swift targets with the release Xcode toolchain
3. assemble the app bundle and helper layout
4. sign nested libraries and executables with Developer ID Application
5. enable hardened runtime and secure timestamp
6. verify entitlements and designated requirements
7. sign the installer with Developer ID Installer
8. submit with `notarytool`
9. inspect the notarization log
10. staple tickets to app and package
11. run `spctl` and `codesign --verify --deep --strict` on clean machines
12. publish immutable artifacts and signed update metadata

Keep entitlements minimal. Do not include `get-task-allow` in release builds. Hardened runtime is mandatory for notarization.

Build and signing keys are isolated from general CI. Notarization uses an App Store Connect API key with minimum access. Update manifests use a separately protected signing key.

## 12. Installation, updates, and rollback

The `.pkg` installs `/Applications/HireRadar.app` and registers helpers through the app on first run. It does not scatter mutable executables across user directories.

Update sequence:

1. backend announces a compatible version and rollout ring
2. agent downloads to a randomized staging directory
3. updater validates manifest signature, SHA-256, Apple signature, Team ID, bundle ID, version monotonicity, and protocol range
4. agent checkpoints active work and stops accepting leases
5. daemon atomically replaces the application bundle
6. helpers re-register if required
7. new version runs a health handshake
8. failed health restores the previous signed bundle
9. agent reconciles durable commands before resuming

Never update during an ambiguous submission window. Keep one previous version locally. Do not roll back to a cryptographically revoked or protocol-incompatible build.

## 13. Local data protection and privacy

Use Keychain for small secrets and application-support files for operational state. Encrypt sensitive packages and checkpoints with an AES-GCM key stored in Keychain. Browser cookies remain in the dedicated profile, protected by macOS account access and FileVault when enabled.

Rules:

- directories use `0700`
- files use `0600`
- no secrets in plist files, command lines, crash annotations, or Unified Logging
- documents are removed after terminal state by default
- crash recovery retains only the minimum encrypted checkpoint
- diagnostics require user action, redact values, and show a preview
- uninstall offers device revocation and local profile deletion

The root daemon owns no user-content directory and cannot decrypt job packages.

## 14. Logging and diagnostics

Use `Logger` for native lifecycle events and Serilog JSON files for the .NET agent. Apply the same event names and correlation IDs used on Windows.

Record:

- version, architecture, macOS version, and capability class
- helper authorization and lifecycle
- wake schedule and wake result
- attempt transition names and durations
- adapter and normalized error code
- bounded resource samples
- update validation and rollback result

Never record answers, resume text, cookies, tokens, rendered page content, CAPTCHA content, or raw fields.

## 15. Failure taxonomy

Add these normalized errors:

```text
MAC_BACKGROUND_ITEM_REQUIRES_APPROVAL
MAC_BACKGROUND_ITEM_DISABLED
MAC_DAEMON_UNAVAILABLE
MAC_XPC_AUTH_FAILED
MAC_KEYCHAIN_LOCKED
MAC_FIRST_UNLOCK_REQUIRED
MAC_WAKE_SCHEDULE_FAILED
MAC_WAKE_EVENT_MISSED
MAC_USER_SESSION_UNAVAILABLE
MAC_BROWSER_RENDER_SUSPENDED
MAC_UPDATE_SIGNATURE_INVALID
MAC_NOTARIZATION_INVALID
MAC_UNSUPPORTED_OS
MAC_UNSUPPORTED_ARCHITECTURE
```

Each maps to a safe user action, retry class, internal diagnostic details, and whether another paired device may take the lease.

## 16. Testing matrix

### 16.1 Hardware and OS

Test at minimum:

- latest macOS on Apple Silicon
- previous two supported major versions on Apple Silicon
- macOS 13 and latest supported macOS on Intel
- 8 GB, 16 GB, and 24 GB or higher memory classes
- laptop battery and AC power
- desktop Mac

Use real hardware for sleep, wake, thermal, lock, FileVault, and rendering gates. VMs cover installation, protocol, update, and browser fixtures but cannot certify hardware wake behavior.

### 16.2 Required suites

- universal package installation and uninstall
- Gatekeeper and notarization on a clean machine
- background-item approval, denial, disable, and re-enable
- Keychain create, sign, restart, lock, first-unlock, and deletion
- XPC code-signature rejection with an unsigned client
- sleep, scheduled wake, missed wake, display off, lock, and logout
- network loss and change after wake
- Apple Silicon and Intel Playwright launch
- five concurrent fixtures with state isolation
- adaptive expansion and thermal or memory backoff
- page-only phone intervention through direct ICE and TURN
- update, interrupted update, health failure, and rollback
- reboot and durable command recovery
- duplicate callback and ambiguous-submission protection

### 16.3 Cross-platform parity suite

Run the same protocol and ATS fixtures against Windows and macOS. Compare normalized event sequences, final states, selected fields, confirmation evidence, and error classes. Timing may differ; semantic outcomes may not.

CI blocks release if either platform fails a parity fixture. General availability requires both signed installers to pass clean-machine smoke tests.

## 17. Delivery plan with Windows parity

Every runner milestone has paired deliverables.

### Platform foundation

- shared .NET solution and platform interfaces
- Windows Service and Agent host
- macOS Swift app, LaunchDaemon, LaunchAgent, and XPC bridge
- MSIX development installer
- signed development `.pkg`
- DPAPI and Keychain device proof
- Task Scheduler and IOKit wake prototypes

### Greenhouse vertical slice

- one shared Playwright controller and adapter
- dedicated profile on both platforms
- submit confirmation and idempotent finalization on both
- identical application timeline events

### Recovery and intervention

- restart and checkpoint recovery on both
- phone question flow on both
- page-only takeover on both
- lock and display-off evidence captured independently

### Adaptive execution

- Windows and macOS resource samplers
- common AIMD scheduler
- parity under five or more fixture applications
- platform ceilings validated on low-resource hardware

### Production packaging

- signed MSIX and update feed
- Developer ID-signed, hardened, notarized `.pkg` and signed update feed
- rollback on both platforms
- one coordinated beta and GA gate

Platform work proceeds in parallel while adapter work remains shared.

## 18. macOS release acceptance criteria

macOS is ready only when:

1. A fresh signed and notarized installer passes Gatekeeper without bypass.
2. Background components use normal System Settings approval.
3. No unnecessary privacy permission is requested.
4. Pairing creates a Keychain-backed device identity.
5. The daemon schedules and reconciles a wake event.
6. The agent reconnects and claims durable work after wake.
7. The browser profile survives agent and machine restart after first unlock.
8. A Greenhouse fixture reaches verified submission without platform-specific adapter code.
9. Five fixtures run concurrently without state crossover.
10. Scheduling backs off under memory, battery, and thermal pressure.
11. Phone answers and page-only takeover resume the exact tab.
12. Lock and display-off behavior is measured and reported honestly.
13. Device revocation prevents new tokens and work.
14. Updates validate signatures and roll back after failed health.
15. Uninstall removes helpers and offers revocation and profile deletion.
16. Windows and macOS parity fixtures produce equivalent outcomes.

## 19. Research basis

- Apple `SMAppService`: https://developer.apple.com/documentation/servicemanagement/smappservice
- Apple background-process guidance: https://developer.apple.com/documentation/appkit/managing-ongoing-background-processes-in-your-mac
- Apple helper update guidance: https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos
- Apple launchd agents and daemons: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
- Apple daemon boundaries: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- Apple Keychain secret storage: https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets
- Apple scheduled wake API: https://developer.apple.com/documentation/iokit/1557076-iopmschedulepowerevent
- Apple IOPMLib: https://developer.apple.com/documentation/iokit/iopmlib_h
- Apple wake notification: https://developer.apple.com/documentation/appkit/nsworkspace/didwakenotification
- Apple notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple distribution preparation: https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution
- Playwright .NET browser management: https://playwright.dev/dotnet/docs/browsers
- .NET OS lifecycle policy: https://github.com/dotnet/core/blob/main/os-lifecycle-policy.md

## 20. Immediate implementation sequence

Create the shared platform interfaces and protobuf IPC contract first. In parallel, prototype four macOS risks before product UI: `SMAppService` authorization, root wake scheduling, Keychain-backed signing, and headed Playwright rendering across display-off and locked states. These results determine availability reporting without forking the shared browser or application architecture.
