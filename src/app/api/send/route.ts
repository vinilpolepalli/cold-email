import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { getOutbox, sendEmail } from '@/lib/send';
import { getCurrentUserId, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first' }, { status: 400 });

  const { researcherId, subject, body, to } = await req.json();
  const researcher = getProfile(researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const recipient = (typeof to === 'string' && to.includes('@') ? to : null) ?? researcher.email;
  if (!recipient) {
    return NextResponse.json(
      { error: `${researcher.name} has no published email. Check their website (${researcher.website ?? researcher.sourceUrl}) and enter one manually.` },
      { status: 400 }
    );
  }
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }

  const entry = await sendEmail({
    userId,
    researcherId,
    researcherName: researcher.name,
    to: recipient,
    fromName: user.name,
    replyTo: user.email || undefined,
    subject: subject.trim(),
    body,
  });
  return NextResponse.json({ entry });
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ outbox: getOutbox(userId) });
}
