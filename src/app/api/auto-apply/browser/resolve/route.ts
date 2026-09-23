import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { matchAvailableOption } from '@/lib/form-option-matching';
import { exactSuppliedOption, findSavedAnswer, isSensitiveFact, mayUseAi, optionLabels, optionSetHash, ResolutionField } from '@/lib/field-resolution';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const norm = (v: unknown) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
type LiveField = ResolutionField;

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const store = db();
  const { data: device } = await store.from('autoapply_browser_devices').select('user_id,revoked_at')
    .eq('device_token_hash', hash(token)).maybeSingle();
  if (!device || device.revoked_at) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const { jobId, fields, planId: requestedPlanId } = await request.json().catch(() => ({}));
  if (!jobId || !Array.isArray(fields) || fields.length > 50) return NextResponse.json({ error: 'Invalid fields' }, { status: 400, headers: cors });
  const { data: job } = await store.from('autoapply_job_queue').select('job_title,company_name')
    .eq('id', jobId).eq('user_id', device.user_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Application not found' }, { status: 404, headers: cors });
  const { data: profile } = await store.from('user_profiles').select('*').eq('user_id', device.user_id).maybeSingle();
  const custom = (profile?.custom_answers || {}) as Record<string, string>;
  const fact = (key: string) => custom['__fact:' + key];
  const planId = requestedPlanId || crypto.randomUUID();
  const answers: { name: string; value: string; source: string; confidence: number; reason: string; matchedOption?: string; safeToApply: boolean; attempt: number; optionSetHash: string }[] = [];
  const prose: LiveField[] = [];
  const unresolved: LiveField[] = [];
  const pick = (f: LiveField, value: unknown, source = 'profile', reason = 'Matched verified candidate data') => {
    if (value === null || value === undefined || value === '') return false;
    let chosen = String(value);
    const options = optionLabels(f);
    if (options.length) {
      chosen = matchAvailableOption(f.label, chosen, options) || '';
      if (!chosen) return false;
    }
    answers.push({ name: f.name, value: chosen, source, confidence: source === 'ai' ? 0.75 : 0.98, reason, matchedOption: options.length ? chosen : undefined, safeToApply: true, attempt: f.attempt || 1, optionSetHash: optionSetHash(f) }); return true;
  };
  for (const f of fields as LiveField[]) {
    const q = norm(f.label);
    const saved = findSavedAnswer(custom, f.label);
    if (pick(f, saved, 'saved', 'Matched a previously confirmed answer')) continue;
    if (/current.*government employee|currently.*government/.test(q) && pick(f, fact('government_current'), 'saved', 'Matched an explicit reusable government-employment fact')) continue;
    if (/government.*past 10 years|former.*government|within the past 10 years/.test(q) && pick(f, fact('government_past_10_years'), 'saved', 'Matched an explicit reusable government-employment fact')) continue;
    if (/reserves|national guard/.test(q) && pick(f, fact('reserve_or_guard'), 'saved', 'Matched an explicit reusable service fact')) continue;
    if (/5 days|five days|full week.*office|office.*full week/.test(q) && pick(f, fact('onsite_five_days'), 'saved', 'Matched an explicit reusable onsite preference')) continue;
    if (/travel/.test(q) && pick(f, fact('travel'), 'saved', 'Matched an explicit reusable travel preference')) continue;
    if (/coding language|programming language/.test(q) && pick(f, fact('coding_language'), 'saved', 'Matched the preferred coding language')) continue;
    if (/security clearance|clearance level/.test(q) && pick(f, fact('security_clearance'), 'saved', 'Matched an explicit clearance fact')) continue;
    if (/citizen|citizenship|permanent resident/.test(q) && pick(f, fact('citizenship_status'), 'saved', 'Matched an explicit citizenship or residency fact')) continue;
    if (/gender|sex/.test(q) && pick(f, fact('gender_preference'), 'saved', 'Matched an explicit EEO preference')) continue;
    if (/hispanic|latino|ethnicity|race/.test(q) && pick(f, fact('ethnicity_preference'), 'saved', 'Matched an explicit EEO preference')) continue;
    if (/veteran/.test(q) && pick(f, fact('veteran_preference'), 'saved', 'Matched an explicit EEO preference')) continue;
    if (/disab/.test(q) && pick(f, fact('disability_preference'), 'saved', 'Matched an explicit EEO preference')) continue;
    if (/preferred name/.test(q) && pick(f, profile?.preferred_name)) continue;
    if (/pronoun/.test(q) && pick(f, profile?.pronouns)) continue;
    if (/zip|postal/.test(q) && pick(f, profile?.zip_code)) continue;
    if (/location/.test(q) && pick(f, profile?.location || [profile?.city, profile?.state, profile?.country].filter(Boolean).join(', '))) continue;
    if (/city/.test(q) && pick(f, profile?.city || profile?.location)) continue;
    if (/state|province/.test(q) && pick(f, profile?.state)) continue;
    if (/country/.test(q) && pick(f, profile?.country)) continue;
    if (/degree|education level|qualification/.test(q) && pick(f, profile?.education_degree)) continue;
    if (/hear about|learn about|source/.test(q) && pick(f, profile?.default_source)) continue;
    if (/18|adult/.test(q) && pick(f, profile?.is_adult === true ? 'Yes' : profile?.is_adult === false ? 'No' : null)) continue;
    if (/bay area|san francisco area/.test(q) && pick(f, profile?.bay_area_resident === true ? 'Yes' : profile?.bay_area_resident === false ? 'No' : null)) continue;
    if (/salary|compensation/.test(q) && pick(f, profile?.expected_salary || profile?.salary_expectation)) continue;
    if (/sponsor/.test(q) && pick(f, profile?.require_sponsorship === true ? 'Yes' : profile?.require_sponsorship === false ? 'No' : profile?.sponsorship_status)) continue;
    if (/work authorization|authorized to work|eligible to work/.test(q) && pick(f, profile?.work_authorization)) continue;
    if (/previously worked|former employee|current or former/.test(q)) {
      const employers = [...(profile?.prior_employers || []), profile?.current_company].filter(Boolean).map(norm);
      const company = norm(job.company_name);
      if (pick(f, employers.some((e: string) => e.includes(company) || company.includes(e)) ? 'Yes' : 'No')) continue;
    }
    if (mayUseAi(f)) prose.push(f);
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
        for (const item of parsed.answers || []) {
          const field = prose.find((candidate) => candidate.name === item.name);
          if (!field || !item.value || isSensitiveFact(field.label)) continue;
          const value = field.options?.length ? exactSuppliedOption(field, item.value) : String(item.value).trim();
          if (value) pick(field, value, 'ai', 'Generated from supplied candidate context on the final bounded attempt');
        }
      } catch { /* unresolved fields remain for the user */ }
    }
  }
  const answered = new Set(answers.map((a) => a.name));
  const needsContext = [...unresolved, ...prose].filter((f) => !answered.has(f.name)).map((f) => ({ name: f.name, reason: isSensitiveFact(f.label) ? 'A confirmed user answer is required for this sensitive fact.' : 'No truthful answer matched the current ATS options.', attempt: f.attempt || 1 }));
  return NextResponse.json({ planId, answers, needsContext, needsUser: needsContext.map((f) => f.name) }, { headers: cors });
}
