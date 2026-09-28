# Auto-Apply Live QA Log

Live cross-board fill coverage, measured by driving real public application forms
with a synthetic profile and verifying each control retains its value (never
submitting). Runner: `scripts/qa/ats-live-run.js` (drives real Chrome via
Playwright, injects `extension/dev/form-drive.js`). URLs are sampled from the live
`jobs` pipeline. Goal: iterate to 100% on forms that render, across boards.

Metric notes: `formsFullyOk` = forms (that rendered controls) where every driven
control retained. `noForm` = URL rendered no application form (closed/expired job
or wrapper) — excluded from the pass rate. `comboRetainedPct` = react-select /
react-aria / autocomplete controls that committed a value.

## Round 3 — 2026-09-27 (50/board; async typeaheads segregated)

| Board | forms | rendered | fullyOk* | combobox retained | async typeahead | notes |
|-------|-------|----------|----------|-------------------|-----------------|-------|
| Greenhouse | 50 | 40 | **37** | **97%** (145) | 100% | 10 closed; residual 4 = no-label phone-country widget (product-handled via adapter + phone linkage) |
| Ashby | 50 | 22 | 21 | 88% (8) | 100% | 28 closed/expired (stale pipeline); 1 "did not open" |
| Lever | 2 | 2 | 2 | n/a | n/a | native `<select>` |

*fullyOk = every non-typeahead control retained (async location/school reported apart;
they verified 100% once given a real query). Fixed-list dropdowns, multi-selects,
demographics, degree, availability, coding-language, yes/no, native selects: ~100%.

Trend: Greenhouse combobox retention 91% (R1) → 100% (R2, 25) → 97% (R3, 50, larger
sample); the multi-value fix removed the systematic failure. Remaining misses are
the phone-country widget (product-special-cased) and closed jobs, not the contract.

## Round 2 — 2026-09-27 (after multi-value retention fix)

| Board | forms | rendered | fullyOk | combo retained | notes |
|-------|-------|----------|---------|----------------|-------|
| Greenhouse | 25 | 25 | **25/25** | **100%** (97) | all pass |
| Ashby | 25 | 10 | 9/10 | 90% (10) | 15 closed/expired; 1 autocomplete "no options" |
| Lever | 2 | 2 | 2/2 | n/a (native selects) | native `<select>` path |

## Round 1 — 2026-09-27 (baseline, before fixes)

| Board | forms | rendered | fullyOk | combo retained | notes |
|-------|-------|----------|---------|----------------|-------|
| Greenhouse | 6–8 | all | 4/6 | 91% | `autocomplete: not retained` on multi-selects |
| Ashby | 6–8 | (harness bug) | — | — | root matched the autofill pane, not the form |
| Lever | 2 | 2 | 2/2 | n/a | native selects |

## Fixes landed from this campaign

- **Multi-select retention** (`combobox-interaction.js`): `retained()` now matches
  `.select__multi-value` chips, not just `.select__single-value`. Multi-selects
  (locations, languages, "previously employed by…") were read as empty →
  retried/blocked. Greenhouse 91% → 100%. (Root cause found live on Coursera.)
- Harness: pick the real form container (not Ashby's autofill pane); drive Ashby
  yes/no buttons; numeric values for number fields.

## Known / to-do

- Ashby: high `noForm` rate is mostly stale/closed pipeline jobs; confirm timing
  isn't a factor on the SPA. One "autocomplete: no options" to inspect.
- Scale each board toward 50/round and record the trend here.
- Workday / SmartRecruiters: auth/bot-gated — cannot be driven headless; need the
  user's authenticated browser or a dedicated adapter (tracked separately).
