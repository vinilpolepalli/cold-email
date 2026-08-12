import { NextRequest, NextResponse } from 'next/server';
import { getAllProfiles, searchProfiles } from '@/lib/profiles';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // The directory is private: researcher contact details are for signed-in
  // users only, never the public waitlist page.
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? undefined;
  const school = searchParams.get('school') ?? undefined;
  const area = searchParams.get('area') ?? undefined;
  const profiles = q || school || area ? await searchProfiles({ q, school, area }) : await getAllProfiles();
  return NextResponse.json({ count: profiles.length, profiles });
}
