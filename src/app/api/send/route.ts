import { NextRequest, NextResponse } from 'next/server';
import { discardDraft } from '@/lib/drafts';
import { getProfile } from '@/lib/profiles';
import { getOutbox, isSendableAddress, sendEmail, validateRecipients } from '@/lib/send';
import { getResumeFile } from '@/lib/resume-file';
import { getCurrentUserId, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = await getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first' }, { status: 400 });

  const { researcherId, subject, body, to, cc, attachResume } = await req.json();
  const researcher = await getProfile(researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const requested = typeof to === 'string' ? to.trim() : '';
  const recipient = requested || researcher.email || '';
  if (!recipient) {
    return NextResponse.json(
      { error: `${researcher.name} has no published email. Check their website (${researcher.website ?? researcher.sourceUrl}) and enter one manually.` },
      { status: 400 }
    );
  }
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }

  // Copied addresses reach a mail header exactly like the recipient does, so
  // they get the same validation.
  const addresses = validateRecipients(recipient, cc);
  if ('error' in addresses) return NextResponse.json({ error: addresses.error }, { status: 400 });

  // Attach the uploaded resume unless the sender opted out.
  const stored = attachResume === false ? null : await getResumeFile(userId);

  const entry = await sendEmail({
    userId,
    researcherId,
    researcherName: researcher.name,
    to: addresses.to,
    cc: addresses.cc,
    fromName: user.name,
    replyTo: user.email && isSendableAddress(user.email) ? user.email : undefined,
    subject: subject.trim(),
    body,
    attachment: stored
      ? { fileName: stored.fileName, contentType: stored.contentType, base64: stored.base64 }
      : null,
  });
  // The email has left. Reopening compose for this researcher should start
  // fresh rather than on the copy that was already sent.
  await discardDraft(userId, researcherId);
  return NextResponse.json({ entry });
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ outbox: await getOutbox(userId) });
}
