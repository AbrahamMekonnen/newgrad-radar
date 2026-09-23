const DEFAULT_ORIGIN = 'https://newgrad-radar.vercel.app';
const POLL_ALARM = 'hireradar-poll';
const currentByTab = new Map();
const stored = () => chrome.storage.local.get(['origin', 'deviceToken', 'paused']);
const api = async (path, options = {}) => {
  const state = await stored();
  if (!state.deviceToken) throw new Error('Browser helper is not connected.');
  const response = await fetch((state.origin || DEFAULT_ORIGIN) + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.deviceToken, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('HireRadar returned ' + response.status));
  return data;
};
const report = async (job, stage, extra = {}) => api('/api/auto-apply/browser/device', {
  method: 'PATCH', body: JSON.stringify({ id: job.id, leaseId: job.leaseId, stage, ...extra }),
});
// Controlled learning batches keep failures reviewable and prevent a broken
// selector from draining the full queue before its shared cause is fixed.
const BATCH_SIZE = 7;
const adaptiveCapacity = () => BATCH_SIZE;
let pollRunning = false;
async function poll() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const state = await stored();
    if (!state.deviceToken || state.paused) return;
    const capacity = adaptiveCapacity();
    while (currentByTab.size < capacity) {
      const data = await api('/api/auto-apply/browser/device');
      if (!data.job) break;
      try {
        const tab = await chrome.tabs.create({ url: data.job.jobUrl, active: false });
        if (!tab.id) throw new Error('Could not create ATS tab.');
        currentByTab.set(tab.id, data.job);
        await chrome.storage.session.set({ ['job:' + tab.id]: data.job });
        await report(data.job, 'tab_opened');
      } catch (error) {
        await report(data.job, 'failed', { detail: 'Could not open the ATS tab: ' + error.message }).catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn('HireRadar poll failed:', error);
  } finally {
    pollRunning = false;
  }
}
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  // Unpacked-extension reloads preserve session storage and existing ATS tabs.
  // Clear only tabs created and tracked by this helper so each update starts
  // with the current content script. Ordinary browser tabs are never touched.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const items = await chrome.storage.session.get(null);
  const managedKeys = Object.keys(items).filter((key) => key.startsWith('job:'));
  const managedTabs = managedKeys.map((key) => Number(key.slice(4))).filter(Number.isFinite);
  currentByTab.clear();
  if (managedKeys.length) await chrome.storage.session.remove(managedKeys);
  await Promise.allSettled(managedTabs.map((tabId) => chrome.tabs.remove(tabId)));
  void poll();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 }); void poll();
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === POLL_ALARM) void poll(); });
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !tab.openerTabId) return;
  const result = await chrome.storage.session.get('job:' + tab.openerTabId);
  const job = currentByTab.get(tab.openerTabId) || result['job:' + tab.openerTabId];
  if (!job) return;
  currentByTab.delete(tab.openerTabId);
  await chrome.storage.session.remove('job:' + tab.openerTabId);
  currentByTab.set(tab.id, job);
  await chrome.storage.session.set({ ['job:' + tab.id]: job });
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const result = await chrome.storage.session.get('job:' + tabId);
  const job = currentByTab.get(tabId) || result['job:' + tabId];
  if (!job) return;
  const currentUrl = String(changeInfo.url || tab.url || '');
  if (/community\.workday\.com\/invalid-url/i.test(currentUrl)) {
    currentByTab.delete(tabId);
    await chrome.storage.session.remove('job:' + tabId);
    await report(job, 'failed', { detail: 'The Workday posting redirected to its invalid/expired-job page.' }).catch(() => undefined);
    void poll();
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['ats-adapters.js', 'execution-contract.js', 'content.js'] });
  } catch (error) {
    await report(job, 'failed', { detail: 'Could not start the ATS page helper: ' + error.message }).catch(() => undefined);
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.session.get('job:' + tabId);
  const job = currentByTab.get(tabId) || result['job:' + tabId];
  currentByTab.delete(tabId);
  await chrome.storage.session.remove('job:' + tabId);
  if (job) await report(job, 'failed', { detail: 'ATS tab closed before confirmed submission.' }).catch(() => undefined);
  void poll();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'PAIR') {
      const origin = String(message.origin || DEFAULT_ORIGIN).replace(/\/$/, '');
      const response = await fetch(origin + '/api/auto-apply/browser/device', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: message.code, name: navigator.userAgent.includes('Edg/') ? 'Edge helper' : 'Chrome helper' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Pairing failed');
      await chrome.storage.local.set({ origin, deviceToken: data.token, deviceId: data.deviceId, paused: false });
      void poll(); return { ok: true };
    }
    if (message.type === 'SET_PAUSED') {
      await chrome.storage.local.set({ paused: !!message.paused });
      if (!message.paused) void poll();
      return { ok: true };
    }
    if (message.type === 'STATUS') return { ...(await stored()), activeCount: currentByTab.size, capacity: adaptiveCapacity() };
    if (message.type === 'PAGE_READY') {
      const tabId = sender.tab?.id;
      if (!tabId) return { job: null };
      const result = await chrome.storage.session.get('job:' + tabId);
      const job = currentByTab.get(tabId) || result['job:' + tabId] || null;
      if (job) await report(job, 'filling');
      return { job };
    }
    if (message.type === 'FETCH_FILE') {
      const fileUrl = new URL(message.url);
      if (fileUrl.hostname !== 'jmrbyubrrpxxvotsljms.supabase.co' || !fileUrl.pathname.includes('/storage/v1/object/public/resumes/')) {
        throw new Error('File URL is outside the configured résumé storage.');
      }
      const response = await fetch(fileUrl.href);
      if (!response.ok) throw new Error('Could not download the stored résumé.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        data: btoa(binary),
        type: response.headers.get('content-type') || 'application/pdf',
        name: decodeURIComponent(fileUrl.pathname.split('/').pop() || 'resume.pdf'),
      };
    }    if (message.type === 'RESOLVE_FIELDS') {
      const tabId = sender.tab?.id;
      if (!tabId) return { answers: [], needsUser: [] };
      const result = await chrome.storage.session.get('job:' + tabId);
      const job = currentByTab.get(tabId) || result['job:' + tabId];
      if (!job) return { answers: [], needsUser: [] };
      return api('/api/auto-apply/browser/resolve', {
        method: 'POST', body: JSON.stringify({ jobId: job.id, planId: message.planId, fields: message.fields }),
      });
    }    if (message.type === 'PROGRESS') {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: false };
      const keys = ['job:' + tabId, 'submitted:' + tabId];
      const result = await chrome.storage.session.get(keys);
      const job = currentByTab.get(tabId) || result['job:' + tabId];
      // Greenhouse can navigate to its success page before the original
      // content script receives our acknowledgement. That new page reports the
      // same success; accept it when this tab already has a recorded receipt.
      if (!job) return message.stage === 'submitted' && !!result['submitted:' + tabId]
        ? { ok: true, alreadySubmitted: true } : { ok: false };
      await report(job, message.stage, message.detail || {});
      if (message.stage === 'submitted') {
        await chrome.storage.session.set({ ['submitted:' + tabId]: { jobId: job.id, at: Date.now() } });
        currentByTab.delete(tabId);
        await chrome.storage.session.remove('job:' + tabId);
        void poll();
      }
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
void (async () => {
  const version = chrome.runtime.getManifest().version;
  const local = await chrome.storage.local.get(['runtimeVersion']);
  const items = await chrome.storage.session.get(null);
  const managed = Object.entries(items).filter(([key]) => key.startsWith('job:'));

  // Reloading an unpacked extension restarts its worker but can preserve the
  // session entries and tabs created by the previous version. Never restore
  // old content scripts after an upgrade: close only HireRadar-managed tabs,
  // clear their session records, and let their expired leases return safely.
  if (local.runtimeVersion !== version) {
    const keys = managed.map(([key]) => key);
    const tabs = keys.map((key) => Number(key.slice(4))).filter(Number.isFinite);
    if (keys.length) await chrome.storage.session.remove(keys);
    await Promise.allSettled(tabs.map((tabId) => chrome.tabs.remove(tabId)));
    await chrome.storage.local.set({ runtimeVersion: version });
  } else {
    for (const [key, job] of managed) {
      const tabId = Number(key.slice(4));
      try {
        await chrome.tabs.get(tabId);
        currentByTab.set(tabId, job);
      } catch {
        await chrome.storage.session.remove(key);
        await report(job, 'failed', { detail: 'ATS tab no longer exists.' }).catch(() => undefined);
      }
    }
  }
  void poll();
})();