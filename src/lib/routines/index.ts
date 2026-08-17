import { Routine, RoutineContext, RoutineReport } from './types';
import { JOBS } from './jobs';
import { listStore, newId, writeStore } from '../store';

export type { Routine, RoutineContext, RoutineReport } from './types';

// The registry, the run log, and the composite "daily" routine.
//
// Every routine is runnable on its own, from the campaign page or the CLI. The
// scheduled entry point is `daily`, which runs them in the order they depend
// on each other: find addresses, learn who is recruiting, rank, draft, send,
// nudge. Running that one job on a cron is the whole automation.

/**
 * The nightly chain, in order. Addresses are found before ranking so a
 * professor discovered tonight can be queued tonight; drafts are written
 * before sending so the send step only ever handles work that has been sitting
 * long enough to be reviewed.
 */
const DAILY_CHAIN = ['find-emails', 'find-opportunities', 'build-queue', 'write-drafts', 'send-due', 'follow-up'];

/**
 * Steps that must run even when the chain is short of time.
 *
 * The crawling steps at the front are the slow ones and the ones it is safe to
 * cut: an address not found tonight is found tomorrow. Sending is not like
 * that. A draft the sender approved for 9am has to actually go at 9am, so the
 * chain reserves time for these two rather than letting a slow crawl eat the
 * whole budget and silently skip the send.
 */
const MUST_RUN = new Set(['send-due', 'follow-up']);

/** Time held back for the sending steps at the end of the chain. */
const RESERVE_MS = 60_000;

const daily: Routine = {
  name: 'daily',
  description: 'The whole chain: find addresses, check who is recruiting, rank, draft, send, nudge.',
  sends: true,
  async run(ctx: RoutineContext) {
    const details: string[] = [];
    const counts: Record<string, number> = {};
    const summaries: string[] = [];

    for (const name of DAILY_CHAIN) {
      const job = JOBS.find((j) => j.name === name);
      if (!job) continue;

      // Hand the slow front half a deadline that stops short of the real one,
      // so there is still time left to send when they finish.
      const stepDeadline =
        ctx.deadline && !MUST_RUN.has(name) ? ctx.deadline - RESERVE_MS : ctx.deadline;

      if (stepDeadline && Date.now() >= stepDeadline) {
        summaries.push(`${job.name}: skipped, out of time`);
        details.push(`── ${job.name} ── skipped, out of time this run`);
        continue;
      }

      try {
        // Each step gets the chain's own context; a per-step limit would have
        // to come from the policy, which the steps already read for
        // themselves.
        const result = await job.run({ ...ctx, limit: undefined, deadline: stepDeadline });
        summaries.push(`${job.name}: ${result.summary}`);
        details.push(`── ${job.name} ──`, ...result.details);
        for (const [key, value] of Object.entries(result.counts)) {
          counts[`${job.name}.${key}`] = value;
        }
      } catch (err) {
        // One failing step must not strand the rest. A crawl that times out
        // should never stop the drafts that were already written from going
        // out, and vice versa.
        const message = err instanceof Error ? err.message : String(err);
        summaries.push(`${job.name}: failed (${message.slice(0, 120)})`);
        details.push(`── ${job.name} ── failed: ${message.slice(0, 300)}`);
        counts[`${job.name}.error`] = 1;
      }
    }

    return { summary: summaries.join(' | '), counts, details };
  },
};

export const ROUTINES: Routine[] = [daily, ...JOBS];

export function getRoutine(name: string): Routine | undefined {
  return ROUTINES.find((r) => r.name === name);
}

export function routineNames(): string[] {
  return ROUTINES.map((r) => r.name);
}

// ── running, and the log ────────────────────────────────────────────────────

/** Runs kept per user. Enough to see a pattern, not so many that the list is
 *  unreadable or the store fills up with history nobody reads. */
const KEEP_RUNS = 40;

export async function runRoutine(name: string, ctx: RoutineContext): Promise<RoutineReport> {
  const routine = getRoutine(name);
  const startedAt = new Date().toISOString();
  const id = newId('run');

  if (!routine) {
    return {
      routine: name,
      id,
      userId: ctx.userId,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      dryRun: ctx.dryRun,
      summary: `No routine called "${name}"`,
      counts: {},
      details: [],
      error: `Unknown routine. Available: ${routineNames().join(', ')}`,
    };
  }

  let report: RoutineReport;
  try {
    const result = await routine.run(ctx);
    report = {
      routine: routine.name,
      id,
      userId: ctx.userId,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      dryRun: ctx.dryRun,
      summary: result.summary,
      counts: result.counts,
      details: result.details,
      error: null,
    };
  } catch (err) {
    report = {
      routine: routine.name,
      id,
      userId: ctx.userId,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      dryRun: ctx.dryRun,
      summary: 'The routine failed',
      counts: {},
      details: [],
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }

  // The log is a convenience, not the work. A store that cannot be written
  // must not turn a successful run into a reported failure.
  await writeStore(`routinerun:${id}`, report).catch(() => {});
  return report;
}

export async function getRuns(userId: string, limit = KEEP_RUNS): Promise<RoutineReport[]> {
  try {
    const rows = await listStore<RoutineReport>('routinerun');
    return rows
      .filter((r) => r?.userId === userId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** The most recent run of each routine, for the status column in the UI. */
export async function getLastRuns(userId: string): Promise<Record<string, RoutineReport>> {
  const runs = await getRuns(userId, 200);
  const latest: Record<string, RoutineReport> = {};
  for (const run of runs) {
    if (!latest[run.routine]) latest[run.routine] = run;
  }
  return latest;
}
