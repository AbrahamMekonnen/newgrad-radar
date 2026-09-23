import type { SupabaseClient } from '@supabase/supabase-js';

// A long, hard-to-guess ntfy topic. Topics are effectively public (anyone who
// knows the string can subscribe), so we generate a random one instead of
// letting users pick something weak.
export function generateNtfyTopic(): string {
  const rand =
    (globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
      .replace(/-/g, '');
  return `hireradar-${rand.slice(0, 24)}`;
}

/**
 * Make sure a user can actually RECEIVE push notifications before we start
 * queueing them (e.g. when they track a company or turn on its notifications).
 *
 * The scrape's watchlist notifier only sends when the user has
 * `push_enabled = true` AND an `ntfy_topic`; without this, tracking a company
 * recorded intent but delivered nothing. We provision both here.
 *
 * For a brand-new preferences row we scope to 'my_list' (their tracked
 * companies only) rather than the DB default 'all', so provisioning doesn't
 * silently subscribe them to every job. An existing row's scope is preserved.
 *
 * NOTE: ntfy still requires the user to subscribe to their topic in the ntfy
 * app to receive push on their phone — callers should prompt them to finish
 * that in Settings. `newlyProvisioned` is true when we just turned it on, so
 * the caller knows to show that prompt.
 */
export async function ensureNtfyProvisioned(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ topic: string | null; newlyProvisioned: boolean }> {
  const { data } = await supabase
    .from('user_preferences')
    .select('ntfy_topic, push_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (data?.ntfy_topic && data?.push_enabled) {
    return { topic: data.ntfy_topic, newlyProvisioned: false };
  }

  const topic = data?.ntfy_topic || generateNtfyTopic();
  const payload: Record<string, unknown> = {
    user_id: userId,
    ntfy_topic: topic,
    push_enabled: true,
    updated_at: new Date().toISOString(),
  };
  // Only set the scope when creating the row, so we never overwrite a choice
  // the user already made in Settings.
  if (!data) payload.notify_scope = 'my_list';

  const { error } = await supabase
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) {
    console.error('ensureNtfyProvisioned failed:', error);
    return { topic: null, newlyProvisioned: false };
  }
  return { topic, newlyProvisioned: true };
}
