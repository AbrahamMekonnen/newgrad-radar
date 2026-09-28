# Auto-Apply Combobox Interaction — Research & Contract

Status: implemented and live-validated (extension ≥ 0.18.4)
Last updated: 2026-09-27

This captures the root causes behind the repeated ATS dropdown failures and the
interaction contract that fixes them, so the "why" is not lost. All findings were
confirmed **live on real forms** (not guessed from telemetry). The implementation
lives in `extension/combobox-interaction.js` (`globalThis.HireRadarCombobox`),
wired into `extension/content.js` (`fillCombo`, `visibleOptions`, `controlHasValue`),
with DOM-level tests in `src/lib/__tests__/combobox-interaction.test.ts`.

## Why it repeated for a week

The interaction layer (the code that opens a dropdown, reads its options, clicks
one, and verifies it stuck) had **zero DOM-level tests**. Every fix was validated
only by reloading the unpacked extension and reading sanitized telemetry, so the
real behaviour on the page was never observed directly. Debugging the real form in
the browser pane (see below) + adding tests is what broke the loop.

## Root causes (confirmed live on the Roblox Greenhouse form)

1. **Wrong open gesture.** Greenhouse's education/demographic controls are
   **react-aria-style** selects (Greenhouse "remix" build). They open on a
   **PointerEvent press** (`pointerdown → pointerup`), **not** on the
   `MouseEvent('mousedown') + click()` the old code used, and **not** on focus +
   `keyDown(ArrowDown)` alone. If the menu never opens, no option matching can
   possibly work. Stock react-select (v3–v5) *does* open on focus + ArrowDown
   (the `react-select-event` contract); native `<select>` uses value + change.
   → The contract tries **pointer press → keyboard ArrowDown → mousedown**, and
   **verifies `aria-expanded` / scoped options after each** before proceeding.

2. **Programmatic typing is a no-op for react-select.** Setting the input value
   via the native setter + dispatching `input` does **not** filter a react-select
   (it is a controlled component that reads its own state), *unless the menu is
   already open*. Order matters: **open first, then type.** Confirmed: typing
   "Eastern Mennonite" into the (async) school select after opening returned
   "Eastern Mennonite University".

3. **Cross-widget option contamination.** When a target menu was closed,
   `visibleOptions` fell back to a **document-wide** `[role=option]` scan and
   grabbed the phone-country picker's **244** `iti__country` options — so a degree
   answer could be matched against phone-country options. → Options are now read
   **only from the control's own menu** (`aria-controls` listbox, or a menu inside
   its own container). Never `document`.

4. **Retained-value false positive (the big one).** The committed-value check
   walked up **6 ancestors** doing a broad descendant `[class*=single-value]`
   search, so an **empty** required field inherited a **neighbouring** filled
   select's value (every empty demographic read the degree field's "Bachelors").
   Empty required fields therefore looked complete, got skipped, and silently
   blocked submission. → The check is now scoped **strictly to the control's own
   box** (`.select__control`), never an ancestor walk. Confirmed live: empty
   demographic reads `""` while degree reads its own value.

5. **Autocomplete retention (Ashby & custom typeaheads).** These keep the
   committed value **in the input itself** with no single-value chip. The retained
   check trusts a **closed** autocomplete's input value (an **open** menu means the
   text is still an uncommitted search query). react-select clears its own input on
   close, so this never mis-reads react-select search text. Confirmed live on Ashby
   (Ramp): the location typeahead opens on type, scopes 5 options via
   `aria-controls`, and the value is detected.

## The contract (implementation summary)

- `openCombobox(input)` — pointer press → focus+ArrowDown → mousedown; verify open.
- `scopedOptions(input)` — options from the control's own menu only (aria-controls
  / own-container menu). Version-agnostic option selectors.
- `retainedText(input)` — committed value from the control's OWN box only:
  react-select `.select__single-value`, classic `.Select-value-label`, an inline
  `[aria-selected=true]`, or a **closed** autocomplete's input value.
- Version-agnostic selectors cover react-select v1/v2 (`.Select-control`,
  `.Select-menu`, `.Select-value-label`), v3–v5 / "remix" (`.select__*`), and
  generic ARIA comboboxes.

## Per-ATS coverage status

- **Greenhouse (modern, `job-boards.greenhouse.io`, react-aria):** ✅ fully
  validated live (Roblox) — open, scope, select, retain, neighbour-isolation.
  Same markup for every Greenhouse company, so it generalizes by construction.
- **Ashby (`jobs.ashbyhq.com`):** ✅ yes/no via the Ashby adapter; typeahead
  autocomplete validated live (Ramp); autocomplete retention fixed.
- **Greenhouse (classic, `boards.greenhouse.io`, react-select v1/v2):** ✅ covered
  by version-agnostic selectors (not separately live-validated).
- **Lever:** native `<select>` + checkbox groups — handled by `content.js` native
  paths, unaffected by the combobox module.
- **Workday, SmartRecruiters, iCIMS, Taleo:** ⚠️ custom multi-step widgets; the
  generic pointer + `aria-controls` contract helps, but these are **not yet
  live-validated** and Workday/SmartRecruiters still need dedicated multi-step
  state machines (see the handoff's "areas still incomplete").

## How to debug reload-free (this is the key workflow)

Open the real ATS form in a browser and drive the actual controls with the same
contract — do **not** iterate via extension reloads + telemetry. In this repo's
tooling that was done by injecting the `HireRadarCombobox` logic into the live
page and asserting `aria-expanded`, scoped option counts, and the retained value.
A trusted OS-level click is the ground-truth baseline for "did it really open".

## Related

- `docs/CLAUDE_AUTOAPPLY_HANDOFF.md` — overall handoff and current regression case.
- `docs/AUTOAPPLY_FAILURE_AUDIT.md` — the broader failure taxonomy.
- GPA is genuinely null for the current test profile — never invent it.
