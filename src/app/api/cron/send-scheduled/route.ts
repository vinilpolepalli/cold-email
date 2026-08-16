import { NextRequest, NextResponse } from 'next/server';
import { runDueSends } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

/**
 * Sends whatever has come due. Vercel Cron calls this on the schedule in
 * vercel.json, carrying `Authorization: Bearer $CRON_SECRET`.
 *
 * With CRON_SECRET unset the route refuses to run rather than defaulting to
 * open: it sends real email on behalf of real accounts, so an unauthenticated
 * caller could use it to flush every user's queue early. That is a different
 * shape of "optional service" from the rest of the app — the graceful
 * degradation here is that scheduling still works through the outbox flush,
 * which is behind sign-in.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not set, so this route is disabled' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const result = await runDueSends();
  return NextResponse.json({ ok: true, ...result });
}
