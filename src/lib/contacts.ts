import { ContactLookup, LabContact, ResearcherProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';
import { readStore, writeStore } from './store';
import { extractLinks, fetchPage, stripHtml } from './scraper';

// Who else belongs on the email. A cold email to a professor often reaches
// them faster through the person who manages their calendar, and a lab manager
// or postdoc running the project is frequently the one who actually replies.
//
// Addresses come only from mailto links on pages we fetched. Nothing is
// constructed from a name and a domain: guessing wrong means a stranger gets a
// student's resume, and guessing right is still an address nobody published.

const MAX_PAGES = 4;
const MAX_CONTACTS = 8;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Sub-pages worth opening from a lab's front page. */
const CONTACT_PAGE_HINTS = /\b(contact|people|members|team|staff|lab|group|about|directory|administration)\b/i;

const ADMIN_ROLE =
  /\b(administrat\w*|assistant to|executive assistant|faculty assistant|admin(?:istrative)? (?:assistant|coordinator|associate)|coordinator|program manager|office manager|department manager|secretary|scheduler|chief of staff)\b/i;

const LAB_ROLE =
  /\b(lab manager|laboratory manager|research (?:scientist|associate|assistant|engineer|specialist|technician)|postdoc\w*|post-doctoral|staff scientist|senior scientist|graduate student|phd (?:student|candidate)|doctoral (?:student|candidate)|principal investigator|co-investigator)\b/i;

/**
 * Addresses that appear on nearly every university page and belong to nobody
 * on the team. Copying a student's cold email to the webmaster is noise at
 * best, and to a privacy or accessibility inbox it is a small embarrassment.
 */
const ROLE_ACCOUNT =
  /^(?:webmaster|postmaster|no-?reply|donotreply|privacy|accessibility|ada|help|support|helpdesk|it|itsupport|security|abuse|legal|copyright|hr|jobs|careers|apply|admissions|giving|alumni|press|media|news|marketing|comms|communications|events|webteam|feedback|info|contact|inquiries|enquiries|general|office|mail|email|test)@/i;

/** Fetch only public web hosts: a scraped profile can carry any URL. */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    // Literal private and loopback ranges. Hostnames that resolve to them are
    // out of scope here; these pages come from our own directory.
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '::1' || host.startsWith('[')) return false;
    return true;
  } catch {
    return false;
  }
}

function classify(role: string | null, context: string): LabContact['kind'] | null {
  const haystack = `${role ?? ''} ${context}`;
  if (ADMIN_ROLE.test(haystack)) return 'admin';
  if (LAB_ROLE.test(haystack)) return 'lab';
  return null;
}

function looksLikePersonName(text: string): boolean {
  const t = text.trim();
  return (
    t.length > 3 &&
    t.length < 60 &&
    /^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]*\.?){1,3}$/.test(t) &&
    !/(university|institute|department|school|faculty|laboratory|center|centre)/i.test(t)
  );
}

/**
 * Read the name and job title sitting next to an address. Lab pages almost
 * always write them as "Jenna Feugill, Administrative Assistant", so the role
 * keyword is the anchor: the title runs forward from it and the name runs
 * backward.
 */
function describeNear(context: string): { name: string | null; role: string | null } {
  const match = ADMIN_ROLE.exec(context) ?? LAB_ROLE.exec(context);
  if (!match) return { name: null, role: null };
  const index = context.toLowerCase().indexOf(match[0].toLowerCase());

  // Forward to the first separator: a phone number or the next person's name
  // would otherwise be swept into the job title.
  const role =
    context
      .slice(index, index + 90)
      .split(/[.|•·\n]|\s{2,}/)[0]
      .replace(/\s+/g, ' ')
      .trim() || null;

  const before = context.slice(Math.max(0, index - 90), index).replace(/[,\s–-]+$/, '');
  const candidate = before.match(/([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*\.?){1,3})$/)?.[1];
  return { name: candidate && looksLikePersonName(candidate) ? candidate : null, role };
}

/**
 * Pull every published address off one page, with whatever name and role sit
 * next to it. Works on the raw HTML rather than the stripped text so the
 * anchor's own label is available: on most lab pages that label is the name.
 */
// The local part must start and end alphanumeric. Without the anchors, a page
// reading "email: .jane@mit.edu" or "(see jane@mit.edu)" yields an address
// with punctuation glued to it, which then bounces when the email is sent.
const ADDRESS_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Academic pages hide addresses from scrapers by writing "jane [at] mit [dot]
 * edu". A person reading the page has no trouble with it, and the address is
 * still one the lab chose to publish, so undo the substitution before looking.
 * Only bracketed forms are decoded: a bare " at " is ordinary prose.
 */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+@\s+/g, '@');
}

/** Addresses printed as plain text rather than linked. */
function contactsFromText(text: string, url: string, researcher: ResearcherProfile): LabContact[] {
  const found: LabContact[] = [];
  const clean = deobfuscate(text);
  let match: RegExpExecArray | null;
  ADDRESS_RE.lastIndex = 0;

  while ((match = ADDRESS_RE.exec(clean))) {
    const email = match[0].trim().toLowerCase();
    if (ROLE_ACCOUNT.test(email)) continue;
    if (researcher.email && email === researcher.email.toLowerCase()) continue;

    const before = clean.slice(Math.max(0, match.index - 300), match.index);
    const context = `${before}\n${clean.slice(ADDRESS_RE.lastIndex, ADDRESS_RE.lastIndex + 160)}`;
    const { name, role } = describeNear(context);
    const kind = classify(role, context);
    if (!kind) continue;

    const fallbackName =
      before.split('\n').map((l) => l.trim()).filter(Boolean).slice(-4).reverse().find(looksLikePersonName) ?? null;
    found.push({ name: name ?? fallbackName, role, email, kind, sourceUrl: url });
  }
  return found;
}

function contactsFromPage(html: string, url: string, researcher: ResearcherProfile): LabContact[] {
  const found: LabContact[] = contactsFromText(stripHtml(html), url, researcher);
  const anchor = /<a\b[^>]*href=["']mailto:([^"'?>]+)[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html))) {
    const email = decodeURIComponent(match[1]).trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) continue;
    if (ROLE_ACCOUNT.test(email)) continue;
    if (researcher.email && email === researcher.email.toLowerCase()) continue;

    const label = stripHtml(match[2]).trim();
    // The block before the link usually holds the name and title; the link
    // itself is often just the address or the word "email".
    const before = stripHtml(html.slice(Math.max(0, match.index - 600), match.index));
    const after = stripHtml(html.slice(anchor.lastIndex, anchor.lastIndex + 200));
    const context = `${before}\n${label}\n${after}`;

    const { name, role } = describeNear(context);
    const kind = classify(role, context);
    if (!kind) continue;

    const tail = before.split('\n').map((l) => l.trim()).filter(Boolean).slice(-4);
    const fallbackName = (looksLikePersonName(label) ? label : null) ?? tail.reverse().find(looksLikePersonName) ?? null;

    found.push({ name: name ?? fallbackName, role, email, kind, sourceUrl: url });
  }
  return found;
}

const NIM_SYSTEM = `You read a lab or department web page and list the people a student should copy on an email to the professor: administrative assistants, coordinators, lab managers, and lab members such as postdocs and research scientists.

Reply ONLY with JSON: {"contacts":[{"name":string|null,"role":string|null,"email":string,"kind":"admin"|"lab"}]}

Rules:
- Include a person ONLY if their email address appears literally in the page text. Never construct an address from a name and a domain.
- kind is "admin" for assistants, coordinators, schedulers, and office staff; "lab" for people doing the research.
- Skip the professor themselves, and skip generic addresses like info@, webmaster@, or help@.
- Empty array if the page lists nobody who fits.`;

async function nimContacts(
  pageText: string,
  url: string,
  researcher: ResearcherProfile,
  nimAuth?: NimAuth
): Promise<LabContact[]> {
  const reply = await nimChat(
    [
      { role: 'system', content: NIM_SYSTEM },
      {
        role: 'user',
        content: `Professor: ${researcher.name} (${researcher.email ?? 'no listed email'})\nSource: ${url}\n\nPAGE TEXT:\n${pageText.slice(0, 10000)}`,
      },
    ],
    { temperature: 0.1, maxTokens: 800 },
    nimAuth
  );
  const parsed = extractJson<{ contacts?: Partial<LabContact>[] }>(reply);
  return (parsed.contacts ?? [])
    .filter((c): c is Partial<LabContact> & { email: string } => typeof c.email === 'string')
    .map<LabContact>((c) => ({
      name: typeof c.name === 'string' ? c.name : null,
      role: typeof c.role === 'string' ? c.role : null,
      email: c.email.trim().toLowerCase(),
      kind: c.kind === 'admin' ? 'admin' : 'lab',
      sourceUrl: url,
    }))
    .filter((c) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.email))
    .filter((c) => !ROLE_ACCOUNT.test(c.email))
    .filter((c) => !researcher.email || c.email !== researcher.email.toLowerCase())
    // The model is told the address must be on the page. Check rather than
    // trust: a hallucinated address is a stranger receiving a resume.
    .filter((c) => pageText.toLowerCase().includes(c.email));
}

/** Lab front page, its contact-ish sub-pages, then the department profile. */
function pagesToRead(researcher: ResearcherProfile, frontHtml: string, frontUrl: string): string[] {
  const pages = new Set<string>();
  const base = new URL(frontUrl);
  for (const link of extractLinks(frontHtml, frontUrl)) {
    try {
      const url = new URL(link.href);
      if (url.host !== base.host) continue;
      if (url.toString() === frontUrl) continue;
      if (!CONTACT_PAGE_HINTS.test(url.pathname) && !CONTACT_PAGE_HINTS.test(link.text)) continue;
      pages.add(url.toString());
    } catch {
      // ignore malformed hrefs
    }
  }
  if (researcher.sourceUrl && researcher.sourceUrl !== frontUrl) pages.add(researcher.sourceUrl);
  return [...pages].slice(0, MAX_PAGES - 1);
}

function dedupe(contacts: LabContact[]): LabContact[] {
  const byEmail = new Map<string, LabContact>();
  for (const contact of contacts) {
    const existing = byEmail.get(contact.email);
    // Keep the richest record for an address, and let a named entry win over
    // an anonymous one.
    if (!existing || (!existing.name && contact.name) || (!existing.role && contact.role)) {
      byEmail.set(contact.email, { ...existing, ...contact });
    }
  }
  // Assistants first: they are the reason this feature exists.
  return [...byEmail.values()]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'admin' ? -1 : 1))
    .slice(0, MAX_CONTACTS);
}

function emptyLookup(researcherId: string): ContactLookup {
  return { researcherId, contacts: [], pagesChecked: [], fetchedAt: new Date().toISOString() };
}

function isFresh(cached: ContactLookup): boolean {
  const age = Date.now() - Date.parse(cached.fetchedAt);
  if (Number.isNaN(age)) return false;
  return age < (cached.contacts.length ? TTL_MS : EMPTY_TTL_MS);
}

/**
 * People worth copying, cached per researcher. Never throws: no contacts is a
 * perfectly good answer, and the email sends fine without them.
 */
export async function getLabContacts(
  researcher: ResearcherProfile,
  opts: { refresh?: boolean; nimAuth?: NimAuth } = {}
): Promise<ContactLookup> {
  const key = `contacts:${researcher.id}`;
  let cached: ContactLookup | null = null;
  try {
    cached = await readStore<ContactLookup | null>(key, null);
  } catch {
    // Cache unavailable; ask the pages directly.
  }
  if (!opts.refresh && cached && isFresh(cached)) return cached;

  const front = researcher.website ?? researcher.sourceUrl;
  if (!front || !isPublicHttpUrl(front)) return cached ?? emptyLookup(researcher.id);

  const found: LabContact[] = [];
  const pagesChecked: string[] = [];
  const useNim = nimAvailable(opts.nimAuth);

  const read = async (url: string) => {
    if (!isPublicHttpUrl(url)) return null;
    try {
      const html = await fetchPage(url);
      pagesChecked.push(url);
      found.push(...contactsFromPage(html, url, researcher));
      if (useNim) {
        try {
          found.push(...(await nimContacts(stripHtml(html), url, researcher, opts.nimAuth)));
        } catch {
          // The heuristic pass already ran for this page.
        }
      }
      return html;
    } catch {
      return null;
    }
  };

  const frontHtml = await read(front);
  if (frontHtml) {
    for (const url of pagesToRead(researcher, frontHtml, front)) await read(url);
  }

  const result: ContactLookup = {
    researcherId: researcher.id,
    contacts: dedupe(found),
    pagesChecked,
    fetchedAt: new Date().toISOString(),
  };

  // A failed crawl must not wipe contacts we already found.
  if (!result.contacts.length && cached?.contacts.length) return cached;

  try {
    await writeStore(key, result);
  } catch {
    // Caching is an optimisation.
  }
  return result;
}
