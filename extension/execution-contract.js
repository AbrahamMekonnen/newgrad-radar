(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HireRadarExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const normalize = (value) => String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
  const visible = (element) => Boolean(element && element.getClientRects().length > 0
    && element.getAttribute('aria-hidden') !== 'true');

  const classifyErrors = (errors) => {
    const text = normalize((errors || []).join(' '));
    if (!text) return { category: 'unconfirmed', transient: false };
    if (/captcha|recaptcha|hcaptcha|verify you are human/.test(text)) return { category: 'captcha', transient: false };
    if (/already applied|already submitted|duplicate application/.test(text)) return { category: 'duplicate', transient: false };
    if (/job.*closed|position.*closed|no longer available|expired posting/.test(text)) return { category: 'job_closed', transient: false };
    if (/session.*expired|sign in|log in|unauthorized/.test(text)) return { category: 'session_expired', transient: false };
    if (/upload|parsing|updating your forms|processing|please wait|still saving/.test(text)) return { category: 'processing', transient: true };
    if (/rate limit|too many requests|temporarily unavailable|timeout|timed out|network|try again/.test(text)) return { category: 'temporary', transient: true };
    if (/required|missing entry|needs corrections|invalid|must be/.test(text)) return { category: 'validation', transient: false };
    return { category: 'ats_error', transient: false };
  };

  const safeDiagnostic = (input) => ({
    code: String(input?.code || 'unknown').slice(0, 80),
    ats: String(input?.ats || 'generic').slice(0, 40),
    step: String(input?.step || '').slice(0, 80),
    fieldKey: String(input?.fieldKey || '').slice(0, 160),
    controlType: String(input?.controlType || '').slice(0, 40),
    optionCount: Number.isFinite(input?.optionCount) ? input.optionCount : undefined,
    answerSource: String(input?.answerSource || '').slice(0, 40),
    retained: typeof input?.retained === 'boolean' ? input.retained : undefined,
    category: String(input?.category || '').slice(0, 40),
    attempt: Number.isFinite(input?.attempt) ? input.attempt : undefined,
  });

  const uploadPending = (doc) => {
    const selectors = '[aria-busy=true], progress, [role=progressbar], [role=status], [aria-live], [class*=uploading], [class*=progress], [class*=spinner]';
    return [...doc.querySelectorAll(selectors)].some((element) => {
      if (!visible(element)) return false;
      if (element.getAttribute('aria-busy') === 'true' || element.tagName === 'PROGRESS' || element.getAttribute('role') === 'progressbar') return true;
      const text = normalize(element.textContent || element.getAttribute('aria-label') || '');
      return /uploading|parsing your resume|processing resume|updating your forms|still saving|please wait/.test(text);
    });
  };

  const withinTransitionGrace = (startedAt, now = Date.now(), windowMs = 8000) => {
    const start = Number(startedAt || 0);
    return !start || now - start < windowMs;
  };

  const findNextAction = (doc) => [...doc.querySelectorAll('button, input[type=button], input[type=submit]')]
    .filter((element) => visible(element) && !element.disabled)
    .map((element) => ({ element, text: normalize(element.textContent || element.value) }))
    .filter(({ text }) => /^(next|continue|save and continue|review application|review)$/.test(text))
    .sort((a, b) => (/review/.test(b.text) ? 1 : 0) - (/review/.test(a.text) ? 1 : 0))[0]?.element || null;

  const requiredInvalid = (root) => [...(root?.querySelectorAll?.('input, textarea, select, [role=combobox]') || [])]
    .find((element) => visible(element) && element.willValidate && !element.checkValidity()) || null;

  const shouldRetrySubmit = ({ attempts, errors }) => {
    const classification = classifyErrors(errors);
    return { ...classification, retry: attempts < 2 && classification.transient };
  };

  return { normalize, visible, classifyErrors, safeDiagnostic, uploadPending, withinTransitionGrace, findNextAction, requiredInvalid, shouldRetrySubmit };
});
