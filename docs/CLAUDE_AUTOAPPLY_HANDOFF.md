# Claude Handoff: HireRadar / NewGrad Radar

Updated: 2026-09-26 (America/Los_Angeles)

## Start here

Repository: `C:\Users\ameko\Downloads\newgrad-radar-clean\newgrad-radar-clean`
Remote: `https://github.com/AbrahamMekonnen/newgrad-radar.git`
Branch: `main`
Current HEAD when this handoff was written: `7a7ec42fa9dab8e5c90d3dc5b7c000b65995fc00`
Current extension version: `0.16.4`

Read these first:

- `docs/AUTOAPPLY_FAILURE_AUDIT.md`
- `docs/BROWSER_FIRST_AUTOAPPLY_ARCHITECTURE.md`
- this file

Do not print, commit, or paste `.env.local` values. API keys and a Supabase service-role token were previously pasted into chat and should be rotated by the owner. Use only local environment variables and GitHub/Vercel secrets.

## Product goal

HireRadar discovers jobs, prepares truthful applications from the user's profile/resume/answer bank, and automatically submits user-authorized applications. Authorization comes from either a direct Auto Apply click or a standing watchlist rule. The backend does preparation; a paired browser extension performs the final ATS interaction from the user's normal browser session. Submission is counted only after positive ATS confirmation and an idempotent submission receipt.

The user wants quality and completeness. Deterministic facts such as authorization, sponsorship, education, demographics preferences, legal acknowledgements, salary, and source should not consume Gemini tokens. AI should be reserved for grounded prose answers and must never invent user facts. Unknown factual or sensitive questions must be requested from the user and then saved for reuse.

## Current architecture

- Next.js application and APIs under `src/`.
- Supabase queue and migrations under `supabase/migrations/`.
- Browser extension under `extension/`.
- Python preparation/scraping under `scraper/`.
- Durable queue: `autoapply_job_queue`.
- Paired browser table: `autoapply_browser_devices`.
- Sanitized field telemetry: `autoapply_field_events`.
- Confirmed/idempotent submissions: `autoapply_submission_receipts`.
- Browser claims only `direct_click` or `standing_rule` jobs using the `user_browser` execution channel.
- Extension supports an adaptive batch capped at eight tabs in the current implementation.

## Main historical failures

1. Server-prepared fields were incorrectly treated as the full live schema. Compliance, demographic, conditional, late-rendered, wrapper, and portal controls were missed.
2. The extension stopped at the first unresolved question, so later controls were never attempted.
3. React rerenders and unstable field identities caused the same controls to be retried repeatedly.
4. Loose option matching sent values absent from dropdowns, such as a full degree name where only degree levels existed.
5. React Select search text was mistaken for a retained selection.
6. Optional EEO/marketing/location controls were sometimes counted as required because a broad ancestor contained a required marker.
7. Upload waits serialized the whole process, preventing unrelated fields from being filled.
8. A submit click was confused with a confirmed submission. Analytics and counts became inflated.
9. ATS success pages sometimes appeared while HireRadar failed to record the receipt.
10. Wrapper career pages (Roblox, Waymo, MongoDB, Samsara) hid or proxied canonical Greenhouse forms.
11. CAPTCHA was assumed too broadly. Some forms manually submitted without presenting CAPTCHA.
12. Opening a prepared application did not transfer values into the ATS, forcing the user to refill it.
13. Missing profile facts and weak profile collection prevented strong AI prose and deterministic answers.
14. Old extension reloads left content scripts orphaned, jobs leased, and test results ambiguous.

Observed examples:

- Accenture: Degree and Hispanic/Latino oscillated; degree repeatedly selected the wrong/nonexistent option.
- MongoDB: demographic controls and consent stayed empty; placeholder LinkedIn; preferred name mapping errors.
- Palantir: high-school fields and custom prose/policy questions unresolved.
- Twilio: demographic controls and consent unresolved.
- Lever/Lab49: work authorization, sponsorship, office presence, salary, and location issues.
- Ashby: upload-processing stalls and ATS success not recorded.
- Roblox: school, degree, availability, GPA, language, demographics, phone country, and optional location/organization controls were reported unresolved.
- Workday: invalid/unavailable posting behavior and multistep flow limitations.

## Major implementation changes already made

See Git history from `7f0f579` through `1e38c64`. Key commits:

- `7f0f579` validates fill plans against live forms.
- `e14d4c2` stops terminal retry loops.
- `365968f` waits through ATS transitions.
- `1ac4d20` runs an eight-application canary batch.
- `29cdd63` improves Ashby discovery and optional EEO fills.
- `4265996` fixes Lever education and checkbox groups.
- `1dbb69c` rebuilds live form preflight, stable identities, required-state handling, invalid-set validation, Greenhouse demographics, and profile URL validation.
- `c6edd02` handles wrapper transitions, closed jobs, sole acknowledgements, and AI-notetaker defaults.
- `3d841e9` routes known `gh_jid` wrappers to canonical Greenhouse embed URLs.
- `9f7b7ca` removes uncancelled field-operation races, respects explicit optional state, supports bare School labels, multi-value coding-language preferences, and job-title term availability.
- `1e38c64` releases leases on extension upgrades and records extension versions in progress telemetry.

Other concurrent onboarding/mobile commits exist after/between these; do not revert them.

### Important fix in 0.16.3

`extension/content.js` previously did this in two places:

```js
Promise.race([fill(field), wait(6000).then(...)])
```

The timeout did not cancel `fill()`. The abandoned operation continued clicking while the next field started, creating cross-field oscillation and corrupted selections. Those races were removed. DOM interactions are now sequential and each fill function is internally bounded.

### Required-state fix

An explicit `aria-required="false"` or `data-required="false"` is authoritative. A broad ancestor's marker must not promote that control to required. This should prevent optional Roblox Location and campus-organization controls from becoming blockers.

### Resolver fixes

- Bare `School`, `University`, `College`, and `Institution` labels use `education_school`.
- Degree uses semantic degree-level option matching.
- Saved language strings are split into preferences and matched only to offered options.
- Aliases include `pyton/python -> Python 3`, `js -> Javascript`, `ts -> Typescript`, `cpp -> C++`, and `csharp -> C#`.
- The saved Roblox value is currently `java, pyton`; offered options should select Java first.
- A role title such as `[Summer 2027] Software Engineer Intern` may supply `Summer 2027` only when that exact term exists among availability options.
- GPA remains unresolved because the profile GPA is null. Never invent it.
- EEO defaults try the available decline/prefer-not-to-answer option unless the user saved an explicit preference.

## Exact current Roblox regression state

Queue row:

- queue ID: `88902fb6-759b-47ad-8cad-e18363bbd993`
- job: `[Summer 2027] Software Engineer Intern`
- company: Roblox
- ATS: Greenhouse
- canonical URL: `https://job-boards.greenhouse.io/embed/job_app?for=roblox&token=8072713`
- status at last check: `waiting_for_browser`
- priority was deliberately changed to `1` so it is the next eligible regression test.
- authorization source: `direct_click`
- execution channel: `user_browser`

Confirmed profile facts relevant to the form:

- school: Eastern Mennonite University
- degree: Bachelor of Science in Computer Science
- major: Computer Science
- graduation: July 2026
- GPA: missing/null
- location: San Francisco, CA
- country: United States
- coding-language saved fact: `java, pyton`
- authorization and sponsorship already resolve correctly.

The old Roblox preflight (before 0.16.3) detected 12 controls: phone country, optional city, school, degree, availability, GPA, coding language, optional campus organizations, and four demographics. It stalled with an expired lease. That old result must not be used to judge 0.16.3/0.16.4.

The user said they loaded 0.16.3 and saw similar issues, but Supabase proved the internship was not rerun under that version. Its last progress was from the older September 26 run. Reloading the extension had deleted tab records before releasing leases, leaving jobs blocked for ten minutes. Version 0.16.4 fixes this by reporting each managed prior-version job as failed/retryable before clearing tab records. Every new progress payload now contains `extensionVersion`.

## Immediate next action

1. User reloads the unpacked extension and confirms version `0.16.4`.
2. The prioritized Roblox internship should be claimed next.
3. Query the queue row and `autoapply_field_events` after the run.
4. Verify `browser_progress.extensionVersion === "0.16.4"` before interpreting the result.
5. Analyze all unresolved controls in that single run. Do not patch only the first one.
6. Expected truthful result: everything resolvable should fill; GPA may remain the only factual blocker.
7. If school/degree/demographic React Select controls still fail, inspect retained selection UI (`.select__single-value` or equivalent), options exposed through `[role=option]`, and `aria-controls`. Do not treat input search text as a selection.

## How to query diagnostics safely

Use `.env.local` locally without printing its values. Query Supabase REST or the existing client. Node 20 currently fails with the installed newer Supabase client because native WebSocket is unavailable, so a small Python `urllib` REST script worked. Select only sanitized columns.

Useful fields:

```text
autoapply_job_queue:
  id, job_title, company_name, ats_type, status,
  browser_stage, browser_progress, priority, updated_at

autoapply_field_events:
  event_code, field_key, control_type, answer_source,
  failure_category, retained, attempt, option_count, created_at
```

Never print `prepared_data`, profile values, device tokens, service keys, or resume URLs in logs/chat.

## Areas still incomplete

- A clean 0.16.4 Roblox run has not yet happened.
- Greenhouse React Select interaction needs live verification after race removal.
- Full control-outcome telemetry is still limited; `field_filling` often records an attempt but not a final retained result. Improve this so every discovered control has a terminal outcome.
- Extension progress should include a run/attempt ID in addition to version, allowing events from repeated runs on one queue row to be separated reliably.
- Uploads should become independent dependencies rather than blocking unrelated work.
- Workday and SmartRecruiters need explicit multistep state machines.
- Submission receipt reconciliation needs continued testing, especially Ashby success-page cases.
- The user-profile/answer-bank collection flow needs more complete reusable facts and better learning from user-provided missing answers.
- Salary should come from role/company/location market evidence or saved user constraints; never use an arbitrary number.
- Email, Netlify/push job notifications, notified-job views, analytics funnel consistency, and Answer Bank loading were raised earlier and may still need separate verification. Keep them separate from the current ATS engine regression work.
- Telegram and scraper timeout/source-yield work was previously discussed; it is separate from the browser auto-apply work.

## Correct engineering approach

- Treat the browser-rendered form as authoritative.
- Discover the complete form before deciding readiness.
- Classify using label, section, control type, options, and neighboring fields.
- Resolve every deterministic field in one planning pass.
- Use AI only for grounded prose.
- Apply independent controls even if one answer is missing.
- Keep interactive widget operations sequential unless real cancellation exists.
- Verify retained state after every interaction.
- Retry a control at most once with a materially different strategy.
- Rescan only after an actual schema signature change.
- Collect the entire invalid set, not only the first error.
- Count a submission only from positive ATS evidence plus an idempotent receipt.
- Never bypass CAPTCHA, MFA, anti-bot controls, or employer security mechanisms.

## Tests and commands

From the repository root:

```powershell
node --check extension/background.js
node --check extension/content.js
npx tsc --noEmit
npm test -- --runInBand
python -X utf8 -m unittest scraper.autoapply.test_regressions
git diff --check
```

Latest validated result:

- Jest: 12 suites, 202 tests passed.
- Python auto-apply regressions: 16 passed.
- TypeScript and JavaScript syntax checks passed.

## Working-tree warning

At handoff time these unrelated local files were modified and intentionally not staged:

```text
M scraper/.h1b_cache/sponsors.json
D scraper/.orchestrator_state.json
M scraper/interview_scraper.log
M scraper/utils/scraper_infra.py
```

Do not discard, reset, stage, or commit them without first determining whether another agent/process owns them. Stage only exact files for the current change. Concurrent work also added onboarding/mobile commits; always inspect `git status` and recent history before committing.

## User expectations

The user is frustrated by many rounds that fix one field at a time. For each test, collect the full form and all errors, explain the shared cause, implement a general fix, run the full test suite, push, and only then request one extension reload. Avoid asking the user to reload repeatedly for partial changes. The user has explicitly authorized pushing code to the repository and testing the auto-apply queue. Do not expose secrets or submit unverified/invented answers.
