import { NextRequest, NextResponse } from 'next/server';
import { discardDraft, getDraft, saveDraft } from '@/lib/drafts';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** The saved state of an in-progress email to one researcher. */
export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const researcherId = new URL(req.url).searchParams.get('researcherId');
  if (!researcherId) return NextResponse.json({ error: 'Which researcher?' }, { status: 400 });

  return NextResponse.json({ draft: await getDraft(userId, researcherId) });
}

export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json();
  const researcherId = typeof body.researcherId === 'string' ? body.researcherId : '';
  if (!researcherId) return NextResponse.json({ error: 'Which researcher?' }, { status: 400 });

  try {
    const draft = await saveDraft(userId, researcherId, {
      subject: typeof body.subject === 'string' ? body.subject : '',
      body: typeof body.body === 'string' ? body.body : '',
      to: typeof body.to === 'string' ? body.to : '',
      cc: Array.isArray(body.cc) ? body.cc : [],
      attachResume: body.attachResume !== false,
    });
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const researcherId = new URL(req.url).searchParams.get('researcherId');
  if (!researcherId) return NextResponse.json({ error: 'Which researcher?' }, { status: 400 });

  await discardDraft(userId, researcherId);
  return NextResponse.json({ ok: true });
}
