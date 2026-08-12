import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { generateDraft } from '@/lib/template';
import { getCurrentUserId, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first: upload your resume.' }, { status: 400 });

  const { researcherId } = await req.json();
  const researcher = getProfile(researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  const draft = await generateDraft(researcher, user);
  return NextResponse.json({ draft, researcher });
}
