import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { getLabContacts } from '@/lib/contacts';
import { getCurrentUserId, getNimAuth } from '@/lib/user';

export const dynamic = 'force-dynamic';
// Reads a handful of external pages, so it gets a longer window than a draft.
export const maxDuration = 60;

/** People worth copying on an email to this researcher. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { id } = await params;
  const researcher = await getProfile(id);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  const lookup = await getLabContacts(researcher, { refresh, nimAuth: await getNimAuth(userId) });
  return NextResponse.json({ lookup });
}
