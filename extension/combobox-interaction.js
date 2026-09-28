/**
 * HireRadarCombobox — a general, framework-aware interaction contract for custom
 * dropdown/combobox controls (react-select, react-aria, and native selects), plus
 * strict option scoping and retained-selection verification.
 *
 * Why this module exists (evidence, not guesses):
 *  - Greenhouse's education/demographic controls are react-aria-style selects
 *    ("remix" build). They open on a POINTER press (pointerdown→pointerup), NOT on
 *    the plain MouseEvent('mousedown')+click the old code used, and NOT on raw
 *    programmatic typing (react-select/aria are controlled — the DOM input value
 *    is ignored). Confirmed live on the real Roblox form.
 *  - Stock react-select opens on focus + keyDown(ArrowDown) (the react-select-event
 *    contract used across the ecosystem). Native <select> uses value + change.
 *  - When a menu is closed, the OLD visibleOptions() fell back to a document-wide
 *    [role=option] scan and scooped up UNRELATED widgets' options (e.g. the phone
 *    country picker's 244 entries), matching a degree answer against phone options.
 *
 * So: try an ordered set of open strategies and VERIFY the menu actually opened
 * after each; read options only from THIS control's own menu; verify the retained
 * selection from the control's own value UI. This one general contract covers every
 * react-select / react-aria ATS instead of patching one field on one form.
 *
 * Every function is pure DOM (no chrome.* / no globals) so it is unit-testable.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HireRadarCombobox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const norm = (v) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = (el) => (el && el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : undefined);

  // Build a pointer event even where PointerEvent is unavailable (jsdom, older
  // engines). react-aria reads .pointerType / .pointerId, so we always set them.
  const pointerEvent = (el, type) => {
    const w = view(el) || {};
    const opts = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === 'pointerup' || type === 'mouseup' ? 0 : 1 };
    let ev;
    try {
      if (typeof w.PointerEvent === 'function') {
        ev = new w.PointerEvent(type, { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 });
      }
    } catch { /* fall through */ }
    if (!ev) {
      const Ctor = (w.MouseEvent || (typeof MouseEvent !== 'undefined' ? MouseEvent : null));
      ev = Ctor ? new Ctor(type, opts) : { type, bubbles: true };
      try {
        Object.defineProperty(ev, 'pointerId', { value: 1 });
        Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
        Object.defineProperty(ev, 'isPrimary', { value: true });
      } catch { /* some engines seal events */ }
    }
    return ev;
  };
  const keyEvent = (el, type, key, keyCode) => {
    const w = view(el) || {};
    const Ctor = (w.KeyboardEvent || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null));
    if (!Ctor) return { type, key };
    return new Ctor(type, { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true });
  };

  // A full press mimics a real mouse/touch press so react-aria's usePress fires:
  // pointerdown → mousedown → pointerup → mouseup → click, all on the SAME node.
  const press = (el) => {
    if (!el || !el.dispatchEvent) return;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try { el.dispatchEvent(t.startsWith('pointer') ? pointerEvent(el, t) : new (view(el).MouseEvent)(t, { bubbles: true, cancelable: true, button: 0 })); }
      catch { try { el.dispatchEvent(pointerEvent(el, t)); } catch { /* ignore */ } }
    }
  };

  const isHidden = (el) => {
    if (!el || !el.getAttribute) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    const inline = el.style && el.style.display;
    if (inline === 'none') return true;
    return false;
  };
  // Layout visibility (real browser). In no-layout envs (jsdom) callers pass
  // requireLayout:false so structural hidden checks stay authoritative.
  const isVisible = (el, requireLayout = true) => {
    if (isHidden(el)) return false;
    if (requireLayout && typeof el.getClientRects === 'function') return el.getClientRects().length > 0;
    return true;
  };

  const controlRoot = (input) =>
    (input.closest && (input.closest('[class*="select__container"]') || input.closest('[class*="select-shell"]')
      || input.closest('[class*="Select--"], [class*="Select-container"], [class*="select-container"]')
      || input.closest('[class*="combobox"]') || input.closest('[role="combobox"]')?.parentElement))
    || input.parentElement || input;

  // The listbox/menu that belongs to THIS control — never a document-wide scan.
  const ownMenu = (input) => {
    const doc = (input && input.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    // 1) The accessible link the control itself declares (works for portalled menus).
    const controlledId = (input.getAttribute && (input.getAttribute('aria-controls') || input.getAttribute('aria-owns')))
      || (controlRoot(input)?.querySelector?.('[aria-controls],[aria-owns]')?.getAttribute?.('aria-controls'));
    if (controlledId) {
      const byId = doc.getElementById(controlledId);
      if (byId) return byId;
    }
    // 2) A menu rendered inside the control's own container (inline react-select).
    const rootEl = controlRoot(input);
    const inline = rootEl && rootEl.querySelector
      && rootEl.querySelector('[class*="select__menu"], [class*="Select-menu"], [role="listbox"], [role="menu"], [class*="menu-list"], [class*="dropdown"]');
    return inline || null;
  };

  // Options that belong to THIS control's menu only. Kills cross-widget
  // contamination (the phone-country picker no longer pollutes a degree select).
  const scopedOptions = (input, { requireLayout = true } = {}) => {
    const menu = ownMenu(input);
    if (!menu || !menu.querySelectorAll) return [];
    const sel = '[role="option"], [role="menuitemradio"], [class*="select__option"], [class*="option"]';
    const items = [...menu.querySelectorAll(sel)].filter((el) => el !== input && !isHidden(el)
      && (!requireLayout || typeof el.getClientRects !== 'function' || el.getClientRects().length > 0)
      && norm(el.textContent));
    // De-dupe nested wrappers that repeat the same label.
    return [...new Set(items)].filter((el) =>
      !items.some((other) => other !== el && el.contains && el.contains(other) && norm(other.textContent) === norm(el.textContent)));
  };

  const isOpen = (input, opts) => {
    if (input.getAttribute && input.getAttribute('aria-expanded') === 'true') return true;
    return scopedOptions(input, opts).length > 0;
  };

  // The retained selection UI (react-select single-value, or an aria-selected
  // option shown inline). This is verification of a real committed choice, not
  // the search text a controlled input may still hold.
  //
  // CRITICAL: scope strictly to THIS control's own box. An earlier version walked
  // up to 6 ancestors doing a broad descendant [class*=single-value] search, which
  // matched a NEIGHBOURING filled select's value — so an empty required field
  // looked complete, got skipped, and quietly blocked submission. The committed
  // value always lives inside this control's own .select__control / container.
  const retainedText = (input) => {
    const root = control(input) || controlRoot(input) || input;
    if (!root || !root.querySelector) return '';
    // Committed-value UI across versions (all scoped to THIS control):
    //  v3–v5: .select__single-value · classic v1/v2: .Select-value-label / .Select-value
    //  generic ARIA: an [aria-selected=true] option shown inline.
    // Includes MULTI-select chips (.select__multi-value / .select__multi-value__label):
    // multi-selects (locations, languages, "previously employed by…") commit values
    // as chips, not a single-value, and were wrongly read as empty → retried/blocked.
    const selected = root.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="value-label"], [class*="Select-value"], [aria-selected="true"]');
    const text = String((selected && selected.textContent) || '').trim();
    if (text && !/^select$|^choose/i.test(norm(text))) return text;
    // Autocomplete-style comboboxes (Ashby, and many custom typeaheads) keep the
    // committed value in the input itself, with no single-value chip. Trust it
    // ONLY when the menu is closed — an open menu means the text is still an
    // uncommitted search query. react-select clears its own input on close, so
    // this never mis-reads react-select search text as a selection.
    const isCombo = input.getAttribute
      && (input.getAttribute('aria-autocomplete') || input.getAttribute('role') === 'combobox');
    const expanded = input.getAttribute && input.getAttribute('aria-expanded') === 'true';
    const val = String((input && input.value) || '').trim();
    if (isCombo && !expanded && val && !/^select$|^choose/i.test(norm(val))) return val;
    return '';
  };
  const retained = (input) => Boolean(retainedText(input));

  // The control's own interactive box, across react-select versions:
  //  v3–v5 / Greenhouse "remix": .select__control (or prefixed *__control)
  //  classic v1/v2: .Select-control
  //  generic ARIA: the [role=combobox] element itself.
  const control = (input) => (input.closest && (input.closest('[class*="select__control"], [class*="__control"], [class*="Select-control"], [class*="select-control"]')
    || input.closest('[role="combobox"]'))) || input;

  // Open strategies, tried in order, each VERIFIED before moving on:
  //  A) pointer press on the control  → react-aria (Greenhouse "remix")
  //  B) focus + ArrowDown keydown     → stock react-select (react-select-event)
  //  C) plain mousedown + click       → legacy / simple custom menus
  const OPEN_STRATEGIES = [
    (input) => press(control(input)),
    (input) => {
      try { input.focus && input.focus(); } catch { /* ignore */ }
      input.dispatchEvent && input.dispatchEvent(keyEvent(input, 'keydown', 'ArrowDown', 40));
      input.dispatchEvent && input.dispatchEvent(keyEvent(input, 'keyup', 'ArrowDown', 40));
    },
    (input) => {
      const c = control(input);
      try { c.dispatchEvent(new (view(c).MouseEvent)('mousedown', { bubbles: true, button: 0 })); } catch { /* ignore */ }
      try { c.click && c.click(); } catch { /* ignore */ }
    },
  ];

  const openCombobox = async (input, { settle = 350, strategies = OPEN_STRATEGIES } = {}) => {
    if (!input) return false;
    try { input.focus && input.focus(); } catch { /* ignore */ }
    if (isOpen(input)) return true;
    for (const strategy of strategies) {
      try { strategy(input); } catch { /* try next */ }
      await sleep(settle);
      if (isOpen(input)) return true;
    }
    return isOpen(input);
  };

  const closeCombobox = (input) => {
    try { input.dispatchEvent(keyEvent(input, 'keydown', 'Escape', 27)); } catch { /* ignore */ }
    try { input.blur && input.blur(); } catch { /* ignore */ }
  };

  // Select an option node using the same press contract (react-aria options also
  // respond to pointer, not a bare synthetic click).
  const selectOption = async (optionEl, { settle = 300 } = {}) => {
    if (!optionEl) return false;
    press(optionEl);
    await sleep(settle);
    return true;
  };

  return {
    norm, press, keyEvent, pointerEvent, isHidden, isVisible,
    controlRoot, control, ownMenu, scopedOptions, isOpen,
    retained, retainedText, openCombobox, closeCombobox, selectOption,
    OPEN_STRATEGIES,
  };
});
