import { NextRequest, NextResponse } from 'next/server';
import { MAX_TEMPLATE_LENGTH, deleteTemplate, listTemplates, parseTrackParam, saveTemplate } from '@/lib/user-template';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Every template the sender has: one default, plus any per-track overrides. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ templates: await listTemplates(userId), maxLength: MAX_TEMPLATE_LENGTH });
}

/**
 * Save a template. `trackId` omitted or "default" saves the fallback used by
 * any track without one of its own.
 */
export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let trackId;
  try {
    trackId = parseTrackParam(body?.trackId);
  } catch {
    return NextResponse.json({ error: 'Unknown track' }, { status: 400 });
  }

  const text = typeof body?.text === 'string' ? body.text : '';
  const mode = body?.mode === 'skeleton' ? 'skeleton' : 'reference';
  const saved = await saveTemplate(userId, trackId, text, mode);
  return NextResponse.json({ template: saved, templates: await listTemplates(userId) });
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  let trackId;
  try {
    trackId = parseTrackParam(req.nextUrl.searchParams.get('trackId'));
  } catch {
    return NextResponse.json({ error: 'Unknown track' }, { status: 400 });
  }
  await deleteTemplate(userId, trackId);
  return NextResponse.json({ templates: await listTemplates(userId) });
}
