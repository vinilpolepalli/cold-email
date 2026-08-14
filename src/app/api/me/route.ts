import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, getUserProfile, saveUserProfile } from '@/lib/user';
import { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ profile: await getUserProfile(userId) });
}

const EDITABLE: (keyof UserProfile)[] = [
  'name', 'email', 'education', 'experience', 'projects', 'skills', 'publications', 'researchInterests', 'awards', 'aiSummary',
  // The four facts the opening line and the signature are built from.
  'standing', 'school', 'gradYear', 'degree',
];

export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const existing = await getUserProfile(userId);
  if (!existing) return NextResponse.json({ error: 'Onboard first' }, { status: 400 });

  const body = await req.json();
  const updated: UserProfile = { ...existing };
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    const value = body[key];
    // The row editors leave a blank entry behind when someone adds a line and
    // does not fill it. Left in, it becomes an empty bullet in a real email.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated as any)[key] = Array.isArray(value)
      ? value.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
      : value;
  }
  updated.updatedAt = new Date().toISOString();
  await saveUserProfile(updated);
  return NextResponse.json({ profile: updated });
}
