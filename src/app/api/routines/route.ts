import { NextResponse } from 'next/server';
import { ROUTINES, getLastRuns, getRuns } from '@/lib/routines';
import { getCurrentUserId } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** The routines, when each last ran, and the recent history. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const [lastRuns, runs] = await Promise.all([getLastRuns(userId), getRuns(userId, 20)]);
  return NextResponse.json({
    routines: ROUTINES.map((r) => ({
      name: r.name,
      description: r.description,
      sends: r.sends,
      lastRun: lastRuns[r.name] ?? null,
    })),
    runs,
    // Whether a scheduler can reach these without a browser session.
    scheduled: Boolean(process.env.ROUTINE_SECRET),
  });
}
