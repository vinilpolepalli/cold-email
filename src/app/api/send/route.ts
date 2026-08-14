import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { getOutbox, sendEmail } from '@/lib/send';
import { getResumeFile } from '@/lib/resume-file';
import { getCurrentUserId, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';

// A real address check, not just "contains @". The recipient reaches a mail
// header, so a permissive check is how CRLF and extra recipients get in.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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
  if (!EMAIL_RE.test(recipient) || recipient.length > 254) {
    return NextResponse.json({ error: 'That recipient address is not valid' }, { status: 400 });
  }
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }

  // Copied addresses reach a mail header exactly like the recipient does, so
  // they get the same validation. The cap is a blast-radius limit: a cold
  // email copying a dozen people is a mailing list, not an introduction.
  const copies = Array.isArray(cc) ? cc : [];
  const seen = new Set([recipient.toLowerCase()]);
  const validated: string[] = [];
  for (const raw of copies) {
    const address = typeof raw === 'string' ? raw.trim() : '';
    if (!address) continue;
    if (!EMAIL_RE.test(address) || address.length > 254) {
      return NextResponse.json({ error: `That CC address is not valid: ${address.slice(0, 80)}` }, { status: 400 });
    }
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    validated.push(address);
  }
  if (validated.length > 5) {
    return NextResponse.json({ error: 'Copy at most five people on one email' }, { status: 400 });
  }

  // Attach the uploaded resume unless the sender opted out.
  const stored = attachResume === false ? null : await getResumeFile(userId);

  const entry = await sendEmail({
    userId,
    researcherId,
    researcherName: researcher.name,
    to: recipient,
    cc: validated,
    fromName: user.name,
    replyTo: user.email && EMAIL_RE.test(user.email) ? user.email : undefined,
    subject: subject.trim(),
    body,
    attachment: stored
      ? { fileName: stored.fileName, contentType: stored.contentType, base64: stored.base64 }
      : null,
  });
  return NextResponse.json({ entry });
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ outbox: await getOutbox(userId) });
}
