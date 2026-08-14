import { NextRequest, NextResponse } from 'next/server';
import { RECOMMENDED_MODEL } from '@/lib/models';
import { nimChat } from '@/lib/nim';
import { getCurrentUserId, getUserSettings } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A real round trip to the model, so "is my key working" has an answer that is
// not "send an email and find out". Tests the key in the form field when one
// is supplied, so it can be checked before saving.

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const settings = await getUserSettings(userId);
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : settings.nimApiKey;
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : settings.nimModel;

  const effectiveModel = model || process.env.NIM_MODEL || RECOMMENDED_MODEL;
  const usingServerKey = !apiKey && Boolean(process.env.NVIDIA_API_KEY);
  if (!apiKey && !usingServerKey) {
    return NextResponse.json({ ok: false, reason: 'no-key', error: 'No NIM key saved or entered.' });
  }

  const startedAt = Date.now();
  try {
    const reply = await nimChat(
      [
        { role: 'system', content: 'Reply with the single word OK.' },
        { role: 'user', content: 'ping' },
      ],
      { temperature: 0, maxTokens: 5 },
      { apiKey, model }
    );
    return NextResponse.json({
      ok: true,
      model: effectiveModel,
      usingServerKey,
      latencyMs: Date.now() - startedAt,
      reply: reply.trim().slice(0, 40),
    });
  } catch (err) {
    // The provider's own message is the useful part: a 401 means a bad key, a
    // 404 means the model is not available to this account, and guessing
    // between them wastes the user's time.
    const message = String(err instanceof Error ? err.message : err);
    return NextResponse.json({
      ok: false,
      model: effectiveModel,
      latencyMs: Date.now() - startedAt,
      reason: /401|403|unauthor/i.test(message) ? 'bad-key' : /404|not found|model/i.test(message) ? 'bad-model' : 'failed',
      error: message.slice(0, 300),
    });
  }
}
