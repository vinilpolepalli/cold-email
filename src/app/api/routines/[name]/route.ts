import { NextRequest, NextResponse } from 'next/server';
import { getRoutine, routineNames, runRoutine } from '@/lib/routines';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';
// Crawling and drafting several professors takes real time. The routines are
// individually bounded, but a chain of them needs the longest window a
// serverless function will give.
export const maxDuration = 800;

/**
 * Run one routine.
 *
 * Two callers, authenticated differently:
 *
 *  - the campaign page, as the signed-in user;
 *  - a scheduler with no session at all (Vercel Cron, a Claude Code Routine,
 *    a crontab running scripts/routine.mjs), carrying ROUTINE_SECRET.
 *
 * The secret path is the one that can name a user id, which is why it needs a
 * secret: without it, an unauthenticated caller could run a sending routine
 * against somebody else's queue.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return execute(req, name, await req.json().catch(() => ({})));
}

/**
 * The same thing over GET, because Vercel Cron only issues GET requests. A
 * cron entry pointing at a POST-only handler fails silently forever, which is
 * the worst possible way for scheduled sending to be broken.
 *
 * Options come from the query string here rather than a body.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const search = req.nextUrl.searchParams;
  return execute(req, name, {
    dryRun: search.get('dryRun') === '1' || search.get('dryRun') === 'true',
    limit: search.has('limit') ? Number(search.get('limit')) : undefined,
    userId: search.get('userId') ?? undefined,
  });
}

async function execute(req: NextRequest, name: string, body: Record<string, unknown>) {
  if (!getRoutine(name)) {
    return NextResponse.json(
      { error: `Unknown routine "${name}". Available: ${routineNames().join(', ')}` },
      { status: 404 }
    );
  }

  const auth = await authorize(req, body);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = Number(body?.limit);
  const report = await runRoutine(name, {
    userId: auth.userId,
    now: new Date(),
    // A scheduled run is a dry run only if it says so. The default has to be
    // "really do it", or the nightly job silently does nothing forever.
    dryRun: body?.dryRun === true,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : undefined,
  });

  return NextResponse.json({ report }, { status: report.ok ? 200 : 500 });
}

type Authorized = { userId: string } | { error: string; status: number };

async function authorize(req: NextRequest, body: { userId?: unknown }): Promise<Authorized> {
  // CRON_SECRET is what Vercel Cron sends automatically; ROUTINE_SECRET is for
  // everything else driving this (a crontab, a Claude Code Routine). Either
  // works, so a Vercel deployment needs no extra wiring.
  const secret = process.env.ROUTINE_SECRET || process.env.CRON_SECRET;
  const presented =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    req.headers.get('x-routine-secret')?.trim() ||
    '';

  if (secret && presented && timingSafeEqual(presented, secret)) {
    // Whose queue to run. Explicit in the request, otherwise the configured
    // default, which is what a single-user deployment will use.
    const requested = typeof body?.userId === 'string' ? body.userId.trim() : '';
    const userId = requested || process.env.ROUTINE_USER_ID || '';
    if (!userId) {
      return {
        error: 'Authenticated, but no user to run as. Set ROUTINE_USER_ID or pass userId in the body.',
        status: 400,
      };
    }
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) return { error: 'Unsupported user id', status: 400 };
    return { userId };
  }

  // A presented-but-wrong secret is a failed attempt, not an invitation to try
  // the session instead.
  if (presented) return { error: 'Invalid routine secret', status: 401 };

  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Sign in required', status: 401 };
  // A signed-in caller only ever runs their own routines, whatever the body says.
  return { userId };
}

/** Constant-time compare, so a wrong secret cannot be found a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
