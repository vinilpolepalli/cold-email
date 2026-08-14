import { NextRequest, NextResponse } from 'next/server';
import { getAllProfiles, searchProfiles, withoutEmails } from '@/lib/profiles';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Anyone can browse the directory. Contact details are the part that stays
  // behind sign-in: they are published for people who need them, not for
  // whoever points a script at this endpoint.
  const userId = await getCurrentUserId();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? undefined;
  const school = searchParams.get('school') ?? undefined;
  const area = searchParams.get('area') ?? undefined;
  const found = q || school || area ? await searchProfiles({ q, school, area }) : await getAllProfiles();
  const profiles = userId ? found : withoutEmails(found);

  return NextResponse.json({ count: profiles.length, profiles, emailsVisible: Boolean(userId) });
}
