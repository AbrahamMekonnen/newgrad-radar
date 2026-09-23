(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HireRadarATS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const normalize = (value) => String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';

  const degreeLevel = (value) => {
    const text = normalize(value);
    if (/\b(phd|ph d|doctor|doctorate)\b/.test(text)) return 'doctorate';
    if (/\b(master|masters|ms|m s|mba|ma|m a)\b/.test(text)) return 'master';
    if (/\b(bachelor|bachelors|bs|b s|ba|b a)\b/.test(text)) return 'bachelor';
    if (/\b(associate|associates|aa|a a|as|a s)\b/.test(text)) return 'associate';
    if (/\b(high school|secondary|ged)\b/.test(text)) return 'high_school';
    return '';
  };

  const stableFieldKey = (field) => normalize(field?.label)
    ? [normalize(field.label), normalize(field.type)].filter(Boolean).join('|')
    : [String(field?.name || ''), normalize(field?.type)].filter(Boolean).join('|');

  const matchOption = (question, wanted, options) => {
    const target = normalize(wanted);
    const usable = (options || []).filter((option) => {
      const value = normalize(option);
      return value && !/^(select|choose|please select)\b/.test(value);
    });
    if (!target) return null;
    const exact = usable.find((option) => normalize(option) === target);
    if (exact) return exact;

    const q = normalize(question);
    if (/degree|education level|qualification/.test(q)) {
      const level = degreeLevel(target);
      const option = level && usable.find((candidate) => degreeLevel(candidate) === level);
      if (option) return option;
    }

    if (/country/.test(q)) {
      const aliases = {
        us: 'united states', usa: 'united states', 'u s': 'united states',
        uk: 'united kingdom', 'u k': 'united kingdom',
      };
      const country = aliases[target] || target;
      const option = usable.find((candidate) => normalize(candidate) === country);
      if (option) return option;
    }

    const yes = /^(yes|true|1)$/.test(target);
    const no = /^(no|false|0)$/.test(target);
    if (yes || no) {
      const option = usable.find((candidate) => normalize(candidate) === (yes ? 'yes' : 'no'));
      if (option) return option;
    }

    const contained = usable.filter((option) => {
      const candidate = normalize(option);
      return candidate.includes(target) || target.includes(candidate);
    });
    return contained.length === 1 ? contained[0] : null;
  };

  const scoreSubmitText = (value) => {
    const text = normalize(value);
    if (/^submit (your )?application\b/.test(text)) return 10;
    if (text === 'submit') return 9;
    if (/^(send|complete) (your )?application\b/.test(text)) return 8;
    if (text === 'apply') return 1;
    return 0;
  };

  const successEvidence = (url, text) => {
    const target = normalize(url);
    const body = normalize(text).slice(0, 20000);
    const urlMatched = ['thank you', 'application submitted', 'application success', 'submission confirmation']
      .some((phrase) => target.includes(phrase));
    const textMatched = [
      'thank you for applying', 'thanks for applying', 'application has been submitted',
      'application was submitted', 'successfully submitted your application',
      'we received your application', 'we have received your application',
      'your application was received', 'your application has been received',
      'application is complete', 'application was already submitted', 'your application is in',
    ].some((phrase) => body.includes(phrase));
    return { confirmed: urlMatched || textMatched, urlMatched, textMatched };
  };

  const inferCountry = (fields) => {
    const explicit = (fields || []).find((field) =>
      field.category === 'country' || /^country$/i.test(String(field.label || '').trim()))?.value;
    if (explicit) return String(explicit);
    const phone = String((fields || []).find((field) => field.category === 'phone')?.value || '').replace(/\D/g, '');
    const location = String((fields || []).find((field) => field.category === 'location')?.value || '');
    if ((phone.length === 11 && phone.startsWith('1'))
      || /\b(?:usa|united states|ca|ny|dc|va|tx|wa|ma|md|nj|fl|il)\b/i.test(location)) return 'United States';
    return '';
  };

  const adapters = {
    greenhouse: {
      type: 'greenhouse',
      hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
      formSelectors: ['form'],
      phoneCountryProxy: '.phone-input__country input:required, .phone-input__country .requiredInput',
      async repairInvalid(context) {
        const invalid = context.invalid;
        if (!invalid || !/country/i.test(String(context.label || ''))) return false;
        const country = inferCountry(context.fields || []);
        const shell = invalid.closest('.select__container, .select, [class*=phone]');
        const combo = shell?.querySelector('input[role=combobox], input[aria-autocomplete=true]');
        if (!combo || !country) return false;
        const applied = await context.fillCombo(combo, {
          name: 'phone-country', label: 'Country', value: country, values: [],
        });
        await context.wait(300);
        return Boolean(applied && invalid.checkValidity());
      },
    },
    lever: {
      type: 'lever',
      hosts: ['jobs.lever.co'],
      formSelectors: ['.application-form form', '.lever-form', 'form.application'],
      labelFor(element) {
        const row = element.closest('li.application-question, .application-question, li') || element.closest('[class*=card]');
        const heading = row?.querySelector('.application-label, label, h3, h4, [class*=question]');
        return String(heading?.textContent || row?.textContent || '').replace(/\s+/g, ' ').trim();
      },
    },
    ashby: {
      type: 'ashby',
      hosts: ['jobs.ashbyhq.com'],
      formSelectors: ['#form[role="tabpanel"]', '.ashby-application-form', 'form[data-form-type="application"]'],
      findField(doc, field) {
        const name = String(field?.name || '');
        if (!name) return null;
        const entry = [...doc.querySelectorAll('[data-field-path]')]
          .find((item) => item.getAttribute('data-field-path') === name);
        return entry?.querySelector('input, textarea, select, [role="combobox"]') || null;
      },
      fillCheckbox(element, wanted) {
        const entry = element.closest('[data-field-path]');
        const target = /^(?:false|no|0)$/i.test(String(wanted).trim()) ? 'no'
          : /^(?:true|yes|1)$/i.test(String(wanted).trim()) ? 'yes' : '';
        const option = target && entry?.querySelector(`.ashby-application-form-input-yesno-option[data-option="${target}"]`);
        if (!option) return false;
        if (option.getAttribute('aria-pressed') !== 'true') option.click();
        return true;
      },
      fieldAccepted(element, wanted) {
        if (element?.type !== 'checkbox') return null;
        const entry = element.closest('[data-field-path]');
        const yesNo = entry?.querySelector('.ashby-application-form-input-yesno');
        if (!yesNo) return null;
        const target = /^(?:false|no|0)$/i.test(String(wanted).trim()) ? 'no'
          : /^(?:true|yes|1)$/i.test(String(wanted).trim()) ? 'yes' : '';
        return Boolean(target && yesNo.querySelector(`[data-option="${target}"][aria-pressed="true"]`));
      },
      findInvalid(root) {
        const controls = [...root.querySelectorAll('input, textarea, select, [role="combobox"]')];
        const nativeInvalid = controls.find((item) => item.willValidate && !item.checkValidity());
        if (nativeInvalid) return nativeInvalid;
        const entries = [...root.querySelectorAll('[data-field-path]')];
        for (const entry of entries) {
          const heading = entry.querySelector('.ashby-application-form-question-title, label');
          if (!heading || (!heading.className.includes('required') && !/\*\s*$/.test(heading.textContent || ''))) continue;
          const items = [...entry.querySelectorAll('input, textarea, select, [role="combobox"]')];
          if (!items.length) continue;
          const satisfied = items.some((item) => {
            if (item.type === 'checkbox') {
              const yesNo = entry.querySelector('.ashby-application-form-input-yesno');
              return yesNo ? Boolean(yesNo.querySelector('[data-option][aria-pressed="true"]')) : item.checked;
            }
            if (item.type === 'radio') return item.checked;
            if (item.type === 'file') return item.files?.length > 0;
            return String(item.value || '').trim().length > 0;
          });
          if (!satisfied) return items[0];
        }
        return null;
      },
      findSubmit(doc) {
        const panel = doc.querySelector('#form[role="tabpanel"], .ashby-application-form');
        if (!panel) return null;
        return [...panel.querySelectorAll('button, input[type="submit"], input[type="button"]')]
          .filter((item) => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true')
          .map((item) => ({ item, score: scoreSubmitText(item.textContent || item.value) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)[0]?.item || null;
      },
      validationRoot(submit) {
        return submit?.closest('#form[role="tabpanel"], .ashby-application-form') || null;
      },
    },
    workday: {
      type: 'workday',
      hostPattern: /\.myworkdayjobs\.com$/i,
      formSelectors: ['form', '[data-automation-id="applyFlowPage"]'],
    },
    smartrecruiters: {
      type: 'smartrecruiters',
      hostPattern: /\.smartrecruiters\.com$/i,
      formSelectors: ['form', '[data-test="application-form"]'],
    },
    generic: { type: 'generic', hosts: [], formSelectors: ['form'] },
  };

  const detect = (url, declared) => {
    const named = normalize(declared).replace(/ /g, '');
    if (adapters[named]) return adapters[named];
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    return Object.values(adapters).find((adapter) =>
      adapter.hosts?.includes(host) || adapter.hostPattern?.test(host)) || adapters.generic;
  };

  const createFieldLedger = (maxAttempts = 2) => {
    const states = new Map();
    const get = (field) => states.get(stableFieldKey(field)) || { attempts: 0, status: 'discovered' };
    return {
      begin(field) {
        const key = stableFieldKey(field);
        const state = get(field);
        if (state.status === 'verified' || state.status === 'needs_user' || state.attempts >= maxAttempts) return false;
        states.set(key, { ...state, attempts: state.attempts + 1, status: 'filling' });
        return true;
      },
      verify(field) {
        const state = get(field);
        states.set(stableFieldKey(field), { ...state, status: 'verified' });
      },
      reject(field) {
        const state = get(field);
        states.set(stableFieldKey(field), {
          ...state,
          status: state.attempts >= maxAttempts ? 'needs_user' : 'retry',
        });
      },
      get,
    };
  };

  return {
    adapters, detect, normalize, degreeLevel, stableFieldKey, matchOption,
    scoreSubmitText, successEvidence, inferCountry, createFieldLedger,
  };
});
