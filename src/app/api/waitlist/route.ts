import { NextRequest, NextResponse } from 'next/server';
import { addToWaitlist, getWaitlist, isValidEmail, isWaitlistAdmin, removeFromWaitlist } from '@/lib/waitlist';
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
    await addToWaitlist({
      email,
      name: typeof body.name === 'string' ? body.name : undefined,
      school: typeof body.school === 'string' ? body.school : undefined,
    });
  } catch {
    return NextResponse.json({ error: 'Could not save your spot. Please try again.' }, { status: 503 });
  }

  // Deliberately identical for a new and an existing signup, and carrying no
  // queue position or total. Differing responses would let anyone test whether
  // a given address is on a private beta list and read the signup count.
  return NextResponse.json({ ok: true });
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

/** Admin only: drop a signup, once it has been let in or turned down. */
export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isWaitlistAdmin(userId)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    await removeFromWaitlist(id);
  } catch {
    return NextResponse.json({ error: 'Unknown signup' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
