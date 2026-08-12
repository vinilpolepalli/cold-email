import { ResearcherProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { newId } from './store';

// Agentic university-directory scraper. Given a faculty listing URL it:
//   1. fetches the listing and discovers individual profile links,
//   2. crawls a bounded number of profile pages,
//   3. extracts structured profiles — with the NIM LLM when a key is set,
//      falling back to DOM/text heuristics that handle common directory markup.
// The same pipeline serves /api/scrape (used by the /scrape admin page and the
// CLI in scripts/scrape.mjs).

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PROFILE_LINK_HINTS = ['people', 'faculty', 'profile', 'person', 'directory', '~'];

export interface ScrapeOptions {
  school?: string;
  maxPages?: number;
  nimAuth?: NimAuth;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'cold-email-research-scraper/1.0 (+academic outreach demo)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function stripHtml(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const href = new URL(m[1], baseUrl).toString();
      links.push({ href, text: stripHtml(m[2]).trim() });
    } catch {
      // ignore malformed hrefs
    }
  }
  return links;
}

function looksLikeName(text: string): boolean {
  const t = text.trim();
  return (
    t.length > 4 &&
    t.length < 60 &&
    /^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(t) &&
    !/(university|institute|department|school|faculty|research|professor)/i.test(t)
  );
}

function discoverProfileLinks(html: string, baseUrl: string, limit: number): { href: string; text: string }[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const out: { href: string; text: string }[] = [];
  for (const link of extractLinks(html, baseUrl)) {
    const url = new URL(link.href);
    if (url.host !== base.host) continue;
    if (url.pathname === base.pathname) continue;
    const hintMatch = PROFILE_LINK_HINTS.some((h) => url.pathname.toLowerCase().includes(h));
    if (!hintMatch && !looksLikeName(link.text)) continue;
    if (!looksLikeName(link.text)) continue;
    if (seen.has(url.toString())) continue;
    seen.add(url.toString());
    out.push({ href: url.toString(), text: link.text.trim() });
    if (out.length >= limit) break;
  }
  return out;
}

function heuristicProfileFromPage(html: string, url: string, school: string, nameHint?: string): Omit<ResearcherProfile, 'id'> | null {
  const text = stripHtml(html);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = (h1 ? stripHtml(h1[1]) : '') || nameHint || '';
  if (!name || !looksLikeName(name)) return null;

  const mailto = html.match(/mailto:([^"'?]+)/i);
  const emails = text.match(EMAIL_RE) ?? [];
  const email = (mailto ? mailto[1] : emails[0]) ?? null;

  const titleLine = lines.find((l) => /\b(professor|prof\.|lecturer|scientist|fellow|chair|director)\b/i.test(l) && l.length < 120);

  let researchAreas: string[] = [];
  const interestsIdx = lines.findIndex((l) => /research (interests|areas|focus)/i.test(l));
  if (interestsIdx !== -1) {
    const source = lines[interestsIdx].replace(/.*research (interests|areas|focus)\s*:?/i, '').trim() || lines[interestsIdx + 1] || '';
    researchAreas = source
      .split(/[,;•·]/)
      .map((s) => s.replace(/\.$/, '').trim().toLowerCase())
      .filter((s) => s.length > 2 && s.length < 60)
      .slice(0, 6);
  }

  const bioLine = lines.find(
    (l) => l.length > 80 && !l.includes('@') && l !== titleLine && !/research (interests|areas|focus)/i.test(l)
  );

  const deptLine = lines.find((l) => /\b(department|school|institute) of\b/i.test(l) && l.length < 90);

  return {
    name,
    title: titleLine ?? 'Faculty',
    school,
    department: deptLine ?? school,
    email: email ? email.trim() : null,
    website: url,
    researchAreas,
    bio: bioLine ? bioLine.slice(0, 300) : null,
    sourceUrl: url,
  };
}

async function nimExtractProfiles(
  pageText: string,
  url: string,
  school: string,
  nimAuth?: NimAuth
): Promise<Omit<ResearcherProfile, 'id'>[]> {
  const reply = await nimChat(
    [
      {
        role: 'system',
        content:
          'You extract faculty research profiles from university web page text. Reply ONLY with JSON: {"profiles":[{"name","title","department","email","researchAreas":[],"bio"}]}. Rules: include only real people present in the text; email null unless it literally appears in the text; bio max 2 sentences; researchAreas 2-6 short lowercase tags. Empty array if no faculty found.',
      },
      { role: 'user', content: `School: ${school}\nSource: ${url}\n\nPAGE TEXT:\n${pageText.slice(0, 12000)}` },
    ],
    { temperature: 0.1, maxTokens: 1500 },
    nimAuth
  );
  const parsed = extractJson<{ profiles: Array<Partial<ResearcherProfile>> }>(reply);
  return (parsed.profiles ?? [])
    .filter((p): p is Partial<ResearcherProfile> & { name: string } => Boolean(p.name))
    .map((p) => ({
      name: p.name,
      title: p.title ?? 'Faculty',
      school,
      department: p.department ?? school,
      email: p.email ?? null,
      website: url,
      researchAreas: Array.isArray(p.researchAreas) ? p.researchAreas.slice(0, 6) : [],
      bio: p.bio ?? null,
      sourceUrl: url,
    }));
}

export async function scrapeUniversity(listingUrl: string, opts: ScrapeOptions = {}): Promise<{ profiles: ResearcherProfile[]; pagesVisited: number; extractor: 'nim' | 'heuristic' }> {
  const school = opts.school?.trim() || new URL(listingUrl).hostname;
  const maxPages = Math.min(opts.maxPages ?? 12, 25);
  const useNim = nimAvailable(opts.nimAuth);

  const listingHtml = await fetchPage(listingUrl);
  const results = new Map<string, Omit<ResearcherProfile, 'id'>>();
  let pagesVisited = 1;

  const keyOf = (p: { name: string }) => p.name.toLowerCase().replace(/[^a-z]/g, '');
  const record = (p: Omit<ResearcherProfile, 'id'> | null) => {
    if (!p) return;
    const key = keyOf(p);
    const existing = results.get(key);
    // Prefer the entry with an email, then the one with more research areas.
    if (!existing || (!existing.email && p.email) || (existing.email === p.email && p.researchAreas.length > existing.researchAreas.length)) {
      results.set(key, { ...existing, ...p, email: p.email ?? existing?.email ?? null });
    }
  };

  // Pass 1: extract whatever the listing page itself contains.
  if (useNim) {
    try {
      (await nimExtractProfiles(stripHtml(listingHtml), listingUrl, school, opts.nimAuth)).forEach(record);
    } catch {
      // NIM hiccup — heuristics below still run
    }
  }

  // Pass 2: crawl individual profile pages.
  const profileLinks = discoverProfileLinks(listingHtml, listingUrl, maxPages - 1);
  for (const link of profileLinks) {
    try {
      const html = await fetchPage(link.href);
      pagesVisited++;
      const heuristic = heuristicProfileFromPage(html, link.href, school, link.text);
      if (useNim) {
        try {
          const fromNim = await nimExtractProfiles(stripHtml(html).slice(0, 8000), link.href, school, opts.nimAuth);
          if (fromNim[0]) {
            record({ ...fromNim[0], website: link.href, email: fromNim[0].email ?? heuristic?.email ?? null });
            continue;
          }
        } catch {
          // fall back to heuristic for this page
        }
      }
      record(heuristic);
    } catch {
      // skip unreachable profile pages
    }
  }

  const profiles = [...results.values()].map((p) => ({
    ...p,
    id: newId('res'),
    scrapedFrom: listingUrl,
  }));
  return { profiles, pagesVisited, extractor: useNim ? 'nim' : 'heuristic' };
}
