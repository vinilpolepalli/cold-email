import { OutboxEntry, UserProfile } from './types';
import { getOutbox } from './send';
import { threadHasReply } from './sender-identity';
import { SendPolicy } from './campaign';
import { institutionOf, standingOf } from './template';

// Nudging somebody who has not replied.
//
// The whole feature turns on one question, asked before every nudge: did they
// already answer? Sending "just following up" to a professor who replied four
// days ago is worse than never following up at all, so a nudge goes out only
// when the inbox has been checked and holds nothing new, or when the sender
// has explicitly accepted the risk of nudging blind.
//
// Two nudges is the default ceiling. A third email from a stranger who has
// been ignored twice is not persistence.

export interface FollowUpCandidate {
  /** The original email this would be a nudge for. */
  original: OutboxEntry;
  /** Which nudge this is: 1 for the first, 2 for the second. */
  number: number;
  /** Days since the original went out. */
  ageDays: number;
}

export type FollowUpDecision =
  | { action: 'send'; candidate: FollowUpCandidate }
  | { action: 'replied'; candidate: FollowUpCandidate }
  | { action: 'skip'; candidate: FollowUpCandidate; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Group the outbox into threads, keyed by the id of the original email. A
 * thread is one professor: the first email plus any nudges already sent on it.
 */
function threads(entries: OutboxEntry[]): Map<string, OutboxEntry[]> {
  const byThread = new Map<string, OutboxEntry[]>();
  for (const entry of entries) {
    if (entry.status !== 'sent') continue;
    // followUpOf points at the original; an original points at itself.
    const root = entry.followUpOf ?? entry.id;
    const list = byThread.get(root) ?? [];
    list.push(entry);
    byThread.set(root, list);
  }
  return byThread;
}

/**
 * Which threads have gone quiet long enough to deserve a nudge, according to
 * the schedule in the policy. This is the cheap pass: it does no network work
 * and makes no claim about whether anybody replied.
 */
export function findCandidates(
  entries: OutboxEntry[],
  policy: SendPolicy,
  now: Date = new Date()
): FollowUpCandidate[] {
  if (!policy.followUpsEnabled || !policy.followUpDays.length) return [];

  const candidates: FollowUpCandidate[] = [];
  for (const [rootId, chain] of threads(entries)) {
    const original = chain.find((e) => e.id === rootId) ?? chain[0];
    if (!original) continue;

    // Whether the professor answered is not recorded here: the outbox records
    // what we sent, and the answer lives on the campaign target. decide()
    // below is what actually checks, against the live thread.
    const sentSoFar = chain.length - 1; // nudges already on this thread
    if (sentSoFar >= policy.followUpDays.length) continue;

    // Age is measured from the most recent message we sent, not from the
    // original: two nudges five days apart is the schedule, not two nudges on
    // the same afternoon because the original was old.
    const latest = chain.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const ageDays = (now.getTime() - Date.parse(latest.createdAt)) / DAY_MS;
    if (!Number.isFinite(ageDays)) continue;

    // The gap that has to have elapsed before this particular nudge.
    const dueAfter =
      sentSoFar === 0
        ? policy.followUpDays[0]
        : policy.followUpDays[sentSoFar] - policy.followUpDays[sentSoFar - 1];
    if (ageDays < dueAfter) continue;

    candidates.push({ original, number: sentSoFar + 1, ageDays: Math.floor(ageDays) });
  }

  return candidates.sort((a, b) => b.ageDays - a.ageDays);
}

/**
 * The expensive pass: for each candidate, actually look at the thread before
 * committing to a nudge.
 *
 * When the inbox cannot be read the answer depends on what the sender chose.
 * The default is to skip, because the failure mode of nudging blind lands on
 * the professor rather than on us.
 */
export async function decide(
  userId: string,
  candidate: FollowUpCandidate,
  policy: SendPolicy
): Promise<FollowUpDecision> {
  const threadId = candidate.original.threadId;
  if (!threadId) {
    return policy.followUpWithoutReplyDetection
      ? { action: 'send', candidate }
      : { action: 'skip', candidate, reason: 'No thread id on the original, so a reply cannot be ruled out' };
  }

  const replied = await threadHasReply(userId, threadId);
  if (replied === true) return { action: 'replied', candidate };
  if (replied === false) return { action: 'send', candidate };

  return policy.followUpWithoutReplyDetection
    ? { action: 'send', candidate }
    : {
        action: 'skip',
        candidate,
        reason: 'Could not check the thread for a reply (the school account may need the read permission)',
      };
}

// ── writing the nudge ───────────────────────────────────────────────────────

/**
 * A follow-up is short on purpose. The original said everything; this one only
 * has to put the thread back at the top of an inbox, and every extra sentence
 * is another reason to archive it.
 *
 * Written deterministically rather than generated. There is nothing here worth
 * a model call: no new facts, no personalisation the original did not already
 * carry, and a generated nudge tends to restate the pitch at length.
 */
export function followUpBody(
  original: OutboxEntry,
  user: UserProfile,
  number: number
): { subject: string; body: string } {
  const firstName = original.researcherName.trim().split(/\s+/).slice(-1)[0] || original.researcherName;
  const school = institutionOf(user);
  const standing = standingOf(user);

  const opener =
    number === 1
      ? `I wanted to gently bring this back to the top of your inbox in case it got buried.`
      : `I know this time of year is busy, so this is my last note on it.`;

  const closer =
    number === 1
      ? `If there is someone in the lab better placed to talk to, I am happy to reach out to them instead.`
      : `Either way, thank you for your time, and I will keep following the lab's work.`;

  const body = [
    `Dear Professor ${firstName},`,
    '',
    opener,
    '',
    `I am still very interested in the work we discussed below, and I would welcome the chance to help with it${
      standing ? ` as ${standing}${school ? ` at ${school}` : ''}` : ''
    }.`,
    '',
    closer,
    '',
    'Best,',
    user.name,
  ].join('\n');

  return {
    // Re: on the existing subject, so the nudge is visibly the same
    // conversation even in a client that ignores the threading headers.
    subject: original.subject.startsWith('Re: ') ? original.subject : `Re: ${original.subject}`,
    body,
  };
}

/** Every email already sent on this thread, oldest first. */
export function chainFor(entries: OutboxEntry[], rootId: string): OutboxEntry[] {
  return entries
    .filter((e) => e.id === rootId || e.followUpOf === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Convenience for callers that have a user id rather than a loaded outbox. */
export async function candidatesFor(
  userId: string,
  policy: SendPolicy,
  now: Date = new Date()
): Promise<FollowUpCandidate[]> {
  return findCandidates(await getOutbox(userId), policy, now);
}
