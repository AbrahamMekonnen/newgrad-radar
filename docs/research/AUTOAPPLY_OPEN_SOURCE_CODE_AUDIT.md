# Auto-Apply Open-Source Code Audit

Date: 2026-09-24

This audit was completed before the next live extension run. It compares code, tests, and execution contracts rather than relying on feature claims.

## Repositories inspected

- [AutoApply](https://github.com/geckguy/AutoApply): strongest local mapper and untrusted-LLM validation boundary. Its useful patterns are typed form schemas, explicit fill instructions, deterministic mapping before AI, retained-value verification, learned corrections, and focused filler safety tests.
- [Personal JobPilot](https://github.com/TheCromazone/Personal-JobPilot): strongest end-to-end fixture coverage. Its useful patterns are whole-form scanning, fill-plan generation before mutation, repeated-section ownership, multi-page replay, preservation of existing user answers, and a hard stop before an unverified final action.
- [jobApplier](https://github.com/17nbist/jobApplier): strongest configuration workflow. Its useful patterns are a versioned field taxonomy, selector/action configuration, configuration validation, sanitized ATS fixtures, and a refresh process for drifting ATS selectors.
- [Emplorio](https://github.com/OElhwry/Emplorio): cleanest typed adapter split. Its useful patterns are adapter-first detection with generic fallback, honest filled/already-correct/unmapped counts, and isolated submission detection.
- [JobFill](https://github.com/Thesirloc/job-autofill): useful small adapter examples and local-first data handling, but its scope and tests are too limited to guide HireRadar's unattended executor.
- [jayzuccarelli/autofill](https://github.com/jayzuccarelli/autofill): useful persistent-profile and login-interruption behavior for browser agents, but its general visual-agent loop is slower and less deterministic than HireRadar's ATS adapters.

The installed Simplify extension was also inspected locally only to understand broad architecture. No proprietary code was copied. The useful architectural observation is that production autofill systems maintain numerous site-specific recipes, action sequences, value maps, iframe handling, mutation observation, and success routes instead of relying on a single fuzzy matcher.

## Findings

HireRadar already had several mature mechanisms: deterministic profile facts before AI, bounded attempts, a per-field ledger, named ATS adapters, positive submission evidence, sanitized field events, a shared question policy, canary concurrency, and offline fixtures.

The highest-impact missing contract was between the resolver and the browser. The server returned a plan identifier and option hash, but the browser matched answers mostly by name and did not reject a response after a dynamic option list changed. Repeated controls and React-generated names could therefore consume an answer intended for a different control or an earlier render.

Confirmed user corrections were also reusable by normalized question text without being tied to the option set that the user saw. That is unsafe for questions whose wording stays similar while available choices differ between employers.

## Adopted in v0.14.0

1. Every live required control receives a semantic fieldId containing its section, normalized label, control type, and occurrence. Resolver responses echo this identifier.
2. Every categorical answer carries a normalized option-set signature. The extension rejects the answer if the current page no longer exposes that exact option set.
3. The browser validates field identity, option signature, and exact supplied option before mutating the page. Rejected responses receive the terminal reason stale_plan and do not trigger repeated clicking.
4. User-confirmed corrections are stored under a question-and-option-set key. Legacy question-only answers remain readable for compatibility, while new corrections get the safer scoped key.
5. Regression tests cover repeated controls, dynamic option changes, scoped corrections, exact categorical values, bounded attempts, and ATS success evidence.

## Patterns retained for the next adapter phase

- Grow the sanitized fixture corpus from actual field-event failures, then fix a shared adapter or policy before another live batch.
- Declare adapter capabilities and verification level in the generated ATS registry. Discovery support must not be presented as verified submission support.
- Keep whole-form preflight and per-field isolation: one unresolved control never blocks attempts on later controls.
- Preserve user-entered values unless a field is proven to contain a parser error and the replacement comes from a verified profile fact.
- Treat navigation, submit clicks, and submission confirmation as separate state transitions.
- Require a positive receipt before counting an application as submitted.
- Run fixture, contract, type, and syntax gates before staged live canaries of 1, then 3, then 7.

## Patterns intentionally not adopted

- General-purpose visual agents as the primary filler. They cost more, run more slowly, and are harder to make idempotent than deterministic ATS adapters.
- Sending all fields to an LLM. Identity, legal, demographic, education, location, compensation, and authorization fields remain deterministic or user-confirmed.
- First-match fuzzy dropdown selection. A categorical answer must map to one page-provided option and survive a retained-value check.
- Click-based submission tracking. A click is an attempt; only an ATS receipt is a submission.
- Blind mass concurrency. Cross-domain parallelism remains behind canary gates and per-adapter failure isolation.

## Acceptance gate before another live run

- Full Jest suite passes.
- TypeScript passes with no emit.
- Extension scripts pass syntax checks.
- Python auto-apply tests pass.
- Generated ATS recipes are current.
- Migration 057_autoapply_field_events.sql is applied so sanitized failures can feed fixture development.
- Extension version changes only after all offline gates pass.
