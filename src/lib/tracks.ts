import { ResearcherProfile, TrackId } from './types';
import { readStore, writeStore } from './store';

export type { TrackId };

// Research tracks: the handful of directions the sender is actually pursuing,
// used to decide which professors belong together and which cold emails have
// already been proven.
//
// The point of a track is the approval gate. A cold email that reads well to a
// robotics lab reads wrong to a genomics lab, so autonomy is earned per track
// rather than globally: the sender reviews and sends the first couple in a
// track by hand, and only then can that track be armed for autonomous sending.
// A new track starts locked however many emails the other tracks have sent.

export interface Track {
  id: TrackId;
  label: string;
  /** One line, shown in the UI next to the track's gate. */
  blurb: string;
  /**
   * Terms that are decisive on their own. A single anchor outweighs several
   * ordinary terms, because a compbio professor lists "machine learning" too
   * and would otherwise be filed under pure CS along with everyone else.
   */
  anchors: string[];
  /** Supporting vocabulary. Only decides a track when no anchor hits. */
  terms: string[];
}

// The vocabulary below was taken from the research areas actually present in
// data/profiles.json, not invented: "machine learning" appears on 266 of the
// 794 profiles, which is exactly why it is a term and never an anchor.
export const TRACKS: Track[] = [
  {
    id: 'cs-core',
    label: 'Pure CS',
    blurb: 'Theory, algorithms, systems, ML and NLP foundations.',
    anchors: [
      'theory of computation',
      'programming languages',
      'computer architecture',
      'systems and networking',
      'distributed systems',
      'algorithms',
      'computational complexity',
      'cryptography',
      'compilers',
      'operating systems',
      'databases',
      'formal methods',
      'ml systems',
      'computation & theory',
    ],
    terms: [
      'machine learning',
      'artificial intelligence',
      'deep learning',
      'reinforcement learning',
      'natural language processing',
      'nlp',
      'large language models',
      'foundation models',
      'generative ai',
      'generative models',
      'machine learning theory',
      'statistical machine learning',
      'information theory',
      'optimization',
      'game theory',
      'computational linguistics',
      'speech',
      'computer science',
    ],
  },
  {
    id: 'cs-bio',
    label: 'CS + Bio',
    blurb: 'Computational biology, genomics, neuro, and health AI.',
    anchors: [
      'computational biology',
      'bioinformatics',
      'genomics',
      'computational genomics',
      'statistical genetics',
      'population genetics',
      'systems biology',
      'synthetic biology',
      'single-cell genomics',
      'cancer genomics',
      'biostatistics',
      'biomedical informatics',
      'clinical informatics',
      'computational neuroscience',
      'neuroscience',
      'neuroimaging',
      'neuroai',
      'biophysics',
      'gene regulation',
      'precision medicine',
      'digital health',
      'electronic health records',
      'medical ai',
      'ai for healthcare',
      'ai for health',
      'ai in medicine',
      'biomedical systems',
      'protein',
      'drug discovery',
      'immunology',
      'epidemiology',
    ],
    terms: [
      'health',
      'medicine',
      'clinical',
      'biology',
      'biological',
      'biomedical',
      'disease',
      'cell',
      'molecular',
      'brain',
      'neural circuits',
      'clinical decision support',
    ],
  },
  {
    id: 'cs-robotics',
    label: 'CS + Robotics',
    blurb: 'Robotics, computer vision, control, autonomy, and graphics.',
    anchors: [
      'robotics',
      'computer vision',
      'vision and graphics',
      'control and autonomy',
      'control theory',
      'autonomous systems',
      'autonomy',
      'motion planning',
      'manipulation',
      'perception',
      'slam',
      'graphics',
      'computational imaging',
      'image reconstruction',
      'human-robot interaction',
      'embodied ai',
    ],
    terms: [
      'control',
      'dynamical systems',
      'signal processing',
      'sensors',
      'sensing',
      'vision',
      'navigation',
      'kinematics',
      'actuation',
      'drones',
      'autonomous vehicles',
    ],
  },
  {
    id: 'cs-other',
    label: 'Other areas',
    blurb: 'Statistics, HCI, social and everything not yet its own track.',
    // Deliberately empty: this is where a researcher lands when nothing else
    // claims them, not a track anyone matches into.
    anchors: [],
    terms: [],
  },
];

export const TRACK_IDS = TRACKS.map((t) => t.id);

const FALLBACK_TRACK: TrackId = 'cs-other';

export function getTrack(id: TrackId): Track {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[TRACKS.length - 1];
}

export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && TRACK_IDS.includes(value as TrackId);
}

// ── classification ──────────────────────────────────────────────────────────

const ANCHOR_WEIGHT = 4;
const TERM_WEIGHT = 1;

/**
 * Where each field's vocabulary counts from. Research areas are curated tags
 * and describe what the lab does; a bio is prose that mentions everything the
 * person has ever touched, so it barely counts.
 */
const FIELD_WEIGHTS = { areas: 3, department: 2, title: 1.5, bio: 0.5 } as const;

/** Whole-word containment, so "control" does not match "controlled trial". */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

export interface TrackMatch {
  trackId: TrackId;
  /** Raw score, comparable only against the other tracks for this researcher. */
  score: number;
  /** The vocabulary that earned it, so a placement can be explained or argued with. */
  matchedOn: string[];
}

/**
 * File a researcher under the track that best describes them, with the terms
 * that decided it. Returns every track that scored, strongest first, so the
 * caller can see when a placement was close (a vision person who also does a
 * lot of medical imaging genuinely belongs to two).
 */
export function classifyResearcher(researcher: ResearcherProfile): TrackMatch[] {
  const fields: [string, number][] = [
    [researcher.researchAreas.join(' ; ').toLowerCase(), FIELD_WEIGHTS.areas],
    [(researcher.department ?? '').toLowerCase(), FIELD_WEIGHTS.department],
    [(researcher.title ?? '').toLowerCase(), FIELD_WEIGHTS.title],
    [(researcher.bio ?? '').toLowerCase(), FIELD_WEIGHTS.bio],
  ];

  const matches: TrackMatch[] = [];
  for (const track of TRACKS) {
    let score = 0;
    const matchedOn: string[] = [];
    for (const [vocabulary, weight] of [
      [track.anchors, ANCHOR_WEIGHT] as const,
      [track.terms, TERM_WEIGHT] as const,
    ]) {
      for (const term of vocabulary) {
        for (const [text, fieldWeight] of fields) {
          if (!text || !mentions(text, term)) continue;
          score += weight * fieldWeight;
          matchedOn.push(term);
          // One hit per term. A term repeated across the title and the bio is
          // the same fact stated twice, not twice the evidence.
          break;
        }
      }
    }
    if (score > 0) matches.push({ trackId: track.id, score, matchedOn: [...new Set(matchedOn)].slice(0, 5) });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/** The single track a researcher is filed under. */
export function trackOf(researcher: ResearcherProfile): TrackId {
  return classifyResearcher(researcher)[0]?.trackId ?? FALLBACK_TRACK;
}

/** Group a directory by track, for the counts shown beside each gate. */
export function countByTrack(researchers: ResearcherProfile[]): Record<TrackId, number> {
  const counts = Object.fromEntries(TRACK_IDS.map((id) => [id, 0])) as Record<TrackId, number>;
  for (const r of researchers) counts[trackOf(r)]++;
  return counts;
}

// ── per-user track state (the approval gate) ────────────────────────────────

export interface TrackState {
  trackId: TrackId;
  /** Emails in this track the sender read and sent themselves. */
  reviewedSends: number;
  /** The sender has explicitly turned on autonomous sending for this track. */
  autonomous: boolean;
  /** Reviewed sends required before arming is even offered. */
  unlockAt: number;
  updatedAt: string;
}

/**
 * "We will draft the first couple based on research type." Two is the couple:
 * enough for the sender to see how the track reads and correct it through the
 * standing instructions in preferences.ts, without making them hand-send ten
 * emails before anything is automated.
 */
export const DEFAULT_UNLOCK_AT = 2;

function trackKey(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `tracks:${userId}`;
}

function freshState(trackId: TrackId): TrackState {
  return {
    trackId,
    reviewedSends: 0,
    autonomous: false,
    unlockAt: DEFAULT_UNLOCK_AT,
    updatedAt: new Date().toISOString(),
  };
}

export async function getTrackStates(userId: string): Promise<Record<TrackId, TrackState>> {
  const stored = await readStore<Partial<Record<TrackId, TrackState>> | null>(trackKey(userId), null);
  const states = {} as Record<TrackId, TrackState>;
  for (const id of TRACK_IDS) {
    const saved = stored?.[id];
    states[id] = saved
      ? {
          ...freshState(id),
          ...saved,
          // A stored record predating a field, or hand-edited, must not be
          // able to produce a NaN threshold that compares false forever.
          reviewedSends: Number.isFinite(saved.reviewedSends) ? Math.max(0, Math.floor(saved.reviewedSends)) : 0,
          unlockAt: Number.isFinite(saved.unlockAt) ? Math.max(0, Math.floor(saved.unlockAt)) : DEFAULT_UNLOCK_AT,
          autonomous: saved.autonomous === true,
          trackId: id,
        }
      : freshState(id);
  }
  return states;
}

export async function saveTrackStates(userId: string, states: Record<TrackId, TrackState>): Promise<void> {
  await writeStore(trackKey(userId), states);
}

/**
 * Whether the sender may leave this track unattended. Both halves are
 * required: the track has to have been proven by hand, and the sender has to
 * have said yes. Reaching the threshold never flips it on by itself, because
 * "it has sent two emails" is not consent to send two hundred.
 */
export function canAutoSend(state: TrackState): boolean {
  return state.autonomous && state.reviewedSends >= state.unlockAt;
}

/** Reaching the threshold only means arming is now offered in the UI. */
export function canArm(state: TrackState): boolean {
  return !state.autonomous && state.reviewedSends >= state.unlockAt;
}

/**
 * Record that the sender reviewed and sent one email in this track by hand.
 * Autonomous sends deliberately do not count: the gate measures how much of
 * this track a human has actually read.
 */
export async function recordReviewedSend(userId: string, trackId: TrackId): Promise<TrackState> {
  const states = await getTrackStates(userId);
  const next: TrackState = {
    ...states[trackId],
    reviewedSends: states[trackId].reviewedSends + 1,
    updatedAt: new Date().toISOString(),
  };
  states[trackId] = next;
  await saveTrackStates(userId, states);
  return next;
}

/** Arm or disarm autonomous sending for one track. */
export async function setAutonomous(userId: string, trackId: TrackId, autonomous: boolean): Promise<TrackState> {
  const states = await getTrackStates(userId);
  const state = states[trackId];
  // Arming before the track has been proven is refused here rather than in the
  // UI alone, since the routine runner and the API both come through this.
  if (autonomous && state.reviewedSends < state.unlockAt) {
    throw new Error(
      `Send ${state.unlockAt - state.reviewedSends} more ${getTrack(trackId).label} email(s) yourself before arming this track`
    );
  }
  states[trackId] = { ...state, autonomous, updatedAt: new Date().toISOString() };
  await saveTrackStates(userId, states);
  return states[trackId];
}
