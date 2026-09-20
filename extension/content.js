(() => {
  if (window.__hireRadarAutoApplyLoaded) return;
  window.__hireRadarAutoApplyLoaded = true;
  const MARKER = 'newgrad-radar=';
  const CACHE_KEY = 'newgrad-radar-handoff-v2';
  const normalize = (value) => String(value || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    if (!String(field.name || '').endsWith('_text')) return;
    const buttons = [...document.querySelectorAll('button')]
      .filter((button) => buttonText(button).includes('enter manually'));
    const target = field.category === 'cover_letter'
      ? (buttons.find((button) => normalize(button.parentElement?.parentElement?.textContent).includes('cover letter')) || buttons.at(-1))
      : buttons[0];
    if (target) {
      target.click();
      await wait(150);
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
      const suffix = [...document.querySelectorAll('[name]')]
        .find((el) => String(el.getAttribute('name')).endsWith(String(field.name)));
      if (suffix) return suffix;
    }
    return byLabel(field.label);
  };

  const answerLabel = (field) => {
    const match = (field.values || []).find((item) => String(item.value) === String(field.value));
    return String(match?.label ?? field.value ?? '');
  };

  const optionMatches = (text, wanted) => {
    const got = normalize(text);
    const target = normalize(wanted);
    if (!got || !target) return false;
    if (got === target || got.includes(target) || target.includes(got)) return true;
    if (target.includes('decline') && (got.includes('decline') || got.includes('prefer not') || got.includes('do not want'))) return true;
    const targetTokens = new Set(target.split(' ').filter((x) => x.length > 2));
    const gotTokens = new Set(got.split(' ').filter((x) => x.length > 2));
    if (!targetTokens.size) return false;
    const overlap = [...targetTokens].filter((x) => gotTokens.has(x)).length;
    return overlap / targetTokens.size >= 0.65;
  };

  const visibleOptions = () => [...document.querySelectorAll('[role="option"], [data-option-index]')]
    .filter((item) => item.getClientRects().length > 0);

  const fillCombo = async (element, field) => {
    const wanted = answerLabel(field);
    const existing = normalize(element.value || element.textContent);
    if (existing && existing !== 'select' && optionMatches(existing, wanted)) return true;
    if (existing && existing !== 'select') return true; // preserve a user's manual choice

    element.click();
    await wait(100);
    let option = visibleOptions().find((item) => optionMatches(item.textContent, wanted));
    if (!option && element instanceof HTMLInputElement) {
      setNativeValue(element, wanted);
      await wait(250);
      option = visibleOptions().find((item) => optionMatches(item.textContent, wanted));
    }
    if (!option) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      element.blur();
      return false;
    }
    option.click();
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const fill = async (field) => {
    let element = findField(field);
    if (!element) {
      await clickManualEntry(field);
      element = findField(field);
    }
    if (!element || element.type === 'file') return false;
    const value = field.value;

    if (element instanceof HTMLSelectElement) {
      const wanted = answerLabel(field);
      const option = [...element.options].find((item) => String(item.value) === String(value))
        || [...element.options].find((item) => optionMatches(item.textContent, wanted));
      if (!option) return false;
      element.value = option.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (element.getAttribute('role') === 'combobox') return fillCombo(element, field);
    if (element.type === 'radio') {
      const radios = [...document.querySelectorAll('input[type="radio"]')]
        .filter((item) => item.name === element.name || item.closest('fieldset') === element.closest('fieldset'));
      const option = radios.find((item) => String(item.value) === String(value))
        || radios.find((item) => optionMatches(item.parentElement?.textContent, answerLabel(field)));
      if (!option) return false;
      option.click();
      return true;
    }
    if (element.type === 'checkbox') {
      const checked = !['false', 'no', '0', ''].includes(normalize(value));
      if (element.checked !== checked) element.click();
      return true;
    }
    if (String(element.value || '').trim()) return true; // never overwrite user edits
    setNativeValue(element, value);
    return true;
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
      const worker = await chrome.runtime.sendMessage({ type: 'PAGE_READY' });
      if (worker?.job) return { ...worker.job, browserWorker: true };
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

  const isSuccessPage = () => {
    const activeSubmit = [...document.querySelectorAll('button, input[type="submit"]')]
      .some((item) => {
        const text = normalize(item.textContent || item.value);
        return !item.disabled && ['submit application', 'submit', 'apply'].includes(text);
      });
    if (activeSubmit) return false;
    const signalText = [
      document.title,
      ...[...document.querySelectorAll('h1, h2, [role="status"], [role="alert"]')]
        .map((item) => item.textContent || ''),
    ].map(normalize).join(' ');
    return [
      'thank you for applying',
      'application has been submitted',
      'application submitted',
      'we have received your application',
      'your application was received',
    ].some((phrase) => signalText.includes(phrase));
  };

  const persist = (data) => sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));

  const reportSuccess = async (data) => {
    if (data.reported) return;
    if (data.browserWorker) {
      const result = await chrome.runtime.sendMessage({ type: 'PROGRESS', stage: 'submitted' });
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

  const openApplicationForm = () => {
    const actions = [...document.querySelectorAll('a, button')];
    const trigger = actions.find((item) => {
      const text = normalize(item.textContent);
      return ['apply now', 'apply for this job', 'start application', 'apply to this job'].includes(text);
    });
    if (!trigger) return false;
    banner('HireRadar is opening the application form…');
    trigger.click();
    return true;
  };
  const submitPreparedForm = (data) => {
    if (!data.autoSubmitRequested || data.submitStarted) return false;
    const form = document.querySelector('form');
    if (form?.checkValidity && !form.checkValidity()) {
      banner('HireRadar filled the prepared answers, but the ATS still reports a required field. Review it before submitting.', true);
      return false;
    }
    const controls = [...document.querySelectorAll('button, input[type="submit"]')];
    const submit = controls.find((item) => {
      const text = normalize(item.textContent || item.value);
      return text === 'submit application' || text === 'submit' || text === 'apply';
    });
    if (!submit || submit.disabled) return false;
    data.submitStarted = true;
    persist(data);
    banner('HireRadar filled every required field and is submitting the application…');
    submit.click();
    return true;
  };

  (async () => {
    try {
      const data = await loadPayload();
      if (!data || !sameJob(data)) return;
      const fields = (data.fields || []).filter((field) =>
        field.value !== null && field.value !== undefined && field.value !== '');
      const completed = new Set();
      let running = false;
      const run = async () => {
        if (running) return;
        running = true;
        if (isSuccessPage()) {
          try {
            await reportSuccess(data);
            banner('Application submitted successfully. HireRadar marked it as Submitted.');
          } catch (error) {
            banner(error.message || 'Could not update the submitted status.', true);
          }
          running = false;
          return;
        }
        for (const field of fields) {
          if (completed.has(field.name)) continue;
          if (await fill(field)) completed.add(field.name);
        }
        const remaining = fields.length - completed.size;
        if (remaining === fields.length && openApplicationForm()) {
          running = false;
          return;
        }
        if (data.browserWorker) {
          void chrome.runtime.sendMessage({
            type: 'PROGRESS',
            stage: remaining ? 'waiting_for_user' : 'filling',
            detail: {
              filled: completed.size,
              total: fields.length,
              detail: remaining ? remaining + ' prepared fields were not found or need user input.' : 'All prepared fields were filled.',
            },
          });
        }
        if (remaining) {
          banner('HireRadar filled ' + completed.size + ' of ' + fields.length + ' prepared fields. Waiting for ' + remaining + ' dynamic field' + (remaining === 1 ? '' : 's') + '…');
        } else if (!submitPreparedForm(data)) {
          banner(data.autoSubmitRequested
            ? 'HireRadar filled every prepared field. Review the ATS field highlighted as incomplete, then submit.'
            : 'HireRadar filled all ' + fields.length + ' prepared fields. Review the form, then submit when it is correct.');
        }
        running = false;
      };

      let debounce;
      const observer = new MutationObserver(() => {
  if (window.__hireRadarAutoApplyLoaded) return;
  window.__hireRadarAutoApplyLoaded = true;
        clearTimeout(debounce);
        debounce = setTimeout(run, 120);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      await run();
      setTimeout(run, 750);
      setTimeout(run, 2000);
      const retry = setInterval(() => {
  if (window.__hireRadarAutoApplyLoaded) return;
  window.__hireRadarAutoApplyLoaded = true;
        run();
        if (completed.size === fields.length) clearInterval(retry);
      }, 3000);
      setTimeout(() => {
  if (window.__hireRadarAutoApplyLoaded) return;
  window.__hireRadarAutoApplyLoaded = true;
        clearInterval(retry);
        observer.disconnect();
      }, 120000);
    } catch (error) {
      banner(error.message || 'Could not load prepared answers.', true);
    }
  })();
})();
