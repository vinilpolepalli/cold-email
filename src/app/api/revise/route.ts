import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { nimAvailable } from '@/lib/nim';
import { addRule, getRules } from '@/lib/preferences';
import { getPublications } from '@/lib/publications';
import { reviseEmail } from '@/lib/revise';
import { focusFromWorks } from '@/lib/template';
import { getCurrentUserId, getNimAuth, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_INSTRUCTION = 500;
const MAX_BODY = 20_000;

/**
 * Apply a typed instruction to the draft on the compose screen, and remember
 * the instruction for future drafts.
 *
 * The selection arrives as offsets rather than as text so the reply can be
 * spliced back into exactly the span the sender highlighted. Offsets from a
 * client are not trusted: they are checked against the body that came with
 * them, and the passage is cut server-side.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = await getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first: upload your resume.' }, { status: 400 });

  const nimAuth = await getNimAuth(userId);
  if (!nimAvailable(nimAuth)) {
    return NextResponse.json(
      { error: 'AI edits need an NVIDIA NIM key. Add one in Settings.', needsKey: true },
      { status: 400 }
    );
  }

  const payload = await req.json();

  const instruction = typeof payload.instruction === 'string' ? payload.instruction.trim().slice(0, MAX_INSTRUCTION) : '';
  if (!instruction) return NextResponse.json({ error: 'Say what to change' }, { status: 400 });

  const body = typeof payload.body === 'string' ? payload.body : '';
  if (!body.trim()) return NextResponse.json({ error: 'There is no draft to edit' }, { status: 400 });
  if (body.length > MAX_BODY) return NextResponse.json({ error: 'That draft is too long to edit' }, { status: 400 });

  const subject = typeof payload.subject === 'string' ? payload.subject.slice(0, 200) : '';

  const researcher = await getProfile(payload.researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  // A stale or malformed range would splice the reply into the wrong place, so
  // an unusable one falls back to editing the whole email rather than guessing.
  let selection: string | null = null;
  let range: { start: number; end: number } | null = null;
  const raw = payload.selection;
  if (raw && typeof raw.start === 'number' && typeof raw.end === 'number') {
    const start = Math.max(0, Math.min(Math.floor(raw.start), body.length));
    const end = Math.max(0, Math.min(Math.floor(raw.end), body.length));
    if (end > start) {
      range = { start, end };
      selection = body.slice(start, end);
    }
  }

  const rules = await getRules(userId);

  // The same paper the draft reacts to. Without it, "say more about his paper"
  // has nothing to work from but the sentence already in the email, and an
  // editor asked to expand on a paper it cannot see will invent the rest.
  const works = await getPublications(researcher).catch(() => null);
  const paper = works ? focusFromWorks(works, user) : null;

  let result;
  try {
    result = await reviseEmail({ instruction, body, subject, selection, researcher, user, paper, rules }, nimAuth);
  } catch (err) {
    // The instruction is not saved when the edit failed: a rule the sender
    // never saw applied is not something they agreed to keep.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not apply that: ${detail}` }, { status: 502 });
  }

  // Every instruction becomes a standing rule. The compose screen lists them
  // and can drop any that should not have stuck.
  const rule = await addRule(userId, instruction);

  return NextResponse.json({
    text: result.text,
    subject: result.subject,
    range,
    rule,
    rules: await getRules(userId),
  });
}
