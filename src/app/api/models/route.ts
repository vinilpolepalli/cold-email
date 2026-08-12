import { NextResponse } from 'next/server';
import { RECOMMENDED_MODEL, listModels } from '@/lib/models';
import { getCurrentUserId, getUserSettings } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const settings = await getUserSettings(userId);
  const models = await listModels(settings.nimApiKey);
  return NextResponse.json({ models, recommended: RECOMMENDED_MODEL, selected: settings.nimModel });
}
