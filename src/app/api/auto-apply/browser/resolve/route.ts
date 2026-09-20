import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const norm = (v: unknown) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
type LiveField = { name: string; label: string; type?: string; options?: string[] };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const store = db();
  const { data: device } = await store.from('autoapply_browser_devices').select('user_id,revoked_at')
    .eq('device_token_hash', hash(token)).maybeSingle();
  if (!device || device.revoked_at) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const { jobId, fields } = await request.json().catch(() => ({}));
  if (!jobId || !Array.isArray(fields) || fields.length > 50) return NextResponse.json({ error: 'Invalid fields' }, { status: 400, headers: cors });
  const { data: job } = await store.from('autoapply_job_queue').select('job_title,company_name')
    .eq('id', jobId).eq('user_id', device.user_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Application not found' }, { status: 404, headers: cors });
  const { data: profile } = await store.from('user_profiles').select('*').eq('user_id', device.user_id).maybeSingle();
  const custom = (profile?.custom_answers || {}) as Record<string, string>;
  const answers: { name: string; value: string; source: string }[] = [];
  const prose: LiveField[] = [];
  const unresolved: LiveField[] = [];
  const pick = (f: LiveField, value: unknown) => {
    if (value === null || value === undefined || value === '') return false;
    let chosen = String(value);
    if (f.options?.length) {
      const wanted = norm(chosen);
      chosen = f.options.find((o) => norm(o) === wanted || norm(o).includes(wanted) || wanted.includes(norm(o))) || '';
      if (!chosen) return false;
    }
    answers.push({ name: f.name, value: chosen, source: 'profile' }); return true;
  };
  for (const f of fields as LiveField[]) {
    const q = norm(f.label);
    const saved = custom[f.label] || custom[q];
    if (pick(f, saved)) continue;
    if (/preferred name/.test(q) && pick(f, profile?.preferred_name)) continue;
    if (/pronoun/.test(q) && pick(f, profile?.pronouns)) continue;
    if (/zip|postal/.test(q) && pick(f, profile?.zip_code)) continue;
    if (/location/.test(q) && pick(f, profile?.location || [profile?.city, profile?.state, profile?.country].filter(Boolean).join(', '))) continue;
    if (/city/.test(q) && pick(f, profile?.city || profile?.location)) continue;
    if (/state|province/.test(q) && pick(f, profile?.state)) continue;
    if (/country/.test(q) && pick(f, profile?.country)) continue;
    if (/hear about|learn about|source/.test(q) && pick(f, profile?.default_source)) continue;
    if (/18|adult/.test(q) && pick(f, profile?.is_adult === true ? 'Yes' : profile?.is_adult === false ? 'No' : null)) continue;
    if (/bay area|san francisco area/.test(q) && pick(f, profile?.bay_area_resident === true ? 'Yes' : profile?.bay_area_resident === false ? 'No' : null)) continue;
    if (/salary|compensation/.test(q) && pick(f, profile?.expected_salary || profile?.salary_expectation)) continue;
    if (/sponsor|work authorization|authorized to work/.test(q) && pick(f, profile?.work_authorization || profile?.sponsorship_status)) continue;
    if (/previously worked|former employee|current or former/.test(q)) {
      const employers = [...(profile?.prior_employers || []), profile?.current_company].filter(Boolean).map(norm);
      const company = norm(job.company_name);
      if (pick(f, employers.some((e: string) => e.includes(company) || company.includes(e)) ? 'Yes' : 'No')) continue;
    }
    if (/why |describe|tell us|project|accomplishment|experience|additional information|cover letter/.test(q) && !f.options?.length) prose.push(f);
    else unresolved.push(f);
  }

  if (prose.length && process.env.GEMINI_API_KEY) {
    const context = {
      current_title: profile?.current_title,
      proud_project: profile?.proud_project,
      career_goals: profile?.career_goals,
      writing_sample: profile?.writing_sample,
      preferred_tone: profile?.preferred_tone || 'natural',
    };
    const prompt = `Return only JSON {"answers":[{"name":"field name","value":"answer"}]}.
Draft concise, truthful, human application answers for ${job.job_title} at ${job.company_name}. Use only the supplied non-sensitive context. Never invent facts. If context is insufficient, omit that field. Match the candidate's tone.
CONTEXT: ${JSON.stringify(context)}
QUESTIONS: ${JSON.stringify(prose)}`;
    const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.35 } }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (ai?.ok) {
      const result = await ai.json();
      try {
        const parsed = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        for (const item of parsed.answers || []) if (item.name && item.value) answers.push({ name: item.name, value: item.value, source: 'ai' });
      } catch { /* unresolved fields remain for the user */ }
    }
  }
  const answered = new Set(answers.map((a) => a.name));
  return NextResponse.json({ answers, needsUser: [...unresolved, ...prose].filter((f) => !answered.has(f.name)).map((f) => f.name) }, { headers: cors });
}
