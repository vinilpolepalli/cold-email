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
  'name', 'email', 'education', 'experience', 'projects', 'skills', 'publications', 'researchInterests', 'aiSummary',
];

export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const existing = await getUserProfile(userId);
  if (!existing) return NextResponse.json({ error: 'Onboard first' }, { status: 400 });

  const body = await req.json();
  const updated: UserProfile = { ...existing };
  for (const key of EDITABLE) {
    if (key in body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (updated as any)[key] = body[key];
    }
  }
  updated.updatedAt = new Date().toISOString();
  await saveUserProfile(updated);
  return NextResponse.json({ profile: updated });
}
