import type { SupabaseClient } from '@supabase/supabase-js';

// Columns added in migration 061. If a project hasn't applied that migration yet,
// PostgREST rejects the whole upsert ("Could not find the 'work_experience'
// column ... in the schema cache", code PGRST204). Strip those columns and retry
// so profile saving never breaks in the gap before the migration lands — the
// structured history simply isn't persisted until the columns exist.
const MIGRATION_061_COLS = ['work_experience', 'education_history', 'projects', 'skills_list'];

export async function upsertUserProfile(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ error: unknown }> {
  const first = await supabase.from('user_profiles').upsert(row as never);
  const err = first.error;
  if (err) {
    const sig = `${err.message || ''} ${err.code || ''}`;
    const missingNewCol = MIGRATION_061_COLS.some((c) => sig.includes(c)) || /PGRST204|schema cache/i.test(sig);
    if (missingNewCol) {
      const stripped = { ...row };
      for (const c of MIGRATION_061_COLS) delete stripped[c];
      const retry = await supabase.from('user_profiles').upsert(stripped as never);
      return { error: retry.error };
    }
  }
  return { error: err };
}
