import { ResearcherProfile } from '../types';
import { readStore, writeStore } from '../store';
import { extractLinks, stripHtml } from '../scraper';
import { isPublicHttpUrl } from '../contacts';

// Finds the published address for a professor we hold no address for.
//
// 150 of the 794 directory entries have an empty email field, almost always
// because the page they were scraped from does not print one. The address
// usually exists somewhere else: a department listing, a lab site, a personal
// page. This agent goes looking, one professor at a time.
//
// The one rule that matters, and the reason this is not a two-line function:
// an address is only ever *read off a page*, never built from a name and a
// domain. Guessing firstname.lastname@stanford.edu would be right often enough
// to feel clever and wrong often enough to mail a stranger a student's resume.
// On top of that, every candidate has to look like it belongs to this person,
// because the single address printed on a professor's own page is frequently
// their assistant's.

const FETCH_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; SloanBot/1.0; academic directory backfill)';

/** Pages opened per professor before giving up. Keeps one run bounded. */
const MAX_PAGES_PER_RESEARCHER = 8;

/** Courtesy gap between requests to the same host. */
const HOST_DELAY_MS = 350;

const ROLE_ACCOUNT =
  /^(?:webmaster|postmaster|no-?reply|donotreply|privacy|accessibility|help|support|helpdesk|it|security|abuse|legal|hr|jobs|careers|apply|admissions|giving|alumni|press|media|news|marketing|comms|events|feedback|info|contact|inquiries|general|office|mail|email|admin|operations)@/i;

// Local part must start and end alphanumeric, or "(see jane@x.edu)" yields an
// address with punctuation glued on that bounces when it is used.
const ADDRESS_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Sub-pages of a lab site worth opening when hunting for a contact. */
const CONTACT_HINTS = /\b(contact|people|about|team|members|lab|group|bio|cv|home)\b/i;

// ── name and address matching (ported from scripts/backfill-emails.mjs) ─────

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameParts(name: string): { first: string; last: string } {
  const parts = normalizeName(name).split(' ').filter(Boolean);
  return { first: parts[0] ?? '', last: parts[parts.length - 1] ?? '' };
}

/**
 * Does this address plausibly belong to this person? University local parts
 * are built from a name in a handful of predictable ways, and requiring one of
 * them is what keeps a colleague's address off the wrong record.
 *
 * The omissions here are deliberate and were each paid for by a bad result:
 * there is no "surname plus one more letter" rule, because it accepted
 * rivest@mit.edu for Alex Rives, and proximity on a page is never sufficient
 * on its own, because the only address on Amin Saberi's profile belongs to the
 * assistant who handles his scheduling.
 */
export function addressMatchesName(email: string, name: string): boolean {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const { first, last } = nameParts(name);
  if (!first || !last) return false;

  const candidates = [
    `${first}${last}`,
    `${first[0]}${last}`,
    `${first}${last[0]}`,
    first,
    last,
    `${last}${first[0]}`,
    `${first[0]}${last[0]}`,
  ];
  if (candidates.some((c) => c.length > 2 && local === c)) return true;

  // Initials around the surname: "amnewman" is Aaron M Newman.
  if (local.length === last.length + 2 && local[0] === first[0] && local.slice(2) === last) return true;
  if (local.length === last.length + 1 && local[0] === first[0] && local.slice(1) === last) return true;
  // Truncations: "andrewg" for Andrew Gentles.
  if (local.startsWith(first) && local.length >= first.length + 1 && last.startsWith(local.slice(first.length))) {
    return true;
  }
  // A prefix of the surname is fine; the surname plus extra tokens is not,
  // which is how "covert.lab" was being read as Markus Covert's own address.
  if (last.length >= 5 && last.startsWith(local) && local.length >= 5) return true;

  return false;
}

/**
 * Institutional addresses only. A lab's shared gmail is published on plenty of
 * official pages, but it is the lab's mailbox rather than the professor's.
 */
function isInstitutional(email: string): boolean {
  return (email.split('@')[1] ?? '').endsWith('.edu');
}

/** "jane [at] stanford [dot] edu" is still an address the page chose to show. */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+@\s+/g, '@');
}

/**
 * The address on this page that belongs to this person, or null. Ranked by how
 * close it sits to their name, but only ever chosen from addresses whose local
 * part is built from the name.
 */
export function pickForPerson(text: string, name: string): { email: string; distance: number } | null {
  const clean = deobfuscate(text);
  const lower = clean.toLowerCase();
  const { first, last } = nameParts(name);
  const full = lower.indexOf(`${first} ${last}`);
  const anchor = full !== -1 ? full : lower.indexOf(last);

  const found: { email: string; distance: number }[] = [];
  ADDRESS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ADDRESS_RE.exec(clean))) {
    const email = match[0].toLowerCase();
    if (ROLE_ACCOUNT.test(email) || !isInstitutional(email)) continue;
    if (!addressMatchesName(email, name)) continue;
    found.push({ email, distance: anchor === -1 ? Number.POSITIVE_INFINITY : Math.abs(match.index - anchor) });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.distance - b.distance);
  return found[0];
}

// ── where to look ───────────────────────────────────────────────────────────

/**
 * Directory hosts per school that are known to print addresses. Hints, not the
 * whole strategy: the researcher's own website and source page are tried first
 * and find most of what is findable.
 */
const SCHOOL_DIRECTORIES: Record<string, string[]> = {
  Stanford: ['https://profiles.stanford.edu', 'https://med.stanford.edu/profiles'],
  MIT: ['https://www.eecs.mit.edu/people', 'https://www.csail.mit.edu/people'],
  Harvard: ['https://www.seas.harvard.edu/faculty', 'https://connects.catalyst.harvard.edu'],
  Princeton: ['https://www.cs.princeton.edu/people/faculty'],
  Penn: ['https://directory.seas.upenn.edu'],
};

/** Slugged name forms departments use in person-page URLs. */
function nameSlugs(name: string): string[] {
  const { first, last } = nameParts(name);
  if (!first || !last) return [];
  return [`${first}-${last}`, `${first}${last}`, `${first}.${last}`, `${first[0]}${last}`, last];
}

/**
 * Person-page URLs worth trying on a host we already know publishes this
 * person. Constructing a *URL* is free: a wrong guess 404s and costs one
 * request. Constructing an *address* is not, which is why that never happens.
 */
function personPageGuesses(host: string, name: string): string[] {
  const out: string[] = [];
  for (const slug of nameSlugs(name)) {
    for (const prefix of ['people', 'faculty', 'profiles', 'profile', 'directory', 'person']) {
      out.push(`${host.replace(/\/+$/, '')}/${prefix}/${slug}`);
    }
  }
  return out;
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

// ── the hunt ────────────────────────────────────────────────────────────────

export interface EmailHunt {
  researcherId: string;
  name: string;
  school: string;
  /** The address, when one was both found and verified against the name. */
  email: string | null;
  /** The page it was read from, which is the evidence for it. */
  foundOn: string | null;
  pagesChecked: string[];
  status: 'found' | 'not-found';
  triedAt: string;
  /** How many separate runs have looked for this person. */
  attempts: number;
}

function huntKey(researcherId: string): string {
  return `emailhunt:${researcherId}`;
}

function discoveredKey(researcherId: string): string {
  return `email:${researcherId}`;
}

/** An address this agent found, merged over the checked-in directory on read. */
export interface DiscoveredEmail {
  researcherId: string;
  email: string;
  /** The page the address was printed on. */
  sourceUrl: string;
  discoveredAt: string;
}

export async function getHuntRecord(researcherId: string): Promise<EmailHunt | null> {
  try {
    return await readStore<EmailHunt | null>(huntKey(researcherId), null);
  } catch {
    return null;
  }
}

/**
 * Look for one professor's published address.
 *
 * Order matters: their own lab site first (most likely to print it and most
 * likely to be current), then the page we originally scraped them from, then
 * the sub-pages a lab site keeps contact details on, then the school's central
 * directory. The search stops the moment a name-matched address turns up.
 */
export async function huntEmail(researcher: ResearcherProfile): Promise<EmailHunt> {
  const previous = await getHuntRecord(researcher.id);
  const pagesChecked: string[] = [];
  const seen = new Set<string>();

  const finish = async (email: string | null, foundOn: string | null): Promise<EmailHunt> => {
    const record: EmailHunt = {
      researcherId: researcher.id,
      name: researcher.name,
      school: researcher.school,
      email,
      foundOn,
      pagesChecked,
      status: email ? 'found' : 'not-found',
      triedAt: new Date().toISOString(),
      attempts: (previous?.attempts ?? 0) + 1,
    };
    await writeStore(huntKey(researcher.id), record);
    if (email && foundOn) {
      const discovered: DiscoveredEmail = {
        researcherId: researcher.id,
        email,
        sourceUrl: foundOn,
        discoveredAt: record.triedAt,
      };
      await writeStore(discoveredKey(researcher.id), discovered);
    }
    return record;
  };

  /** Read one page and check it. Returns the address when this page had it. */
  const check = async (url: string): Promise<string | null> => {
    if (seen.has(url) || pagesChecked.length >= MAX_PAGES_PER_RESEARCHER) return null;
    seen.add(url);
    const html = await fetchPage(url);
    await wait(HOST_DELAY_MS);
    pagesChecked.push(url);
    if (!html) return null;

    // Linked addresses and printed ones both count; mailto is checked first
    // because a page that links an address is unambiguous about owning it.
    const mailtos = [...html.matchAll(/mailto:([^"'?<>\s]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase());
    for (const address of mailtos) {
      if (!ROLE_ACCOUNT.test(address) && isInstitutional(address) && addressMatchesName(address, researcher.name)) {
        return address;
      }
    }
    return pickForPerson(stripHtml(html), researcher.name)?.email ?? null;
  };

  // 1. Their own site and the page we scraped them from.
  const primary = [researcher.website, researcher.sourceUrl].filter(Boolean) as string[];
  for (const url of primary) {
    const hit = await check(url);
    if (hit) return finish(hit, url);
  }

  // 2. Contact-ish sub-pages of their own site.
  for (const url of primary) {
    if (pagesChecked.length >= MAX_PAGES_PER_RESEARCHER) break;
    const html = await fetchPage(url);
    if (!html) continue;
    const subPages = extractLinks(html, url)
      .filter((link) => {
        try {
          return new URL(link.href).host === new URL(url).host && CONTACT_HINTS.test(link.href + ' ' + link.text);
        } catch {
          return false;
        }
      })
      .slice(0, 4);
    for (const link of subPages) {
      const hit = await check(link.href);
      if (hit) return finish(hit, link.href);
    }
  }

  // 3. The school's central directory, and person-page URLs on it.
  for (const host of SCHOOL_DIRECTORIES[researcher.school] ?? []) {
    if (pagesChecked.length >= MAX_PAGES_PER_RESEARCHER) break;
    for (const guess of personPageGuesses(host, researcher.name).slice(0, 4)) {
      const hit = await check(guess);
      if (hit) return finish(hit, guess);
    }
  }

  return finish(null, null);
}

// ── reading the results back ────────────────────────────────────────────────

/**
 * Every address this agent has found, keyed by researcher id. Merged over the
 * checked-in directory by profiles.ts, so a discovered address is usable
 * immediately without a commit — data/profiles.json is read-only at runtime
 * and is not even writable on a serverless host.
 */
export async function getDiscoveredEmails(): Promise<Map<string, DiscoveredEmail>> {
  const { listStore } = await import('../store');
  try {
    const rows = await listStore<DiscoveredEmail>('email');
    return new Map(rows.filter((r) => r?.researcherId && r.email).map((r) => [r.researcherId, r]));
  } catch {
    return new Map();
  }
}

/** Hunt records for every professor the agent has already looked for. */
export async function getHuntRecords(): Promise<Map<string, EmailHunt>> {
  const { listStore } = await import('../store');
  try {
    const rows = await listStore<EmailHunt>('emailhunt');
    return new Map(rows.filter((r) => r?.researcherId).map((r) => [r.researcherId, r]));
  } catch {
    return new Map();
  }
}

/**
 * How long to leave a professor alone after a fruitless search. Departments do
 * republish pages, so a miss is not permanent, but re-crawling the same eight
 * pages nightly is just noise on somebody's web server.
 */
const RETRY_AFTER_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Who is worth looking for on this run: no address yet, and either never tried
 * or tried long enough ago to be worth another go. Ordered by how many times
 * we have already tried, so nobody is retried while others are untouched.
 */
export async function huntCandidates(
  researchers: ResearcherProfile[],
  limit: number
): Promise<ResearcherProfile[]> {
  const hunts = await getHuntRecords();
  const now = Date.now();

  return researchers
    .filter((r) => !r.email)
    .map((r) => ({ researcher: r, hunt: hunts.get(r.id) }))
    .filter(({ hunt }) => {
      if (!hunt) return true;
      if (hunt.status === 'found') return false;
      const age = now - Date.parse(hunt.triedAt);
      return !Number.isFinite(age) || age > RETRY_AFTER_MS;
    })
    .sort((a, b) => (a.hunt?.attempts ?? 0) - (b.hunt?.attempts ?? 0))
    .slice(0, limit)
    .map(({ researcher }) => researcher);
}
