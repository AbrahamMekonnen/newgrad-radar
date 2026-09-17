(() => {
  const marker = 'newgrad-radar=';
  const part = location.hash.split('&').find((item) => item.replace(/^#/, '').startsWith(marker));
  if (!part) return;

  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const decode = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  };
  const setNativeValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, String(value)); else element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const byLabel = (label) => {
    const wanted = normalize(label);
    const labels = [...document.querySelectorAll('label')];
    const found = labels.find((item) => {
      const got = normalize(item.textContent);
      return got === wanted || got.includes(wanted) || wanted.includes(got);
    });
    if (!found) return null;
    if (found.htmlFor) return document.getElementById(found.htmlFor);
    return found.querySelector('input, textarea, select') || found.parentElement?.querySelector('input, textarea, select');
  };
  const findField = (field) => {
    if (field.name) {
      const exact = document.getElementsByName(field.name)[0];
      if (exact) return exact;
      const suffix = [...document.querySelectorAll('[name]')].find((el) => el.name.endsWith(field.name));
      if (suffix) return suffix;
    }
    return byLabel(field.label);
  };
  const fill = (field) => {
    let element = findField(field);
    if (!element || element.type === 'file') return false;
    const value = field.value;
    if (element instanceof HTMLSelectElement) {
      const wanted = normalize(value);
      const option = [...element.options].find((item) => String(item.value) === String(value))
        || [...element.options].find((item) => normalize(item.textContent) === wanted)
        || [...element.options].find((item) => normalize(item.textContent).includes(wanted));
      if (!option) return false;
      element.value = option.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (element.type === 'radio') {
      const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`)];
      const option = radios.find((item) => String(item.value) === String(value))
        || radios.find((item) => normalize(item.parentElement?.textContent).includes(normalize(value)));
      if (!option) return false;
      option.click(); return true;
    }
    if (element.type === 'checkbox') {
      const checked = !['false', 'no', '0', ''].includes(normalize(value));
      if (element.checked !== checked) element.click();
      return true;
    }
    setNativeValue(element, value);
    return true;
  };
  const banner = (message, error = false) => {
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647', maxWidth: '360px', padding: '12px 16px', borderRadius: '10px', color: '#fff', background: error ? '#b91c1c' : '#4f46e5', font: '14px/1.4 system-ui', boxShadow: '0 8px 30px rgba(0,0,0,.25)' });
    box.textContent = message; document.body.appendChild(box); setTimeout(() => box.remove(), 12000);
  };

  (async () => {
    try {
      const encoded = part.replace(/^#/, '').slice(marker.length);
      const { origin, token } = decode(encoded);
      history.replaceState(null, '', location.pathname + location.search);
      const response = await fetch(`${origin}/api/auto-apply/handoff?token=${encodeURIComponent(token)}`);
      if (!response.ok) throw new Error('Prepared answers expired. Open the application from NewGrad Radar again.');
      const data = await response.json();
      let filled = 0;
      for (const field of data.fields || []) if (fill(field)) filled += 1;
      banner(`NewGrad Radar filled ${filled} field${filled === 1 ? '' : 's'}. Review them, complete any file upload or CAPTCHA, then submit.`);
    } catch (error) { banner(error.message || 'Could not load prepared answers.', true); }
  })();
})();
