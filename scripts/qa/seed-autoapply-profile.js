/** Reversibly seed recurring Auto-Apply facts for an authorized QA campaign. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..', '..');
for (const name of ['.env.local', 'scraper/.env']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('Supabase credentials are not configured.');
class DisabledWebSocket {}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: DisabledWebSocket },
});
const backupFile = path.join(root, '.qa', 'autoapply-profile-before-seed.json');
const profileColumns = ['custom_answers', 'education_graduation_date', 'proud_project', 'career_goals', 'writing_sample',
  'current_title', 'current_company', 'country', 'state', 'city', 'location', 'default_source'];

const seedFacts = {
  government_current: 'No',
  government_past_10_years: 'No',
  reserve_or_guard: 'No',
  military_service: 'No',
  foreign_government_service: 'No',
  onsite_five_days: 'Yes',
  remote_work: 'Yes',
  travel: 'Yes',
  travel_percentage: '25%',
  relocation_locations: 'San Francisco Bay Area, New York City, Seattle, or remote in the United States',
  marketing_communications: 'No',
  sms_consent: 'No',
  whatsapp_consent: 'No',
  interview_recording_consent: 'No',
  privacy_acknowledgement: 'Yes',
  demographic_data_consent: 'Yes',
  arbitration_acknowledgement: 'Yes',
  truthfulness_certification: 'Yes',
  ai_notetaker_consent: 'No',
  interview_assistance_policy_acknowledgement: 'Yes',
  ai_use_policy_acknowledgement: 'Yes',
  english_level: 'C2 (Native)',
  other_languages: 'English and Amharic',
  coding_language: 'Python 3',
  available_start_date: 'Available to Start Immediately',
  six_month_full_time_program: 'Yes',
  education_start_date: 'September 2022',
  internship_count: '2',
  prior_interviews: 'None unless recorded in a saved company-specific answer',
  offer_deadline: 'None',
  sat_score: 'Not taken',
  act_score: 'Not taken',
  gre_score: 'Not taken',
  security_clearance: 'No - I am interested in obtaining one.',
  government_access_card: 'No',
  export_control_status: 'Authorized to work in the United States without employer sponsorship',
  internship_availability: 'Available for the full dates listed in the job posting',
  internship_months: 'January, February, March, April, May, and June',
  can_perform_essential_functions: 'Yes',
  document_acknowledgement: 'Yes',
  production_ai_agent_experience: 'Yes',
  agent_full_stack_experience: 'I built and deployed a full-stack TypeScript application with server-side automation, PostgreSQL persistence, role-based workflows, and production monitoring. I designed the agent-style workflow to plan actions, validate inputs, retry recoverable failures, and surface uncertain decisions for review.',
  post_government_employment_restrictions: 'No',
  ai_tool_usage: 'I design or automate workflows with AI tools (e.g., building agents, integrating AI into team processes).',
  government_official_relative: 'No',
  institutional_conflict_relationship: 'No',
  senior_leader_referral: 'No',
  share_academic_transcripts: 'Yes',
  past_security_clearance: 'N/A - have never held U.S. security clearance',
  company_history: 'No',
  conflict_of_interest: 'No',
  polygraph_level: 'None',
  md_agency_clearance: 'No',
  platform_commerce_experience_years: '0-2',
  canada_work_authorization: 'No',
  citizenship_status: 'U.S. citizen',
  engineering_preference_1: 'Backend',
  engineering_preference_2: 'Full Stack',
  engineering_preference_3: 'Infrastructure',
  desired_employment: 'Full-time',
  finance_interest: 'Interested but considering all opportunities',
  employment_obligations: 'No',
  other_processes: 'None',
  current_country: 'United States',
  zip_code: '94105',
  location_preference: 'Any/all',
  full_time_start_window: 'Q4 2026 (October - December)',
  first_location_preference: 'San Francisco, CA, United States',
};
const rawAnswers = {
  'what is your expected graduation month year': 'May 2028',
  'when are you available for a 12 week internship check all that apply': 'Summer 2027',
  'how did you hear about twilio': 'Careers Website',
  'when are you available to start full time': 'Q4 2026 (October - December)',
};

async function activeUserId() {
  const { data, error } = await db.from('autoapply_browser_devices').select('user_id,last_seen_at')
    .is('revoked_at', null).order('last_seen_at', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new Error('No active paired browser user was found.');
  return data[0].user_id;
}

async function main() {
  const mode = process.argv.includes('--restore') ? 'restore' : 'seed';
  const userId = await activeUserId();
  if (mode === 'restore') {
    if (!fs.existsSync(backupFile)) throw new Error('No QA profile backup exists.');
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    if (backup.user_id !== userId) throw new Error('Backup belongs to a different user.');
    const restored = Object.fromEntries(profileColumns.filter((column) => column in backup).map((column) => [column, backup[column]]));
    const { error } = await db.from('user_profiles').update(restored).eq('user_id', userId);
    if (error) throw error;
    console.log(`Restored ${Object.keys(backup.custom_answers || {}).length} saved profile answers.`);
    return;
  }
  const { data: profile, error } = await db.from('user_profiles').select(profileColumns.join(',')).eq('user_id', userId).single();
  if (error) throw error;
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  // A second seed must never replace the original pre-campaign snapshot.
  if (!fs.existsSync(backupFile)) {
    fs.writeFileSync(backupFile, JSON.stringify({ user_id: userId, ...profile, custom_answers: profile.custom_answers || {}, backed_up_at: new Date().toISOString() }, null, 2));
  } else {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    let changed = false;
    for (const column of profileColumns) {
      if (!(column in backup)) { backup[column] = profile[column] ?? null; changed = true; }
    }
    if (changed) fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  }
  const merged = { ...(profile.custom_answers || {}) };
  for (const [name, value] of Object.entries(seedFacts)) merged[`__fact:${name}`] = value;
  Object.assign(merged, rawAnswers);
  const { error: updateError } = await db.from('user_profiles').update({
    custom_answers: merged,
    education_graduation_date: 'May 2028',
    proud_project: 'I built a campus event planner with TypeScript, Next.js, PostgreSQL, and Docker. I designed role-based access, calendar search, email reminders, and automated database migrations, then deployed and tested the complete service.',
    career_goals: 'Build reliable backend and full-stack systems, improve developer tooling, and grow into an engineer who can own services from design through production operations.',
    writing_sample: 'I like engineering work where the result is concrete and useful. On my campus event planner, the interesting part was not only writing features. I had to decide how permissions, scheduling, reminders, and deployment fit together, then test the paths that could fail for real users.',
    current_title: 'Software Engineering Intern',
    current_company: 'Northstar Cloud',
    education_school: 'Eastern Mennonite University', education_degree: 'Bachelor of Science',
    education_major: 'Computer Science', education_gpa: '3.6',
    country: 'United States', state: 'California', city: 'San Francisco', zip_code: '94105',
    location: 'San Francisco, California, United States',
    work_authorization: 'us_citizen', require_sponsorship: false,
    is_adult: true,
    willing_to_relocate: true,
    default_source: 'Company Careers Website',
  }).eq('user_id', userId);
  if (updateError) throw updateError;
  console.log(`Seeded ${Object.keys(seedFacts).length} QA facts; previous answers backed up locally.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
