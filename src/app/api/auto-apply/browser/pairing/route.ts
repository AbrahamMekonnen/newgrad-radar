import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  );
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const code = randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data, error } = await admin().from('autoapply_browser_devices').insert({
    user_id: user.id,
    name: 'Browser helper',
    pairing_code_hash: hash(code),
    pairing_expires_at: expiresAt,
  }).select('id').single();
  if (error || !data) return NextResponse.json({ error: 'Could not create pairing code' }, { status: 500 });
  return NextResponse.json({ code, expiresAt });
}
