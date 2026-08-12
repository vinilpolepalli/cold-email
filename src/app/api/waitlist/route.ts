import { NextRequest, NextResponse } from 'next/server';
import { addToWaitlist, getWaitlist, isValidEmail, isWaitlistAdmin } from '@/lib/waitlist';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Public: anyone can join the waitlist. */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; name?: unknown; school?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  try {
    const { alreadyOn, position } = await addToWaitlist({
      email,
      name: typeof body.name === 'string' ? body.name : undefined,
      school: typeof body.school === 'string' ? body.school : undefined,
    });
    return NextResponse.json({ ok: true, alreadyOn, position });
  } catch (err) {
    return NextResponse.json({ error: `Could not save your spot: ${String(err).slice(0, 150)}` }, { status: 500 });
  }
}

/** Admin only: read the signup list. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isWaitlistAdmin(userId)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  const entries = await getWaitlist();
  return NextResponse.json({ count: entries.length, entries });
}
