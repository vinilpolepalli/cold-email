import { NextRequest, NextResponse } from 'next/server';
import { getRoutine, routineNames, runRoutine } from '@/lib/routines';
import { clerkConfigured, getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Crawling and drafting several professors takes real time, so this asks for
 * the longest window the platform allows. 300s is the Vercel ceiling outside
 * the higher plans; asking for more fails the deployment outright rather than
 * being clamped, so this stays where every plan accepts it.
 *
 * A run that needs longer is not a problem: the routines stop cleanly at
 * WORK_BUDGET_MS below and resume on the next run.
 */
export const maxDuration = 300;

/**
 * How long a run may work before it starts wrapping up, leaving enough of the
 * window to finish the item in hand and write its report. Being killed by the
 * platform loses the report, which is the part a person reads.
 */
const WORK_BUDGET_MS = (maxDuration - 25) * 1000;

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

  // Demo mode has no real sign-in: getCurrentUserId returns the single local
  // user to anyone who asks. That is fine for reading and for the crawls, and
  // not fine for a route that can send email, so a routine that sends needs
  // the shared secret when there is no account system to authenticate against.
  const routine = getRoutine(name);
  if (routine?.sends && !auth.viaSecret && !clerkConfigured()) {
    return NextResponse.json(
      {
        error:
          'Sending routines need ROUTINE_SECRET when authentication is not configured. Run it through `npm run campaign`, or set up Clerk.',
      },
      { status: 401 }
    );
  }

  const limit = Number(body?.limit);
  const report = await runRoutine(name, {
    userId: auth.userId,
    now: new Date(),
    // A scheduled run is a dry run only if it says so. The default has to be
    // "really do it", or the nightly job silently does nothing forever.
    dryRun: body?.dryRun === true,
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : undefined,
    // Naming schools is how one batch is aimed at one university rather than
    // at whatever the global ranking happens to surface.
    schools: Array.isArray(body?.schools)
      ? (body.schools as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 10)
      : undefined,
    departmentPattern:
      typeof body?.departmentPattern === 'string' ? body.departmentPattern.slice(0, 200) : undefined,
    deadline: Date.now() + WORK_BUDGET_MS,
  });

  return NextResponse.json({ report }, { status: report.ok ? 200 : 500 });
}

type Authorized = { userId: string; viaSecret: boolean } | { error: string; status: number };

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
    return { userId, viaSecret: true };
  }

  // A presented-but-wrong secret is a failed attempt, not an invitation to try
  // the session instead.
  if (presented) return { error: 'Invalid routine secret', status: 401 };

  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Sign in required', status: 401 };
  // A signed-in caller only ever runs their own routines, whatever the body says.
  return { userId, viaSecret: false };
}

/** Constant-time compare, so a wrong secret cannot be found a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
