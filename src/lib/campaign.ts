import { ResearcherProfile, TrackId, UserProfile } from './types';
import { findStore, newId, readStore, writeStore } from './store';
import { recommendResearchers } from './recommend';
import { isCampaignSchool, schoolWeight } from './schools';
import { trackOf } from './tracks';
import { getOpportunities, opportunityWeight, OpportunitySignal } from './agents/opportunities';

// The queue of professors to write to, in the order they should be written to.
//
// A target moves through: queued -> drafted -> approved -> sent. Nothing skips
// the middle. Even an armed track writes the draft first and sends it on the
// next pass, so there is always a window in which a human could have looked,
// and so a bad batch can be emptied before any of it leaves.

export type TargetStatus =
  | 'queued'
  | 'drafted'
  | 'approved'
  | 'sent'
  | 'replied'
  | 'skipped'
  | 'failed';

export interface CampaignTarget {
  id: string;
  userId: string;
  researcherId: string;
  researcherName: string;
  school: string;
  trackId: TrackId;
  status: TargetStatus;
  /** Composite rank at the time it was queued, for display and ordering. */
  rank: number;
  /** Why this professor, in words: matched areas, school, recruiting note. */
  reasons: string[];
  // The draft, once written.
  subject: string | null;
  body: string | null;
  to: string | null;
  cc: string[];
  /** When this should go out. Null until it has been drafted. */
  scheduledAt: string | null;
  /** True when a routine may send this without further human input. */
  autoApproved: boolean;
  outboxId: string | null;
  sentAt: string | null;
  /** Why a target was skipped or failed, so the queue explains itself. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function targetKey(userId: string, researcherId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(researcherId)) throw new Error('Unsupported researcher id');
  return `target:${userId}:${researcherId}`;
}

// ── ranking ─────────────────────────────────────────────────────────────────

export interface RankedTarget {
  researcher: ResearcherProfile;
  trackId: TrackId;
  score: number;
  reasons: string[];
}

/**
 * Order the directory by who is actually worth an email.
 *
 * Three multiplied signals, in descending order of how much they should move
 * the answer: how well the work matches the sender's own (recommend.ts, which
 * already explains itself), which school it is (Stanford first, by request),
 * and whether the lab has said it is looking for anyone.
 *
 * Multiplied rather than added, so a closed lab cannot be dragged to the top
 * of the queue by a strong topic match alone.
 */
export async function rankTargets(
  user: UserProfile,
  researchers: ResearcherProfile[],
  opts: { excludeIds?: Set<string>; campaignSchoolsOnly?: boolean } = {}
): Promise<RankedTarget[]> {
  const eligible = researchers.filter((r) => {
    if (opts.excludeIds?.has(r.id)) return false;
    // No published address means no email. The finder agent may supply one on
    // a later run, at which point they become eligible on their own.
    if (!r.email) return false;
    if (opts.campaignSchoolsOnly !== false && !isCampaignSchool(r.school)) return false;
    return true;
  });
  if (!eligible.length) return [];

  const signals = await getOpportunities();
  // A limit is required or this returns only the default handful.
  const recommendations = recommendResearchers(user, eligible, { limit: eligible.length });

  const ranked: RankedTarget[] = recommendations.map((rec) => {
    const signal = signals.get(rec.researcher.id);
    const school = schoolWeight(rec.researcher.school);
    const opportunity = opportunityWeight(signal);

    return {
      researcher: rec.researcher,
      trackId: trackOf(rec.researcher),
      score: Math.round(rec.score * school * opportunity * 10) / 10,
      reasons: buildReasons(rec.matchedOn, rec.researcher.school, signal),
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.researcher.name.localeCompare(b.researcher.name));
  return ranked;
}

function buildReasons(matchedOn: string[], school: string, signal: OpportunitySignal | undefined): string[] {
  const reasons: string[] = [];
  if (matchedOn.length) reasons.push(`Overlaps on ${matchedOn.slice(0, 3).join(', ')}`);
  reasons.push(`${school} is priority ${school === 'Stanford' ? 'one' : school === 'MIT' ? 'two' : 'three'}`);
  if (signal?.stance === 'open') {
    const kinds = signal.kinds.length ? signal.kinds.join('/') : 'people';
    reasons.push(`Lab page says they are looking for ${kinds}`);
  }
  if (signal?.stance === 'closed') reasons.push('Lab page says they are not taking anyone');
  return reasons;
}

// ── the queue ───────────────────────────────────────────────────────────────

export async function getTargets(userId: string): Promise<CampaignTarget[]> {
  try {
    const rows = await findStore<CampaignTarget>('target', 'userId', userId);
    return rows.sort((a, b) => b.rank - a.rank || a.researcherName.localeCompare(b.researcherName));
  } catch {
    return [];
  }
}

export async function getTarget(userId: string, researcherId: string): Promise<CampaignTarget | null> {
  try {
    return await readStore<CampaignTarget | null>(targetKey(userId, researcherId), null);
  } catch {
    return null;
  }
}

export async function saveTarget(target: CampaignTarget): Promise<CampaignTarget> {
  const next = { ...target, updatedAt: new Date().toISOString() };
  await writeStore(targetKey(target.userId, target.researcherId), next);
  return next;
}

export async function updateTarget(
  userId: string,
  researcherId: string,
  patch: Partial<CampaignTarget>
): Promise<CampaignTarget | null> {
  const existing = await getTarget(userId, researcherId);
  if (!existing) return null;
  return saveTarget({ ...existing, ...patch });
}

/**
 * Add a ranked professor to the queue. Returns null when they are already on
 * it: a target that has been sent, skipped, or is waiting for review must not
 * be silently reset by the next overnight run.
 */
export async function queueTarget(userId: string, ranked: RankedTarget): Promise<CampaignTarget | null> {
  const existing = await getTarget(userId, ranked.researcher.id);
  if (existing) return null;

  const now = new Date().toISOString();
  return saveTarget({
    id: newId('tgt'),
    userId,
    researcherId: ranked.researcher.id,
    researcherName: ranked.researcher.name,
    school: ranked.researcher.school,
    trackId: ranked.trackId,
    status: 'queued',
    rank: ranked.score,
    reasons: ranked.reasons,
    subject: null,
    body: null,
    to: ranked.researcher.email,
    cc: [],
    scheduledAt: null,
    autoApproved: false,
    outboxId: null,
    sentAt: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  });
}

/** Ids already on the queue, so ranking can skip them. */
export async function queuedResearcherIds(userId: string): Promise<Set<string>> {
  return new Set((await getTargets(userId)).map((t) => t.researcherId));
}

// ── send policy: how fast, and when ─────────────────────────────────────────

export interface SendPolicy {
  /**
   * Master switch. While this is on, no routine sends anything, whatever else
   * is approved, armed, scheduled or connected.
   *
   * The other guards are each conditional on something: a track being unarmed,
   * a target sitting at drafted, no mailbox attached. That is four things to
   * reason about when the only question worth answering quickly is "can this
   * send an email right now". This is the one switch that answers it, and it
   * is checked before any of the rest.
   */
  paused: boolean;
  /** Hard ceiling on emails sent in any rolling 24 hours. */
  maxPerDay: number;
  /** Ceiling for one routine run, so a single pass cannot empty the queue. */
  maxPerRun: number;
  /** Minimum spacing, so a batch does not arrive as an obvious burst. */
  minGapMinutes: number;
  /** Local send window. A cold email timestamped 3am reads as machinery. */
  windowStartHour: number;
  windowEndHour: number;
  /** IANA zone the window is expressed in. */
  timezone: string;
  /** Weekends get less attention and look worse. */
  weekdaysOnly: boolean;
  /** How many drafts to prepare per run. */
  draftsPerRun: number;
  // ── follow-ups ───────────────────────────────────────────────────────────
  followUpsEnabled: boolean;
  /** Days after the original to send nudge 1, nudge 2, and so on. The length
   *  of this list is the cap: two is where persistence turns into pestering. */
  followUpDays: number[];
  /**
   * Whether to nudge when we cannot check the inbox for a reply.
   *
   * Off by default, and deliberately so. Reply detection needs the Gmail read
   * scope; without it a follow-up is sent blind, and the one email this system
   * must never send is "just following up!" to somebody who answered a week
   * ago. Turning this on is a choice the sender makes with that stated.
   */
  followUpWithoutReplyDetection: boolean;
}

export const DEFAULT_POLICY: SendPolicy = {
  // Paused until the sender says otherwise. A campaign that starts able to
  // send is one misconfiguration away from mailing a professor before anybody
  // has read what it wrote; a campaign that starts paused merely needs turning
  // on, and the person turning it on knows they did.
  paused: true,
  maxPerDay: 8,
  maxPerRun: 4,
  minGapMinutes: 25,
  windowStartHour: 9,
  windowEndHour: 17,
  timezone: 'America/Los_Angeles',
  weekdaysOnly: true,
  draftsPerRun: 6,
  followUpsEnabled: true,
  followUpDays: [5, 12],
  followUpWithoutReplyDetection: false,
};

function policyKey(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `policy:${userId}`;
}

export async function getPolicy(userId: string): Promise<SendPolicy> {
  const stored = await readStore<Partial<SendPolicy> | null>(policyKey(userId), null);
  const merged = { ...DEFAULT_POLICY, ...(stored ?? {}) };
  // Clamp rather than trust: these come from an API and drive a send loop, so
  // a hand-edited record must not be able to produce an unbounded blast.
  return {
    ...merged,
    // Only an explicit false unpauses. A stored record missing the field, or
    // one that fails to load and falls back to defaults, stays paused.
    paused: merged.paused !== false,
    maxPerDay: clamp(merged.maxPerDay, 1, 40),
    maxPerRun: clamp(merged.maxPerRun, 1, 20),
    minGapMinutes: clamp(merged.minGapMinutes, 1, 24 * 60),
    windowStartHour: clamp(merged.windowStartHour, 0, 23),
    windowEndHour: clamp(merged.windowEndHour, 1, 24),
    draftsPerRun: clamp(merged.draftsPerRun, 1, 40),
    weekdaysOnly: merged.weekdaysOnly !== false,
    timezone: typeof merged.timezone === 'string' && merged.timezone ? merged.timezone : DEFAULT_POLICY.timezone,
    followUpsEnabled: merged.followUpsEnabled !== false,
    // At most three nudges however the record was edited, each at least a day
    // out and in increasing order. A malformed list here would otherwise mean
    // somebody gets four emails in one afternoon.
    followUpDays: Array.isArray(merged.followUpDays)
      ? [...new Set(merged.followUpDays.filter((d) => Number.isFinite(d)).map((d) => clamp(d, 1, 90)))]
          .sort((a, b) => a - b)
          .slice(0, 3)
      : DEFAULT_POLICY.followUpDays,
    followUpWithoutReplyDetection: merged.followUpWithoutReplyDetection === true,
  };
}

export async function savePolicy(userId: string, patch: Partial<SendPolicy>): Promise<SendPolicy> {
  const next = { ...(await getPolicy(userId)), ...patch };
  await writeStore(policyKey(userId), next);
  return getPolicy(userId);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ── scheduling ──────────────────────────────────────────────────────────────

/** Hour and weekday of an instant, in the policy's zone rather than the server's. */
function localParts(at: Date, timezone: string): { hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const name = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
    return { hour: hour === 24 ? 0 : hour, weekday: weekday === -1 ? 1 : weekday };
  } catch {
    // An invalid zone should not stop the queue; fall back to server time.
    return { hour: at.getUTCHours(), weekday: at.getUTCDay() };
  }
}

export function isWithinWindow(at: Date, policy: SendPolicy): boolean {
  const { hour, weekday } = localParts(at, policy.timezone);
  if (policy.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  return hour >= policy.windowStartHour && hour < policy.windowEndHour;
}

/**
 * The next moment inside the send window, at or after `from`. Steps forward an
 * hour at a time rather than doing zone arithmetic by hand, which is wrong
 * across a daylight-saving boundary in ways that are hard to see.
 */
export function nextSendSlot(from: Date, policy: SendPolicy): Date {
  const at = new Date(from);
  at.setMinutes(0, 0, 0);
  if (at < from) at.setHours(at.getHours() + 1);
  for (let i = 0; i < 24 * 14; i++) {
    if (isWithinWindow(at, policy)) return at;
    at.setHours(at.getHours() + 1);
  }
  return at;
}

/**
 * Lay a batch of drafts out across the send window, spaced by the policy gap.
 * `startAfter` is normally tomorrow morning: a draft written tonight should be
 * reviewable before it goes anywhere.
 */
export function scheduleBatch(count: number, startAfter: Date, policy: SendPolicy): Date[] {
  const slots: Date[] = [];
  let cursor = nextSendSlot(startAfter, policy);
  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor));
    const next = new Date(cursor.getTime() + policy.minGapMinutes * 60_000);
    cursor = isWithinWindow(next, policy) ? next : nextSendSlot(next, policy);
  }
  return slots;
}

/** The calendar date in the policy's zone, as YYYY-MM-DD, for comparing days. */
function localDate(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * The first send slot on a later day than today, in the sender's own zone.
 *
 * Drafts are written overnight and land here, so this is what puts a whole
 * night between a draft being written and it going anywhere. Comparing local
 * calendar dates rather than adding a fixed number of hours matters: adding 12
 * hours to a 4am run lands at 4pm the *same* day, which is not a review window
 * anybody would call overnight.
 */
export function tomorrowMorning(policy: SendPolicy, from: Date = new Date()): Date {
  const today = localDate(from, policy.timezone);
  const at = new Date(from);
  at.setMinutes(0, 0, 0);
  // Two weeks of hours is far more than enough to clear a weekend under a
  // weekdays-only policy, and bounds the loop against a pathological zone.
  for (let i = 0; i < 24 * 14; i++) {
    at.setHours(at.getHours() + 1);
    if (localDate(at, policy.timezone) !== today && isWithinWindow(at, policy)) return at;
  }
  return nextSendSlot(from, policy);
}

// ── what may be sent right now ──────────────────────────────────────────────

/**
 * Approved targets whose time has come, newest policy applied. Ordered by
 * schedule so the queue drains in the order it was laid out.
 */
export async function dueTargets(userId: string, now: Date = new Date()): Promise<CampaignTarget[]> {
  const targets = await getTargets(userId);
  return targets
    .filter((t) => t.status === 'approved' && t.scheduledAt && Date.parse(t.scheduledAt) <= now.getTime())
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
}

/** Targets waiting on a human. This is the review list the sender reads. */
export async function awaitingReview(userId: string): Promise<CampaignTarget[]> {
  return (await getTargets(userId)).filter((t) => t.status === 'drafted' && !t.autoApproved);
}

/**
 * How many emails have already gone out in the trailing 24 hours, so the daily
 * cap is enforced against reality rather than against one run's own counter.
 */
export async function sentInLastDay(userId: string, now: Date = new Date()): Promise<number> {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return (await getTargets(userId)).filter(
    (t) => t.sentAt && Date.parse(t.sentAt) >= cutoff
  ).length;
}

export interface CampaignSummary {
  queued: number;
  drafted: number;
  awaitingReview: number;
  approved: number;
  sent: number;
  replied: number;
  skipped: number;
  failed: number;
  sentLastDay: number;
  nextScheduledAt: string | null;
}

export async function summarize(userId: string): Promise<CampaignSummary> {
  const targets = await getTargets(userId);
  const count = (status: TargetStatus) => targets.filter((t) => t.status === status).length;
  const upcoming = targets
    .filter((t) => t.status === 'approved' && t.scheduledAt)
    .map((t) => t.scheduledAt!)
    .sort();

  return {
    queued: count('queued'),
    drafted: count('drafted'),
    awaitingReview: targets.filter((t) => t.status === 'drafted' && !t.autoApproved).length,
    approved: count('approved'),
    sent: count('sent'),
    replied: count('replied'),
    skipped: count('skipped'),
    failed: count('failed'),
    sentLastDay: await sentInLastDay(userId),
    nextScheduledAt: upcoming[0] ?? null,
  };
}
