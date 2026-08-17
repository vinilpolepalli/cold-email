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
