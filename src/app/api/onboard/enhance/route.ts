import { NextRequest, NextResponse } from 'next/server';
import { aiParseResume, summarize } from '@/lib/resume';
import { getCurrentUserId, getNimAuth } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// The slow half of onboarding, split out so the upload can answer immediately.
// This runs the LLM extraction over the same text and hands the result back
// for the client to merge into whatever the user has not already edited.
//
// It deliberately does not save. The user is editing their profile while this
// is in flight, and a write landing underneath them would silently undo their
// corrections.

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text : '';
  if (text.trim().length < 40) return NextResponse.json({ error: 'No resume text supplied' }, { status: 400 });

  const nimAuth = await getNimAuth(userId);
  const ai = await aiParseResume(text, nimAuth);
  if (!ai) {
    // No key, or the model misfired. The heuristic parse the client already
    // has stands on its own, so this is not an error.
    return NextResponse.json({ enhanced: false, reason: 'no-model' });
  }

  const { summary: aiSummary, ...fields } = ai;
  const summary = aiSummary || (await summarize(fields, nimAuth)).summary;
  return NextResponse.json({ enhanced: true, parsed: { ...fields, aiSummary: summary }, parser: 'nim' });
}
