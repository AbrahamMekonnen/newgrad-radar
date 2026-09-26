(() => {
  if (window.__hireRadarAutoApplyLoaded) return;
  window.__hireRadarAutoApplyLoaded = true;
  const MARKER = 'newgrad-radar=';
  const CACHE_KEY = 'newgrad-radar-handoff-v2';
  const normalize = (value) => String(value || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ATS = globalThis.HireRadarATS;
  const EXEC = globalThis.HireRadarExecution;

  // Messaging that can never throw. chrome.runtime.sendMessage throws
  // "Extension context invalidated" (synchronously) when this content script is
  // orphaned — e.g. the tab was open before the extension was reloaded — and
  // rejects when no receiver is listening. Either would abort the fill loop, so
  // always go through here and treat failure as "no worker available".
  const send = (message, timeoutMs = 12000) => {
    try {
      const request = Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
    } catch {
      return Promise.resolve(null);
    }
  };

  const decode = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), (c) =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  };

  const setNativeValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const buttonText = (button) => normalize(button.textContent);
  const clickManualEntry = async (field) => {
    if (!String(field.name || '').endsWith('_text') && field.category !== 'cover_letter') return;
    const buttons = [...document.querySelectorAll('button')]
      .filter((button) => buttonText(button).includes('enter manually'));
    const target = field.category === 'cover_letter'
      ? (buttons.find((button) => normalize(button.parentElement?.parentElement?.textContent).includes('cover letter')) || buttons.at(-1))
      : buttons[0];
    if (target) {
      target.click();
      await wait(500);
    }
  };

  const byLabel = (label) => {
    const wanted = normalize(label);
    if (!wanted) return null;
    const labels = [...document.querySelectorAll('label')];
    const found = labels.find((item) => {
      const got = normalize(item.textContent);
      return got === wanted || (wanted.length > 5 && (got.includes(wanted) || wanted.includes(got)));
    });
    if (found?.htmlFor) return document.getElementById(found.htmlFor);
    return found?.querySelector('input, textarea, select, [role="combobox"]')
      || found?.parentElement?.querySelector('input, textarea, select, [role="combobox"]')
      || null;
  };

  const findField = (field) => {
    const adapterField = ATS?.detect(location.href)?.findField?.(document, field);
    if (adapterField) return adapterField;
    const aliases = {
      location: ['candidate-location'],
      city: ['candidate-location'],
      school: ['school--0'],
      degree: ['degree--0'],
      major: ['discipline--0'],
    };
    const ids = [field.name, ...(aliases[field.category] || [])].filter(Boolean);
    for (const id of ids) {
      const exact = document.getElementById(String(id));
      if (exact) return exact;
    }
    if (field.name) {
      const exact = document.getElementsByName(field.name)[0];
      if (exact) return exact;
      const named = [...document.querySelectorAll('[name]')];
      const suffix = named.find((el) => String(el.getAttribute('name')).endsWith(String(field.name)))
        || named.find((el) => String(el.getAttribute('name')).includes(String(field.name)));
      if (suffix) return suffix;
    }
    return byLabel(field.label);
  };

  const answerLabel = (field) => {
    const match = (field.values || []).find((item) => String(item.value) === String(field.value));
    return String(match?.label ?? field.value ?? '');
  };

  // The visible text for a control, by standard semantics (aria-label, an
  // associated <label for>, or a wrapping <label>) — NOT the parent's text,
  // which is often an empty wrapper. Works on any well-formed form regardless
  // of the site's markup/classes.
  const labelTextFor = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      try {
        const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (forLabel) return forLabel.textContent;
      } catch { /* invalid id for a selector */ }
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return wrap.textContent;
    return el.parentElement?.textContent || '';
  };

  const checkboxGroupFor = (element) => {
    const container = element?.closest?.('.application-question, fieldset, [role="group"], [class*="question"]');
    if (!container) return element ? [element] : [];
    const boxes = [...container.querySelectorAll('input[type="checkbox"]')]
      .filter((item) => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true');
    return boxes.length ? boxes : (element ? [element] : []);
  };

  const optionMatches = (text, wanted) => {
    const got = normalize(text);
    const target = normalize(wanted);
    if (!got || !target) return false;
    if (got === target || got.includes(target) || target.includes(got)) return true;
    if (/decline|self identify|prefer not|do not wish|don t wish|not wish to answer/.test(target)
      && /decline|prefer not|do not wish|don t wish|not wish to answer|choose not to disclose/.test(got)) return true;
    const targetTokens = new Set(target.split(' ').filter((x) => x.length > 2));
    const gotTokens = new Set(got.split(' ').filter((x) => x.length > 2));
    if (!targetTokens.size) return false;
    const overlap = [...targetTokens].filter((x) => gotTokens.has(x)).length;
    return overlap / targetTokens.size >= 0.65;
  };

  // Pick the BEST-matching candidate, not the first over a loose threshold.
  // Options often share most words (e.g. work-auth choices), so an exact label
  // must win over a partial one. Generic — works on any option set.
  const bestMatch = (candidates, wanted, textOf) => {
    const target = normalize(wanted);
    if (!target) return null;
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const got = normalize(textOf(c));
      if (!got) continue;
      let score = 0;
      if (got === target) score = 3;
      else if (got.includes(target) || target.includes(got)) score = 2;
      else {
        const tt = target.split(' ').filter((x) => x.length > 2);
        const gt = new Set(got.split(' ').filter((x) => x.length > 2));
        const overlap = tt.filter((x) => gt.has(x)).length / (tt.length || 1);
        if (overlap >= 0.65) score = 1 + overlap - Math.abs(gt.size - tt.length) / 100; // tie-break tighter text
      }
      if (target.includes('decline') && (got.includes('decline') || got.includes('prefer not'))) score = Math.max(score, 2);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore > 0 ? best : null;
  };

  const degreeLevel = (value) => {
    const text = normalize(value);
    if (/\b(phd|ph d|doctor|doctorate)\b/.test(text)) return 'doctorate';
    if (/\b(master|masters|ms|m s|mba|ma|m a)\b/.test(text)) return 'master';
    if (/\b(bachelor|bachelors|bs|b s|ba|b a)\b/.test(text)) return 'bachelor';
    if (/\b(associate|associates|aa|a a|as|a s)\b/.test(text)) return 'associate';
    if (/\b(high school|secondary|ged)\b/.test(text)) return 'high_school';
    return '';
  };
  const semanticOption = (field, wanted, candidates) => {
    const matched = ATS?.matchOption(field.label, wanted, candidates.map((item) => item.textContent));
    if (matched) return candidates.find((item) => normalize(item.textContent) === normalize(matched)) || null;
    const question = normalize(field.label);
    if (/degree|education level|qualification/.test(question)) {
      const level = degreeLevel(wanted);
      if (level) return candidates.find((item) => degreeLevel(item.textContent) === level) || null;
    }
    return null;
  };
  const unresolvedChoiceSignatures = new Map();
  const resolutionState = new Map();
  const fieldKey = (field) => ATS?.stableFieldKey(field) || (normalize(field.label)
    ? [normalize(field.label), normalize(field.type)].filter(Boolean).join('|')
    : [String(field.name || ''), normalize(field.type)].filter(Boolean).join('|'));
  const visibleOptions = (owner) => {
    const controlledId = owner?.getAttribute?.('aria-controls') || owner?.getAttribute?.('aria-owns');
    const controlled = controlledId && document.getElementById(controlledId);
    const nearbyPopup = owner?.closest?.('[class*=select], [class*=combobox], [role=group]')
      ?.querySelector?.('[role=listbox], [role=menu], [class*=menu], [class*=options]');
    const root = controlled || nearbyPopup || document;
    const selector = [
      '[role="option"]', '[role="menuitemradio"]', '[role="radio"]',
      '[data-option-index]', '[data-value]', '[aria-selected]',
      '.dropdown-results > *', '[class*="option"]', '[class*="menu"] li',
    ].join(',');
    const items = [...root.querySelectorAll(selector)]
      .filter((item) => item !== owner && item.getClientRects().length > 0
        && item.getAttribute('aria-hidden') !== 'true' && normalize(item.textContent));
    return [...new Set(items)].filter((item) =>
      !items.some((other) => other !== item && item.contains(other)
        && normalize(other.textContent) === normalize(item.textContent)));
  };

  const fillCombo = async (element, field) => {
    const wanted = answerLabel(field);
    const existing = normalize(element.value || element.textContent);
    const isLocation = /location/i.test([field.label, field.category, element.id, element.name].filter(Boolean).join(' '));
    const isCountry = /country/i.test(String(field.label || element.id || element.name || ''));
    const selectedLocation = isLocation && document.querySelector('#selected-location, input[name="selectedLocation"]');
    if (existing && existing !== 'select' && optionMatches(existing, wanted) && (!selectedLocation || selectedLocation.value)) return true;
    if (existing && existing !== 'select' && !isLocation) return true;

    element.focus();
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.click();
    await wait(350);
    let candidates = visibleOptions(element);
    if (!candidates.length) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      await wait(350);
      candidates = visibleOptions(element);
    }
    let option = candidates.find((item) => optionMatches(item.textContent, wanted))
      || semanticOption(field, wanted, candidates);
    const initialSignature = candidates.map((item) => normalize(item.textContent)).join('|');
    if (!option && initialSignature && unresolvedChoiceSignatures.get(field.name) === initialSignature) return false;
    if (!option && element instanceof HTMLInputElement) {
      element.focus();
      const searchValue = isLocation ? wanted.split(',')[0].trim() : wanted;
      setNativeValue(element, searchValue);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: searchValue }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: searchValue.slice(-1) || 'a', bubbles: true }));
      await wait(isLocation ? 1800 : isCountry ? 700 : 350);
      candidates = visibleOptions(element);
      option = candidates.find((item) => optionMatches(item.textContent, wanted))
        || semanticOption(field, wanted, candidates);
      if (!option && isLocation) {
        const matched = ATS?.matchLocationOption?.(wanted, candidates.map((item) => item.textContent));
        option = matched ? candidates.find((item) => normalize(item.textContent) === normalize(matched)) : null;
      }
    }
    if (!option && isLocation && element instanceof HTMLInputElement) {
      // Async city selectors sometimes render after their first debounce. Commit
      // the first ATS suggestion only after searching with the verified city.
      await wait(1500);
      candidates = visibleOptions(element);
      const matched = ATS?.matchLocationOption?.(wanted, candidates.map((item) => item.textContent));
      option = matched ? candidates.find((item) => normalize(item.textContent) === normalize(matched)) : null;
      if (!option && candidates.length === 1) option = candidates[0];
    }
    if (!option && isCountry && element instanceof HTMLInputElement) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      await wait(300);
      if (controlHasValue(element, field)) return true;
    }
    if (!option && isLocation && ATS?.detect(location.href)?.type === 'lever' && selectedLocation) {
      // Lever gates its autocomplete lookup behind hCaptcha. The final form accepts
      // the candidate-supplied city in both location fields, so retain that value
      // when the lookup cannot return suggestions instead of looping on No results.
      setNativeValue(element, wanted);
      setNativeValue(selectedLocation, wanted);
      element.blur();
      return Boolean(String(selectedLocation.value || '').trim());
    }
    if (!option) {
      // Portalled or virtualized listboxes may expose no option nodes. Use the
      // standard combobox keyboard contract with the exact resolved answer.
      element.focus();
      if (element instanceof HTMLInputElement) {
        setNativeValue(element, wanted);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
        await wait(350);
      }
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      await wait(300);
      if (controlHasValue(element, field)) return true;
      const signature = candidates.map((item) => normalize(item.textContent)).join('|') || initialSignature;
      if (signature) unresolvedChoiceSignatures.set(field.name, signature);
      if (element instanceof HTMLInputElement) setNativeValue(element, '');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      element.blur();
      return false;
    }
    unresolvedChoiceSignatures.delete(field.name);
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    if (option.isConnected) option.click();
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(250);
    if (controlHasValue(element, field)) return true;

    // Some React controls ignore synthetic option clicks but accept the same
    // exact choice through their keyboard contract.
    element.focus();
    if (element instanceof HTMLInputElement) {
      setNativeValue(element, wanted);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
      await wait(350);
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await wait(300);
    return controlHasValue(element, field);
  };
  const fillScopedChoice = (field) => {
    const question = normalize(field.label);
    const wanted = answerLabel(field);
    const containers = [...document.querySelectorAll('fieldset, [role="radiogroup"], [class*="field"], [class*="question"], form > div')];
    const container = containers.filter((item) => normalize(item.textContent).includes(question))
      .sort((a, b) => String(a.textContent).length - String(b.textContent).length)[0];
    if (!container) return false;
    const choices = [...container.querySelectorAll('label, button, [role="radio"], [role="option"]')]
      .filter((item) => item.getClientRects().length > 0);
    const choice = bestMatch(choices, wanted, (item) => item.textContent);
    if (!choice) return false;
    const input = choice.querySelector?.('input') || (choice.htmlFor && document.getElementById(choice.htmlFor));
    (input || choice).click();
    (input || choice).dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const fill = async (field) => {
    let element = findField(field);
    if (!element) {
      await clickManualEntry(field);
      element = findField(field);
    }
    if (!element) return fillScopedChoice(field);
    const value = field.value;
    if (element.type === 'file') {
      if (!value || typeof value !== 'string') return false;
      if (field.category === 'cover_letter' && !/^https?:\/\//i.test(value)) {
        await clickManualEntry(field);
        const manual = document.querySelector('textarea[name="cover_letter_text"], textarea#cover_letter_text');
        if (!manual) return false;
        setNativeValue(manual, value);
        return String(manual.value || '').trim().length > 0;
      }
      try {
        const fileUrl = new URL(value);
        if (fileUrl.hostname !== 'jmrbyubrrpxxvotsljms.supabase.co' || !fileUrl.pathname.includes('/storage/v1/object/public/resumes/')) return false;
        const downloaded = await send({ type: 'FETCH_FILE', url: fileUrl.href }, 20000);
        if (!downloaded?.data) return false;
        const binary = atob(downloaded.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], downloaded.name || 'resume.pdf', { type: downloaded.type || 'application/pdf' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        element.files = transfer.files;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return element.files?.length === 1;
      } catch { return false; }
    }

    if (element instanceof HTMLSelectElement) {
      const wanted = answerLabel(field);
      let option = [...element.options].find((item) => String(item.value) === String(value))
        || [...element.options].find((item) => optionMatches(item.textContent, wanted));
      if (!option) return false;
      element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return String(element.value) === String(option.value);
    }
    if (
      element.getAttribute('role') === 'combobox'
      || element.getAttribute('aria-autocomplete')
      || /location/i.test(String(element.id || element.name || ''))
    ) return fillCombo(element, field);
    if (element.type === 'radio') {
      const fieldset = element.closest('fieldset');
      const radios = [...document.querySelectorAll('input[type="radio"]')]
        .filter((item) => item.name === element.name || (fieldset && item.closest('fieldset') === fieldset));
      // Only trust a value match when the radios actually have distinct values —
      // many forms render every option with value="on" and differentiate by
      // label, so match on the associated label text in that case.
      const distinctValues = new Set(radios.map((item) => String(item.value))).size > 1;
      const option = (distinctValues && radios.find((item) => String(item.value) === String(value)))
        || bestMatch(radios, answerLabel(field), labelTextFor);
      if (!option) return fillScopedChoice(field);
      option.click();
      option.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (element.type === 'checkbox') {
      const adapter = ATS?.detect(location.href);
      if (adapter?.fillCheckbox?.(element, answerLabel(field))) return true;
      if (field.type === 'checkbox-group') {
        const boxes = checkboxGroupFor(element);
        const option = bestMatch(boxes, answerLabel(field), labelTextFor);
        if (!option) return false;
        if (!option.checked) option.click();
        option.dispatchEvent(new Event('change', { bubbles: true }));
        return Boolean(option.checked);
      }
      const checked = !['false', 'no', '0', ''].includes(normalize(value));
      if (element.checked !== checked) element.click();
      return element.checked === checked;
    }
    if (String(element.value || '').trim()) return true; // never overwrite user edits
    setNativeValue(element, value);
    return true;
  };

  const planChoiceAnswers = (fields) => {
    const planned = new Map();
    for (const field of fields) {
      const element = findField(field);
      if (!(element instanceof HTMLSelectElement)) continue;
      const wanted = answerLabel(field);
      const choices = [...element.options].map((item) => item.textContent.trim()).filter(Boolean);
      const exact = [...element.options].find((item) =>
        String(item.value) === String(field.value) || optionMatches(item.textContent, wanted));
      const matched = exact?.textContent?.trim() || ATS?.matchOption?.(field.label, wanted, choices);
      if (matched) planned.set(field.name, { value: matched, source: field.source || 'profile' });
      // Unknown selections intentionally remain unresolved. The complete-form
      // preflight handles them after every known field has already been filled.
    }
    return planned;
  };
  const banner = (message, error = false) => {
    let box = document.getElementById('newgrad-radar-helper');
    if (!box) {
      box = document.createElement('div');
      box.id = 'newgrad-radar-helper';
      Object.assign(box.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        maxWidth: '390px', padding: '12px 16px', borderRadius: '10px', color: '#fff',
        font: '14px/1.4 system-ui', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
      });
      document.body.appendChild(box);
    }
    box.style.background = error ? '#b91c1c' : '#4f46e5';
    box.textContent = message;
  };

  const loadPayload = async () => {
    try {
      const worker = await send({ type: 'PAGE_READY' });
      if (worker?.job) {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        // Preserve runtime state across the periodic fill/submit passes. The
        // worker payload is authoritative for the lease and prepared fields;
        // the cache carries submit attempts, upload timers, and receipts.
        return cached?.id === worker.job.id
          ? { ...cached, ...worker.job, fields: worker.job.fields, browserWorker: true }
          : { ...worker.job, browserWorker: true };
      }
    } catch { /* legacy handoff remains available */ }
    const part = location.hash.split('&')
      .find((item) => item.replace(/^#/, '').startsWith(MARKER));
    if (part) {
      const encoded = part.replace(/^#/, '').slice(MARKER.length);
      const { origin, token } = decode(encoded);
      history.replaceState(null, '', location.pathname + location.search);
      const response = await fetch(origin + '/api/auto-apply/handoff?token=' + encodeURIComponent(token));
      if (!response.ok) throw new Error('Prepared answers expired. Open the application from HireRadar again.');
      const data = await response.json();
      data.handoffOrigin = origin;
      data.handoffToken = token;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
      return data;
    }
    const cached = sessionStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  };

  const sameJob = (data) => {
    if (!data?.jobUrl) return true;
    const ids = (url) => String(url).match(/[0-9]{6,}|[0-9a-f]{8}-[0-9a-f-]{20,}/gi) || [];
    const current = new Set(ids(location.href));
    const expected = ids(data.jobUrl);
    return !current.size || !expected.length || expected.some((id) => current.has(id));
  };

  const isSuccessPage = (data) => {
    const adapter = ATS?.detect(location.href, data?.atsType);
    if ((data?.submitAttempts || 0) > 0 && adapter?.submissionComplete?.(document)) return true;
    // ATS clients often leave the old form mounted but hidden after success.
    // Only a visible, enabled submit control inside a form means the
    // application can still be submitted.
    const activeSubmit = [...document.querySelectorAll('button, input[type="submit"]')]
      .some((item) => {
        const text = normalize(item.textContent || item.value);
        return item.getClientRects().length > 0
          && !item.disabled
          && !!item.closest('form')
          && ['submit application', 'submit', 'apply'].includes(text);
      });
    if (activeSubmit) return false;

    const urlSignal = normalize(location.pathname + ' ' + location.search + ' ' + location.hash);
    const successUrl = [
      'thank-you', 'thank_you', 'application-submitted', 'application_submitted',
      'application-success', 'application_success', 'submission-confirmation',
    ].some((phrase) => urlSignal.includes(phrase));

    // Confirmation copy is frequently rendered in an ordinary div/paragraph,
    // not an h1, role=status, or role=alert.
    const signalText = normalize([
      document.title,
      document.body?.innerText || '',
    ].join(' ')).slice(0, 20000);
    const successText = [
      'thank you for applying',
      'thanks for applying',
      'thank you for submitting your application',
      'we will be in touch if there is a fit',
      'application has been submitted',
      'application was submitted',
      'application submitted',
      'successfully submitted your application',
      'we received your application',
      'we have received your application',
      'your application was received',
      'your application has been received',
      'application is complete',
      'application was already submitted',
      'your application is in',
    ].some((phrase) => signalText.includes(phrase));
    const adapterEvidence = ATS?.successEvidence(location.href, signalText);
    return adapterEvidence?.confirmed || successUrl || successText;
  };

  const persist = (data) => sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));

  const reportSuccess = async (data) => {
    if (data.reported) return;
    if (data.browserWorker) {
      const result = await send({ type: 'PROGRESS', stage: 'submitted' });
      if (!result?.ok) throw new Error(result?.error || 'HireRadar could not record the submission.');
      data.reported = true;
      persist(data);
      return;
    }
    if (!data.handoffOrigin || !data.handoffToken) return;
    const response = await fetch(data.handoffOrigin + '/api/auto-apply/handoff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.handoffToken, status: 'submitted' }),
    });
    if (!response.ok) throw new Error('The ATS accepted the application, but HireRadar could not update its status.');
    data.reported = true;
    persist(data);
  };

  const fieldLabelFor = (element) => {
    const adapterLabel = ATS?.detect(location.href)?.labelFor?.(element);
    if (adapterLabel) return adapterLabel.slice(0, 1000);
    const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').filter(Boolean).join(' ');
    const container = element.closest('.application-question, fieldset, [class*=field], [class*=question], [class*=phone], [data-testid]');
    const heading = container?.querySelector('legend, label, .application-label, [class*=label], [class*=heading]');
    const primary = String(element.labels?.[0]?.textContent || element.getAttribute('aria-label') || labelledBy
      || heading?.textContent || element.getAttribute('placeholder') || container?.textContent || '')
      .replace(/\s+/g, ' ').trim();
    const genericChoice = /^(acknowledge|agree|yes|no|accept|decline)$/i.test(primary);
    const contextual = genericChoice ? String(container?.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return (contextual || primary).slice(0, 1000);
  };
  const questionContainerFor = (element) => element.closest(
    '.application-question, fieldset, [role="radiogroup"], [role="group"], [data-field-path], [data-automation-id*="question"], [class*="question"]'
  );
  const elementIsRequired = (element, label) => {
    // Explicit optional state is authoritative. Broad ATS sections often also
    // contain required controls and must not promote this control to required.
    if (element.getAttribute('aria-required') === 'false'
      || element.getAttribute('data-required') === 'false') return false;
    if (element.required || element.getAttribute('aria-required') === 'true'
      || element.getAttribute('data-required') === 'true') return true;
    const question = questionContainerFor(element);
    if (element.type === 'radio' && element.name) {
      const group = [...document.querySelectorAll('input[type="radio"]')]
        .filter((item) => item.name === element.name);
      if (group.some((item) => item.required || item.getAttribute('aria-required') === 'true')) return true;
    }
    const marker = question?.querySelector(
      '[data-required="true"], [aria-label*="required" i], .required-indicator, .field-required, [class~="required"]'
    );
    return Boolean(marker || /(?:\*|\u2731)\s*$/.test(String(label || '').trim()));
  };
  const liveFieldFor = (element, index = 0) => {
    let name = element.name || element.id || element.dataset.hireradarField;
    if (!name) {
      name = 'hireradar-anonymous-' + index + '-' + Math.random().toString(36).slice(2, 8);
      element.dataset.hireradarField = name;
    }
    const options = element instanceof HTMLSelectElement
      ? [...element.options].map((option) => option.textContent.trim()).filter(Boolean)
      : [];
    const semanticType = element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete')
      ? 'combobox'
      : element.type || element.getAttribute('role');
    const label = fieldLabelFor(element);
    const sectionElement = element.closest('fieldset, [role="group"], [data-field-path], [data-automation-id*="section"], section');
    const section = String(
      sectionElement?.querySelector?.('legend, h2, h3, h4, [class*=heading], [class*=title]')?.textContent || ''
    ).replace(/\s+/g, ' ').trim().slice(0, 300);
    const identity = String(element.name || element.id || element.dataset.hireradarField || index);
    const fieldId = [normalize(section), normalize(label), normalize(semanticType), normalize(identity)]
      .filter(Boolean).join('|');
    const adapter = ATS?.detect(location.href);
    const required = Boolean(elementIsRequired(element, label) || adapter?.isRequired?.(element));
    return { name, fieldId, label, section, type: semanticType, required, options, optionSignature: ATS?.optionSignature?.(options) || '' };
  };
  const controlHasValue = (element, field) => {
    const adapterAccepted = ATS?.detect(location.href)?.fieldAccepted?.(element, answerLabel(field || {}));
    if (adapterAccepted !== null && adapterAccepted !== undefined) return adapterAccepted;
    if (element.type === 'radio') {
      return [...document.querySelectorAll('input[type=\"radio\"]')].some((item) => item.name === element.name && item.checked);
    }
    if (element.type === 'checkbox') {
      if (field?.type === 'checkbox-group') {
        const boxes = checkboxGroupFor(element);
        const wanted = answerLabel(field);
        const option = bestMatch(boxes, wanted, labelTextFor);
        return option ? Boolean(option.checked) : boxes.some((item) => item.checked);
      }
      return element.checked;
    }
    if (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete')) {
      // React-Select keeps search text in the input while no option is selected.
      // Require retained selection UI rather than treating that search text as
      // a completed answer.
      let container = element.parentElement;
      for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
        const selected = container.querySelector(':scope > [class*=singleValue], :scope > [class*=single-value], [aria-selected=true]');
        const text = String(selected?.textContent || '').trim();
        if (text && !/^select|^choose/i.test(text)) return true;
      }
      return false;
    }
    if (String(element.value || '').trim()) return true;
    return false;
  };
  const isKnownOptionalField = (label) => /(?:gender(?: identity)?|race|ethnic|hispanic|latino|veteran|disabilit|sexual orientation|demographic|self.identif|work authori[sz]ation|sponsor|privacy|data consent|terms|how did you hear|referral source|previously worked|former employee)/i.test(String(label || ''));

  const scanUnfilledFields = ({ includeOptionalKnown = false } = {}) => {
    const adapter = ATS?.detect(location.href);
    const submit = adapter?.findSubmit?.(document)
      || [...document.querySelectorAll('button, input[type="submit"]')].find((item) => /submit|apply/i.test(String(item.textContent || item.value || '')));
    const root = adapter?.validationRoot?.(submit) || submit?.form || submit?.closest('form')
      || adapter?.formSelectors?.map((selector) => document.querySelector(selector)).find(Boolean)
      || document.querySelector('form');
    if (!root) return [];
    const controls = [...root.querySelectorAll('input, textarea, select, [role="combobox"]')];
    const seen = new Set();
    return controls.flatMap((element, index) => {
      if (element.getClientRects().length === 0 || element.getAttribute('aria-hidden') === 'true'
        || ['hidden', 'file', 'submit', 'button'].includes(element.type)) return [];
      const descriptor = liveFieldFor(element, index);
      if (!descriptor.required && !(includeOptionalKnown && isKnownOptionalField(descriptor.label))) return [];
      const name = descriptor.name;
      if (seen.has(name)) return [];
      seen.add(name);

      if (element.type === 'checkbox') {
        const group = checkboxGroupFor(element);
        if (group.length > 1) {
          if (group.some((item) => item.checked)) return [];
          const options = group.map((item) => String(labelTextFor(item) || item.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
          return [{ ...descriptor, type: 'checkbox-group', options, optionSignature: ATS?.optionSignature?.(options) || '' }];
        }
      }

      if (element.type === 'radio') {
        const group = controls.filter((item) => item.type === 'radio' && item.name === element.name);
        if (group.some((item) => item.checked)) return [];
        const container = element.closest('.application-question, fieldset, [role="radiogroup"], [class*="question"]');
        const heading = container?.querySelector('legend, .application-label .text, .application-label, [class*="question-label"]');
        const label = heading?.textContent || container?.textContent || element.getAttribute('aria-label') || '';
        const options = group.map((item) => labelTextFor(item) || item.value).map((value) => String(value).trim()).filter(Boolean);
        return [{ ...descriptor, label: String(label).replace(/\s+/g, ' ').trim().slice(0, 1000), type: 'radio', options, optionSignature: ATS?.optionSignature?.(options) || '' }];
      }

      if (controlHasValue(element, descriptor)) return [];
      return [descriptor];
    }).filter((field) => field.label);
  };
  const fieldAccepted = (field) => {
    const element = findField(field);
    if (!element) return false;
    return controlHasValue(element, field) || Boolean(String(element.textContent || '').trim());
  };
  const resolveFieldBounded = async (field, validationMessage = '') => {
    const key = fieldKey(field);
    const state = resolutionState.get(key) || { attempt: 0, signatures: new Set(), planId: null };
    if (state.accepted || state.exhausted || state.attempt >= 2) return { accepted: Boolean(state.accepted) };
    for (let attempt = Math.max(1, state.attempt + 1); attempt <= 2; attempt++) {
      const element = findField(field);
      if ((!field.options || !field.options.length) && element && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete'))) {
        element.click(); await wait(500);
        field.options = visibleOptions(element).map((item) => String(item.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      const options = (field.options || []).map((value) => String(value).trim()).filter(Boolean);
      const signature = JSON.stringify([attempt, options.map(normalize), validationMessage, field.currentValue || '']);
      if (state.signatures.has(signature)) break;
      state.signatures.add(signature); state.attempt = attempt; resolutionState.set(key, state);
      const response = await send({ type: 'RESOLVE_FIELDS', planId: state.planId, fields: [{ ...field, attempt, currentValue: String(findField(field)?.value || ''), validation: { message: validationMessage, accepted: false } }] }, 30000);
      state.planId = response?.planId || state.planId;
      const answer = response?.answers?.find((item) => ATS?.answerMatchesField?.(field, item) ?? (item.name === field.name && item.safeToApply !== false));
      if (!answer) { state.lastFailure = 'no_safe_answer'; resolutionState.set(key, state); continue; }
      field.value = answer.value;
      const current = findField(field);
      if (!current) { state.lastFailure = 'field_missing'; resolutionState.set(key, state); continue; }
      const applied = await fill({ ...field, value: answer.value, source: answer.source });
      await wait(150);
      if (applied && fieldAccepted(field)) { state.accepted = true; state.answerSource = answer.source; resolutionState.set(key, state); return { accepted: true, answer }; }
      state.answerSource = answer.source;
      state.lastFailure = applied ? 'not_retained' : 'apply_failed';
      resolutionState.set(key, state);
      validationMessage = findField(field)?.validationMessage || 'The ATS did not retain the selected value.';
    }
    state.exhausted = true; resolutionState.set(key, state); return { accepted: false };
  };
  const resolveFieldsBatch = async (fields) => {
    const outcomes = new Map(fields.map((field) => [fieldKey(field), { accepted: false }]));
    let planId = null;
    const requestFields = (targets, attempt) => targets.map((field) => ({
      ...field,
      attempt,
      currentValue: String(findField(field)?.value || ''),
      optionSignature: ATS?.optionSignature?.(field.options) || '',
      validation: {
        message: findField(field)?.validationMessage || '',
        accepted: false,
        optionSignature: ATS?.optionSignature?.(field.options) || '',
      },
    }));

    // Apply each control once. A hostile widget may consume its own bounded
    // allowance, but it cannot block or repeatedly recapture the form loop.
    const applyAnswers = async (targets, response, attempt) => {
      planId = response?.planId || planId;
      const answers = new Map((response?.answers || [])
        .filter((answer) => answer.safeToApply !== false)
        .map((answer) => [answer.fieldId || answer.name, answer]));
      const deferred = new Set(response?.deferredAi || []);
      const aiTargets = [];
      for (const field of targets) {
        const key = fieldKey(field);
        const state = resolutionState.get(key) || { attempt: 0, signatures: new Set(), planId };
        state.attempt = attempt;
        state.planId = planId;
        const answer = answers.get(field.fieldId || field.name);
        if (answer && ATS?.answerMatchesField && !ATS.answerMatchesField(field, answer)) {
          state.lastFailure = 'stale_plan';
          resolutionState.set(key, state);
          continue;
        }
        if (!answer) {
          state.lastFailure = response
            ? (deferred.has(field.name) ? 'deferred_to_ai' : 'no_safe_answer')
            : 'resolver_timeout';
          resolutionState.set(key, state);
          if (deferred.has(field.name)) aiTargets.push(field);
          continue;
        }
        state.answerSource = answer.source;
        field.value = answer.value;
        if (!findField(field)) {
          state.lastFailure = 'field_missing';
          resolutionState.set(key, state);
          continue;
        }
        let applied;
        try {
          // fill() is internally bounded. Racing it against a timer does not
          // cancel it; the abandoned operation keeps clicking after the next
          // field starts. Keep interactive widgets strictly sequential.
          applied = await fill({ ...field, value: answer.value, source: answer.source });
        } catch {
          state.lastFailure = 'apply_error';
          resolutionState.set(key, state);
          continue;
        }
        await wait(180);
        if (applied && fieldAccepted(field)) {
          state.accepted = true;
          delete state.lastFailure;
          outcomes.set(key, { accepted: true, answer });
        } else {
          state.lastFailure = applied ? 'not_retained' : 'apply_failed';
        }
        resolutionState.set(key, state);
      }
      return aiTargets;
    };

    // Phase 1 never invokes AI. It returns saved/profile answers quickly and
    // identifies only prose questions that are eligible for the slower pass.
    const fastResponse = await send({
      type: 'RESOLVE_FIELDS', planId, fields: requestFields(fields, 1), fastOnly: true,
    }, 15000);
    const aiTargets = await applyAnswers(fields, fastResponse, 1);

    // Phase 2 starts only after every deterministic field has been attempted.
    if (aiTargets.length) {
      const aiResponse = await send({
        type: 'RESOLVE_FIELDS', planId, fields: requestFields(aiTargets, 2), fastOnly: false,
      }, 30000);
      await applyAnswers(aiTargets, aiResponse, 2);
    }

    for (const field of fields) {
      const state = resolutionState.get(fieldKey(field));
      if (state && !state.accepted) {
        state.exhausted = true;
        resolutionState.set(fieldKey(field), state);
      }
    }
    return fields.map((field) => outcomes.get(fieldKey(field)) || { accepted: false });
  };
  const smartRecruitersDirectUrl = () => {
    const scripts = [...document.scripts].map((script) => script.textContent || '').join('\n');
    const company = scripts.match(/cident:\s*['"]([^'"]+)['"]/)?.[1];
    const publication = scripts.match(/puuid:\s*['"]([^'"]+)['"]/)?.[1];
    if (!company || !publication) return '';
    return 'https://jobs.smartrecruiters.com/oneclick-ui/company/' + encodeURIComponent(company)
      + '/publication/' + encodeURIComponent(publication) + '?dcr_ci=' + encodeURIComponent(company);
  };
  const canonicalGreenhouseApplication = (data) => {
    if (/job-boards\.greenhouse\.io$/.test(location.hostname)) return '';
    const params = new URLSearchParams(location.search);
    const jobId = params.get('gh_jid') || location.pathname.match(/\/jobs?\/(\d+)/)?.[1];
    if (!jobId) return '';
    const knownBoards = {
      'mongodb.com': 'mongodb',
      'www.mongodb.com': 'mongodb',
      'careers.roblox.com': 'roblox',
      'careers.withwaymo.com': 'waymo',
      'www.samsara.com': 'samsara',
    };
    const company = normalize(data?.companyName || '').replace(/ /g, '');
    const board = knownBoards[location.hostname] || company;
    if (!board || !/^\d+$/.test(jobId)) return '';
    return 'https://job-boards.greenhouse.io/embed/job_app?for='
      + encodeURIComponent(board) + '&token=' + encodeURIComponent(jobId);
  };
  const openApplicationForm = () => {
    const actions = [...document.querySelectorAll('a, button')];
    const stableTrigger = document.querySelector('#st-apply, .job-apply .js-oneclick');
    const trigger = (stableTrigger && stableTrigger.getAttribute('aria-hidden') !== 'true' ? stableTrigger : null) || actions.find((item) => {
      if (item.getClientRects().length === 0 || item.getAttribute('aria-hidden') === 'true') return false;
      const text = normalize(item.textContent).replace(/\s+/g, '');
      return [
        'applynow', 'applyforthisjob', 'startapplication', 'applytothisjob',
        'iminterested', 'interested',
      ].includes(text);
    });
    if (!trigger) return false;
    banner('HireRadar is opening the application form…');
    trigger.click();
    return true;
  };
  const visibleAtsErrors = () => {
    const selectors = '[role=alert], [aria-live=assertive], .field-error, .error-message, .input-error, .flash-error, [aria-invalid=true]';
    const text = [...document.querySelectorAll(selectors)]
      .filter((item) => item.getClientRects().length > 0)
      .map((item) => String(item.textContent || item.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const body = String(document.body?.innerText || '').split(/\n+/).map((value) => value.trim())
      .filter((value) => /captcha|error|unable|failed|try again|required field/i.test(value));
    return [...new Set([...text, ...body])].filter((value) => !value.includes('HireRadar')).slice(0, 12);
  };
  const submitPreparedForm = async (data) => {
    // Submit when the user opted into auto-submit (data.autoSubmit) OR the server
    // prep already flagged it — but NOT on the stale prep flag alone. This is
    // only reached once every prepared field is filled; checkValidity below is
    // the real completeness gate (the ATS itself confirms all required fields).
    if (!data.autoSubmit && !data.autoSubmitRequested) return false;
    const now = Date.now();
    // A click is an attempt, not proof of submission. Keep it in flight long
    // enough for the ATS response, then permit one controlled retry if the page
    // neither navigated nor displayed a success state.
    if (data.lastSubmitAttemptAt && now - data.lastSubmitAttemptAt < 30000) return true;
    if ((data.submitAttempts || 0) >= 1) {
      const errors = visibleAtsErrors();
      const decision = EXEC?.shouldRetrySubmit?.({ attempts: data.submitAttempts, errors })
        || { retry: false, category: 'unconfirmed' };
      if (decision.retry) {
        data.lastSubmitAttemptAt = 0;
        persist(data);
        banner('The ATS is still processing. HireRadar will make one controlled retry...');
      } else {
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'waiting_for_user',
          detail: { detail: JSON.stringify({
            message: 'The ATS did not confirm the submission; the application was not marked submitted.',
            diagnostic: EXEC?.safeDiagnostic?.({ code: 'submit_unconfirmed', ats: data.atsType, category: decision.category, attempt: data.submitAttempts }),
          }) },
        });
        data.stopAutomation = true;
        persist(data);
        banner('The ATS did not confirm submission. HireRadar did not mark it submitted.', true);
        return false;
      }
    }
    const adapter = ATS?.detect(location.href, data.atsType);
    if (EXEC?.uploadPending?.(document)) {
      data.uploadWaitStartedAt ||= now;
      persist(data);
      const waitedMs = now - data.uploadWaitStartedAt;
      if (!adapter?.uploadReadyOverride?.(document, waitedMs)) {
        if (waitedMs < 15000) {
          banner('HireRadar is waiting for the ATS to finish uploading and processing files...');
          return true;
        }
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'waiting_for_user',
          detail: { detail: JSON.stringify({ message: 'ATS file processing did not finish.', diagnostic: EXEC?.safeDiagnostic?.({ code: 'upload_timeout', ats: data.atsType, category: 'processing' }) }) },
        });
        data.stopAutomation = true;
        persist(data);
        banner('The ATS did not finish processing the uploaded file.', true);
        return false;
      }
    }
    if (data.uploadWaitStartedAt) {
      delete data.uploadWaitStartedAt;
      persist(data);
    }
    const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')];
    const submit = adapter?.findSubmit?.(document) || controls
      .filter((item) => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true' && item.closest('form'))
      .map((item) => {
        const text = normalize(item.textContent || item.value);
        const score = ATS?.scoreSubmitText(text) ?? (/^submit (your )?application\b/.test(text) ? 10
          : text === 'submit' ? 9
            : /^(send|complete) (your )?application\b/.test(text) ? 8
              : text === 'apply' ? 1 : 0);
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.item;
    if (!submit) {
      const next = adapter?.findNext?.(document) || EXEC?.findNextAction?.(document);
      if (next) {
        banner('HireRadar completed this step and is continuing the application...');
        next.click();
        return true;
      }
      if (openApplicationForm()) return true;
      const formControls = document.querySelectorAll('form input, form textarea, form select, form button').length;
      if (formControls === 0) {
        data.noFormSince ||= Date.now();
        persist(data);
        const companyWrapper = /(?:mongodb\.com|roblox\.com|samsara\.com|withwaymo\.com)$/.test(location.hostname)
          || document.querySelectorAll('iframe').length > 0;
        const transitionWindow = companyWrapper ? 30000 : 8000;
        if (EXEC?.withinTransitionGrace?.(data.noFormSince, Date.now(), transitionWindow)) {
          banner('The ATS is changing pages. HireRadar is waiting for the next step or submission receipt...');
          return true;
        }
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'failed',
          detail: { detail: 'The posting did not expose an application form or Apply action after the transition grace period.' },
        });
        data.stopAutomation = true;
        persist(data);
        banner('This posting does not currently expose an application form.', true);
        return false;
      }
      if (data.noFormSince) {
        delete data.noFormSince;
        persist(data);
      }
      const closedText = normalize(document.body?.innerText || '');
      if (/no longer accepting applications|job is no longer available|position has been filled|job not found/.test(closedText)) {
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'failed',
          detail: { detail: 'The ATS indicates that this posting is closed or no longer accepting applications.' },
        });
        banner('This posting is closed or no longer accepting applications.', true);
        return false;
      }
      if (data.browserWorker) await send({
        type: 'PROGRESS', stage: 'waiting_for_user',
        detail: { detail: 'The form is filled, but no visible ATS submit button was found.' },
      });
      banner('HireRadar filled the form but could not find the ATS submit button.', true);
      return false;
    }
    if (submit.disabled) {
      if (data.browserWorker) await send({
        type: 'PROGRESS', stage: 'waiting_for_user',
        detail: { detail: 'The ATS submit button is visible but disabled.' },
      });
      banner('The ATS submit button is still disabled. HireRadar is checking for a missing field...', true);
      return false;
    }
    // Validate the form that actually CONTAINS the submit button, not the first
    // form on the page (Ashby renders a separate "autofill from resume" mini-form
    // whose validity is unrelated). Name the flagged field so we can see it.
    const form = submit.form || submit.closest('form') || adapter?.validationRoot?.(submit) || document.querySelector('form');
    const adapterInvalid = adapter?.findInvalid?.(form);
    const invalids = [...new Set([
      ...(adapterInvalid ? [adapterInvalid] : []),
      ...(EXEC?.requiredInvalids?.(form) || []),
    ])];
    if (invalids.length) {
      const firstInvalid = invalids[0];
      const firstLabel = fieldLabelFor(firstInvalid) || firstInvalid.name || firstInvalid.id;
      if (adapter?.repairInvalid && await adapter.repairInvalid({
        invalid: firstInvalid, label: firstLabel, fields: data.fields || [], fillCombo, wait,
      })) {
        banner('HireRadar repaired the ATS-specific field and is rechecking the complete form...');
        return true;
      }

      // Repair the full invalid set in one resolver transaction. The previous
      // one-field path repeatedly rediscovered the same first error and never
      // reached later questions.
      const scanned = scanUnfilledFields();
      const byKey = new Map(scanned.map((field) => [fieldKey(field), field]));
      invalids.forEach((element, index) => {
        const descriptor = liveFieldFor(element, 10000 + index);
        if (descriptor.label && !byKey.has(fieldKey(descriptor))) {
          byKey.set(fieldKey(descriptor), descriptor);
        }
      });
      const repairFields = [...byKey.values()];
      if (data.browserWorker && repairFields.length) {
        const results = await resolveFieldsBatch(repairFields);
        if (results.some((result) => result.accepted)) {
          banner('HireRadar repaired the invalid fields and is rechecking the complete form...');
          return true;
        }
      }

      const diagnostics = invalids.map((element, index) => {
        const descriptor = liveFieldFor(element, 10000 + index);
        return EXEC?.safeDiagnostic?.({
          code: 'required_field_unresolved',
          ats: data.atsType,
          fieldKey: fieldKey(descriptor),
          controlType: element.type || element.tagName,
          optionCount: element instanceof HTMLSelectElement ? element.options.length : undefined,
          answerSource: resolutionState.get(fieldKey(descriptor))?.answerSource,
          retained: controlHasValue(element, descriptor),
          category: resolutionState.get(fieldKey(descriptor))?.lastFailure || 'validation',
        });
      }).filter(Boolean);
      if (data.browserWorker) {
        await send({
          type: 'PROGRESS',
          stage: 'waiting_for_user',
          detail: {
            filled: (data.fields || []).length,
            total: (data.fields || []).length,
            detail: JSON.stringify({
              message: 'ATS native validation blocked submission.',
              invalidCount: diagnostics.length,
              invalid: diagnostics,
            }),
          },
        });
      }
      data.stopAutomation = true;
      persist(data);
      banner('The ATS still needs ' + diagnostics.length + ' required field'
        + (diagnostics.length === 1 ? '' : 's') + '. Review the listed blockers and restart this application.', true);
      return false;
    }
    data.submitAttempts = (data.submitAttempts || 0) + 1;
    data.lastSubmitAttemptAt = now;
    persist(data);
    if (data.browserWorker) {
      await send({
        type: 'PROGRESS',
        stage: 'submit_started',
        detail: {
          filled: (data.fields || []).length,
          total: (data.fields || []).length,
          detail: 'ATS submit attempt ' + data.submitAttempts + ' started.',
        },
      });
    }
    banner('HireRadar filled every required field and is submitting the application...');
    submit.click();
    return true;
  };

  (async () => {
    try {
      const data = await loadPayload();
      if (!data) return;
      const isTopFrame = window.top === window;
      const isSmartRecruiters = normalize(data.atsType) === 'smartrecruiters';
      const isEmbeddedGreenhouse = !isTopFrame
        && normalize(data.atsType) === 'greenhouse'
        && /job-boards\.greenhouse\.io\/embed\/job_app/i.test(location.href);
      // SmartRecruiters uses a different publication identifier in its embedded
      // application URL, so the child frame cannot be compared by job URL ID.
      if (!isSmartRecruiters && !sameJob(data)) return;
      // Most ATSes render the application in the top document; ignore their
      // decorative/analytics frames. SmartRecruiters is the exception: its top
      // job page opens an embedded one-click application whose child frame owns
      // filling and submission.
      if (!isTopFrame && !isSmartRecruiters && !isEmbeddedGreenhouse) return;
      if (isTopFrame && normalize(data.atsType) === 'greenhouse'
        && document.querySelector('iframe[src*="/embed/job_app"]')) {
        // The embedded Greenhouse child owns validation and submission. The
        // wrapper must not overwrite its progress with a no-form diagnosis.
        return;
      }
      if (isTopFrame && isSmartRecruiters && !location.pathname.includes('/oneclick-ui/')) {
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'filling',
          detail: { detail: 'SmartRecruiters job page attached; opening the application form.' },
        });
        const directUrl = smartRecruitersDirectUrl();
        if (directUrl) { location.assign(directUrl); return; }
        const opened = openApplicationForm();
        if (!opened && data.browserWorker) await send({
          type: 'PROGRESS', stage: 'waiting_for_user',
          detail: { detail: 'SmartRecruiters application action and publication URL were not found.' },
        });
        return;
      }
      const canonicalApplication = canonicalGreenhouseApplication(data);
      if (canonicalApplication && canonicalApplication !== location.href) {
        if (data.browserWorker) await send({
          type: 'PROGRESS', stage: 'filling',
          detail: { detail: 'Opening the canonical Greenhouse application form.' },
        });
        location.assign(canonicalApplication);
        return;
      }
      const fields = (data.fields || []).filter((field) =>
        field.value !== null && field.value !== undefined && field.value !== '' && normalize(field.value) !== 'unfilled');
      if (data.browserWorker && isSmartRecruiters) {
        void send({
          type: 'PROGRESS',
          stage: 'filling',
          detail: {
            total: fields.length,
            detail: JSON.stringify({
              message: 'SmartRecruiters application frame attached.',
              host: location.hostname,
              path: location.pathname,
              fields: fields.length,
            }),
          },
        });
      }
      const completed = new Set();
      const preparedLedger = ATS?.createFieldLedger?.(1);
      if (data.browserWorker) await send({
        type: 'PROGRESS', stage: 'filling',
        detail: { total: fields.length, detail: JSON.stringify({ message: 'Form planning started.', fields: fields.length }) },
      });
      const plannedAnswers = planChoiceAnswers(fields);
      if (data.browserWorker) void send({
        type: 'PROGRESS', stage: 'filling',
        detail: {
          total: fields.length,
          detail: JSON.stringify({ message: 'Local form planning complete.', resolvedChoices: plannedAnswers.size }),
        },
      });
      for (const field of fields) {
        const planned = plannedAnswers.get(field.name);
        if (planned) { field.value = planned.value; field.source = planned.source; }
      }
      // Stable label/type keys survive React rerenders. Mark a field before
      // resolving it so mutations cannot enqueue the same control again.
      const attemptedLive = new Set();
      let running = false;
      let terminal = false;
      let debounce;
      let observer;
      let retry;
      const stopExecution = () => {
        terminal = true;
        clearTimeout(debounce);
        if (retry) clearInterval(retry);
        observer?.disconnect();
      };
      const run = async () => {
        if (running || terminal) return;
        running = true;
        try {
          const pageText = normalize(document.body?.innerText || '');
          const greenhouseClosed = /job-boards\.greenhouse\.io$/.test(location.hostname)
            && (new URLSearchParams(location.search).get('error') === 'true'
              || /current openings at|job not found|no longer accepting applications/.test(pageText));
          if (greenhouseClosed) {
            if (data.browserWorker) await send({
              type: 'PROGRESS', stage: 'failed',
              detail: { detail: 'The Greenhouse posting is closed or no longer exists.' },
            });
            data.stopAutomation = true;
            persist(data);
            stopExecution();
            banner('This posting is closed or no longer accepting applications.', true);
            return;
          }
          if (isSuccessPage(data)) {
            try {
              await reportSuccess(data);
              stopExecution();
              banner('Application submitted successfully. HireRadar marked it as Submitted.');
            } catch (error) {
              banner(error.message || 'Could not update the submitted status.', true);
            }
            return;
          }
          for (const [fieldIndex, field] of fields.entries()) {
            if (completed.has(field.name)) {
              if (fieldAccepted(field)) continue;
              completed.delete(field.name);
              preparedLedger?.reject(field);
            }
            if (preparedLedger && !preparedLedger.begin(field)) continue;
            if (data.browserWorker) void send({
              type: 'PROGRESS', stage: 'filling',
              detail: { filled: completed.size, total: fields.length, detail: JSON.stringify({ message: 'Filling prepared field.', diagnostic: EXEC?.safeDiagnostic?.({ code: 'field_filling', ats: data.atsType, fieldKey: fieldKey(field), controlType: field.type, answerSource: field.source, attempt: preparedLedger?.get(field)?.attempts }), index: fieldIndex + 1 }) },
            });
            try {
              // Never abandon a live DOM interaction: it would continue clicking into later fields.
              const filled = await fill(field);
              if (filled) {
                await wait(200);
                if (fieldAccepted(field)) {
                  completed.add(field.name);
                  preparedLedger?.verify(field);
                } else {
                  completed.delete(field.name);
                  preparedLedger?.reject(field);
                }
              }
            } catch {
              preparedLedger?.reject(field);
              /* skip this field and continue */
            }
          }
          // React ATSes may replace controls after an onChange. Re-read every
          // completed field from the current DOM before deciding the form is ready.
          await wait(500);
          for (const field of fields) {
            if (completed.has(field.name) && !fieldAccepted(field)) {
              completed.delete(field.name);
              preparedLedger?.reject(field);
            }
          }
          const remaining = fields.length - completed.size;
          if (data.browserWorker) await send({
            type: 'PROGRESS', stage: 'filling',
            detail: { filled: completed.size, total: fields.length, detail: JSON.stringify({ message: 'Prepared field pass complete.', remaining }) },
          });
          // Resolve live fields that the server prep missed — including ones the
          // ATS renders LATE (dynamic controls). Only newly-seen fields are sent,
          // so a field that appears after the first pass still gets resolved.
          // Best-effort: a resolver hiccup must never block prepared fills.
          const failedLive = [];
          // Resolve the complete visible form, then rescan because React ATSes
          // can reveal dependent required questions after earlier selections.
          // Walk conditional sections until the form stabilizes. The hard cap
          // protects against malformed ATS pages, while the attempted-key ledger
          // prevents retries for unresolved controls. A previously accepted field
          // may be retried only if a later React rerender cleared it.
          let previousSchemaSignature = '';
          for (let round = 1; round <= 6; round++) {
            const liveBatch = scanUnfilledFields({ includeOptionalKnown: true }).filter((field) => {
              const key = fieldKey(field);
              return !attemptedLive.has(key);
            });
            if (!liveBatch.length) break;
            const schemaSignature = liveBatch.map((field) => fieldKey(field)).sort().join('||');
            if (schemaSignature === previousSchemaSignature) break;
            previousSchemaSignature = schemaSignature;
            if (data.browserWorker) await send({
              type: 'PROGRESS', stage: 'filling',
              detail: {
                filled: completed.size, total: fields.length,
                detail: JSON.stringify({
                  message: 'Resolving complete required-field preflight.', round,
                  fieldCount: liveBatch.length,
                  diagnostics: liveBatch.map((field) => EXEC?.safeDiagnostic?.({
                    code: 'live_field_resolution', ats: data.atsType,
                    fieldKey: fieldKey(field), controlType: field.type,
                  })),
                }),
              },
            });
            liveBatch.forEach((field) => attemptedLive.add(fieldKey(field)));
            // resolveFieldsBatch bounds every request and every individual
            // control. Do not impose a whole-batch timeout that can prevent later
            // questions from receiving their own attempt.
            const results = await resolveFieldsBatch(liveBatch);
            liveBatch.forEach((field, index) => {
              if (!results[index]?.accepted) failedLive.push(field);
            });
            await wait(500);
          }
          const blockingLive = scanUnfilledFields();
          // The DOM after the final round is authoritative. A field can fail an
          // early resolver attempt and then become valid after a dependent
          // control updates, so do not preserve stale failures that disappeared.
          const blockingKeys = new Set(blockingLive.map((field) => fieldKey(field)));
          const unresolvedByKey = new Map([
            ...blockingLive,
            ...failedLive.filter((field) => blockingKeys.has(fieldKey(field))),
          ].map((field) => [fieldKey(field), field]));
          const unresolvedLive = [...unresolvedByKey.values()].filter((field) => field.required);
          data.liveNeedsUser = unresolvedLive.map((field) => field.name);
          persist(data);
          if (unresolvedLive.length) {
            stopExecution();
            if (data.browserWorker) await send({
              type: 'PROGRESS', stage: 'waiting_for_user',
              detail: {
                filled: completed.size, total: fields.length,
                detail: JSON.stringify({
                  message: unresolvedLive.length + ' required fields need confirmed user data or a supported option.',
                  unresolvedCount: unresolvedLive.length,
                  diagnostics: unresolvedLive.map((field) => EXEC?.safeDiagnostic?.({
                    code: 'preflight_field_unresolved', ats: data.atsType,
                    fieldKey: fieldKey(field), controlType: field.type,
                    answerSource: resolutionState.get(fieldKey(field))?.answerSource,
                    category: resolutionState.get(fieldKey(field))?.lastFailure,
                    attempt: resolutionState.get(fieldKey(field))?.attempt,
                    optionCount: field.options?.length,
                  })),
                }),
              },
            });
            banner('HireRadar found ' + unresolvedLive.length + ' required field' + (unresolvedLive.length === 1 ? '' : 's') + ' that need your answer.', true);
            return;
          }
          if (remaining === fields.length && openApplicationForm()) return;
          if (data.browserWorker && !data.lastSubmitAttemptAt) {
            await send({
              type: 'PROGRESS',
              stage: 'filling',
              detail: {
                filled: completed.size,
                total: fields.length,
                detail: remaining ? JSON.stringify({ message: remaining + ' prepared fields were not found; complete-form preflight found no required blockers.', diagnostics: fields.filter((field) => !completed.has(field.name)).map((field) => EXEC?.safeDiagnostic?.({ code: 'optional_prepared_field_unresolved', ats: data.atsType, fieldKey: fieldKey(field), controlType: field.type, answerSource: field.source, attempt: preparedLedger?.get(field)?.attempts })) }) : 'All prepared fields and required live controls passed preflight.',
              },
            });
          }
          // Try to submit as soon as the ATS itself reports the form complete
          // (checkValidity), regardless of `remaining` — an unfilled OPTIONAL
          // prepared field (a link the form doesn't ask for, etc.) must never
          // block a valid, opted-in submission.
          if (data.autoSubmit || data.autoSubmitRequested) {
            // submitPreparedForm either submits (we're done) or banners the exact
            // blocking field — don't overwrite that specific message below.
            if (await submitPreparedForm(data)) return;
            if (data.stopAutomation) {
              stopExecution();
              return;
            }
          } else if (remaining) {
            banner('HireRadar filled ' + completed.size + ' of ' + fields.length + ' prepared fields. Waiting for ' + remaining + ' dynamic field' + (remaining === 1 ? '' : 's') + '…');
          } else {
            banner('HireRadar filled all ' + fields.length + ' prepared fields. Review the form, then submit when it is correct.');
          }
        } finally {
          running = false;  // ALWAYS reset, so a thrown error never freezes retries
        }
      };

      // Re-run fill whenever the ATS mutates the DOM — this is how late-rendered
      // dynamic fields get filled. (Previously guarded by a flag that was always
      // true, so this never fired and dynamic fields were left unfilled.)
      observer = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(run, 120);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      await run();
      setTimeout(run, 750);
      setTimeout(run, 2000);
      retry = setInterval(() => {
        // Continue through the submit phase. Field completeness alone is not a
        // terminal state; only the ATS success page confirms submission.
        run();
      }, 3000);
      setTimeout(() => {
        clearInterval(retry);
        observer.disconnect();
      }, 120000);
    } catch (error) {
      try {
        void send({
          type: 'PROGRESS',
          stage: 'waiting_for_user',
          detail: { detail: 'Browser helper error: ' + String(error?.message || error).slice(0, 700) },
        });
      } catch { /* extension context may be unavailable */ }
      banner(error.message || 'Could not load prepared answers.', true);
    }
  })();
})();


