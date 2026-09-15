import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Kick off the auto-apply pipeline NOW (match saved criteria -> queue -> prepare)
// instead of waiting for the scheduled run. Triggers the GitHub Actions workflow
// via workflow_dispatch, so preparation starts within ~a minute and runs in
// parallel. Requires a GH token with actions:write in GH_DISPATCH_TOKEN.
const REPO = process.env.GITHUB_REPO || 'AbrahamMekonnen/newgrad-radar';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    // No dispatch token configured — the scheduled pipeline will pick it up.
    return NextResponse.json({
      triggered: false,
      message: 'Saved. Your matches will be prepared on the next scheduled run.',
    });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/autoapply.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.status === 204) {
      return NextResponse.json({ triggered: true, message: 'Preparing your matches now — check back in a minute.' });
    }
    const body = await res.text();
    console.error('workflow dispatch failed:', res.status, body.slice(0, 200));
    return NextResponse.json({ triggered: false, message: 'Saved. It will run on the next scheduled pass.' });
  } catch (e) {
    console.error('workflow dispatch error:', e);
    return NextResponse.json({ triggered: false, message: 'Saved. It will run on the next scheduled pass.' });
  }
}
