/**
 * ATS form interaction probe (DEV / QA ONLY — never shipped in the extension).
 *
 * Audits a live ATS application form the same way the auto-apply engine drives it,
 * so we can see across many job boards what opens, what scopes its options, and
 * what retains a selection — WITHOUT submitting anything.
 *
 * Usage (console or automation), on a real application form:
 *   1) load extension/combobox-interaction.js  (defines globalThis.HireRadarCombobox)
 *   2) load this file
 *   3) await window.__hrProbe()      // audit every control
 *      await window.__hrProbe({ act: true })  // also test-select a safe option, then clear
 *
 * Safety: this never clicks a submit/apply-final control and never types personal
 * data. With { act:true } it selects the FIRST option (or a decline option for
 * demographic questions), verifies retention, then clears the control again.
 */
(function () {
  const CB = globalThis.HireRadarCombobox;
  const norm = (v) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => el && el.getClientRects && el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true';
  const labelFor = (el) => {
    const id = el.id && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const wrap = el.closest('label, [data-field-path], [class*="field"], [class*="question"], fieldset');
    return String(el.getAttribute('aria-label') || id?.textContent || wrap?.querySelector('label,legend,[class*="label"],[class*="title"]')?.textContent || wrap?.textContent || '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);
  };
  const declineIn = (opts) => opts.find((o) => /decline|prefer not|do not wish|don.t wish|not wish to answer|choose not to disclose/i.test(o.textContent));

  async function probeCombo(input, act) {
    const r = { kind: 'combobox', label: labelFor(input), id: input.id || null };
    if (!CB) { r.error = 'HireRadarCombobox not loaded'; return r; }
    r.opened = await CB.openCombobox(input, { settle: 400 });
    const opts = CB.scopedOptions(input, { requireLayout: true });
    r.optionCount = opts.length;
    r.sample = opts.slice(0, 4).map((o) => o.textContent.replace(/\s+/g, ' ').trim().slice(0, 24));
    r.alreadyRetained = CB.retained(input);
    if (act && opts.length && !r.alreadyRetained) {
      const target = declineIn(opts) || opts[0];
      await CB.selectOption(target);
      await sleep(300);
      r.selected = target.textContent.replace(/\s+/g, ' ').trim().slice(0, 24);
      r.retainedAfterSelect = CB.retained(input);
      // best-effort clear so the form is left blank
      const clr = (input.closest('[class*="select__container"], [class*="Select"]') || input.parentElement)
        ?.querySelector('[class*="clear-indicator"], [aria-label*="Clear" i]');
      if (clr) { CB.press(clr); await sleep(150); }
    }
    try { CB.closeCombobox(input); } catch { /* ignore */ }
    return r;
  }

  function probeNativeSelect(sel) {
    return { kind: 'native-select', label: labelFor(sel), id: sel.id || null, optionCount: sel.options.length,
      sample: [...sel.options].slice(0, 4).map((o) => o.textContent.trim().slice(0, 24)) };
  }
  function probeRadioGroup(name, group) {
    return { kind: 'radio-group', name, label: labelFor(group[0]), optionCount: group.length,
      options: group.map((g) => labelFor(g)).slice(0, 6) };
  }

  window.__hrProbe = async function ({ act = false } = {}) {
    const doc = document;
    const seenRadio = new Set();
    const report = { url: location.href, host: location.hostname, hasCombobox: CB != null, controls: [] };
    // comboboxes / react-select / autocompletes
    for (const c of [...doc.querySelectorAll('[role="combobox"], input[aria-autocomplete]')]) {
      if (!vis(c)) continue;
      report.controls.push(await probeCombo(c, act));
    }
    // native selects
    for (const s of [...doc.querySelectorAll('select')]) {
      if (vis(s)) report.controls.push(probeNativeSelect(s));
    }
    // radio groups
    for (const radio of [...doc.querySelectorAll('input[type=radio]')]) {
      if (!vis(radio) || !radio.name || seenRadio.has(radio.name)) continue;
      seenRadio.add(radio.name);
      report.controls.push(probeRadioGroup(radio.name, [...doc.querySelectorAll(`input[type=radio][name="${CSS.escape(radio.name)}"]`)]));
    }
    // counts for text/checkbox/file so the audit is complete
    report.textInputs = [...doc.querySelectorAll('input[type=text], input[type=email], input[type=tel], textarea')].filter(vis).length;
    report.checkboxes = [...doc.querySelectorAll('input[type=checkbox]')].filter(vis).length;
    report.fileInputs = [...doc.querySelectorAll('input[type=file]')].length;
    // summary
    const combos = report.controls.filter((c) => c.kind === 'combobox');
    report.summary = {
      comboboxes: combos.length,
      openedOk: combos.filter((c) => c.opened).length,
      scopedOk: combos.filter((c) => c.optionCount > 0).length,
      retainedOk: combos.filter((c) => c.retainedAfterSelect).length,
      nativeSelects: report.controls.filter((c) => c.kind === 'native-select').length,
      radioGroups: report.controls.filter((c) => c.kind === 'radio-group').length,
    };
    return report;
  };
  return 'form-probe ready: await window.__hrProbe({ act:true })';
})();
