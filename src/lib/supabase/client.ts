import { createBrowserClient } from '@supabase/ssr';

// Fall back to placeholders so static prerendering during the build doesn't
// crash when env isn't inlined. At runtime the real NEXT_PUBLIC_ values are
// present (they're inlined into the client bundle at build time when set).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
  );
}
