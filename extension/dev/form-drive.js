/**
 * ATS form DRIVE harness (DEV / QA ONLY — never shipped; not in manifest).
 *
 * Fills a live application form the way a human would — opens every dropdown,
 * selects an option, types into text/autocomplete fields, picks radios — using a
 * SYNTHETIC test profile, then verifies each control retained its value. It NEVER
 * clicks submit/apply-final and never uses real personal data, so it exercises the
 * whole fill path across many job boards without creating real applications.
 *
 * Mirrors extension/combobox-interaction.js's contract so results reflect shipped
 * behaviour. Returns a compact report: per-form failures + counts.
 *
 * Usage on a real application form:  await window.__hrDrive()
 */
window.__hrDrive = async function () {
  const W = window, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (v) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
  const vis = (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true';
  const pev = (el, t) => { const o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: (t === 'pointerup' || t === 'mouseup') ? 0 : 1 }; try { if (typeof W.PointerEvent === 'function') return new W.PointerEvent(t, { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }); } catch {} const e = new W.MouseEvent(t, o); try { Object.defineProperty(e, 'pointerType', { value: 'mouse' }); } catch {} return e; };
  const kev = (t, k, kc) => new W.KeyboardEvent(t, { key: k, code: k, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true });
  const press = (el) => ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(t.startsWith('pointer') ? pev(el, t) : new W.MouseEvent(t, { bubbles: true, cancelable: true, button: 0 })));
  const control = (i) => (i.closest('[class*="select__control"],[class*="__control"],[class*="Select-control"],[class*="select-control"]') || i.closest('[role="combobox"]')) || i;
  const croot = (i) => i.closest('[class*="select__container"],[class*="Select--"],[class*="Select-container"],[class*="select-container"],[class*="combobox"]') || i.parentElement || i;
  const ownMenu = (i) => { const c = i.getAttribute('aria-controls') || i.getAttribute('aria-owns'); if (c) { const b = document.getElementById(c); if (b) return b; } return croot(i)?.querySelector('[class*="select__menu"],[class*="Select-menu"],[role="listbox"],[role="menu"],[class*="menu-list"],[class*="dropdown"]') || null; };
  const scoped = (i) => { const m = ownMenu(i); if (!m) return []; return [...m.querySelectorAll('[role="option"],[role="menuitemradio"],[class*="select__option"],[class*="option"]')].filter((o) => o !== i && o.getAttribute('aria-hidden') !== 'true' && o.getClientRects().length > 0 && norm(o.textContent)); };
  const isOpen = (i) => i.getAttribute('aria-expanded') === 'true' || scoped(i).length > 0;
  const retained = (i) => { const r = control(i) || croot(i) || i; const s = r.querySelector && r.querySelector('[class*="single-value"],[class*="singleValue"],[class*="multi-value"],[class*="value-label"],[class*="Select-value"],[aria-selected="true"]'); let t = String(s?.textContent || '').trim(); if (t && !/^select$|^choose/i.test(norm(t))) return t; const isC = i.getAttribute('aria-autocomplete') || i.getAttribute('role') === 'combobox'; const ex = i.getAttribute('aria-expanded') === 'true'; const v = String(i.value || '').trim(); if (isC && !ex && v && !/^select$|^choose/i.test(norm(v))) return v; return ''; };
  const openC = async (i) => { i.focus && i.focus(); if (isOpen(i)) return true; press(control(i)); await sleep(380); if (isOpen(i)) return true; i.dispatchEvent(kev('keydown', 'ArrowDown', 40)); await sleep(380); if (isOpen(i)) return true; try { control(i).dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, button: 0 })); control(i).click && control(i).click(); } catch {} await sleep(380); return isOpen(i); };
  const setNative = (el, val) => { const p = el instanceof W.HTMLTextAreaElement ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value')?.set; s ? s.call(el, val) : (el.value = val); el.dispatchEvent(new W.Event('input', { bubbles: true })); el.dispatchEvent(new W.Event('change', { bubbles: true })); };

  const P = { first: 'Jordan', last: 'Taylor', name: 'Jordan Taylor', email: 'jordan.taylor.test@example.com', phone: '4155550123', city: 'New York', location: 'New York, NY, United States', degree: 'Bachelor', school: 'University of California', country: 'United States' };
  const lbl = (el) => String(el.getAttribute('aria-label') || el.closest('label,[data-field-path],[class*=field],[class*=question]')?.querySelector?.('label,legend,[class*=label],[class*=title]')?.textContent || el.getAttribute('placeholder') || el.name || '').replace(/\s+/g, ' ').trim();
  const textVal = (l) => { l = norm(l); if (/e mail|email/.test(l)) return P.email; if (/first name/.test(l)) return P.first; if (/last name|surname/.test(l)) return P.last; if (/full name|^name/.test(l)) return P.name; if (/phone|mobile/.test(l)) return P.phone; if (/linkedin/.test(l)) return 'https://linkedin.com/in/jordantaylor'; if (/github/.test(l)) return 'https://github.com/jordantaylor'; if (/website|portfolio/.test(l)) return 'https://example.com'; if (/city/.test(l)) return P.city; if (/school|university|college/.test(l)) return P.school; if (/location/.test(l)) return P.location; return 'Test'; };
  const pickOpt = (l, opts) => { const L = norm(l); if (/gender|race|ethnic|hispanic|latino|veteran|disab|sexual orientation|demographic/.test(L)) { const d = opts.find((o) => /decline|prefer not|do not wish|not wish to answer|choose not to disclose/i.test(o.textContent)); if (d) return d; } if (/degree|education level/.test(L)) { const b = opts.find((o) => /bachelor/i.test(o.textContent)); if (b) return b; } return opts.find((o) => norm(o.textContent) && !/^select|^choose/i.test(norm(o.textContent))) || opts[0]; };

  await sleep(200);
  // Pick the REAL form container: the candidate holding the most controls. This
  // avoids Ashby's small "autofill-from-resume" pane (ashby-application-form-
  // autofill*), which also matches [class*=application-form] but has none of the
  // real question fields.
  let root = document.body, best = -1;
  for (const c of [...document.querySelectorAll('form,[data-form-type="application"],.ashby-application-form,[class*="application-form"],#main-content')]) {
    const n = c.querySelectorAll('input,select,textarea,[role="combobox"]').length;
    if (n > best) { best = n; root = c; }
  }
  const report = []; const seen = new Set();
  for (const el of [...root.querySelectorAll('input,textarea,select,[role="combobox"]')]) {
    if (!vis(el)) continue;
    const rawType = el.tagName === 'SELECT' ? 'select' : (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) ? 'combobox' : (el.type || 'text');
    if (['submit', 'button', 'hidden', 'file', 'checkbox'].includes(rawType)) continue;
    const label = lbl(el).slice(0, 48);
    const key = (el.name || el.id || label) + rawType; if (seen.has(key)) continue; seen.add(key);
    let ok = false, reason = '', kind = rawType;
    try {
      if (rawType === 'select') {
        const want = norm(textVal(label));
        const o = [...el.options].find((x) => norm(x.textContent) === want) || [...el.options].find((x) => want && norm(x.textContent).includes(want)) || [...el.options].find((x) => x.value && !/^select|^choose/i.test(norm(x.textContent)));
        if (o) { el.value = o.value; el.dispatchEvent(new W.Event('change', { bubbles: true })); ok = String(el.value) === String(o.value); reason = ok ? '' : 'value not set'; } else reason = 'no option';
      } else if (rawType === 'combobox') {
        const hint = `${el.id} ${el.name} ${label}`;
        const isLoc = /location|city/i.test(hint);
        const isSchool = /school|university|college|institution/i.test(hint);
        const opened = await openC(el);
        let opts = scoped(el);
        // Async TYPEAHEADS (location, school) render options only after a real query
        // — the shipped fillCombo handles these with dedicated logic. Segregate them
        // so this generic harness doesn't misreport them as fixed-combobox regressions.
        const async = (isLoc || isSchool) && !opts.length;
        kind = async ? 'typeahead' : (el.getAttribute('aria-autocomplete') ? 'autocomplete' : 'combobox');
        if (!opened && !opts.length && !async) { reason = 'did not open'; }
        else {
          if (!opts.length) {
            const query = isLoc ? P.city : isSchool ? P.school : textVal(label);
            setNative(el, query); await sleep(async ? 1900 : 1200); opts = scoped(el);
          }
          if (!opts.length) reason = 'no options';
          else { press(pickOpt(label, opts)); await sleep(340); ok = !!retained(el); reason = ok ? '' : 'not retained'; }
        }
        try { el.dispatchEvent(kev('keydown', 'Escape', 27)); el.blur && el.blur(); } catch {}
      } else if (rawType === 'radio') {
        kind = 'radio'; const g = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name || '')}"]`)]; const o = g.find(vis) || g[0];
        if (o) { o.click(); ok = g.some((x) => x.checked); reason = ok ? '' : 'not checked'; } else reason = 'no radio';
      } else {
        const isNum = el.type === 'number' || /gpa|year|salary|compensation|how many|number of/i.test(label);
        const val = isNum ? (/gpa/i.test(label) ? '3.5' : /year/i.test(label) ? '2026' : /salary|compensation/i.test(label) ? '120000' : '3') : textVal(label);
        setNative(el, val); ok = String(el.value || '').trim().length > 0; reason = ok ? '' : 'value not set';
      }
    } catch (e) { reason = 'error:' + String(e.message || e).slice(0, 32); }
    report.push({ label, kind, ok, reason, required: el.required || el.getAttribute('aria-required') === 'true' });
  }

  // Ashby (and similar) render Yes/No as buttons, not inputs — drive them too.
  // Match the WRAPPER only (…-yesno), never the option element (…-yesno-option).
  const ynWrappers = [...document.querySelectorAll('[class*="yesno"]')].filter((w) => !/yesno-option|option/.test(w.className));
  for (const yn of ynWrappers) {
    if (!vis(yn) || yn._hrDone) continue; yn._hrDone = true;
    const label = lbl(yn).slice(0, 48);
    const btn = yn.querySelector('[data-option="no"]') || yn.querySelector('[data-option]') || yn.querySelector('button,[role="button"]');
    let ok = false, reason = 'no button';
    if (btn) { press(btn); await sleep(180); ok = !!yn.querySelector('[data-option][aria-pressed="true"], [aria-pressed="true"], [aria-checked="true"]'); reason = ok ? '' : 'not pressed'; }
    report.push({ label, kind: 'yesno', ok, reason, required: false });
  }

  const grp = (k) => report.filter((r) => r.kind === k);
  const combo = [...grp('combobox'), ...grp('autocomplete')];
  return {
    url: location.href.slice(0, 90), host: location.hostname, total: report.length,
    counts: { combobox: combo.length, comboOk: combo.filter((r) => r.ok).length, select: grp('select').length, selOk: grp('select').filter((r) => r.ok).length, text: grp('text').length + grp('email').length + grp('tel').length + grp('url').length, radio: grp('radio').length, yesno: grp('yesno').length, yesnoOk: grp('yesno').filter((r) => r.ok).length, typeahead: grp('typeahead').length, typeaheadOk: grp('typeahead').filter((r) => r.ok).length },
    fail: report.filter((r) => !r.ok).map((r) => ({ label: r.label, kind: r.kind, reason: r.reason, req: r.required })),
    fileInputs: document.querySelectorAll('input[type=file]').length,
  };
};
