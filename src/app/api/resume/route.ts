import { NextResponse } from 'next/server';
import { deleteResumeFile, getResumeFileInfo } from '@/lib/resume-file';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Metadata for the stored resume, so onboarding can show what is on file. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ resume: await getResumeFileInfo(userId) });
}

/** Stop attaching a resume to outgoing email. The parsed profile is kept. */
export async function DELETE() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  await deleteResumeFile(userId);
  return NextResponse.json({ ok: true });
}
