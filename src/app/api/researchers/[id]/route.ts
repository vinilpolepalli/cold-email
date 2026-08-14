import { NextRequest, NextResponse } from 'next/server';
import { getProfile, withoutEmails } from '@/lib/profiles';
import { getPublications } from '@/lib/publications';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A researcher plus their published work, for the profile page. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await getProfile(id);
  if (!found) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  // Public to read, minus the address. See withoutEmails.
  const userId = await getCurrentUserId();
  const researcher = userId ? found : withoutEmails([found])[0];

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  return NextResponse.json({
    researcher,
    works: await getPublications(found, { refresh }),
    emailsVisible: Boolean(userId),
  });
}
