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
const adaptiveCapacity = () => {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  if (cores >= 16 && memory >= 16) return 12;
  if (cores >= 12 && memory >= 8) return 10;
  return 8;
};
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
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 }); void poll();
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
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
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
    if (message.type === 'RESOLVE_FIELDS') {
      const tabId = sender.tab?.id;
      if (!tabId) return { answers: [], needsUser: [] };
      const result = await chrome.storage.session.get('job:' + tabId);
      const job = currentByTab.get(tabId) || result['job:' + tabId];
      if (!job) return { answers: [], needsUser: [] };
      return api('/api/auto-apply/browser/resolve', {
        method: 'POST', body: JSON.stringify({ jobId: job.id, fields: message.fields }),
      });
    }    if (message.type === 'PROGRESS') {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: false };
      const result = await chrome.storage.session.get('job:' + tabId);
      const job = currentByTab.get(tabId) || result['job:' + tabId];
      if (!job) return { ok: false };
      await report(job, message.stage, message.detail || {});
      if (message.stage === 'submitted') {
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
void chrome.storage.session.get(null).then(async (items) => {
  for (const [key, job] of Object.entries(items)) {
    if (!key.startsWith('job:')) continue;
    const tabId = Number(key.slice(4));
    try {
      await chrome.tabs.get(tabId);
      currentByTab.set(tabId, job);
    } catch {
      await chrome.storage.session.remove(key);
      await report(job, 'failed', { detail: 'ATS tab no longer exists.' }).catch(() => undefined);
    }
  }
  void poll();
});