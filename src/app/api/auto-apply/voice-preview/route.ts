import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Lightweight "does this sound like me?" preview for the auto-apply writing
// sample. ONE on-demand LLM call (no chatbot, no back-and-forth) so the user can
// eyeball whether their captured voice reads like them before it's used on real
// applications. Grounded in their own material; previews a question that needs no
// company so it works straight from the profile page.

// Mirror of humanizeProse() in the resolve route: strip the typographic tells a
// person typing an application wouldn't produce, so the preview matches what the
// real drafter would emit.
function humanizeProse(text: string): string {
  let t = String(text || '').trim();
  t = t.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/‑/g, '-').replace(/ /g, ' ');
  t = t.replace(/(\d)\s+%/g, '$1%');
  t = t.replace(/\s*[—–]\s*/g, ', ');
  t = t.replace(/,\s*,/g, ', ');
  t = t.replace(/\s+([.,;:!?])/g, '$1');
  t = t.replace(/,\s*([.!?])/g, '$1');
  t = t.replace(/^[,\s]+/, '');
  t = t.replace(/^(i am writing to (?:apply|express)[^.]*\.\s*)/i, '');
  return t.trim();
}

async function draftText(prompt: string): Promise<string | null> {
  const gk = process.env.GEMINI_API_KEY;
  if (gk) {
    const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${gk}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.72, topP: 0.95 } }),
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
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groq}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.72, top_p: 0.95, messages: [{ role: 'user', content: prompt }] }),
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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: 'No drafting model is configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('first_name,proud_project,career_goals,resume_text,writing_sample,preferred_tone,custom_answers')
    .eq('user_id', user.id)
    .maybeSingle();

  // Prefer the values in the request (the fields the user is actively editing,
  // possibly unsaved) so the preview reflects what they're tweaking right now.
  const savedNotes = (profile?.custom_answers as Record<string, string> | null)?.['__fact:voice_notes'];
  const sample = String(body?.writing_sample ?? profile?.writing_sample ?? '').trim().slice(0, 2500);
  const voiceNotes = String(body?.voice_notes ?? savedNotes ?? '').trim().slice(0, 500);
  if (!sample && !voiceNotes) {
    return NextResponse.json({ error: 'Add a writing sample or a note about your voice first, then preview.' }, { status: 400 });
  }
  const firstName = profile?.first_name || 'the candidate';
  // Draw on the STAR stories the user curated, so the preview reflects the same
  // grounding the live drafter uses (and shows the value of filling the story bank).
  const { data: stories } = await supabase.from('user_story_bank')
    .select('title,situation,task,action,result,technologies,strength_rating')
    .eq('user_id', user.id)
    .order('strength_rating', { ascending: false })
    .limit(3);
  const storyDeck = (stories || []).map((s) => {
    const star = [s.situation, s.task, s.action, s.result].map((p: unknown) => String(p || '').trim()).filter(Boolean).join(' ');
    return `- ${s.title}: ${star}`.slice(0, 600);
  }).join('\n');
  const material = [
    profile?.proud_project && `Proud of: ${profile.proud_project}`,
    profile?.career_goals && `Career goals: ${profile.career_goals}`,
    storyDeck && `Stories from their experience:\n${storyDeck}`,
    profile?.resume_text && `Resume:\n${String(profile.resume_text).slice(0, 2000)}`,
  ].filter(Boolean).join('\n') || '(limited background — stay honest and specific to what is given)';

  const voiceBlock = `${sample ? `THIS IS HOW ${firstName.toUpperCase()} ACTUALLY WRITES. Study the voice closely: sentence length and rhythm, word choice, how blunt or formal it is, its little habits. Write the answer so it reads like the SAME person wrote it on a focused day. Match the voice, not the facts of the sample.
"""
${sample}
"""
` : ''}${voiceNotes ? `HOW ${firstName.toUpperCase()} WANTS TO COME ACROSS (follow this, it overrides the sample where they differ): ${voiceNotes}
` : ''}`;

  const prompt = `You are ${firstName} answering one job-application question yourself, in the voice described below.

${voiceBlock}
RULES
- Truth only. Use ONLY the facts in YOUR BACKGROUND below. Invent no employer, title, date, number, tool, or achievement. If there isn't enough to answer truthfully, say so plainly in your own voice.
- Be specific: name at least one concrete real detail from your background.
- Sound like a real person, not an assistant or a polished essay. Understate rather than oversell. Plain is good.
- Vary rhythm honestly: a short sentence next to a longer one, but every short sentence must carry a fact or a turn, never just announce a feeling.
- Don't wrap it in a bow. Just stop when you're done.
- Plain prose, straight quotes, normal hyphen ("real-time"), "%" no space. About 90-140 words, one paragraph. No greeting or sign-off.
- Never use: the em dash "—", "not just X but Y", three-part lists for rhythm, or: leverage, passionate, delve, robust, seamless, spearheaded, streamline, "excited to contribute", "I am writing to apply".

YOUR BACKGROUND:
${material}

QUESTION: Tell us about a project you're proud of and what your role in it was.

Write ONLY the answer text, nothing else.`;

  const raw = await draftText(prompt);
  if (!raw) return NextResponse.json({ error: 'The model was unavailable. Try again in a moment.' }, { status: 502 });
  return NextResponse.json({ answer: humanizeProse(raw) });
}
