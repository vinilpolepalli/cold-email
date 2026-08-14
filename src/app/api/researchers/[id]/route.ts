import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { getPublications } from '@/lib/publications';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A researcher plus their published work, for the profile page. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { id } = await params;
  const researcher = await getProfile(id);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  return NextResponse.json({ researcher, works: await getPublications(researcher, { refresh }) });
}
