# Auto-Apply Failure Audit and Replacement Plan

## Purpose

This audit treats the repeated Greenhouse, Lever, Ashby, Workday, and SmartRecruiters failures as failures of the shared form engine. Per-company selector patches are allowed only after a shared invariant has been tested and cannot represent the ATS behavior.

## Evidence reviewed

The audit uses the recorded Accenture, MongoDB, Palantir, Twilio, Lab49, Supabase, Roblox, IonQ, Samsara, and Ashby runs; the queue progress events; the browser extension execution path; server preparation and resolution; profile validation; and official form and browser specifications.

The strongest repeated evidence is:

- Accenture repeatedly alternated between Degree and Hispanic/Latino and retried unchanged values.
- Palantir populated High School Name with the candidate name, left graduation year and policy questions unresolved, and reported only the final visible blockers.
- Twilio left five demographic selects and demographic consent unresolved.
- MongoDB left six demographic selects and consent unresolved, used a placeholder LinkedIn URL, and put the full legal name in Preferred Name.
- Ashby sometimes accepted the application while receipt recording reported failure.
- Resume upload processing blocked the entire transaction even when unrelated fields could have been resolved.
- A missing answer stopped later questions from being attempted.
- Prepared percentages reached 100 percent while the live form still contained blockers.

## Root-cause matrix

### 1. Incomplete schema discovery

**Failure:** Server preparation often excludes compliance, demographic, conditional, portal-rendered, or late-rendered controls.

**Cause:** Preparation was treated as the form schema. Greenhouse exposes normal questions, location questions, compliance questions, Inclusion demographic questions, and data compliance as separate structures. Lever public postings do not expose every hosted-form detail. React ATSes can create controls after earlier answers.

**Replacement:** The browser collects the rendered form before filling. Server data is a hint and answer cache. The browser rescans only after a real schema change.

**Acceptance:** A MongoDB fixture discovers all six demographic controls and consent before submission. A conditional-field fixture reaches a stable second snapshot without rediscovering unchanged controls.

### 2. Unstable field identity

**Failure:** The same field is clicked repeatedly or mistaken for a new field after a React rerender.

**Cause:** Identity included DOM array position. Conditional insertions change positions. Generic names and duplicate labels also collide.

**Replacement:** Identity is based on ATS, section, normalized label, semantic control type, stable name/id/path, and option signature. Position is used only for an anonymous control and is persisted on that element.

**Acceptance:** Reordering controls preserves identity. Two same-label fields in different sections remain distinct.

### 3. Incorrect required-state detection

**Failure:** Optional EEO or marketing questions are reported as required; real custom required widgets may be missed.

**Cause:** Any ancestor whose class text contained required made a field required. Optional known fields were intentionally scanned and later counted as required blockers.

**Replacement:** Required state comes from native required, aria-required, data-required, the smallest question's explicit marker, ATS adapter evidence, or the native invalid set. Optional controls can be filled but never block submission.

**Acceptance:** Optional veteran/disability selects do not block a Lever form. Required MongoDB demographic controls and consent do block until resolved.

### 4. Wrong semantic classification

**Failure:** High School Name received the person name; Preferred Name received the full legal name; degree text was sent into a discrete degree-level menu.

**Cause:** Generic keyword rules ran before specific contextual rules. Classification considered a label in isolation instead of section, neighboring fields, control type, and available options.

**Replacement:** Classify the whole form. Specific rules precede generic rules. Rationalization uses section context and option vocabulary. Degree values are reduced to level only when the control offers degree levels.

**Acceptance:** High School Name never maps to full_name. Preferred Name resolves to preferred_name or first_name. Bachelor of Science in Computer Science maps to Bachelor's degree only when that exact level exists.

### 5. Unsafe or stale profile facts

**Failure:** Placeholder LinkedIn URLs and incomplete user facts are considered valid preparation.

**Cause:** The preparation boundary copied strings without semantic validation, while the general profile readiness score did not represent the live job's requirements.

**Replacement:** Validate URLs by scheme and expected host. Separate global profile readiness from per-application readiness. Build a reusable fact bank for authorization, sponsorship, employment history, education, source, policy consent, and optional EEO preferences.

**Acceptance:** Invalid LinkedIn/GitHub placeholders are omitted. The application readiness score is computed from verified live controls, not generated server fields.

### 6. Resolver blocking and excessive AI use

**Failure:** One unanswered question prevents later questions from being attempted, or every question waits on Gemini.

**Cause:** Resolution and interaction were interleaved, with slow requests inside the field loop.

**Replacement:** Resolve the full snapshot in two phases. Phase one uses profile, saved answers, deterministic policy, and exact option matching. Phase two sends only grounded prose questions to AI. Every field receives an independent outcome: resolved, needs_user, unsupported_widget, or optional_unresolved.

**Acceptance:** A resolver timeout for one field does not prevent any other field from being planned or applied. Demographic, legal, salary, authorization, and yes/no policy fields never invoke AI.

### 7. Interaction without transactional verification

**Failure:** Text appears in a combobox but no option is selected; React clears a value; the engine clicks between two fields repeatedly.

**Cause:** Typed search text was sometimes treated as selection, retries were driven by DOM mutation, and accepted fields could reenter later rounds.

**Replacement:** Use the control's semantic interaction contract. For ARIA comboboxes, select an exposed option and verify retained selected state. Apply each answer once, allow one materially different recovery, and never retry the same schema/answer/error signature.

**Acceptance:** No control receives more than two attempts. An unchanged option set and answer terminates. Search text without selected state fails verification.

### 8. First-error validation

**Failure:** The system fixes one browser validation error, submits, discovers the next, and repeats for many rounds.

**Cause:** Only the first invalid control was read.

**Replacement:** Collect the complete native invalid set, merge it with the live snapshot, resolve the set in one request, apply all outcomes, then run validation once more.

**Acceptance:** A seven-blocker form reports and attempts all seven in the same pass.

### 9. Upload and dynamic-state serialization

**Failure:** Resume parsing or one async control prevents unrelated fields from being filled.

**Cause:** A page-level wait serialized independent work.

**Replacement:** Model uploads and dynamic controls as dependencies. Independent controls continue while upload-dependent fields wait. Submission alone waits for all required dependencies.

**Acceptance:** While resume processing is pending, all unrelated visible fields are resolved and filled.

### 10. Submission proof and receipt recording

**Failure:** ATS success is shown but HireRadar says it failed, or an attempted form is counted as submitted.

**Cause:** Browser success detection, queue update, saved-job update, and analytics were separate weakly correlated actions.

**Replacement:** Generate an idempotent submission attempt ID. Require positive ATS evidence: success URL/state, confirmation text in the application container, or ATS response evidence. Record the receipt idempotently and reconcile failed status writes. Analytics derive from confirmed receipts only.

**Acceptance:** Repeated receipt writes create one submitted application. A successful Ashby page remains locally confirmed during a temporary API failure and is reconciled. Clicks, filled forms, and submit attempts never increment submitted counts.

## ATS interaction rules

### Greenhouse

Fetch all question families when available, including demographic_questions and data_compliance. In the browser, treat radio/select renderings as equivalent representations of the same option IDs. Education degree and discipline are separate concepts. Compliance and Inclusion controls may be outside the main custom-question array.

### Lever

The hosted form is browser-authoritative. Questions may be checkbox groups or native/custom selects. Voluntary EEO controls remain optional unless the rendered control or native validation proves otherwise. High-school name and graduation year are separate facts.

### Ashby

The application panel may not be a native form. Use data-field-path and the smallest question entry. Upload completion and success must come from Ashby's visible application panel state, not generic page words.

### Workday and SmartRecruiters

Treat these as multistep state machines. Snapshot each step, resolve every control on that step, verify, then choose only a recognized continuation action. Final submission proof is separate from step advancement.

## Replacement transaction

1. Discover every candidate control and question container.
2. Normalize a stable form snapshot.
3. Classify and rationalize the whole snapshot.
4. Validate all profile facts used in the plan.
5. Resolve deterministic and saved answers for every field in one batch.
6. Resolve grounded prose with AI in a separate bounded batch.
7. Apply independent fields while tracking upload and conditional dependencies.
8. Verify every applied value from current DOM state.
9. Rescan only when the schema signature changes.
10. Repair the complete native invalid set once.
11. Submit only with zero live required blockers.
12. Confirm positive ATS receipt and write one idempotent receipt.
13. Derive queue status, applications, analytics, and notifications from that receipt.

## Research references

- Greenhouse Job Board API: https://docs.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Ashby application forms: https://docs.ashbyhq.com/application-forms
- Chromium Autofill FormStructure: https://chromium.googlesource.com/chromium/src.git/+/HEAD/components/autofill/
- Chromium form rationalization implementation: https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/components/autofill/core/browser/form_structure.cc
- Bitwarden browser field collector: https://github.com/bitwarden/clients/blob/main/apps/browser/src/autofill/services/collect-autofill-content.service.ts
- WHATWG constraint validation: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
- WAI-ARIA combobox pattern: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- Chrome extension content-script isolation: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

