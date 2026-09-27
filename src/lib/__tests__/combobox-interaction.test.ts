/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
// DOM-level coverage for the combobox interaction contract — the layer that had
// ZERO tests and caused week-long repeats (wrong open gesture, cross-widget option
// contamination, search-text mistaken for a selection).
const CB = require('../../../extension/combobox-interaction.js');

const html = (markup: string) => { document.body.innerHTML = markup; };
const NO_LAYOUT = { requireLayout: false };

// A react-select-shaped control. `open` toggles the menu + aria-controls, exactly
// as react-select/react-aria do (menu exists only when open).
function reactSelect({ id = 'degree--0', open = false, single = '' }: { id?: string; open?: boolean; single?: string }) {
  const listId = `${id}-listbox`;
  return `
  <div class="select__container">
    <div class="select__control"><div class="select__value-container">
      ${single ? `<div class="select__single-value">${single}</div>` : '<div class="select__placeholder">Select...</div>'}
      <div class="select__input-container">
        <input id="${id}" role="combobox" aria-autocomplete="list"
               class="select__input" aria-expanded="${open ? 'true' : 'false'}"
               ${open ? `aria-controls="${listId}"` : ''} />
      </div>
    </div></div>
    ${open ? `<div class="select__menu"><div id="${listId}" role="listbox" class="select__menu-list">
      <div role="option" class="select__option">Bachelor's Degree</div>
      <div role="option" class="select__option">Master's Degree</div>
      <div role="option" class="select__option">Doctorate</div>
    </div></div>` : ''}
  </div>`;
}

// The phone country picker (intl-tel-input) — an UNRELATED widget with many
// [role=option] nodes that the old document-wide scan wrongly picked up.
const phoneWidget = `
  <ul class="iti__country-list">
    <li role="option" class="iti__country">United States +1</li>
    <li role="option" class="iti__country">Canada +1</li>
    <li role="option" class="iti__country">Afghanistan +93</li>
  </ul>`;

describe('combobox option scoping (no cross-widget contamination)', () => {
  it('returns NO options for a closed control, even when another widget has open options', () => {
    html(reactSelect({ open: false }) + phoneWidget);
    const input = document.getElementById('degree--0')!;
    expect(CB.scopedOptions(input, NO_LAYOUT)).toHaveLength(0);
    expect(CB.isOpen(input, NO_LAYOUT)).toBe(false);
  });

  it('returns ONLY this control\'s own options when open, never the phone widget\'s', () => {
    html(reactSelect({ open: true }) + phoneWidget);
    const input = document.getElementById('degree--0')!;
    const opts = CB.scopedOptions(input, NO_LAYOUT).map((o: any) => o.textContent.trim());
    expect(opts).toEqual(["Bachelor's Degree", "Master's Degree", 'Doctorate']);
    expect(opts).not.toContain('United States +1');
    expect(CB.isOpen(input, NO_LAYOUT)).toBe(true);
  });

  it('scopes two selects on the same page to their own menus', () => {
    html(reactSelect({ id: 'degree--0', open: true }) + reactSelect({ id: 'school--0', open: false }));
    const degree = document.getElementById('degree--0')!;
    const school = document.getElementById('school--0')!;
    expect(CB.scopedOptions(degree, NO_LAYOUT).length).toBe(3);
    expect(CB.scopedOptions(school, NO_LAYOUT).length).toBe(0); // school menu is closed
  });
});

describe('retained-selection verification (not search text)', () => {
  it('detects a committed single-value selection', () => {
    html(reactSelect({ open: false, single: "Bachelor's Degree" }));
    const input = document.getElementById('degree--0')!;
    expect(CB.retained(input)).toBe(true);
    expect(CB.retainedText(input)).toBe("Bachelor's Degree");
  });

  it('does NOT treat placeholder / empty as retained', () => {
    html(reactSelect({ open: false }));
    const input = document.getElementById('degree--0')!;
    expect(CB.retained(input)).toBe(false);
  });

  it('does NOT treat typed search text as a selection', () => {
    html(reactSelect({ open: true }));
    const input = document.getElementById('degree--0') as HTMLInputElement;
    input.value = 'Bachel'; // controlled search text, no committed option
    expect(CB.retained(input)).toBe(false);
  });
});

describe('open-strategy ordering (pointer → keyboard → mouse), verified each time', () => {
  // Wire a fake control that "opens" only in response to a chosen event type.
  function armOpenOn(input: HTMLInputElement, evType: string, opts: { onControl?: boolean } = {}) {
    const control = input.closest('.select__control') as HTMLElement;
    const target = opts.onControl ? control : input;
    target.addEventListener(evType, () => input.setAttribute('aria-expanded', 'true'));
  }

  it('opens via the pointer press (react-aria) and stops — does not need keyboard', async () => {
    html(reactSelect({ open: false }));
    const input = document.getElementById('degree--0') as HTMLInputElement;
    armOpenOn(input, 'pointerdown', { onControl: true });
    let arrowPressed = false;
    input.addEventListener('keydown', () => { arrowPressed = true; });
    const opened = await CB.openCombobox(input, { settle: 5 });
    expect(opened).toBe(true);
    expect(arrowPressed).toBe(false); // never fell through to the keyboard strategy
  });

  it('falls back to focus+ArrowDown (react-select) when pointer does nothing', async () => {
    html(reactSelect({ open: false }));
    const input = document.getElementById('degree--0') as HTMLInputElement;
    armOpenOn(input, 'keydown'); // only ArrowDown opens it
    const opened = await CB.openCombobox(input, { settle: 5 });
    expect(opened).toBe(true);
  });

  it('reports not-open when nothing responds', async () => {
    html(reactSelect({ open: false }));
    const input = document.getElementById('degree--0') as HTMLInputElement;
    const opened = await CB.openCombobox(input, { settle: 3 });
    expect(opened).toBe(false);
  });
});
