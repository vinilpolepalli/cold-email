import { ResearcherProfile } from '../types';
import { listStore, readStore, writeStore } from '../store';
import { extractLinks, stripHtml } from '../scraper';
import { isPublicHttpUrl } from '../contacts';

// Reads a lab's own pages for whether they are actually looking for anyone.
//
// This exists for two reasons, and the second is the more important one.
//
// The first: a professor who has just written "I am looking for undergraduate
// researchers for the spring" is a far better use of an email than one who has
// not, and the sentence itself gives the draft something real to open with.
//
// The second: plenty of faculty write the opposite, in plain words, at the top
// of their page. "I am not taking new students this year." Emailing them anyway
// is not a neutral act. It wastes the sender's limited credibility and it
// annoys someone who went to the trouble of saying so. A closed stance
// therefore pushes a professor down the queue rather than merely failing to
// push them up.

const FETCH_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; SloanBot/1.0; academic opportunity check)';
const MAX_PAGES = 5;
const HOST_DELAY_MS = 350;

/** Pages on a lab site where a recruiting note is normally kept. */
const OPPORTUNITY_PAGE_HINTS =
  /\b(join|joining|opportunit\w*|position\w*|openings?|hiring|prospective|apply|recruit\w*|students?|people|lab|group|contact|home)\b/i;

export type OpportunityKind = 'phd' | 'undergrad' | 'intern' | 'postdoc' | 'general';

/**
 * Phrases that mean somebody is wanted. Kept as explicit patterns rather than
 * handed to a model, because this decides who gets emailed and a quiet
 * hallucination here is expensive.
 */
const OPEN_PATTERNS: { kind: OpportunityKind; re: RegExp }[] = [
  { kind: 'phd', re: /\b(?:am|are|i'?m)\s+(?:currently\s+)?(?:actively\s+)?(?:looking for|recruiting|seeking|accepting)[^.!?]{0,60}\b(?:phd|doctoral|graduate)\s+students?/i },
  { kind: 'phd', re: /\b(?:accepting|recruiting|taking)\s+(?:new\s+)?(?:phd|doctoral|graduate)\s+students?/i },
  { kind: 'undergrad', re: /\b(?:looking for|recruiting|seeking|accepting|welcome)[^.!?]{0,60}\bundergraduate?s?\b/i },
  { kind: 'undergrad', re: /\bundergraduate\s+(?:research\s+)?(?:opportunit|position|assistant|researcher)\w*/i },
  { kind: 'intern', re: /\b(?:summer\s+)?(?:intern(?:ship)?s?|reu)\b[^.!?]{0,40}\b(?:available|open|apply|position)/i },
  { kind: 'intern', re: /\b(?:reu|summer\s+research)\s+program\b/i },
  { kind: 'postdoc', re: /\b(?:post-?doc\w*)\b[^.!?]{0,60}\b(?:position|opening|available|hiring|seeking|recruiting)/i },
  { kind: 'general', re: /\b(?:we\s+are|i\s+am)\s+hiring\b/i },
  { kind: 'general', re: /\b(?:openings?|positions?)\s+(?:are\s+)?available\b/i },
  { kind: 'general', re: /\bjoin\s+(?:the\s+|our\s+|my\s+)?(?:lab|group|team)\b/i },
  { kind: 'general', re: /\bprospective\s+students?\b/i },
];

/**
 * Phrases that mean the door is shut. Checked before the open patterns and
 * allowed to win, because "I am not currently accepting students" contains
 * "accepting students" and would otherwise read as an invitation.
 */
const CLOSED_PATTERNS: RegExp[] = [
  /\b(?:not|no longer|won'?t be)\s+(?:currently\s+)?(?:be\s+)?(?:accepting|taking|recruiting|admitting|looking for|seeking)\b[^.!?]{0,50}\b(?:students?|postdocs?|applicants?)/i,
  /\bi\s+(?:am|'m)\s+not\s+(?:currently\s+)?(?:accepting|taking|recruiting)\b/i,
  /\bno\s+(?:new\s+)?(?:openings?|positions?|vacancies)\b/i,
  /\bnot\s+(?:currently\s+)?hiring\b/i,
  /\b(?:unable|not able)\s+to\s+(?:take|accept|respond to)\b[^.!?]{0,40}\b(?:students?|requests?|inquir\w*)/i,
  /\bdo\s+not\s+email\s+me\b/i,
];

export interface OpportunityEvidence {
  /** The sentence as the page actually wrote it. Never paraphrased: a draft
   *  that quotes this has to be quoting something real. */
  quote: string;
  url: string;
}

export interface OpportunitySignal {
  researcherId: string;
  /** open: actively wants people. closed: has said not to ask. unknown: silent. */
  stance: 'open' | 'closed' | 'unknown';
  kinds: OpportunityKind[];
  evidence: OpportunityEvidence[];
  pagesChecked: string[];
  checkedAt: string;
}

const MAX_QUOTE = 240;

function signalKey(researcherId: string): string {
  return `opportunity:${researcherId}`;
}

async function fetchPage(url: string): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The sentence a match sits inside, trimmed to something quotable. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  const dot = text.indexOf('.', index);
  const end = dot === -1 ? Math.min(text.length, index + MAX_QUOTE) : Math.min(dot + 1, index + MAX_QUOTE);
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE);
}

/** Read one page's stance. Closed wins over open wherever both appear. */
function readPage(text: string, url: string): { stance: 'open' | 'closed' | 'unknown'; kinds: OpportunityKind[]; evidence: OpportunityEvidence[] } {
  const evidence: OpportunityEvidence[] = [];

  for (const re of CLOSED_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      return { stance: 'closed', kinds: [], evidence: [{ quote: sentenceAround(text, match.index), url }] };
    }
  }

  const kinds = new Set<OpportunityKind>();
  for (const { kind, re } of OPEN_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    kinds.add(kind);
    if (evidence.length < 3) evidence.push({ quote: sentenceAround(text, match.index), url });
  }

  return kinds.size
    ? { stance: 'open', kinds: [...kinds], evidence }
    : { stance: 'unknown', kinds: [], evidence: [] };
}

/**
 * Check one professor's pages. Their own site first, then the handful of
 * sub-pages a lab keeps a recruiting note on. Stops early on a closed stance:
 * once somebody has said no, there is nothing further to learn.
 */
export async function checkOpportunities(researcher: ResearcherProfile): Promise<OpportunitySignal> {
  const pagesChecked: string[] = [];
  const evidence: OpportunityEvidence[] = [];
  const kinds = new Set<OpportunityKind>();
  let stance: OpportunitySignal['stance'] = 'unknown';

  const roots = [researcher.website, researcher.sourceUrl].filter(Boolean) as string[];
  const queue: string[] = [...roots];
  const seen = new Set<string>();

  // Widen from the lab's front page to its "join us" style sub-pages.
  for (const root of roots) {
    const html = await fetchPage(root);
    if (!html) continue;
    for (const link of extractLinks(html, root)) {
      if (queue.length >= MAX_PAGES + roots.length) break;
      try {
        if (new URL(link.href).host !== new URL(root).host) continue;
      } catch {
        continue;
      }
      if (OPPORTUNITY_PAGE_HINTS.test(`${link.href} ${link.text}`)) queue.push(link.href);
    }
  }

  for (const url of queue) {
    if (pagesChecked.length >= MAX_PAGES) break;
    if (seen.has(url)) continue;
    seen.add(url);

    const html = await fetchPage(url);
    await wait(HOST_DELAY_MS);
    pagesChecked.push(url);
    if (!html) continue;

    const page = readPage(stripHtml(html), url);
    if (page.stance === 'closed') {
      stance = 'closed';
      evidence.length = 0;
      evidence.push(...page.evidence);
      kinds.clear();
      break;
    }
    if (page.stance === 'open') {
      stance = 'open';
      page.kinds.forEach((k) => kinds.add(k));
      for (const e of page.evidence) if (evidence.length < 4) evidence.push(e);
    }
  }

  const signal: OpportunitySignal = {
    researcherId: researcher.id,
    stance,
    kinds: [...kinds],
    evidence,
    pagesChecked,
    checkedAt: new Date().toISOString(),
  };
  await writeStore(signalKey(researcher.id), signal);
  return signal;
}

export async function getOpportunity(researcherId: string): Promise<OpportunitySignal | null> {
  try {
    return await readStore<OpportunitySignal | null>(signalKey(researcherId), null);
  } catch {
    return null;
  }
}

export async function getOpportunities(): Promise<Map<string, OpportunitySignal>> {
  try {
    const rows = await listStore<OpportunitySignal>('opportunity');
    return new Map(rows.filter((r) => r?.researcherId).map((r) => [r.researcherId, r]));
  } catch {
    return new Map();
  }
}

/**
 * A recruiting note goes stale: "looking for students for Fall 2025" stops
 * being true. Rechecked monthly, and sooner for the labs that said yes, since
 * those are the ones a draft will quote.
 */
const RECHECK_OPEN_MS = 21 * 24 * 60 * 60 * 1000;
const RECHECK_OTHER_MS = 45 * 24 * 60 * 60 * 1000;

export function isStale(signal: OpportunitySignal | undefined | null): boolean {
  if (!signal) return true;
  const age = Date.now() - Date.parse(signal.checkedAt);
  if (!Number.isFinite(age)) return true;
  return age > (signal.stance === 'open' ? RECHECK_OPEN_MS : RECHECK_OTHER_MS);
}

/** Who to check on this run: never checked, or checked long enough ago. */
export async function opportunityCandidates(
  researchers: ResearcherProfile[],
  limit: number
): Promise<ResearcherProfile[]> {
  const signals = await getOpportunities();
  return researchers
    .filter((r) => (r.website || r.sourceUrl) && isStale(signals.get(r.id)))
    .slice(0, limit);
}

/**
 * How a stance moves a professor in the queue. Open is a strong pull forward;
 * closed is a hard push back rather than a block, so somebody the sender
 * specifically wants is still reachable by hand from the compose screen.
 */
export function opportunityWeight(signal: OpportunitySignal | undefined | null): number {
  if (!signal) return 1;
  if (signal.stance === 'open') return 1.6;
  if (signal.stance === 'closed') return 0.15;
  return 1;
}
