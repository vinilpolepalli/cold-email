// Shared shapes for the routines. Kept in their own module so the registry can
// import every routine without the routines importing the registry back.

export interface RoutineContext {
  userId: string;
  /** Treated as "now" throughout a run, so a long run does not straddle a
   *  send-window boundary halfway through and behave inconsistently. */
  now: Date;
  /**
   * Do everything except the irreversible part. Crawls still run and drafts
   * are still written; nothing is sent. This is what makes it safe to watch a
   * routine before trusting it.
   */
  dryRun: boolean;
  /** Optional ceiling for this run, overriding the policy's own. */
  limit?: number;
  /**
   * Epoch ms after which this run should stop starting new work.
   *
   * Serverless platforms cap how long a request may take and then kill it
   * outright. Being killed is survivable here — every routine persists as it
   * goes, so the next run resumes — but it is silent, and a run that stops
   * cleanly can say what it did not get to. Crawling loops check this between
   * items; the daily chain sets it and skips steps that cannot start.
   */
  deadline?: number;
  /**
   * Restrict this run to these schools, by name.
   *
   * The campaign normally works from CAMPAIGN_SCHOOLS, which is the standing
   * answer to "who would an unattended run contact". A named list here is the
   * sender asking for one specific batch, so it also lifts that restriction —
   * naming a school is a more explicit instruction than the default it
   * overrides.
   */
  schools?: string[];
  /** Further narrow to departments matching this pattern, e.g. Wharton within Penn. */
  departmentPattern?: string;
}

/** Whether there is still time to start another item. */
export function hasTime(ctx: RoutineContext, needMs = 0): boolean {
  return !ctx.deadline || Date.now() + needMs < ctx.deadline;
}

export interface RoutineReport {
  routine: string;
  id: string;
  userId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  dryRun: boolean;
  /** One line, written for a person skimming a list of runs. */
  summary: string;
  /** Counters worth charting or comparing between runs. */
  counts: Record<string, number>;
  /** Per-item lines: what happened to each professor this run touched. */
  details: string[];
  /** Set when the routine could not complete. */
  error: string | null;
}

export interface Routine {
  name: string;
  /** Shown in the UI next to the run button. */
  description: string;
  /**
   * Whether this routine can send email. Used to decide what a dry run must
   * suppress, and to mark the routines worth being careful with in the UI.
   */
  sends: boolean;
  run(ctx: RoutineContext): Promise<Omit<RoutineReport, 'routine' | 'id' | 'userId' | 'startedAt' | 'finishedAt' | 'ok' | 'dryRun' | 'error'>>;
}

/** Convenience for routines: an empty result they can fill in. */
export function emptyResult(summary = 'Nothing to do'): {
  summary: string;
  counts: Record<string, number>;
  details: string[];
} {
  return { summary, counts: {}, details: [] };
}
