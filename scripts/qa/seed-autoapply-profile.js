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
  available_start_date: 'Two weeks after accepting an offer',
  education_start_date: 'September 2022',
  internship_count: '2',
  prior_interviews: 'None unless recorded in a saved company-specific answer',
  offer_deadline: 'None',
  sat_score: 'Not taken',
  act_score: 'Not taken',
  gre_score: 'Not taken',
  security_clearance: 'None',
  government_access_card: 'No',
  export_control_status: 'Authorized to work in the United States without employer sponsorship',
  internship_availability: 'Available for the full dates listed in the job posting',
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
    const { error } = await db.from('user_profiles').update({ custom_answers: backup.custom_answers }).eq('user_id', userId);
    if (error) throw error;
    console.log(`Restored ${Object.keys(backup.custom_answers || {}).length} saved profile answers.`);
    return;
  }
  const { data: profile, error } = await db.from('user_profiles').select('custom_answers').eq('user_id', userId).single();
  if (error) throw error;
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  // A second seed must never replace the original pre-campaign snapshot.
  if (!fs.existsSync(backupFile)) {
    fs.writeFileSync(backupFile, JSON.stringify({ user_id: userId, custom_answers: profile.custom_answers || {}, backed_up_at: new Date().toISOString() }, null, 2));
  }
  const merged = { ...(profile.custom_answers || {}) };
  for (const [name, value] of Object.entries(seedFacts)) merged[`__fact:${name}`] = value;
  const { error: updateError } = await db.from('user_profiles').update({ custom_answers: merged }).eq('user_id', userId);
  if (updateError) throw updateError;
  console.log(`Seeded ${Object.keys(seedFacts).length} QA facts; previous answers backed up locally.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
