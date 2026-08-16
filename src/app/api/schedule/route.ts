import { NextRequest, NextResponse } from 'next/server';
import { discardDraft } from '@/lib/drafts';
import { getProfile } from '@/lib/profiles';
import { validateRecipients } from '@/lib/send';
import { cancelScheduled, dismissScheduled, getScheduled, runDueSends, scheduleEmail } from '@/lib/schedule';
import { getCurrentUserId, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Queue an email to go out later. */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = await getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first' }, { status: 400 });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { researcherId, subject, body, to, cc, attachResume, sendAt } = payload as {
    researcherId?: string;
    subject?: string;
    body?: string;
    to?: string;
    cc?: unknown;
    attachResume?: boolean;
    sendAt?: string;
  };

  const researcher = researcherId ? await getProfile(researcherId) : null;
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const recipient = (typeof to === 'string' ? to.trim() : '') || researcher.email || '';
  if (!recipient) {
    return NextResponse.json(
      { error: `${researcher.name} has no published email. Enter one manually.` },
      { status: 400 }
    );
  }
  // Same check as the send-now path, so a scheduled email cannot slip past
  // validation that an immediate one would have failed.
  const addresses = validateRecipients(recipient, cc);
  if ('error' in addresses) return NextResponse.json({ error: addresses.error }, { status: 400 });

  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }
  if (typeof sendAt !== 'string') {
    return NextResponse.json({ error: 'Pick when to send it' }, { status: 400 });
  }

  try {
    const entry = await scheduleEmail({
      userId,
      researcherId: researcher.id,
      researcherName: researcher.name,
      to: addresses.to,
      cc: addresses.cc,
      subject: subject.trim(),
      body,
      attachResume: attachResume !== false,
      sendAt,
    });
    // The queued copy is now the one that matters. Editing compose afterwards
    // does not change what goes out, so leaving the draft behind would only
    // offer an edit that has no effect.
    await discardDraft(userId, researcher.id);
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not schedule that' }, { status: 400 });
  }
}

/**
 * The caller's queue. Flushing anything already due here means scheduling
 * still works on a Vercel plan whose cron only fires once a day: opening the
 * app sends what was waiting.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  await runDueSends().catch(() => undefined);
  return NextResponse.json({ scheduled: await getScheduled(userId) });
}

/** Cancel one that has not gone out, or clear one that has finished. */
export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const done = url.searchParams.get('dismiss') === '1'
    ? await dismissScheduled(userId, id)
    : await cancelScheduled(userId, id);

  if (!done) {
    return NextResponse.json({ error: 'That email is not waiting to be sent any more' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
