/** Credential-safe health check for Auto-Apply prose providers. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
for (const name of ['.env.local', 'scraper/.env']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at <= 0 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, at).trim();
    if (!(key in process.env)) process.env[key] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  const result = {};
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(gemini)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Return only {"ok":true}' }] }], generationConfig: { responseMimeType: 'application/json' } }),
    }).catch(() => null);
    result.gemini = response ? { configured: true, status: response.status, ok: response.ok } : { configured: true, network: false };
  } else result.gemini = { configured: false };
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq}`, 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.2, messages: [{ role: 'user', content: 'Return only valid json: {"ok":true}' }], response_format: { type: 'json_object' } }),
    }).catch(() => null);
    const error = response && !response.ok ? await response.json().catch(() => null) : null;
    result.groq = response ? { configured: true, status: response.status, ok: response.ok,
      errorCode: error?.error?.code || null, errorMessage: String(error?.error?.message || '').slice(0, 300) || null } : { configured: true, network: false };
  } else result.groq = { configured: false };
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
