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

  const stableFieldKey = (field) => field?.fieldId || (normalize(field?.label)
    ? [normalize(field.label), normalize(field.type)].filter(Boolean).join('|')
    : [String(field?.name || ''), normalize(field?.type)].filter(Boolean).join('|'));

  const optionSignature = (options) => (options || [])
    .map((option) => normalize(typeof option === 'string' ? option : option?.label))
    .filter(Boolean)
    .join('|');

  const answerMatchesField = (field, answer) => {
    if (!answer || answer.safeToApply === false) return false;
    if (field?.fieldId && answer.fieldId !== field.fieldId) return false;
    if (!field?.fieldId && answer.name !== field?.name) return false;
    const signature = optionSignature(field?.options);
    if (signature && answer.optionSignature !== signature) return false;
    if (signature) {
      const wanted = normalize(answer.matchedOption || answer.value);
      if (!(field.options || []).some((option) =>
        normalize(typeof option === 'string' ? option : option?.label) === wanted)) return false;
    }
    return Boolean(normalize(answer.value));
  };
  const matchOption = (question, wanted, options) => {
    const target = normalize(wanted);
    const usable = (options || []).filter((option) => {
      const value = normalize(option);
      return value && !/^(select|choose|please select)( an?| one| option)?$/.test(value);
    });
    if (!target) return null;
    const exact = usable.find((option) => normalize(option) === target);
    if (exact) return exact;

    const privacyDecline = /decline|self identify|prefer not|do not wish|don t wish|not wish to answer/.test(target);
    if (privacyDecline) {
      const option = usable.find((candidate) =>
        /decline|prefer not|do not wish|don t wish|not wish to answer|choose not to disclose/.test(normalize(candidate)));
      if (option) return option;
    }

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

  const matchLocationOption = (wanted, options) => {
    const stateNames = {
      al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
    };
    const rawWanted = String(wanted || '');
    const rawTarget = normalize(rawWanted);
    if (!rawTarget) return null;
    const target = rawTarget.split(' ').map((token) => stateNames[token] || token).join(' ');
    const candidates = (options || []).filter((option) => normalize(option));
    const exact = candidates.find((option) => normalize(option) === rawTarget || normalize(option) === target);
    if (exact) return exact;
    const city = normalize(rawWanted.split(',')[0]);
    if (!city || city.length < 3) return null;
    const cityTokens = city.split(' ').filter(Boolean);
    const cityMatches = candidates.filter((option) => {
      const tokens = new Set(normalize(option).split(' '));
      return cityTokens.every((token) => tokens.has(token));
    });
    if (cityMatches.length === 1) return cityMatches[0];
    const targetTokens = new Set(target.split(' ').filter((token) => token.length > 1));
    return cityMatches.map((option) => {
      const tokens = new Set(normalize(option).split(' '));
      const overlap = [...targetTokens].filter((token) => tokens.has(token)).length;
      return { option, overlap };
    }).sort((a, b) => b.overlap - a.overlap)[0]?.option || null;
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
      'thank you for applying', 'thanks for applying', 'thank you for submitting your application',
      'we will be in touch if there is a fit', 'application has been submitted',
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

  const controlSelector = 'input, textarea, select, [role="combobox"]';
  const ashbyQuestionContainer = (element) => element?.closest?.(
    '[data-field-path], .ashby-application-form-field-entry, .ashby-application-form-question, fieldset, [role="group"]'
  ) || null;
  const ashbyQuestionLabel = (entry, control) => {
    const labelledBy = String(control?.getAttribute?.('aria-labelledby') || '').split(/\s+/)
      .map((id) => control?.ownerDocument?.getElementById?.(id)?.textContent || '').filter(Boolean).join(' ');
    const heading = entry?.querySelector?.(
      '.ashby-application-form-question-title, legend, label, [class*="question-title"], [class*="field-label"]'
    );
    return String(control?.labels?.[0]?.textContent || control?.getAttribute?.('aria-label') || labelledBy || heading?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  };
  const ashbyEntries = (doc) => [...new Set([
    ...doc.querySelectorAll('[data-field-path]'),
    ...doc.querySelectorAll('.ashby-application-form-field-entry, .ashby-application-form-question, fieldset, [role="group"]'),
  ])].filter((entry) => entry.querySelector?.(controlSelector));

  const adapters = {
    greenhouse: {
      type: 'greenhouse',
      hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
      formSelectors: ['form'],
      phoneCountryProxy: '.phone-input__country input:required, .phone-input__country .requiredInput',
      uploadReadyOverride(doc, waitedMs) {
        if (waitedMs < 5000) return false;
        const files = [...doc.querySelectorAll('input[type="file"]')];
        // Greenhouse can clear the native input after ingesting the upload. In
        // that case, require explicit retained-file UI rather than trusting a
        // stale generic live region that still says processing.
        if (files.some((input) => input.files?.length > 0)) return true;
        const retained = [...doc.querySelectorAll(
          '[class*=file-name], [class*=filename], [data-testid*=filename], [data-testid*=uploaded-file]'
        )];
        return retained.some((element) => element.getClientRects().length > 0
          && /\.(pdf|docx?|rtf|txt)\b/i.test(String(element.textContent || '')));
      },      async repairInvalid(context) {
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
        const row = element.closest('.application-question, li.application-question')
          || element.closest('[class*=card]') || element.closest('li');
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
        const wanted = normalize(field?.label || name);
        const exactEntries = [...doc.querySelectorAll('[data-field-path]')];
        const entries = ashbyEntries(doc);
        const exact = name && exactEntries.find((item) => item.getAttribute?.('data-field-path') === name);
        if (exact) return exact.querySelector(controlSelector);
        if (!wanted) return null;
        const ranked = entries.map((entry) => {
          const control = entry.querySelector(controlSelector);
          const label = normalize(ashbyQuestionLabel(entry, control));
          const path = normalize(entry.getAttribute?.('data-field-path'));
          const exactLabel = label === wanted || path === wanted;
          const contains = wanted.length > 4 && (label.includes(wanted) || wanted.includes(label));
          return { control, score: exactLabel ? 3 : contains ? 2 : 0, size: label.length || 9999 };
        }).filter((item) => item.control && item.score > 0)
          .sort((a, b) => b.score - a.score || a.size - b.size);
        if (ranked[0]) return ranked[0].control;
        return [...doc.querySelectorAll(controlSelector)].find((control) => {
          const label = normalize(ashbyQuestionLabel(ashbyQuestionContainer(control), control));
          return label === wanted || (wanted.length > 4 && (label.includes(wanted) || wanted.includes(label)));
        }) || null;
      },
      labelFor(element) {
        return ashbyQuestionLabel(ashbyQuestionContainer(element), element);
      },
      fillCheckbox(element, wanted) {
        const entry = ashbyQuestionContainer(element);
        const target = /^(?:false|no|0)$/i.test(String(wanted).trim()) ? 'no'
          : /^(?:true|yes|1)$/i.test(String(wanted).trim()) ? 'yes' : '';
        const option = target && entry?.querySelector(`.ashby-application-form-input-yesno-option[data-option="${target}"]`);
        if (!option) return false;
        if (option.getAttribute('aria-pressed') !== 'true') option.click();
        return true;
      },
      fieldAccepted(element, wanted) {
        if (element?.type !== 'checkbox') return null;
        const entry = ashbyQuestionContainer(element);
        const yesNo = entry?.querySelector('.ashby-application-form-input-yesno');
        if (!yesNo) return null;
        const target = /^(?:false|no|0)$/i.test(String(wanted).trim()) ? 'no'
          : /^(?:true|yes|1)$/i.test(String(wanted).trim()) ? 'yes' : '';
        return Boolean(target && yesNo.querySelector(`[data-option="${target}"][aria-pressed="true"]`));
      },
      isRequired(element) {
        const entry = ashbyQuestionContainer(element);
        const heading = entry?.querySelector('.ashby-application-form-question-title, legend, label, [class*=question-title], [class*=field-label]');
        return Boolean(heading && (String(heading.className).includes('required') || /\*\s*$/.test(heading.textContent || '')));
      },
      findInvalid(root) {
        const controls = [...root.querySelectorAll('input, textarea, select, [role="combobox"]')];
        const nativeInvalid = controls.find((item) => item.willValidate && !item.checkValidity());
        if (nativeInvalid) return nativeInvalid;
        const entries = ashbyEntries(root);
        for (const entry of entries) {
          const heading = entry.querySelector('.ashby-application-form-question-title, legend, label, [class*=question-title], [class*=field-label]');
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
      uploadReadyOverride(doc, waitedMs) {
        if (waitedMs < 5000) return false;
        const entries = ashbyEntries(doc);
        const entry = entries.find((item) => /resume|cv/i.test([
          item.getAttribute?.('data-field-path'), ashbyQuestionLabel(item, item.querySelector(controlSelector)),
        ].filter(Boolean).join(' ')))
          || entries.find((item) => item.querySelector('input[type="file"]'));
        const input = entry?.querySelector('input[type="file"]') || doc.querySelector?.('input[type="file"]');
        if (input?.files?.length) return true;
        // Ashby may ingest the file and clear the native input. A retained
        // filename or Replace control inside the resume field is durable proof
        // that processing finished; unrelated stale live regions are ignored.
        const shell = entry || ashbyQuestionContainer(input) || input?.parentElement;
        const text = normalize(shell?.textContent || '');
        const retainedName = /\b(pdf|doc|docx|rtf|txt)\b/.test(text);
        const replaceAction = /\breplace\b|\bremove file\b|\bdownload\b/.test(text);
        return Boolean(shell && (retainedName || replaceAction));
      },
      submissionComplete(doc) {
        const panel = doc.querySelector('#form[role="tabpanel"], .ashby-application-form');
        if (!panel) return false;
        const visible = (item) => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true';
        const hasFields = [...panel.querySelectorAll('[data-field-path]')].some(visible);
        const hasSubmit = [...panel.querySelectorAll('button, input[type="submit"]')]
          .some((item) => visible(item) && scoreSubmitText(item.textContent || item.value) > 0);
        const text = normalize(panel.textContent || '');
        if (hasFields || hasSubmit || !text) return false;
        if (/fetching|loading|submitting|processing|updating your forms|needs corrections|missing entry|error|try again/.test(text)) return false;
        return /thank|received|submitted|success|complete|interest|review|touch/.test(text);
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
      findNext(doc) {
        return doc.querySelector('[data-automation-id="bottom-navigation-next-button"], [data-automation-id="continueButton"], button[data-automation-id*="next"]');
      },
      labelFor(element) {
        const group = element.closest('[data-automation-id="formField"], [data-automation-id="questionnaireQuestion"], fieldset');
        const label = group?.querySelector('label, legend, [data-automation-id="promptQuestion"]');
        return String(label?.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      },
    },
    smartrecruiters: {
      type: 'smartrecruiters',
      hostPattern: /\.smartrecruiters\.com$/i,
      formSelectors: ['form', '[data-test="application-form"]'],
      findNext(doc) {
        return doc.querySelector('[data-test="next-button"], [data-testid="next-button"], button[name="next"]');
      },
      labelFor(element) {
        const group = element.closest('[data-test*="question"], .form-group, fieldset');
        const label = group?.querySelector('label, legend, [data-test*="label"]');
        return String(label?.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      },
    },
    generic: { type: 'generic', hosts: [], formSelectors: ['form'] },
  };

  const detect = (url, declared) => {
    const named = normalize(declared).replace(/ /g, '');
    if (adapters[named]) return adapters[named];
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const direct = Object.values(adapters).find((adapter) =>
      adapter.hosts?.includes(host) || adapter.hostPattern?.test(host));
    if (direct) return direct;
    const recipe = globalThis.HireRadarATSRecipes?.detect?.(url);
    return recipe ? { ...adapters.generic, type: recipe.type, recipe,
      formSelectors: recipe.formSelectors?.length ? recipe.formSelectors : adapters.generic.formSelectors }
      : adapters.generic;
  };

  const createFieldLedger = (maxAttempts = 2) => {
    const states = new Map();
    const get = (field) => states.get(stableFieldKey(field)) || {
      attempts: 0, status: 'discovered', failures: [],
    };
    const merge = (field, patch = {}) => {
      const key = stableFieldKey(field);
      const state = { ...get(field), ...patch };
      states.set(key, state);
      return state;
    };
    return {
      discover(field, metadata = {}) {
        return merge(field, { ...metadata, status: get(field).status || 'discovered' });
      },
      begin(field, metadata = {}) {
        const state = get(field);
        if (['verified', 'needs_user', 'failed'].includes(state.status) || state.attempts >= maxAttempts) return false;
        merge(field, { ...metadata, attempts: state.attempts + 1, status: 'filling' });
        return true;
      },
      verify(field, metadata = {}) {
        merge(field, { ...metadata, status: 'verified', retained: true });
      },
      reject(field, reason = 'not_retained', metadata = {}) {
        const state = get(field);
        const failures = [...(state.failures || []), reason];
        merge(field, {
          ...metadata, failures, retained: false, lastFailure: reason,
          status: state.attempts >= maxAttempts ? 'needs_user' : 'retry',
        });
      },
      defer(field, reason = 'no_safe_answer', metadata = {}) {
        merge(field, { ...metadata, status: 'needs_user', lastFailure: reason });
      },
      fail(field, reason = 'apply_error', metadata = {}) {
        const state = get(field);
        merge(field, { ...metadata, status: 'failed', lastFailure: reason,
          failures: [...(state.failures || []), reason] });
      },
      get,
      snapshot() {
        return [...states.entries()].map(([key, state]) => ({ key, ...state }));
      },
    };
  };

  return {
    adapters, detect, normalize, degreeLevel, stableFieldKey, optionSignature, answerMatchesField, matchOption,
    scoreSubmitText, successEvidence, inferCountry, matchLocationOption, createFieldLedger,
  };
});
