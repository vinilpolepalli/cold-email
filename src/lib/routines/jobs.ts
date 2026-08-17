import { Routine, RoutineContext, emptyResult, hasTime } from './types';
import { getAllProfiles } from '../profiles';
import { getUserProfile, getNimAuth } from '../user';
import { getRules } from '../preferences';
import { getPublications } from '../publications';
import { focusFromWorks, generateDraft } from '../template';
import { resolveTemplate } from '../user-template';
import { getResumeFile } from '../resume-file';
import { isSendableAddress, sendEmail, validateRecipients, getOutbox } from '../send';
import { getSenderIdentity } from '../sender-identity';
import { canAutoSend, getTrackStates, trackOf } from '../tracks';
import { isCampaignSchool } from '../schools';
import { getLabContacts } from '../contacts';
import { huntCandidates, huntEmail } from '../agents/email-finder';
import { checkOpportunities, opportunityCandidates } from '../agents/opportunities';
import { candidatesFor, decide, followUpBody } from '../followups';
import {
  CampaignTarget,
  dueTargets,
  getPolicy,
  getTargets,
  queueTarget,
  queuedResearcherIds,
  rankTargets,
  scheduleBatch,
  sentInLastDay,
  tomorrowMorning,
  updateTarget,
} from '../campaign';

// The individual jobs. Each is independently runnable and independently safe
// to run twice: they all work from stored state rather than from whatever the
// previous job in the chain happened to return.

/**
 * Copies for one professor: their assistant and the people running the lab.
 *
 * Capped below validateRecipients' own limit of five, because a cold email
 * copying half a lab is a mailing list rather than an introduction. Admins
 * come first: the assistant is the one who actually books the meeting.
 */
const MAX_CAMPAIGN_COPIES = 3;

async function copiesFor(
  researcher: Parameters<typeof getLabContacts>[0],
  nimAuth: Awaited<ReturnType<typeof getNimAuth>>
): Promise<string[]> {
  try {
    const lookup = await getLabContacts(researcher, { nimAuth });
    const ranked = [...lookup.contacts].sort(
      (a, b) => Number(b.kind === 'admin') - Number(a.kind === 'admin')
    );
    const seen = new Set([researcher.email?.toLowerCase()].filter(Boolean) as string[]);
    const out: string[] = [];
    for (const contact of ranked) {
      const address = contact.email.trim().toLowerCase();
      if (!address || seen.has(address)) continue;
      seen.add(address);
      out.push(contact.email.trim());
      if (out.length >= MAX_CAMPAIGN_COPIES) break;
    }
    return out;
  } catch {
    // No contacts is a fine answer, and the email sends without them.
    return [];
  }
}

/**
 * A time written in the sender's own zone. Run reports are read by a person
 * deciding whether a send time looks right, and a server that happens to run
 * in UTC would otherwise print every slot seven hours off.
 */
function inPolicyZone(at: Date, timezone: string): string {
  try {
    return at.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return at.toISOString();
  }
}

// ── 1. find the missing addresses ───────────────────────────────────────────

const findEmails: Routine = {
  name: 'find-emails',
  description: 'Look for published addresses for directory entries that have none.',
  sends: false,
  async run(ctx: RoutineContext) {
    const limit = ctx.limit ?? 12;
    const all = await getAllProfiles();
    // Campaign schools first: an address for a Stanford professor is worth
    // more than one for a school this campaign will never write to.
    const wanted = all
      .filter((r) => !r.email)
      .sort((a, b) => Number(isCampaignSchool(b.school)) - Number(isCampaignSchool(a.school)));

    const candidates = await huntCandidates(wanted, limit);
    if (!candidates.length) return emptyResult('No professors are waiting on an address lookup');

    const details: string[] = [];
    let found = 0;
    let checked = 0;
    for (const researcher of candidates) {
      // One person can mean eight page fetches, so leave room for a slow one
      // rather than starting a hunt that will be killed halfway through.
      if (!hasTime(ctx, 20_000)) {
        details.push(`Stopped early with ${candidates.length - checked} left; they are first in line next run.`);
        break;
      }
      checked++;
      const hunt = await huntEmail(researcher);
      if (hunt.email) {
        found++;
        details.push(`Found ${hunt.email} for ${researcher.name} (${researcher.school}) on ${hunt.foundOn}`);
      } else {
        details.push(`No published address for ${researcher.name} (${researcher.school}) across ${hunt.pagesChecked.length} pages`);
      }
    }

    const stillMissing = wanted.length - found;
    return {
      summary: `Checked ${checked}, found ${found}. ${stillMissing} directory entries still have no address.`,
      counts: { checked, found, stillMissing },
      details,
    };
  },
};

// ── 2. who is actually looking for people ───────────────────────────────────

const findOpportunities: Routine = {
  name: 'find-opportunities',
  description: 'Read lab pages for whether they are recruiting, or have said not to ask.',
  sends: false,
  async run(ctx: RoutineContext) {
    const limit = ctx.limit ?? 10;
    const all = (await getAllProfiles()).filter((r) => isCampaignSchool(r.school));
    const candidates = await opportunityCandidates(all, limit);
    if (!candidates.length) return emptyResult('Every campaign lab has been checked recently');

    const details: string[] = [];
    const counts = { checked: 0, open: 0, closed: 0, unknown: 0 };
    for (const researcher of candidates) {
      if (!hasTime(ctx, 20_000)) {
        details.push(`Stopped early with ${candidates.length - counts.checked} labs left; they are checked next run.`);
        break;
      }
      const signal = await checkOpportunities(researcher);
      counts.checked++;
      counts[signal.stance]++;
      if (signal.stance !== 'unknown') {
        details.push(
          `${researcher.name} (${researcher.school}): ${signal.stance}${
            signal.evidence[0] ? ` — "${signal.evidence[0].quote}"` : ''
          }`
        );
      }
    }

    return {
      summary: `Checked ${counts.checked} labs: ${counts.open} recruiting, ${counts.closed} explicitly not.`,
      counts,
      details,
    };
  },
};

// ── 3. decide who to write to ───────────────────────────────────────────────

const buildQueue: Routine = {
  name: 'build-queue',
  description: 'Rank the directory and add the best unqueued professors to the queue.',
  sends: false,
  async run(ctx: RoutineContext) {
    const user = await getUserProfile(ctx.userId);
    if (!user) return emptyResult('No profile yet, so there is nothing to rank against');

    const policy = await getPolicy(ctx.userId);
    const limit = ctx.limit ?? policy.draftsPerRun;
    const exclude = await queuedResearcherIds(ctx.userId);
    // Anyone already emailed by hand from the compose screen is not a new
    // target either, even though they never went through this queue.
    for (const entry of await getOutbox(ctx.userId)) exclude.add(entry.researcherId);

    const ranked = await rankTargets(user, await getAllProfiles(), { excludeIds: exclude });
    if (!ranked.length) return emptyResult('Nothing new to queue');

    const details: string[] = [];
    let added = 0;
    for (const target of ranked) {
      if (added >= limit) break;
      const queued = await queueTarget(ctx.userId, target);
      if (!queued) continue;
      added++;
      details.push(`${target.researcher.name} (${target.researcher.school}, ${target.trackId}) — ${target.reasons.join('; ')}`);
    }

    return {
      summary: `Queued ${added} professor(s) from ${ranked.length} ranked candidates.`,
      counts: { added, ranked: ranked.length },
      details,
    };
  },
};

// ── 4. write the drafts ─────────────────────────────────────────────────────

const writeDrafts: Routine = {
  name: 'write-drafts',
  description: 'Draft emails for queued professors and schedule them for the next send window.',
  sends: false,
  async run(ctx: RoutineContext) {
    const user = await getUserProfile(ctx.userId);
    if (!user) return emptyResult('No profile yet, so nothing can be drafted');

    const policy = await getPolicy(ctx.userId);
    const limit = ctx.limit ?? policy.draftsPerRun;
    const queued = (await getTargets(ctx.userId)).filter((t) => t.status === 'queued').slice(0, limit);
    if (!queued.length) return emptyResult('No queued professors are waiting for a draft');

    const [profiles, rules, nimAuth, trackStates] = await Promise.all([
      getAllProfiles(),
      getRules(ctx.userId),
      getNimAuth(ctx.userId),
      getTrackStates(ctx.userId),
    ]);

    // Drafts written now go out in the next window, which is normally tomorrow
    // morning. That gap is the review window, and it is why an armed track is
    // still not the same as sending the instant a draft exists.
    const slots = scheduleBatch(queued.length, tomorrowMorning(policy), policy);

    const details: string[] = [];
    let drafted = 0;
    let autoApproved = 0;

    for (const [index, target] of queued.entries()) {
      // Drafting means a publication fetch and a model call. Both can be slow,
      // and a draft half-written is a draft not written at all.
      if (!hasTime(ctx, 45_000)) {
        details.push(`Stopped early with ${queued.length - index} still to draft; they stay queued for the next run.`);
        break;
      }
      const researcher = profiles.find((p) => p.id === target.researcherId);
      if (!researcher) {
        await updateTarget(ctx.userId, target.researcherId, {
          status: 'skipped',
          note: 'No longer in the directory',
        });
        details.push(`${target.researcherName}: dropped, no longer in the directory`);
        continue;
      }
      if (!researcher.email) {
        await updateTarget(ctx.userId, target.researcherId, {
          status: 'skipped',
          note: 'No published address',
        });
        details.push(`${target.researcherName}: skipped, still no published address`);
        continue;
      }

      const trackId = trackOf(researcher);
      const works = await getPublications(researcher).catch(() => null);
      const template = await resolveTemplate(ctx.userId, trackId);

      // Who else belongs on the email. A cold email to a professor often
      // reaches them through the person who manages their calendar, and the
      // postdoc running the project is frequently the one who replies. This
      // runs on the campaign path for the same reason it runs on the compose
      // screen; leaving it out here made every unattended email a worse
      // version of the one sent by hand.
      const cc = await copiesFor(researcher, nimAuth);
      const draft = await generateDraft(
        researcher,
        user,
        nimAuth,
        works,
        works ? focusFromWorks(works, user) : null,
        rules,
        template
      );

      // An armed track may skip the review step. An unarmed one may not, and
      // this is the only place that decision is made.
      const auto = canAutoSend(trackStates[trackId]);

      await updateTarget(ctx.userId, target.researcherId, {
        status: 'drafted',
        trackId,
        subject: draft.subject,
        body: draft.body,
        to: researcher.email,
        cc,
        scheduledAt: slots[index]?.toISOString() ?? null,
        autoApproved: auto,
        note: `Drafted by ${draft.generator}${template ? ` using your ${template.mode} template` : ''}${
          cc.length ? `, copying ${cc.length} lab contact(s)` : ''
        }`,
      });

      drafted++;
      if (auto) autoApproved++;
      details.push(
        `${researcher.name} (${researcher.school}, ${trackId}) — "${draft.subject}" for ${
          slots[index] ? inPolicyZone(slots[index], policy.timezone) : 'unscheduled'
        }${auto ? ' [track armed, will send without review]' : ' [waiting for your review]'}`
      );
    }

    return {
      summary: `Drafted ${drafted}; ${autoApproved} on armed tracks, ${drafted - autoApproved} waiting for review.`,
      counts: { drafted, autoApproved, awaitingReview: drafted - autoApproved },
      details,
    };
  },
};

// ── 5. send what is due ─────────────────────────────────────────────────────

const sendDue: Routine = {
  name: 'send-due',
  description: 'Send approved drafts whose scheduled time has arrived.',
  sends: true,
  async run(ctx: RoutineContext) {
    const user = await getUserProfile(ctx.userId);
    if (!user) return emptyResult('No profile yet');

    // The master switch, checked before anything else so that "is the campaign
    // paused" is the first and cheapest question, not a conclusion drawn from
    // four other settings.
    const paused = await getPolicy(ctx.userId);
    if (paused.paused) {
      return {
        summary: 'Campaign is paused, so nothing was sent.',
        counts: { sent: 0, blocked: 1 },
        details: ['Unpause it from the campaign page when you are ready to start sending.'],
      };
    }

    // Refuse to send from the wrong mailbox. Without a connected school
    // account the send chain would fall through to whatever else is
    // configured, and the entire point of this campaign is the .edu address.
    const identity = await getSenderIdentity(ctx.userId);
    if (!identity) {
      return {
        summary: 'No school account is connected, so nothing was sent. Connect it in Settings.',
        counts: { sent: 0, blocked: 1 },
        details: ['Sending is held until a university mailbox is connected.'],
      };
    }

    const policy = await getPolicy(ctx.userId);
    const alreadyToday = await sentInLastDay(ctx.userId, ctx.now);
    const room = Math.max(0, policy.maxPerDay - alreadyToday);
    const allowance = Math.min(ctx.limit ?? policy.maxPerRun, policy.maxPerRun, room);

    // Auto-approve drafts on armed tracks whose time has come. Done here, at
    // the last moment, so disarming a track between drafting and sending
    // actually stops the send.
    const trackStates = await getTrackStates(ctx.userId);
    for (const target of await getTargets(ctx.userId)) {
      if (target.status !== 'drafted' || !target.autoApproved) continue;
      if (!canAutoSend(trackStates[target.trackId])) continue;
      await updateTarget(ctx.userId, target.researcherId, { status: 'approved' });
    }

    const due = (await dueTargets(ctx.userId, ctx.now)).slice(0, allowance);
    if (!due.length) {
      const reason =
        room === 0
          ? `Daily cap reached (${alreadyToday}/${policy.maxPerDay} in the last 24h)`
          : 'Nothing is due to send';
      return { summary: reason, counts: { sent: 0, capped: room === 0 ? 1 : 0 }, details: [] };
    }

    const resume = await getResumeFile(ctx.userId);
    const details: string[] = [];
    let sent = 0;
    let failed = 0;

    for (const target of due) {
      const outcome = await sendOne(ctx, target, user, resume);
      if (outcome.ok) {
        sent++;
        details.push(`Sent to ${target.researcherName} <${target.to}>${ctx.dryRun ? ' [dry run]' : ''}`);
      } else {
        failed++;
        details.push(`Failed for ${target.researcherName}: ${outcome.reason}`);
      }
    }

    return {
      summary: ctx.dryRun
        ? `Dry run: ${due.length} would have been sent from ${identity.email}.`
        : `Sent ${sent} from ${identity.email}${failed ? `, ${failed} failed` : ''}.`,
      counts: { sent, failed, capRemaining: Math.max(0, room - sent) },
      details,
    };
  },
};

async function sendOne(
  ctx: RoutineContext,
  target: CampaignTarget,
  user: Awaited<ReturnType<typeof getUserProfile>> & object,
  resume: Awaited<ReturnType<typeof getResumeFile>>
): Promise<{ ok: boolean; reason?: string }> {
  if (!target.to || !target.subject || !target.body) {
    await updateTarget(ctx.userId, target.researcherId, { status: 'failed', note: 'Draft was incomplete' });
    return { ok: false, reason: 'draft incomplete' };
  }

  const addresses = validateRecipients(target.to, target.cc);
  if ('error' in addresses) {
    await updateTarget(ctx.userId, target.researcherId, { status: 'failed', note: addresses.error });
    return { ok: false, reason: addresses.error };
  }

  if (ctx.dryRun) return { ok: true };

  const entry = await sendEmail({
    userId: ctx.userId,
    researcherId: target.researcherId,
    researcherName: target.researcherName,
    to: addresses.to,
    cc: addresses.cc,
    fromName: user.name,
    replyTo: user.email && isSendableAddress(user.email) ? user.email : undefined,
    subject: target.subject,
    body: target.body,
    attachment: resume
      ? { fileName: resume.fileName, contentType: resume.contentType, base64: resume.base64 }
      : null,
    trackId: target.trackId,
    // Sent by a routine, so it does not count toward the track's gate: that
    // number is meant to measure how much of this track a human has read.
    autonomous: true,
  });

  if (entry.status === 'failed') {
    await updateTarget(ctx.userId, target.researcherId, {
      status: 'failed',
      outboxId: entry.id,
      note: entry.detail,
    });
    return { ok: false, reason: entry.detail ?? 'send failed' };
  }

  await updateTarget(ctx.userId, target.researcherId, {
    status: 'sent',
    outboxId: entry.id,
    sentAt: entry.createdAt,
    note: entry.detail,
  });
  return { ok: true };
}

// ── 6. nudge the ones who went quiet ────────────────────────────────────────

const followUp: Routine = {
  name: 'follow-up',
  description: 'Nudge professors who have not replied, after checking that they have not.',
  sends: true,
  async run(ctx: RoutineContext) {
    const user = await getUserProfile(ctx.userId);
    if (!user) return emptyResult('No profile yet');

    const policy = await getPolicy(ctx.userId);
    // A nudge is an email too. Pausing has to stop these as well, or "paused"
    // would quietly mean "paused except for the ones already in flight".
    if (policy.paused) return emptyResult('Campaign is paused, so nothing was nudged');
    if (!policy.followUpsEnabled) return emptyResult('Follow-ups are switched off');

    const identity = await getSenderIdentity(ctx.userId);
    if (!identity) return emptyResult('No school account connected, so nothing was nudged');

    const candidates = await candidatesFor(ctx.userId, policy, ctx.now);
    if (!candidates.length) return emptyResult('Nothing has gone quiet long enough to nudge');

    const allowance = Math.min(ctx.limit ?? policy.maxPerRun, policy.maxPerRun);
    const resume = await getResumeFile(ctx.userId);
    const details: string[] = [];
    const counts = { nudged: 0, replied: 0, skipped: 0, failed: 0 };

    for (const candidate of candidates) {
      if (counts.nudged >= allowance) break;

      const decision = await decide(ctx.userId, candidate, policy);

      if (decision.action === 'replied') {
        counts.replied++;
        // Mark the target so the queue reflects it and nothing nudges again.
        await updateTarget(ctx.userId, candidate.original.researcherId, {
          status: 'replied',
          note: 'They replied',
        });
        details.push(`${candidate.original.researcherName} replied — no nudge, marked as answered`);
        continue;
      }
      if (decision.action === 'skip') {
        counts.skipped++;
        details.push(`${candidate.original.researcherName}: ${decision.reason}`);
        continue;
      }

      const { subject, body } = followUpBody(candidate.original, user, candidate.number);
      if (ctx.dryRun) {
        counts.nudged++;
        details.push(`Would nudge ${candidate.original.researcherName} (#${candidate.number}, quiet ${candidate.ageDays}d)`);
        continue;
      }

      const entry = await sendEmail({
        userId: ctx.userId,
        researcherId: candidate.original.researcherId,
        researcherName: candidate.original.researcherName,
        to: candidate.original.to,
        // Nudges go to the professor alone. Copying the assistant again on a
        // second email turns one polite follow-up into two people's problem.
        cc: [],
        fromName: user.name,
        replyTo: user.email && isSendableAddress(user.email) ? user.email : undefined,
        subject,
        body,
        // The resume rode along on the original; attaching it again is noise.
        attachment: candidate.number === 1 && !candidate.original.attachmentName && resume
          ? { fileName: resume.fileName, contentType: resume.contentType, base64: resume.base64 }
          : null,
        threadId: candidate.original.threadId,
        inReplyTo: candidate.original.rfcMessageId,
        trackId: candidate.original.trackId,
        autonomous: true,
        followUpOf: candidate.original.id,
        followUpNumber: candidate.number,
      });

      if (entry.status === 'failed') {
        counts.failed++;
        details.push(`Nudge failed for ${candidate.original.researcherName}: ${entry.detail}`);
      } else {
        counts.nudged++;
        details.push(`Nudged ${candidate.original.researcherName} (#${candidate.number}, quiet ${candidate.ageDays}d)`);
      }
    }

    return {
      summary: `${counts.nudged} nudged, ${counts.replied} had already replied, ${counts.skipped} skipped.`,
      counts,
      details,
    };
  },
};

export const JOBS: Routine[] = [findEmails, findOpportunities, buildQueue, writeDrafts, sendDue, followUp];
