import { NextResponse } from 'next/server';
import { disconnectSender, getSenderIdentityView, googleOAuthConfigured } from '@/lib/sender-identity';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Which university mailbox, if any, this account sends from. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({
    identity: await getSenderIdentityView(userId),
    configured: googleOAuthConfigured(),
  });
}

export async function DELETE() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  await disconnectSender(userId);
  return NextResponse.json({ identity: null, configured: googleOAuthConfigured() });
}
