// Which schools this campaign is actually aimed at.
//
// The directory holds five, but they are not equally wanted: Stanford first
// and by a clear margin, then MIT, then Harvard. The rest stay in the
// directory and stay browsable, they simply do not get picked by a routine
// running unattended overnight.
//
// Weights are multipliers on a target's rank, so the ordering here is the one
// knob that decides who an autonomous run reaches out to first.

export interface SchoolPriority {
  school: string;
  weight: number;
  /** Shown in the UI so the ordering is visible rather than buried in code. */
  note: string;
}

export const SCHOOL_PRIORITIES: SchoolPriority[] = [
  { school: 'Stanford', weight: 1.0, note: 'First choice.' },
  { school: 'MIT', weight: 0.78, note: 'Second.' },
  { school: 'Harvard', weight: 0.6, note: 'Third.' },
  { school: 'Princeton', weight: 0.3, note: 'In the directory, not a campaign target.' },
  { school: 'Penn', weight: 0.3, note: 'In the directory, not a campaign target.' },
];

/**
 * Schools a routine may act on without being asked. Everything else is still
 * searchable and still emailable by hand from the compose screen; it just
 * never turns up in a queue that nobody is watching.
 */
export const CAMPAIGN_SCHOOLS = ['Stanford', 'MIT', 'Harvard'] as const;

const WEIGHTS = new Map(SCHOOL_PRIORITIES.map((s) => [s.school.toLowerCase(), s.weight]));

/**
 * Rank multiplier for a school. An unknown school (anything added later by the
 * scraper) gets a low but non-zero weight: worth keeping, not worth leading
 * with, and never silently dropped.
 */
export function schoolWeight(school: string): number {
  return WEIGHTS.get((school ?? '').trim().toLowerCase()) ?? 0.25;
}

export function isCampaignSchool(school: string): boolean {
  return (CAMPAIGN_SCHOOLS as readonly string[]).some((s) => s.toLowerCase() === (school ?? '').trim().toLowerCase());
}

/** Campaign schools in priority order, for UI that lists them. */
export function campaignSchoolsInOrder(): string[] {
  return [...CAMPAIGN_SCHOOLS].sort((a, b) => schoolWeight(b) - schoolWeight(a));
}
