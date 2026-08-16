import { ScheduledEmail } from './types';
import { deleteStore, listStore, newId, readStore, writeStore } from './store';
import { sendEmail } from './send';
import { getResumeFile } from './resume-file';
import { getUserProfile } from './user';
import { isSendableAddress } from './send';

// Emails queued to go out later.
//
// There is no long-running process here to hold a timer: the app is a set of
// serverless functions, so "send at 9am" means "something asks, at some point
// after 9am, whether anything is due". Two things ask — the cron route, and a
// cheap check when a signed-in user loads their outbox — and both funnel into
// runDueSends.

const MIN_LEAD_MS = 60_000; // a minute out, so "schedule" never races the click
const MAX_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
/** How long a claim may sit before the row is treated as abandoned. */
const CLAIM_TTL_MS = 10 * 60 * 1000;
/** Cap per run so one invocation cannot hit the function time limit. */
const MAX_PER_RUN = 25;

export interface ScheduleInput {
  userId: string;
  researcherId: string;
  researcherName: string;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  attachResume: boolean;
  sendAt: string;
}

/** Reject a time that is unparseable, in the past, or absurdly far out. */
export function checkSendAt(sendAt: string, now = Date.now()): { at: Date } | { error: string } {
  const at = new Date(sendAt);
  if (Number.isNaN(at.getTime())) return { error: 'That is not a valid date and time' };
  if (at.getTime() - now < MIN_LEAD_MS) return { error: 'Pick a time at least a minute from now' };
  if (at.getTime() - now > MAX_HORIZON_MS) return { error: 'Pick a time within the next 90 days' };
  return { at };
}

export async function scheduleEmail(input: ScheduleInput): Promise<ScheduledEmail> {
  const when = checkSendAt(input.sendAt);
  if ('error' in when) throw new Error(when.error);
  if (!isSendableAddress(input.to)) throw new Error('That recipient address is not valid');

  const entry: ScheduledEmail = {
    id: newId('sch'),
    userId: input.userId,
    researcherId: input.researcherId,
    researcherName: input.researcherName,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    body: input.body,
    attachResume: input.attachResume,
    sendAt: when.at.toISOString(),
    createdAt: new Date().toISOString(),
    status: 'scheduled',
    claim: null,
    claimedAt: null,
    outboxId: null,
    detail: null,
  };
  await writeStore(`scheduled:${entry.id}`, entry);
  return entry;
}

/** Soonest first: the one about to go out is the one worth seeing. */
export async function getScheduled(userId: string): Promise<ScheduledEmail[]> {
  const all = await listStore<ScheduledEmail>('scheduled');
  return all.filter((e) => e.userId === userId).sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

/** Ids come from newId, so the shape is known and cannot walk the keyspace. */
function validId(id: string): boolean {
  return /^sch_[A-Za-z0-9]{1,40}$/.test(id);
}

/**
 * Drop a queued email. Scoped to its owner, so knowing an id is not enough to
 * cancel somebody else's send.
 */
export async function cancelScheduled(userId: string, id: string): Promise<boolean> {
  if (!validId(id)) return false;
  const row = await readStore<ScheduledEmail | null>(`scheduled:${id}`, null);
  if (!row || row.userId !== userId) return false;
  // Already gone out, or mid-flight: cancelling would be a lie either way.
  if (row.status !== 'scheduled') return false;
  await writeStore(`scheduled:${id}`, { ...row, status: 'canceled', detail: 'Canceled before it sent' });
  return true;
}

/** Remove a finished row entirely, once the user has seen the outcome. */
export async function dismissScheduled(userId: string, id: string): Promise<boolean> {
  if (!validId(id)) return false;
  const row = await readStore<ScheduledEmail | null>(`scheduled:${id}`, null);
  if (!row || row.userId !== userId) return false;
  if (row.status === 'scheduled' || row.status === 'sending') return false;
  await deleteStore(`scheduled:${id}`);
  return true;
}

/**
 * Take a row for this run, or report that somebody else has it.
 *
 * The store is last-write-wins with no compare-and-set, so this is an
 * optimistic claim: write our token, read it back, and continue only if ours
 * survived. Two runs racing will both write, but only one will read its own
 * token back, so only one sends.
 */
async function claim(row: ScheduledEmail): Promise<boolean> {
  const token = newId('clm');
  await writeStore(`scheduled:${row.id}`, {
    ...row,
    status: 'sending',
    claim: token,
    claimedAt: new Date().toISOString(),
  });
  const after = await readStore<ScheduledEmail | null>(`scheduled:${row.id}`, null);
  return after?.claim === token;
}

/**
 * Send everything that has come due.
 *
 * Safe to call concurrently and safe to call often: rows are claimed before
 * sending, and a row that is not `scheduled` is left alone.
 */
export async function runDueSends(now = Date.now()): Promise<{ sent: number; failed: number; stale: number }> {
  const all = await listStore<ScheduledEmail>('scheduled');
  let sent = 0;
  let failed = 0;
  let stale = 0;

  // A row claimed by a run that then died would otherwise sit in `sending`
  // forever. It is marked failed rather than retried: the previous run may
  // have got as far as handing the message to Gmail, and sending a cold email
  // twice is worse than not sending it.
  for (const row of all) {
    if (row.status !== 'sending') continue;
    const claimedAt = row.claimedAt ? new Date(row.claimedAt).getTime() : 0;
    if (now - claimedAt < CLAIM_TTL_MS) continue;
    await writeStore(`scheduled:${row.id}`, {
      ...row,
      status: 'failed',
      detail: 'Interrupted while sending. It may or may not have gone out, so it was not retried automatically.',
    });
    stale++;
  }

  const due = all
    .filter((e) => e.status === 'scheduled' && new Date(e.sendAt).getTime() <= now)
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
    .slice(0, MAX_PER_RUN);

  for (const row of due) {
    if (!(await claim(row))) continue;

    try {
      const user = await getUserProfile(row.userId);
      if (!user) throw new Error('The sender has no profile any more');
      const stored = row.attachResume ? await getResumeFile(row.userId) : null;

      const outbox = await sendEmail({
        userId: row.userId,
        researcherId: row.researcherId,
        researcherName: row.researcherName,
        to: row.to,
        cc: row.cc,
        fromName: user.name,
        replyTo: user.email && isSendableAddress(user.email) ? user.email : undefined,
        subject: row.subject,
        body: row.body,
        attachment: stored
          ? { fileName: stored.fileName, contentType: stored.contentType, base64: stored.base64 }
          : null,
      });

      await writeStore(`scheduled:${row.id}`, {
        ...row,
        status: outbox.status === 'failed' ? 'failed' : 'sent',
        claim: null,
        outboxId: outbox.id,
        detail: outbox.detail,
      });
      if (outbox.status === 'failed') failed++;
      else sent++;
    } catch (err) {
      await writeStore(`scheduled:${row.id}`, {
        ...row,
        status: 'failed',
        claim: null,
        detail: String(err).slice(0, 300),
      });
      failed++;
    }
  }

  return { sent, failed, stale };
}
