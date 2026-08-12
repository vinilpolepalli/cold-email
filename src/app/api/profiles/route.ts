import { NextRequest, NextResponse } from 'next/server';
import { getAllProfiles, searchProfiles } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? undefined;
  const school = searchParams.get('school') ?? undefined;
  const area = searchParams.get('area') ?? undefined;
  const profiles = q || school || area ? searchProfiles({ q, school, area }) : getAllProfiles();
  return NextResponse.json({ count: profiles.length, profiles });
}
