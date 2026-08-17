import { NextRequest, NextResponse } from 'next/server';
import {
  getPolicy,
  getTargets,
  savePolicy,
  summarize,
  updateTarget,
  nextSendSlot,
} from '@/lib/campaign';
import { getCurrentUserId } from '@/lib/user';
import { recordReviewedSend } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/** The queue, the counts, and the current send policy. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const [targets, summary, policy] = await Promise.all([
    getTargets(userId),
    summarize(userId),
    getPolicy(userId),
  ]);
  return NextResponse.json({ targets, summary, policy });
}

const MAX_SUBJECT = 500;
const MAX_BODY = 20_000;

/**
 * Act on one target, or change the policy.
 *
 * Approving is the moment a human takes responsibility for an email, so it is
 * also where an edited subject and body are accepted: the sender reads the
 * draft, fixes it, and approves the thing they actually read.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'policy') {
    const policy = await savePolicy(userId, body.policy ?? {});
    return NextResponse.json({ policy });
  }

  const researcherId = typeof body?.researcherId === 'string' ? body.researcherId : '';
  if (!researcherId) return NextResponse.json({ error: 'researcherId is required' }, { status: 400 });

  const target = (await getTargets(userId)).find((t) => t.researcherId === researcherId);
  if (!target) return NextResponse.json({ error: 'Not on the queue' }, { status: 404 });

  switch (action) {
    case 'approve': {
      if (!target.subject || !target.body) {
        return NextResponse.json({ error: 'This target has no draft yet' }, { status: 400 });
      }
      const policy = await getPolicy(userId);
      // Approving something whose slot has already passed should send it at the
      // next opening rather than immediately: a 6am approval must not produce a
      // 6am email.
      const scheduled = target.scheduledAt && Date.parse(target.scheduledAt) > Date.now()
        ? target.scheduledAt
        : nextSendSlot(new Date(), policy).toISOString();

      const updated = await updateTarget(userId, researcherId, {
        status: 'approved',
        subject: typeof body.subject === 'string' ? body.subject.slice(0, MAX_SUBJECT) : target.subject,
        body: typeof body.body === 'string' ? body.body.slice(0, MAX_BODY) : target.body,
        scheduledAt: scheduled,
        note: 'Approved by you',
      });
      // A human read this one, which is what the per-track gate counts.
      await recordReviewedSend(userId, target.trackId);
      return NextResponse.json({ target: updated });
    }

    case 'skip': {
      const updated = await updateTarget(userId, researcherId, {
        status: 'skipped',
        note: typeof body.note === 'string' ? body.note.slice(0, 300) : 'Skipped by you',
      });
      return NextResponse.json({ target: updated });
    }

    case 'unapprove': {
      const updated = await updateTarget(userId, researcherId, {
        status: 'drafted',
        autoApproved: false,
        note: 'Pulled back for review',
      });
      return NextResponse.json({ target: updated });
    }

    case 'reschedule': {
      const at = Date.parse(typeof body.scheduledAt === 'string' ? body.scheduledAt : '');
      if (!Number.isFinite(at)) return NextResponse.json({ error: 'A valid scheduledAt is required' }, { status: 400 });
      const updated = await updateTarget(userId, researcherId, { scheduledAt: new Date(at).toISOString() });
      return NextResponse.json({ target: updated });
    }

    case 'replied': {
      const updated = await updateTarget(userId, researcherId, { status: 'replied', note: 'They replied' });
      return NextResponse.json({ target: updated });
    }

    default:
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  }
}
