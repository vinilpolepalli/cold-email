import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profiles';
import { getPublications, pickRelevantPublication } from '@/lib/publications';
import { generateDraft } from '@/lib/template';
import { getResumeFileInfo } from '@/lib/resume-file';
import { getCurrentUserId, getNimAuth, getUserProfile } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const user = await getUserProfile(userId);
  if (!user) return NextResponse.json({ error: 'Complete onboarding first: upload your resume.' }, { status: 400 });

  const { researcherId } = await req.json();
  const researcher = await getProfile(researcherId);
  if (!researcher) return NextResponse.json({ error: 'Unknown researcher' }, { status: 404 });

  // The draft names one of their papers, so their publication record is
  // fetched (from cache, usually) before writing anything.
  const works = await getPublications(researcher);
  const draft = await generateDraft(researcher, user, await getNimAuth(userId), works);
  const cited = pickRelevantPublication(works, [...user.researchInterests, ...user.skills, user.aiSummary]);

  return NextResponse.json({
    draft,
    researcher,
    resume: await getResumeFileInfo(userId),
    works,
    // Surfaced so the compose screen can show which paper the draft leans on
    // and link straight to it.
    citedPublication: cited,
  });
}
