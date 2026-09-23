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
        const row = element.closest('li, .application-question, [class*=card]');
        const heading = row?.querySelector('.application-label, label, h3, h4, [class*=question]');
        return String(heading?.textContent || row?.textContent || '').replace(/\s+/g, ' ').trim();
      },
    },
    ashby: {
      type: 'ashby',
      hosts: ['jobs.ashbyhq.com'],
      formSelectors: ['.ashby-application-form form', 'form[data-form-type="application"]'],
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
