import { NextRequest, NextResponse } from 'next/server';
import { googleOAuthConfigured, startConsent } from '@/lib/sender-identity';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Begin connecting the sender's university mailbox. Answers with the consent
 * URL rather than redirecting, so the settings page can open it in a popup and
 * stay where it is.
 */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then try again.',
      },
      { status: 400 }
    );
  }

  // Pre-fills the account chooser so the school address is the obvious pick.
  const hint = req.nextUrl.searchParams.get('hint')?.trim().slice(0, 200) || undefined;
  const { url } = await startConsent(userId, req.nextUrl.origin, hint);
  return NextResponse.json({ url });
}
