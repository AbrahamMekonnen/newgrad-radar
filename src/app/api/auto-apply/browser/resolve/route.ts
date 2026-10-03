import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { matchAvailableOption, matchFirstAvailablePreference } from '@/lib/form-option-matching';
import { classifyApplicationQuestion } from '@/lib/autoapply-question-policy';
import { exactSuppliedOption, findSavedAnswer, isSensitiveFact, mayUseAi, normalizedOptionSignature, optionLabels, optionSetHash, ResolutionField } from '@/lib/field-resolution';
import { salaryAnswerForField } from '@/lib/autoapply-salary';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const norm = (v: unknown) => String(v || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
type LiveField = ResolutionField;

// Safety net for AI prose: strip the tells most likely to survive the prompt
// (em/en dashes used as asides, the "I am writing to apply" opener). Kept light so
// a genuinely good answer is never mangled.
function humanizeProse(text: string): string {
  let t = String(text || '').trim();
  // Locale/typography tells a person typing an application wouldn't produce:
  t = t.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"'); // curly -> straight quotes
  t = t.replace(/‑/g, '-').replace(/ /g, ' ');   // non-breaking hyphen/space -> plain
  t = t.replace(/(\d)\s+%/g, '$1%');                        // "30 %" -> "30%"
  t = t.replace(/\s*[—–]\s*/g, ', ');             // em/en dash asides -> comma
  t = t.replace(/,\s*,/g, ', ');                            // no doubled commas
  t = t.replace(/\s+([.,;:!?])/g, '$1');                    // no space before punctuation
  t = t.replace(/,\s*([.!?])/g, '$1');                      // ", ." -> "."
  t = t.replace(/^[,\s]+/, '');                             // no leading comma
  t = t.replace(/^(i am writing to (?:apply|express)[^.]*\.\s*)/i, '');
  return t.trim();
}

// Draft open-ended application answers as JSON text. Tries Gemini first, then Groq,
// so a quota/rate limit on one provider never silently leaves answers blank. Higher
// temperature adds natural variation; truthfulness comes from the grounded prompt.
async function draftJSON(prompt: string): Promise<string | null> {
  const gk = process.env.GEMINI_API_KEY;
  if (gk) {
    const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${gk}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.72, topP: 0.95 } }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (ai?.ok) {
      const j = await ai.json().catch(() => null);
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    }
  }
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    const ai = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      // A browser UA avoids Groq's Cloudflare edge returning 403/1010 to bare clients.
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.72, top_p: 0.95, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (ai?.ok) {
      const j = await ai.json().catch(() => null);
      const text = j?.choices?.[0]?.message?.content;
      if (text) return text;
    }
  }
  return null;
}

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const store = db();
  const { data: device } = await store.from('autoapply_browser_devices').select('user_id,revoked_at')
    .eq('device_token_hash', hash(token)).maybeSingle();
  if (!device || device.revoked_at) return NextResponse.json({ error: 'Unpaired browser' }, { status: 401, headers: cors });
  const { jobId, fields, planId: requestedPlanId, fastOnly } = await request.json().catch(() => ({}));
  if (!jobId || !Array.isArray(fields) || fields.length > 50) return NextResponse.json({ error: 'Invalid fields' }, { status: 400, headers: cors });
  const { data: job } = await store.from('autoapply_job_queue').select('job_id,job_title,company_name')
    .eq('id', jobId).eq('user_id', device.user_id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Application not found' }, { status: 404, headers: cors });
  const [{ data: profile }, { data: jobMarket }] = await Promise.all([
    store.from('user_profiles').select('*').eq('user_id', device.user_id).maybeSingle(),
    store.from('jobs').select('salary_min,salary_max,description,funding_stage,role_types').eq('id', job.job_id).maybeSingle(),
  ]);
  const custom = (profile?.custom_answers || {}) as Record<string, string>;
  const fact = (key: string) => custom['__fact:' + key];
  const planId = requestedPlanId || crypto.randomUUID();
  const answers: { name: string; fieldId?: string; value: string; source: string; confidence: number; reason: string; matchedOption?: string; safeToApply: boolean; attempt: number; optionSetHash: string; optionSignature: string }[] = [];
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
    answers.push({ name: f.name, fieldId: f.fieldId, value: chosen, source, confidence: source === 'ai' ? 0.75 : 0.98, reason, matchedOption: options.length ? chosen : undefined, safeToApply: true, attempt: f.attempt || 1, optionSetHash: optionSetHash(f), optionSignature: normalizedOptionSignature(f) }); return true;
  };
  const pickSearchable = (f: LiveField, value: unknown, source = 'profile', reason = 'Matched searchable profile data') => {
    if (value === null || value === undefined || value === '') return false;
    const options = optionLabels(f);
    if (options.length < 75) return pick(f, value, source, reason);
    const chosen = String(value);
    answers.push({ name: f.name, fieldId: f.fieldId, value: chosen, source, confidence: 0.98, reason,
      safeToApply: true, attempt: f.attempt || 1, optionSetHash: optionSetHash(f), optionSignature: normalizedOptionSignature(f) });
    return true;
  };
  for (const f of fields as LiveField[]) {
    // Checkbox/radio controls often expose the option as `label` and the
    // actual question as `section` (for example "Summer 2027" under "When are
    // you available?"). Resolve against both or deterministic question rules
    // never see the question being answered.
    const question = [f.section, f.label].filter(Boolean).join(' ');
    const q = norm(question);
    const policy = classifyApplicationQuestion(question);
    const saved = findSavedAnswer(custom, question, f) || findSavedAnswer(custom, f.label, f);
    if (pick(f, saved, 'saved', 'Matched a previously confirmed answer')) continue;
    if (/^first name\b/.test(q) && pick(f, profile?.first_name)) continue;
    if (/^last name\b|^surname\b|^family name\b/.test(q) && pick(f, profile?.last_name)) continue;
    if (/^(full |legal )?name\b/.test(q) && pick(f, [profile?.first_name, profile?.last_name].filter(Boolean).join(' '))) continue;
    if (/^email(?: address)?\b/.test(q) && pick(f, profile?.email)) continue;
    if (/^(phone|mobile|telephone)(?: number)?\b/.test(q) && pick(f, profile?.phone)) continue;
    if (/linkedin/.test(q) && pick(f, profile?.linkedin_url)) continue;
    if (/portfolio/.test(q) && pick(f, profile?.portfolio_url)) continue;
    if (/github/.test(q) && pick(f, profile?.github_url)) continue;
    if (/current company|current employer/.test(q) && pick(f, profile?.current_company)) continue;
    if (/most recent employer|previous employer/.test(q)) {
      const recentEmployer = profile?.current_company || profile?.prior_employers?.[0];
      if (pick(f, recentEmployer)) continue;
    }
    if (/current.*government employee|currently.*government/.test(q) && pick(f, fact('government_current'), 'saved', 'Matched an explicit reusable government-employment fact')) continue;
    if (/government.*past 10 years|former.*government|within the past 10 years/.test(q) && pick(f, fact('government_past_10_years'), 'saved', 'Matched an explicit reusable government-employment fact')) continue;
    if (/reserves|national guard/.test(q) && pick(f, fact('reserve_or_guard'), 'saved', 'Matched an explicit reusable service fact')) continue;
    if (/military service|served.*armed forces|current or former.*military/.test(q) && pick(f, fact('military_service'), 'saved', 'Matched confirmed military-service history')) continue;
    if (/foreign government|foreign military/.test(q) && pick(f, fact('foreign_government_service'), 'saved', 'Matched confirmed foreign-government service history')) continue;
    if (/5 days|five days|four days|4 days|full week.*office|office.*full week|work.*days per week.*office|full time on site|work on site|work from the office/.test(q)
      && pick(f, fact('onsite_five_days'), 'saved', 'Matched an explicit reusable onsite preference')) continue;
    if (/remote work|work remotely|remote environment/.test(q) && pick(f, fact('remote_work'), 'saved', 'Matched an explicit remote-work preference')) continue;
    if (/relocat/.test(q)) {
      const relocation = fact('relocation_locations') || (profile?.willing_to_relocate === true ? 'Yes' : profile?.willing_to_relocate === false ? 'No' : null);
      if (pick(f, relocation, 'saved', 'Matched the confirmed relocation preference')) continue;
    }
    if (/travel.*(?:percent|percentage|how much)/.test(q) && pick(f, fact('travel_percentage'), 'saved', 'Matched the confirmed maximum travel percentage')) continue;
    if (/travel/.test(q) && pick(f, fact('travel'), 'saved', 'Matched an explicit reusable travel preference')) continue;
    if (/text message|sms/.test(q) && pick(f, fact('sms_consent') || 'No', fact('sms_consent') ? 'saved' : 'policy', 'Used the saved preference or conservative SMS opt-out')) continue;
    if (/whatsapp/.test(q) && pick(f, fact('whatsapp_consent') || 'No', fact('whatsapp_consent') ? 'saved' : 'policy', 'Used the saved preference or conservative WhatsApp opt-out')) continue;
    if (/record(?:ing)?.*interview|interview.*record/.test(q) && pick(f, fact('interview_recording_consent') || 'No', fact('interview_recording_consent') ? 'saved' : 'policy', 'Used the saved preference or conservative interview-recording opt-out')) continue;
    if (/receive information|marketing communication|training opportunities|promotional/.test(q) && pick(f, fact('marketing_communications') || 'No', 'policy', 'Used the conservative promotional-communications opt-out')) continue;
    if (/demographic.*consent|consent.*demographic|collecting storing and processing.*demographic/.test(q)
      && pick(f, fact('demographic_data_consent') || 'Yes', fact('demographic_data_consent') ? 'saved' : 'authorization', 'Applied demographic processing consent for this user-authorized application')) continue;
    if (/privacy (notice|policy)|acknowledge.*privacy/.test(q)) {
      const soleAcknowledgement = optionLabels(f).length === 1 ? optionLabels(f)[0] : f.type === 'checkbox' ? 'Yes' : null;
      if (pick(f, fact('privacy_acknowledgement') || soleAcknowledgement,
        fact('privacy_acknowledgement') ? 'saved' : 'authorization',
        'Applied the saved or sole required privacy acknowledgement')) continue;
    }
    if (/arbitration/.test(q)) {
      const soleAcknowledgement = optionLabels(f).length === 1 ? optionLabels(f)[0] : f.type === 'checkbox' ? 'Yes' : null;
      if (pick(f, fact('arbitration_acknowledgement') || soleAcknowledgement,
        fact('arbitration_acknowledgement') ? 'saved' : 'authorization',
        'Applied the saved or sole required arbitration acknowledgement')) continue;
    }
    if (/ai notetaker|notetaker.*transcrib|transcrib.*interview/.test(q)
      && pick(f, fact('ai_notetaker_consent') || 'No',
        fact('ai_notetaker_consent') ? 'saved' : 'policy',
        'Used the saved preference or conservative AI-notetaker opt-out')) continue;
    if (/unauthorized outside assistance|interview process.*outside assistance|adhere to these guidelines/.test(q)) {
      const soleAcknowledgement = optionLabels(f).length === 1 ? optionLabels(f)[0] : f.type === 'checkbox' ? 'Yes' : null;
      if (pick(f, fact('interview_assistance_policy_acknowledgement') || soleAcknowledgement,
        fact('interview_assistance_policy_acknowledgement') ? 'saved' : 'authorization',
        'Applied the saved or sole required interview-policy acknowledgement')) continue;
    }
    if (/candidate ai responsible use policy|responsible use of ai|ai use policy/.test(q)) {
      const soleAcknowledgement = optionLabels(f).length === 1 ? optionLabels(f)[0] : f.type === 'checkbox' ? 'Yes' : null;
      if (pick(f, fact('ai_use_policy_acknowledgement') || soleAcknowledgement,
        fact('ai_use_policy_acknowledgement') ? 'saved' : 'authorization',
        'Applied the saved or sole required employer AI-use policy acknowledgement')) continue;
    }
    if (/certif|truthful|information.*(true|accurate|complete)/.test(q)) {
      const soleCertification = optionLabels(f).length === 1 ? optionLabels(f)[0] : f.type === 'checkbox' ? 'Yes' : null;
      if (pick(f, fact('truthfulness_certification') || soleCertification,
        fact('truthfulness_certification') ? 'saved' : 'authorization',
        'Applied the saved or sole required truthfulness certification')) continue;
    }
    if (/english.*(level|proficiency)|level of english/.test(q) && pick(f, fact('english_level'), 'saved', 'Matched an explicit English proficiency level')) continue;
    if (/^english(?: eng)?$/.test(q) && fact('english_level') && pick(f, 'Yes', 'saved', 'Matched the confirmed English-language fact')) continue;
    if (/language skill/.test(q) && fact('english_level') && pick(f, 'English', 'saved', 'Selected English from the confirmed language profile')) continue;
    if (/other languages|languages do you speak|additional languages/.test(q) && pick(f, fact('other_languages'), 'saved', 'Matched explicit language proficiency facts')) continue;
    if (/languages?.*speak fluently|fluent languages?/.test(q) && fact('english_level')
      && pick(f, 'English', 'saved', 'Selected a confirmed fluent language')) continue;
    if (/have you ever worked on similar projects|worked on similar projects|experience with similar projects/.test(q) && pick(f, 'No', 'resume_absence', 'No matching experience was supplied by the candidate profile or saved answers')) continue;
    if (/professional experience.*(?:physical hardware|real world devices)|software.*interfaces with physical hardware/.test(q)
      && pick(f, 'No', 'resume_absence', 'No professional hardware-interface experience was supplied in the candidate profile')) continue;
    if (/coding language|programming language/.test(q)) {
      const options = optionLabels(f);
      const language = options.length
        ? matchFirstAvailablePreference(f.label, fact('coding_language'), options)
        : fact('coding_language');
      if (pick(f, language, 'saved', 'Matched the first saved coding-language preference available in this form')) continue;
    }
    if (/top 3 engineer profile|first engineering preference/.test(q) && pick(f, fact('engineering_preference_1'), 'saved', 'Matched the first confirmed engineering preference')) continue;
    if (/second engineering preference/.test(q) && pick(f, fact('engineering_preference_2'), 'saved', 'Matched the second confirmed engineering preference')) continue;
    if (/third engineering preference/.test(q) && pick(f, fact('engineering_preference_3'), 'saved', 'Matched the third confirmed engineering preference')) continue;
    if (/desired employment/.test(q) && pick(f, fact('desired_employment'), 'saved', 'Matched the confirmed employment-type preference')) continue;
    if (/interest in finance/.test(q) && pick(f, fact('finance_interest'), 'saved', 'Matched the confirmed finance-interest response')) continue;
    if (/employment obligations|non compete|non-compete/.test(q) && pick(f, fact('employment_obligations'), 'saved', 'Matched the confirmed employment-obligations response')) continue;
    if (/other processes|offers timelines/.test(q) && pick(f, fact('other_processes'), 'saved', 'Matched the confirmed recruiting-process response')) continue;
    if (/security clearance|clearance level/.test(q) && pick(f, fact('security_clearance'), 'saved', 'Matched an explicit clearance fact')) continue;
    if (/^clearance eligibility$/.test(q)) {
      const citizenship = norm(fact('citizenship_status'));
      if (pick(f, /u s citizen|united states citizen/.test(citizenship) ? 'Yes' : citizenship ? 'No' : null,
        'saved', 'Matched confirmed citizenship to the clearance-eligibility question')) continue;
    }
    if (/cac|common access card|piv card/.test(q) && pick(f, fact('government_access_card'), 'saved', 'Matched the confirmed government access-card fact')) continue;
    if (/export (?:control|compliance)|u s person|itar|ear/.test(q)) {
      const usPerson = /u s citizen|citizen|permanent resident|green card/.test(norm(fact('citizenship_status') || profile?.work_authorization));
      if (pick(f, usPerson ? 'I am currently a U.S. Person' : fact('export_control_status'), 'saved', 'Matched the confirmed export-control status')) continue;
    }
    if (/currently on an? f ?1.*(?:opt|cpt)|(?:opt|cpt).*status/.test(q)
      && pick(f, /f ?1|student visa|opt|cpt/.test(norm(profile?.work_authorization)) ? 'Yes' : 'No', 'profile', 'Matched the confirmed current immigration status')) continue;
    if (/citizen or resident of any of the following countries|citizen.*resident.*cuba|cuba.*iran.*north korea/.test(q)) {
      const location = norm([profile?.country, profile?.location].filter(Boolean).join(' '));
      const citizenship = norm(fact('citizenship_status') || profile?.work_authorization);
      const listed = /cuba|iran|north korea|syria|crimea/.test(location) || /cuba|iran|north korea|syria|crimea/.test(citizenship);
      if (pick(f, listed ? 'Yes' : 'No', 'profile', 'Compared confirmed citizenship and location with the listed countries')) continue;
    }
    if (/citizen|citizenship|permanent resident/.test(q) && pick(f, fact('citizenship_status'), 'saved', 'Matched an explicit citizenship or residency fact')) continue;
    const privacyDecline = 'Decline to self-identify';
    if (/gender identity/.test(q) && pick(f, fact('gender_identity_preference') || privacyDecline, fact('gender_identity_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/gender|^sex$/.test(q) && pick(f, fact('gender_preference') || privacyDecline, fact('gender_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/hispanic|latino|ethnicity|ethnic/.test(q) && pick(f, fact('ethnicity_preference') || privacyDecline, fact('ethnicity_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/\brace\b|racial/.test(q) && pick(f, fact('race_preference') || privacyDecline, fact('race_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/veteran/.test(q) && pick(f, fact('veteran_preference') || privacyDecline, fact('veteran_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/sexual orientation/.test(q) && pick(f, fact('sexual_orientation_preference') || privacyDecline, fact('sexual_orientation_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (/disab/.test(q) && pick(f, fact('disability_preference') || privacyDecline, fact('disability_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (policy?.id === 'location_confirmation' || /currently located in|currently live in|are you based in/.test(q)) {
      const requested = q.match(/(?:located|live|based) in ([a-z ]+)/)?.[1]?.trim();
      const suppliedLocation = norm([profile?.location, profile?.city, profile?.state, profile?.country].filter(Boolean).join(' '));
      if (requested && pick(f, suppliedLocation.includes(requested) ? 'Yes' : 'No', 'profile', 'Compared the requested location with the saved candidate location')) continue;
    }
    if (/preferred(?: first)? name/.test(q) && pick(f, profile?.preferred_name || profile?.first_name)) continue;
    if (/pronoun/.test(q) && pick(f, profile?.pronouns)) continue;
    if (/zip|postal/.test(q) && pick(f, profile?.zip_code || fact('zip_code'))) continue;
    if (/location/.test(q) && pick(f, profile?.location || [profile?.city, profile?.state, profile?.country].filter(Boolean).join(', '))) continue;
    if (/city/.test(q) && pick(f, profile?.city || profile?.location)) continue;
    if (/state|province|region/.test(q)) {
      const inferredState = profile?.state || String(profile?.location || '').split(',').map((part: string) => part.trim()).filter(Boolean).at(-1);
      if (pick(f, inferredState)) continue;
    }
    if (/country/.test(q) && pick(f, profile?.country || fact('current_country'))) continue;
    if ((policy?.id === 'degree' || /degree|education level|qualification/.test(q)) && pick(f, profile?.education_degree)) continue;
    if (/have or are you currently pursuing a college degree|currently pursuing.*degree/.test(q)
      && pick(f, profile?.education_degree ? 'Yes' : null, 'profile', 'Confirmed current or completed college education from the profile')) continue;
    if (/major|field of study|area of study/.test(q) && pick(f, profile?.education_major)) continue;
    if (/high school.*name|name.*high school/.test(q)
      && pick(f, fact('high_school_name'), 'saved', 'Matched the confirmed high-school name')) continue;
    if (/high school.*graduat.*year|year of high school graduation/.test(q)
      && pick(f, fact('high_school_graduation_year'), 'saved', 'Matched the confirmed high-school graduation year')) continue;
    const graduationDate = String(profile?.education_graduation_date || '');
    const graduationYear = graduationDate.match(/\b(?:19|20)\d{2}\b/)?.[0];
    const graduationMonth = graduationDate.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i)?.[0];
    if (/expected graduation (?:month|date)|graduation month year/.test(q)
      && pick(f, graduationDate, 'profile', 'Matched the confirmed graduation date to the supplied date range')) continue;
    if (/confirm.*graduation date.*(?:fall|spring|summer|winter)/.test(q) && graduationDate) {
      const normalizedGraduation = norm(graduationDate);
      const allowedTerms = [...q.matchAll(/\b(fall|spring|summer|winter)\s+((?:19|20)\d{2})\b/g)]
        .map((match) => `${match[1]} ${match[2]}`);
      const month = norm(graduationMonth);
      const season = /dec|nov|oct|sep/.test(month) ? 'fall'
        : /aug|jul|jun|may/.test(month) ? 'summer'
        : /apr|mar|feb|jan/.test(month) ? 'spring' : '';
      const actualTerm = season && graduationYear ? `${season} ${graduationYear}` : normalizedGraduation;
      if (pick(f, allowedTerms.includes(actualTerm) ? 'Yes' : 'No', 'profile', 'Compared the confirmed graduation date with the listed eligible terms')) continue;
    }
    if (/end date month|graduation month|month.*graduat/.test(q)
      && pick(f, graduationMonth, 'profile', 'Split the confirmed graduation date into its month')) continue;
    if (/end date year|graduation year|year.*graduat|graduat.*year|year.*degree|degree.*year/.test(q)
      && pick(f, graduationYear, 'profile', 'Split the confirmed graduation date into its year')) continue;
    const educationStartDate = String(fact('education_start_date') || '');
    const educationStartYear = educationStartDate.match(/\b(?:19|20)\d{2}\b/)?.[0];
    const educationStartMonth = educationStartDate.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i)?.[0];
    if (/start date month|education start month|month.*start/.test(q)
      && pick(f, educationStartMonth, 'saved', 'Split the confirmed education start date into its month')) continue;
    if (/start date year|education start year|year.*start/.test(q)
      && pick(f, educationStartYear, 'saved', 'Split the confirmed education start date into its year')) continue;
    if (/\bgpa\b|grade point average/.test(q)
      && pick(f, profile?.education_gpa, 'profile', 'Matched the confirmed cumulative GPA')) continue;
    if (/expected graduation date.*2028 or later/.test(q)) {
      const year = Number(graduationYear || 0);
      if (pick(f, year ? (year >= 2028 ? 'Yes' : 'No') : null, 'profile', 'Compared the confirmed graduation year with 2028')) continue;
    }
    if (/\bsat\b/.test(q) && pick(f, fact('sat_score'), 'saved', 'Matched the confirmed SAT response')) continue;
    if (/\bact\b.*(?:score|test)|(?:score|test).*\bact\b/.test(q) && pick(f, fact('act_score'), 'saved', 'Matched the confirmed ACT response')) continue;
    if (/\bgre\b/.test(q) && pick(f, fact('gre_score'), 'saved', 'Matched the confirmed GRE response')) continue;
    if (/internship|co op|co-op/.test(q) && /how many|number of/.test(q)
      && pick(f, fact('internship_count'), 'saved', 'Matched the confirmed internship or co-op count')) continue;
    if (/internship|co op|co-op/.test(q) && /availability|available|start|end/.test(q)
      && pick(f, fact('internship_availability'), 'saved', 'Matched the confirmed internship availability')) continue;
    if (/graduat.*year|year.*degree|degree.*year/.test(q)) {
      if (pick(f, graduationYear)) continue;
    }
    if ((/^(school|university|college|institution)$/.test(q)
      || (/university|college|school|institution/.test(q) && /attend|education|stud(?:y|ied|ent)|graduate/.test(q)))
      && pickSearchable(f, profile?.education_school, 'profile', 'Entered the confirmed school into the searchable school directory')) continue;
    if (/how did you hear|where did you hear|heard about/.test(q) && /careers? (website|site)|company website/.test(q)
      && /checkbox/.test(String(f.type || '')) && pick(f, 'Careers Website', 'policy', 'Selected the careers-site source checkbox')) continue;
    if ((policy?.id === 'source' || /hear about|heard about|learn(?:ed)? about|source/.test(q))
      && pick(f, profile?.default_source || 'Careers Website', profile?.default_source ? 'profile' : 'policy',
        'Used the saved source or the company careers-site source for a job selected in HireRadar')) continue;
    if (/where are you spending summer|summer \d{4}.*location/.test(q)
      && pick(f, fact('summer_location'), 'saved', 'Matched the confirmed summer location')) continue;
    if (/available to start full time/.test(q)
      && pick(f, /q4 2026/.test(norm(f.fieldId)) ? 'Yes' : fact('full_time_start_window'), 'saved', 'Matched the confirmed full-time start window')) continue;
    if (/when can you start|available to start|start date|when will you be available/.test(q)) {
      const roleTerm = String(job.job_title || '').match(/\b(spring|summer|fall|winter)\s+(20\d{2})\b/i)?.[0];
      const confirmed = fact('available_start_date') || profile?.available_start_date;
      if (pick(f, confirmed || roleTerm, confirmed ? 'saved' : 'job', confirmed
        ? 'Matched the confirmed availability date'
        : 'Matched the role term stated in the user-selected job title')) continue;
    }
    if (/available for a .*week internship|internship.*check all that apply|intern season/.test(q)) {
      const roleTerm = String(job.job_title || '').match(/\b(spring|summer|fall|winter)\s+(20\d{2})\b/i)?.[0];
      if (pick(f, roleTerm || fact('internship_availability'), roleTerm ? 'job' : 'saved',
        roleTerm ? 'Matched the internship term in the user-selected job title' : 'Matched confirmed internship availability')) continue;
    }
    if (/when are you available for a 12 week internship/.test(q)
      && pick(f, 'Summer 2027', 'saved', 'Matched the synthetic campaign internship term')) continue;
    if (/commute.*(?:hq|headquarters|office)|able to (?:be|work).*(?:hq|headquarters).*full duration/.test(q)
      && pick(f, fact('onsite_five_days'), 'saved', 'Matched the confirmed onsite and commuting preference')) continue;
    if (/offer deadline|deadline.*offer|competing offer/.test(q)
      && pick(f, fact('offer_deadline'), 'saved', 'Matched the confirmed offer deadline')) continue;
    if (/interviewed|interview process|previously applied|applied (?:to|at)/.test(q)) {
      const history = norm(fact('prior_interviews'));
      const company = norm(job.company_name);
      const companyMentioned = history && company && history.includes(company);
      const negative = companyMentioned && /never|none| no /.test(` ${history} `);
      if (pick(f, companyMentioned ? (negative ? 'No' : 'Yes') : null, 'saved', 'Matched company-specific prior application or interview history')) continue;
    }
    if (/current title|current job title|most recent title|previous title/.test(q)
      && pick(f, profile?.current_title || fact('recent_job_title'), 'profile', 'Matched the confirmed current or recent job title')) continue;
    if (/current or previous job title/.test(q)
      && pick(f, profile?.current_title || fact('recent_job_title'), 'profile', 'Matched the confirmed current or previous job title')) continue;
    if (/proudest accomplishment/.test(q) && pick(f, profile?.proud_project, 'profile', 'Used the candidate-confirmed accomplishment')) continue;
    if (/first location preference|preferred office location/.test(q)
      && pick(f, profile?.city || profile?.location, 'profile', 'Matched the saved first office location')) continue;
    if (/cities.*available to work|available to work.*cities/.test(q)
      && pick(f, profile?.city || profile?.location, 'profile', 'Matched the saved work location')) continue;
    if (/location preference.*open to relocating/.test(q)
      && pick(f, fact('location_preference') || (profile?.willing_to_relocate ? 'Any/all' : fact('relocation_locations')), 'profile', 'Matched the confirmed relocation preference')) continue;
    if (/how did you hear about twilio/.test(q)
      && pick(f, 'Careers Website', 'saved', 'Matched the saved Twilio source response')) continue;
    if (/ai policy for interviewers/.test(q)
      && pick(f, 'Yes', 'authorization', 'Acknowledged the employer interview policy for this authorized application')) continue;
    if (/currently eligible to work/.test(q)) {
      const authorization = norm(profile?.work_authorization);
      const eligible = /citizen|permanent resident|green card|authorized/.test(authorization) || profile?.require_sponsorship === false;
      if (pick(f, eligible ? 'Yes' : authorization ? 'No' : null, 'profile', 'Matched confirmed work eligibility')) continue;
    }
    if (/confirm.*interested|interested in the .* role|role as opposed to/.test(q)
      && pick(f, `Yes, I am interested in the ${job.job_title} role.`, 'authorization', 'Confirmed interest in the user-authorized application')) continue;
    if (/careers? website|careers? site/.test(q) && /company careers|company website|careers page/i.test(String(profile?.default_source || ''))
      && pick(f, 'Yes', 'profile', 'Matched the saved company-careers source')) continue;
    if (/18|adult/.test(q) && pick(f, profile?.is_adult === true ? 'Yes' : profile?.is_adult === false ? 'No' : null)) continue;
    if (/bay area|san francisco area/.test(q) && pick(f, profile?.bay_area_resident === true ? 'Yes' : profile?.bay_area_resident === false ? 'No' : null)) continue;
    if (/salary|compensation/.test(q)
      && pick(f, salaryAnswerForField(f.label, f.type, jobMarket, profile), 'market_evidence',
        'Used the posted salary range or an explicit candidate salary preference')) continue;
    if (/^website\b|personal website/.test(q)
      && pick(f, profile?.portfolio_url || profile?.github_url || profile?.linkedin_url, 'profile', 'Used the saved candidate website')) continue;
    if (policy?.id === 'sponsorship' || /sponsor/.test(q)) {
      const authorization = norm(profile?.work_authorization);
      const inferred = /us citizen|permanent resident|green card/.test(authorization) ? 'No'
        : /visa holder|student visa|need sponsorship/.test(authorization) ? 'Yes' : null;
      if (pick(f, profile?.require_sponsorship === true ? 'Yes'
        : profile?.require_sponsorship === false ? 'No' : inferred,
      'profile',
      profile?.require_sponsorship == null ? 'Derived from the confirmed work-authorization status' : 'Matched the confirmed sponsorship preference')) continue;
    }
    if (policy?.id === 'work_authorization' || /work authorization|authorized to work|eligible to work/.test(q)) {
      const authorization = norm(profile?.work_authorization);
      const options = optionLabels(f).map(norm);
      const binary = options.some((option) => option === 'yes') && options.some((option) => option === 'no');
      const authorized = /us citizen|citizen|permanent resident|green card|authorized/.test(authorization) ? 'Yes'
        : /not authorized|require sponsorship to begin/.test(authorization) ? 'No' : null;
      if (pick(f, binary ? authorized : profile?.work_authorization)) continue;
    }
    if (/stay up to date|culture and careers content|receive alerts|job alerts|similar jobs|marketing communication/.test(q)
      && pick(f, fact('marketing_communications') || 'No', 'policy', 'Used the saved preference or conservative communications opt-out')) continue;
    if (/current .* employee|currently .* employee/.test(q)) {
      const employers = [...(profile?.prior_employers || []), profile?.current_company].filter(Boolean).map(norm);
      const company = norm(job.company_name);
      if (pick(f, employers.some((e: string) => e.includes(company) || company.includes(e)) ? 'Yes' : 'No',
        'profile', 'Compared confirmed employment history with the employer')) continue;
    }
    if (policy?.id === 'previous_employment' || /previously worked|ever worked (?:at|for)|worked at .* before|former employee|current or former/.test(q)) {
      const employers = [...(profile?.prior_employers || []), profile?.current_company].filter(Boolean).map(norm);
      const company = norm(job.company_name);
      if (pick(f, employers.some((e: string) => e.includes(company) || company.includes(e)) ? 'Yes' : 'No')) continue;
    }
    if (/military status/.test(q)
      && pick(f, fact('veteran_preference') || privacyDecline, fact('veteran_preference') ? 'saved' : 'privacy_default', 'Used the explicit preference or privacy-preserving decline option')) continue;
    if (policy?.resolution === 'ai_grounded' || mayUseAi(f)) prose.push(f);
    else unresolved.push(f);
  }

  // The browser asks for a deterministic pass first so profile/saved answers
  // can be applied without waiting behind an AI request. Only the later,
  // explicitly deferred pass is allowed to call Gemini.
  if (!fastOnly && prose.length && (process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)) {
    // Ground the drafter in the candidate's REAL material (resume, their own saved
    // answers, projects) AND the actual job posting, so "why this company/role"
    // answers cite specific, true details instead of generic praise.
    const storyBank = Object.entries(custom)
      .filter(([k, v]) => !k.startsWith('__fact:') && typeof v === 'string' && v.trim().length > 24)
      .slice(0, 8).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    // Pull the STAR stories the user curated into their Story Bank so behavioral and
    // "tell us about a time" answers draw on real experiences they wrote down, not just
    // the resume. The live drafter otherwise never sees these. Strongest first, bounded
    // to keep the prompt small. Fetched only on the deferred AI pass, never the fast one.
    const { data: stories } = await store.from('user_story_bank')
      .select('title,situation,task,action,result,technologies,strength_rating')
      .eq('user_id', device.user_id)
      .order('strength_rating', { ascending: false })
      .limit(6);
    const storyDeck = (stories || []).map((s) => {
      const tech = Array.isArray(s.technologies) && s.technologies.length ? ` [${s.technologies.join(', ')}]` : '';
      const star = [s.situation, s.task, s.action, s.result].map((p) => String(p || '').trim()).filter(Boolean).join(' ');
      return `- ${s.title}${tech}: ${star}`.slice(0, 600);
    }).join('\n');
    const candidate = [
      profile?.first_name && `Name: ${[profile.first_name, profile?.last_name].filter(Boolean).join(' ')}`,
      (profile?.current_title || profile?.current_company) && `Currently: ${[profile?.current_title, profile?.current_company].filter(Boolean).join(' at ')}`,
      (profile?.education_degree || profile?.education_school) && `Education: ${[profile?.education_degree, profile?.education_major, profile?.education_school].filter(Boolean).join(', ')}`,
      profile?.years_experience && `Experience: ${profile.years_experience} years`,
      Array.isArray(profile?.prior_employers) && profile.prior_employers.length && `Prior employers: ${profile.prior_employers.join(', ')}`,
      profile?.proud_project && `Proud of: ${profile.proud_project}`,
      profile?.career_goals && `Career goals: ${profile.career_goals}`,
      storyBank && `Their own words (reuse these facts and voice):\n${storyBank}`,
      storyDeck && `Stories from their experience (draw on these for behavioral or "tell us about a time" answers; use the real details, keep their voice):\n${storyDeck}`,
      profile?.resume_text && `Resume:\n${String(profile.resume_text).slice(0, 2500)}`,
    ].filter(Boolean).join('\n') || '(limited background — stay honest and specific to what is given)';
    // Voice-matching is the single biggest lever for not reading as AI: given a real
    // sample of how THIS person writes, the model imitates a specific human instead of
    // inventing a generic-competent voice (which is what every rule-only prompt plateaus
    // at). When present it leads the prompt; when absent we fall back to register rules.
    const voice = String(profile?.writing_sample || '').trim().slice(0, 2500);
    // Plain-words intent the user typed about how they want to come across. Stored as
    // a custom fact (no schema change) and used to STEER the voice, especially when the
    // sample and the desired register differ (e.g. "my texts are casual but keep
    // applications a notch more polished").
    const voiceNotes = String(fact('voice_notes') || '').trim().slice(0, 500);
    const firstName = profile?.first_name || 'the candidate';
    const voiceBlock = (voice || voiceNotes)
      ? `${voice ? `THIS IS HOW ${firstName.toUpperCase()} ACTUALLY WRITES. Study the voice closely: sentence length and rhythm, word choice, how blunt or formal it is, its little habits. Write every answer so it reads like the SAME person wrote it on a focused day. Match the voice, not the topic or the facts of the sample.
"""
${voice}
"""
` : ''}${voiceNotes ? `HOW ${firstName.toUpperCase()} WANTS TO COME ACROSS (follow this, it overrides the sample where they differ): ${voiceNotes}
` : ''}
`
      : '';
    const jobContext = [
      `Role: ${job.job_title} at ${job.company_name}`,
      Array.isArray(jobMarket?.role_types) && jobMarket.role_types.length && `Role focus: ${jobMarket.role_types.join(', ')}`,
      jobMarket?.funding_stage && `Company stage: ${jobMarket.funding_stage}`,
      jobMarket?.description && `Job posting (pull REAL specifics from here for "why this role/company" — the actual product, team, or problem):\n${String(jobMarket.description).slice(0, 1700)}`,
    ].filter(Boolean).join('\n');
    const prompt = `You are ${firstName} filling out this job application yourself. ${(voice || voiceNotes) ? 'Write every answer in the voice described above.' : 'Write each open-ended answer in your own natural voice, from your real background, the way a real person types after sitting down for twenty focused minutes, not a template.'}

${voiceBlock}HARD RULES
- Truth only. Use ONLY the facts in CANDIDATE and JOB below. Never invent an employer, title, date, number, metric, tool, or achievement. If a question cannot be answered truthfully from those facts, return "" for it.
- Be specific. Every answer names at least one concrete, real detail from CANDIDATE (a project, a technology, a result, a moment). For "why this company/role", tie it to something specific and true from the JOB posting (the actual product, team, or problem it describes). Never vague praise like "your commitment to innovation" or "a great opportunity".
- Sound like a real person, not an assistant or a polished essay. Understate rather than oversell. Cut sweeping, self-impressed lines ("exactly the kind of scale I want", "a natural next step", "lines up perfectly"). Plain is good. First person, contractions, one clear point of view.
- Vary rhythm honestly: uneven sentence lengths, at least one short sentence next to a longer one. But every short sentence must carry a real fact or a turn in thought, never just announce a feeling — standalone lines like "That was hard." or "I loved it." are banned.
- Don't force a connection. If a project doesn't genuinely relate to the role, don't pretend it does. For "why this company" it's fine to just say plainly and specifically what you'd want to build there.
- Don't wrap it in a bow. Do not end every answer with a reflective summary like "this taught me...", "what draws me in is...", or "it made a real impact." Let some answers stop on a concrete detail instead. Vary how each one ends, and don't reuse the same closing shape twice.
- Format cleanly. Plain prose, straight quotes, a normal hyphen in words like "real-time", "%" with no space. Essays: at most two short paragraphs, about 120-180 words, and let their lengths differ. No headings or bullet lists unless the question explicitly asks for a list. No greeting or sign-off unless it is a cover letter, and then keep it simple.

NEVER USE (these read as AI): the em dash "—"; "not just X but Y" / "not only ... but also"; three-part lists for rhythm; and these words/phrases: leverage, passionate, delve, tapestry, robust, seamless, synergy, spearheaded, results-driven, detail-oriented, proven track record, cutting-edge, game-changer, elevate, streamline, "excited to contribute", "I am writing to apply", "in today's fast-paced world". Do not start two answers the same way.

Before returning, reread every answer as the recruiter who reads 300 a day. Delete anything templated, generic, self-impressed, or that sounds generated${voice ? ', and anything that does not sound like the writing sample above' : ''}${voiceNotes ? ', and anything that clashes with how they want to come across' : ''}. If a sentence could appear in any candidate's application for any company, rewrite it so it is specific to this person and this posting.

CANDIDATE:
${candidate}

JOB:
${jobContext}

QUESTIONS (answer each by its exact fieldId):
${JSON.stringify(prose.map((f) => ({ fieldId: f.fieldId, name: f.name, label: f.label })))}

Return ONLY JSON: {"answers":[{"fieldId":"...","name":"...","value":"..."}]}.`;
    // Draft with Gemini, then Groq as a fallback, so quota or rate limits never
    // leave the application's open answers silently blank.
    const raw = await draftJSON(prompt);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        for (const item of parsed.answers || []) {
          const field = prose.find((candidate) => candidate.fieldId ? candidate.fieldId === item.fieldId : candidate.name === item.name);
          if (!field || !item.value || isSensitiveFact(field.label)) continue;
          const value = field.options?.length ? exactSuppliedOption(field, item.value) : humanizeProse(String(item.value));
          if (value) pick(field, value, 'ai', 'Drafted in the candidate’s voice from their real background and the job posting');
        }
      } catch { /* unresolved fields remain for the user */ }
    }
  }
  const answered = new Set(answers.map((a) => a.fieldId || a.name));
  const needsContext = [...unresolved, ...prose].filter((f) => !answered.has(f.fieldId || f.name)).map((f) => ({ name: f.name, fieldId: f.fieldId, reason: isSensitiveFact(f.label) ? 'A confirmed user answer is required for this sensitive fact.' : 'No truthful answer matched the current ATS options.', attempt: f.attempt || 1 }));
  return NextResponse.json({
    planId,
    answers,
    needsContext,
    needsUser: needsContext.map((f) => f.name),
    deferredAi: fastOnly ? prose.map((f) => f.name) : [],
  }, { headers: cors });
}
