import { NextRequest, NextResponse } from 'next/server';
import { RECOMMENDED_MODEL } from '@/lib/models';
import { nimChat } from '@/lib/nim';
import { getCurrentUserId, getUserSettings } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// "Is my key working" answers with one real completion, capped at five tokens.
//
// There is no cheaper authentication check to run first: NVIDIA's /models
// endpoint serves the public catalogue without reading the key, so it passes
// for a key that does not work. A rejected key comes back from the completion
// in about a second anyway. The wait that needed fixing is the other one, a
// free-tier model idling on a cold start, which now gives up at 20 seconds and
// says so rather than hanging until the platform kills the request.

const CHAT_TIMEOUT_MS = 20_000;

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
      { temperature: 0, maxTokens: 5, timeoutMs: CHAT_TIMEOUT_MS },
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
    // The provider's own message is the useful part: a 403 means a bad key, a
    // 404 means the model is not available to this account, and guessing
    // between them wastes the user's time.
    const message = String(err instanceof Error ? err.message : err);
    const reason = /timed out/i.test(message)
      ? 'slow-model'
      : /\(401\)|\(403\)|unauthor|forbidden/i.test(message)
        ? 'bad-key'
        : /\(404\)|not found|unknown model/i.test(message)
          ? 'bad-model'
          : 'failed';
    return NextResponse.json({
      ok: false,
      model: effectiveModel,
      latencyMs: Date.now() - startedAt,
      reason,
      error: message.slice(0, 300),
    });
  }
}
