import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, getUserSettings, saveUserSettings } from '@/lib/user';

export const dynamic = 'force-dynamic';

function mask(key: string | null): string | null {
  if (!key) return null;
  return `••••••••${key.slice(-4)}`;
}

async function settingsView(userId: string) {
  const s = await getUserSettings(userId);
  return {
    nimKeyMasked: mask(s.nimApiKey),
    nimModel: s.nimModel,
    // Which key drafts will actually use: the user's own, the server-wide
    // env key, or none (deterministic template engine).
    nimSource: s.nimApiKey ? 'user' : process.env.NVIDIA_API_KEY ? 'server' : 'none',
  };
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({ settings: await settingsView(userId) });
}

export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json();
  const existing = await getUserSettings(userId);

  if ('nimApiKey' in body) {
    const key = typeof body.nimApiKey === 'string' ? body.nimApiKey.trim() : '';
    existing.nimApiKey = key.length > 0 ? key : null;
  }
  if ('nimModel' in body) {
    const model = typeof body.nimModel === 'string' ? body.nimModel.trim() : '';
    existing.nimModel = model.length > 0 ? model : null;
  }

  await saveUserSettings(userId, existing);
  return NextResponse.json({ settings: await settingsView(userId) });
}
