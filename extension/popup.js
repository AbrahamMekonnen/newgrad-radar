const ask = (message) => chrome.runtime.sendMessage(message);
async function render() {
  const state = await ask({ type: 'STATUS' });
  document.getElementById('disconnected').hidden = !!state.deviceToken;
  document.getElementById('connected').hidden = !state.deviceToken;
  document.getElementById('status').textContent = state.paused ? 'Paused. No applications will start.' : 'Connected and checking for applications.';
  document.getElementById('pause').textContent = state.paused ? 'Resume' : 'Pause';
  document.getElementById('pause').dataset.paused = String(!!state.paused);
}
document.getElementById('pair').addEventListener('click', async () => {
  const message = document.getElementById('message'); message.textContent = '';
  const result = await ask({ type: 'PAIR', origin: document.getElementById('origin').value, code: document.getElementById('code').value.trim() });
  if (!result?.ok) message.textContent = result?.error || 'Could not connect.'; else await render();
});
document.getElementById('pause').addEventListener('click', async (event) => {
  await ask({ type: 'SET_PAUSED', paused: event.currentTarget.dataset.paused !== 'true' }); await render();
});
void render();