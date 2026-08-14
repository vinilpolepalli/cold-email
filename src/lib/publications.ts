import { Publication, ResearcherProfile, ResearcherWorks } from './types';
import { readStore, writeStore } from './store';

// A researcher's published work, for their profile page and for the paragraph
// in the draft that names something they actually wrote.
//
// Two providers, both free and keyless:
//  - OpenAlex, which disambiguates authors and carries open-access PDF links.
//  - Crossref as a fallback, filtered hard on the author name because its
//    author search is a plain text match and will happily return a different
//    Aaron with a similar surname.
//
// Nothing here throws: a lookup that fails yields an empty record, because a
// profile page without publications is fine and a draft that cites a paper the
// researcher did not write is not.

const OPENALEX = 'https://api.openalex.org';
const CROSSREF = 'https://api.crossref.org';

/** Refresh cadence. Publication lists move slowly; a miss costs a round trip. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A lookup that found nothing is retried sooner, in case indexing catches up. */
const EMPTY_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const MAX_WORKS = 8;
const REQUEST_TIMEOUT_MS = 8000;

/**
 * OpenAlex asks callers to identify themselves in exchange for a faster pool.
 * Optional, like every other external service here.
 */
function politeSuffix(): string {
  const mailto = process.env.OPENALEX_MAILTO;
  return mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';
}

/**
 * Both providers throttle by IP, and a serverless deployment shares one with
 * every other tenant, so a 429 is common and usually clears within a second.
 */
async function getJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Sloan/1.0 (research outreach assistant)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 || attempt === 1) return null;
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return null;
}

// ── name and institution matching ───────────────────────────────────────────

/** Lowercase, strip accents and punctuation, so "Ré-Mi O'Neil" compares cleanly. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
 * Same person? Surnames must match outright. First names must match, or one
 * must be the initial of the other, which covers "A. Sidford" and "Aaron".
 */
function samePerson(a: string, b: string): boolean {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x.last || !y.last || x.last !== y.last) return false;
  if (!x.first || !y.first) return false;
  if (x.first === y.first) return true;
  return x.first.length === 1 || y.first.length === 1 ? x.first[0] === y.first[0] : false;
}

/**
 * Institution names a school is known by in publication metadata. Faculty are
 * routinely indexed under an affiliated hospital or institute rather than the
 * university itself, so each school carries its usual satellites.
 */
const SCHOOL_ALIASES: { match: RegExp; aliases: string[] }[] = [
  { match: /stanford/i, aliases: ['stanford'] },
  {
    match: /harvard/i,
    aliases: ['harvard', 'broad institute', 'massachusetts general', 'brigham and women', "boston children", 'dana-farber', 'beth israel'],
  },
  {
    match: /\bmit\b|massachusetts institute/i,
    aliases: ['massachusetts institute of technology', 'mit ', 'broad institute', 'whitehead institute', 'lincoln laboratory'],
  },
  { match: /princeton/i, aliases: ['princeton'] },
  { match: /penn|wharton|pennsylvania/i, aliases: ['university of pennsylvania', 'pennsylvania', 'wharton', 'perelman', "children's hospital of philadelphia"] },
];

function aliasesFor(school: string): string[] {
  const entry = SCHOOL_ALIASES.find((s) => s.match.test(school));
  return entry ? entry.aliases : [school.toLowerCase()];
}

function affiliationMatches(institutionNames: string[], school: string): boolean {
  const aliases = aliasesFor(school);
  return institutionNames.some((n) => {
    const lower = ` ${n.toLowerCase()} `;
    return aliases.some((a) => lower.includes(a));
  });
}

// ── OpenAlex ────────────────────────────────────────────────────────────────

interface OpenAlexAuthor {
  id?: string;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  last_known_institutions?: { display_name?: string }[];
  affiliations?: { institution?: { display_name?: string } }[];
  topics?: { display_name?: string }[];
}

interface OpenAlexWork {
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  doi?: string | null;
  type?: string | null;
  primary_location?: {
    source?: { display_name?: string | null } | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  locations?: { source?: { display_name?: string | null } | null }[] | null;
  best_oa_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
    source?: { display_name?: string | null } | null;
  } | null;
  open_access?: { oa_url?: string | null; is_oa?: boolean } | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** OpenAlex ships abstracts as a word to positions map; put the words back in order. */
function readAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  const text = words.filter(Boolean).join(' ').trim();
  if (text.length < 40) return null;
  return text.length > 900 ? `${text.slice(0, 897)}...` : text;
}

/**
 * Providers index the preprint, the conference version, and the journal
 * version as separate works. Keep one per title, preferring the record with
 * the most citations and then the one that offers a PDF.
 */
function dedupe(publications: Publication[]): Publication[] {
  const best = new Map<string, Publication>();
  for (const pub of publications) {
    const key = pub.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = best.get(key);
    if (!existing) {
      best.set(key, pub);
      continue;
    }
    const better =
      (pub.citations ?? 0) > (existing.citations ?? 0) ||
      ((pub.citations ?? 0) === (existing.citations ?? 0) && !existing.pdfUrl && Boolean(pub.pdfUrl));
    if (better) best.set(key, { ...pub, pdfUrl: pub.pdfUrl ?? existing.pdfUrl, url: pub.url ?? existing.url });
    else if (!existing.pdfUrl && pub.pdfUrl) best.set(key, { ...existing, pdfUrl: pub.pdfUrl });
  }
  return [...best.values()];
}

/**
 * Pick the OpenAlex author record that is actually our researcher. An
 * institution match is required: name alone routinely collides, and every
 * consumer of this data presents it as "their" work.
 */
function pickAuthor(candidates: OpenAlexAuthor[], researcher: ResearcherProfile): OpenAlexAuthor | null {
  const scored = candidates
    .filter((c) => c.display_name && samePerson(c.display_name, researcher.name))
    .map((c) => {
      const institutions = [
        ...(c.last_known_institutions ?? []).map((i) => i.display_name ?? ''),
        ...(c.affiliations ?? []).map((a) => a.institution?.display_name ?? ''),
      ].filter(Boolean);
      return { author: c, affiliated: affiliationMatches(institutions, researcher.school) };
    })
    .filter((c) => c.affiliated)
    // Among same-name colleagues at one university, the fuller record wins.
    .sort((a, b) => (b.author.works_count ?? 0) - (a.author.works_count ?? 0));
  return scored[0]?.author ?? null;
}

/**
 * Mathematical alphanumeric symbols (U+1D400 and up) are how publishers write
 * italic variables. They render as tofu in a plain-text email, so fold them
 * back to the ASCII letter they stand for.
 */
function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return '';
  if (value >= 0x1d400 && value <= 0x1d7ff) {
    const offset = (value - 0x1d400) % 52;
    return offset < 26 ? String.fromCharCode(65 + offset) : String.fromCharCode(97 + offset - 26);
  }
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/**
 * Titles arrive with publisher markup ("l <sub>1</sub> -regression") and HTML
 * entities. They end up in an email, so flatten them to plain text.
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Publisher metadata carries numeric entities for maths italics and Greek
    // letters, e.g. "&#x1D442;(m sqrt(n))". Decode rather than print the codes.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPublication(work: OpenAlexWork): Publication | null {
  const title = cleanTitle(work.title ?? work.display_name ?? '');
  if (!title) return null;
  const doi = work.doi ? work.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : null;
  const pdfUrl = work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? null;
  const url =
    work.best_oa_location?.landing_page_url ??
    work.open_access?.oa_url ??
    (doi ? `https://doi.org/${doi}` : work.primary_location?.landing_page_url ?? null);
  // Conference papers frequently have no primary source; a later location
  // (the proceedings, or the preprint server) still names where to find it.
  const venue =
    work.primary_location?.source?.display_name ??
    work.best_oa_location?.source?.display_name ??
    (work.locations ?? []).map((l) => l.source?.display_name).find(Boolean) ??
    null;

  return {
    title,
    year: work.publication_year ?? null,
    venue,
    authors: (work.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean).slice(0, 8),
    citations: work.cited_by_count ?? null,
    doi,
    url,
    pdfUrl,
    abstract: readAbstract(work.abstract_inverted_index),
  };
}

async function fromOpenAlex(researcher: ResearcherProfile): Promise<ResearcherWorks | null> {
  const search = encodeURIComponent(researcher.name);
  const authors = await getJson<{ results?: OpenAlexAuthor[] }>(
    `${OPENALEX}/authors?search=${search}&per_page=10${politeSuffix()}`
  );
  if (!authors?.results?.length) return null;

  const author = pickAuthor(authors.results, researcher);
  if (!author?.id) return null;

  const authorId = author.id.replace(/^https?:\/\/openalex\.org\//, '');
  const select =
    'title,display_name,publication_year,cited_by_count,doi,type,primary_location,locations,best_oa_location,open_access,authorships,abstract_inverted_index';
  // Over-fetch: preprint and journal versions of the same paper collapse into
  // one entry below, and asking for exactly MAX_WORKS would leave short lists.
  const works = await getJson<{ results?: OpenAlexWork[] }>(
    `${OPENALEX}/works?filter=author.id:${encodeURIComponent(authorId)}&sort=cited_by_count:desc&per_page=${MAX_WORKS + 6}&select=${select}${politeSuffix()}`
  );

  const publications = dedupe(
    (works?.results ?? []).map(toPublication).filter((p): p is Publication => Boolean(p))
  ).slice(0, MAX_WORKS);

  return {
    researcherId: researcher.id,
    authorName: author.display_name ?? null,
    authorUrl: `https://openalex.org/${authorId}`,
    worksCount: author.works_count ?? null,
    citedByCount: author.cited_by_count ?? null,
    topics: (author.topics ?? []).map((t) => t.display_name ?? '').filter(Boolean).slice(0, 6),
    publications,
    provider: 'openalex',
    fetchedAt: new Date().toISOString(),
  };
}

// ── Crossref fallback ───────────────────────────────────────────────────────

interface CrossrefWork {
  title?: string[];
  DOI?: string;
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  author?: { given?: string; family?: string }[];
  link?: { URL?: string; 'content-type'?: string }[];
  'is-referenced-by-count'?: number;
  abstract?: string;
  type?: string;
}

/** Crossref abstracts arrive as JATS XML; strip the tags. */
function stripJats(abstract: string | undefined): string | null {
  if (!abstract) return null;
  const text = abstract
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*Abstract\s*/i, '')
    .trim();
  if (text.length < 40) return null;
  return text.length > 900 ? `${text.slice(0, 897)}...` : text;
}

async function fromCrossref(researcher: ResearcherProfile): Promise<ResearcherWorks | null> {
  const query = encodeURIComponent(researcher.name);
  const select = 'title,DOI,issued,container-title,author,link,is-referenced-by-count,abstract,type';
  const data = await getJson<{ message?: { items?: CrossrefWork[] } }>(
    `${CROSSREF}/works?query.author=${query}&rows=30&select=${select}&sort=is-referenced-by-count&order=desc`
  );
  const items = data?.message?.items ?? [];

  // Crossref matches on text, so keep only works this person is actually on.
  const mine = items.filter((item) =>
    (item.author ?? []).some((a) => a.family && samePerson(`${a.given ?? ''} ${a.family}`.trim(), researcher.name))
  );
  if (!mine.length) return null;

  const publications: Publication[] = mine.slice(0, MAX_WORKS).map((item) => {
    const doi = item.DOI ?? null;
    const pdf = (item.link ?? []).find((l) => l['content-type'] === 'application/pdf')?.URL ?? null;
    return {
      title: cleanTitle(item.title?.[0] ?? ''),
      year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
      venue: item['container-title']?.[0] ?? null,
      authors: (item.author ?? []).map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim()).filter(Boolean).slice(0, 8),
      citations: item['is-referenced-by-count'] ?? null,
      doi,
      url: doi ? `https://doi.org/${doi}` : null,
      pdfUrl: pdf,
      abstract: stripJats(item.abstract),
    };
  });

  return {
    researcherId: researcher.id,
    authorName: researcher.name,
    authorUrl: null,
    worksCount: null,
    citedByCount: null,
    topics: [],
    publications: dedupe(publications.filter((p) => p.title)),
    provider: 'crossref',
    fetchedAt: new Date().toISOString(),
  };
}

// ── cache ───────────────────────────────────────────────────────────────────

function emptyWorks(researcherId: string): ResearcherWorks {
  return {
    researcherId,
    authorName: null,
    authorUrl: null,
    worksCount: null,
    citedByCount: null,
    topics: [],
    publications: [],
    provider: 'none',
    fetchedAt: new Date().toISOString(),
  };
}

function cacheKey(researcherId: string): string {
  return `pubs:${researcherId}`;
}

function isFresh(cached: ResearcherWorks): boolean {
  const age = Date.now() - Date.parse(cached.fetchedAt);
  if (Number.isNaN(age)) return false;
  return age < (cached.publications.length ? TTL_MS : EMPTY_TTL_MS);
}

/**
 * A researcher's works, cached. Never throws: the store being down or a
 * provider timing out degrades to an empty record.
 */
export async function getPublications(
  researcher: ResearcherProfile,
  opts: { refresh?: boolean } = {}
): Promise<ResearcherWorks> {
  const key = cacheKey(researcher.id);
  let cached: ResearcherWorks | null = null;
  try {
    cached = await readStore<ResearcherWorks | null>(key, null);
  } catch {
    // Cache unavailable; fall through and ask the provider directly.
  }
  if (!opts.refresh && cached && isFresh(cached)) return cached;

  let fresh: ResearcherWorks | null = null;
  try {
    fresh = (await fromOpenAlex(researcher)) ?? (await fromCrossref(researcher));
  } catch {
    fresh = null;
  }

  // An empty answer must not erase a list we already have. A rate limit, a
  // timeout, and a genuinely unindexed researcher are indistinguishable from
  // here, and two of the three are temporary.
  if (!fresh?.publications.length && cached?.publications.length) return cached;

  const result = fresh ?? emptyWorks(researcher.id);

  try {
    await writeStore(key, result);
  } catch {
    // Caching is an optimisation, not a requirement.
  }
  return result;
}

// ── selection ───────────────────────────────────────────────────────────────

const TOPIC_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'using', 'their', 'via', 'are', 'was', 'were',
  'new', 'novel', 'based', 'towards', 'toward', 'study', 'analysis', 'approach', 'method', 'methods', 'model',
  'models', 'data', 'results', 'research', 'system', 'systems', 'use', 'used',
]);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter((w) => w.length > 3 && !TOPIC_STOPWORDS.has(w))
  );
}

/**
 * The paper to name in a draft: the one closest to what the sender works on,
 * with citations and recency breaking ties. Falls back to the most-cited work
 * when nothing overlaps, which is still a real, checkable reference.
 */
export function pickRelevantPublication(works: ResearcherWorks, senderTerms: string[]): Publication | null {
  const candidates = works.publications.filter((p) => p.title);
  if (!candidates.length) return null;

  const wanted = terms(senderTerms.join(' '));
  if (!wanted.size) return candidates[0];

  const currentYear = new Date().getFullYear();
  let best = candidates[0];
  let bestScore = -1;
  for (const pub of candidates) {
    const haystack = terms(`${pub.title} ${pub.venue ?? ''} ${(pub.abstract ?? '').slice(0, 400)}`);
    let overlap = 0;
    for (const w of wanted) if (haystack.has(w)) overlap++;
    // Overlap dominates; a well-cited or recent paper only breaks ties.
    const age = pub.year ? Math.max(0, currentYear - pub.year) : 25;
    const score = overlap * 10 + Math.min(3, Math.log10((pub.citations ?? 0) + 1)) - Math.min(3, age / 10);
    if (score > bestScore) {
      bestScore = score;
      best = pub;
    }
  }
  return best;
}

/** Human-readable citation tail: "Nature, 2021" or just one half of it. */
export function publicationContext(pub: Publication): string {
  return [pub.venue, pub.year ? String(pub.year) : null].filter(Boolean).join(', ');
}
