import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key')
);

// Serves the AI-refreshed dashboard greeting lines (site_content key
// 'greeting_lines'). The dashboard rotates through these by time bucket and
// falls back to its own baked-in set if this is empty.
export async function GET() {
  try {
    const { data } = await supabase
      .from('site_content')
      .select('value')
      .eq('key', 'greeting_lines')
      .maybeSingle();
    const lines = Array.isArray(data?.value) ? data!.value : [];
    return NextResponse.json(
      { lines },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch {
    return NextResponse.json({ lines: [] });
  }
}
