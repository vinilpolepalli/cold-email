#!/usr/bin/env node
// Find published emails for directory entries that are missing one.
//
//   node scripts/backfill-emails.mjs [--school Stanford] [--write] [--limit N]
//
// A professor listed on one university page without an address is often listed
// on another with it: Stanford's central profiles site publishes none, while
// the department sites publish plenty. This walks the department people pages,
// matches them to entries we already have, and reads the address off the page.
//
// It never constructs an address from a name and a domain. Every result is a
// string that appeared on an official university page, and every result is
// checked against the person's name before it is accepted, because assigning a
// lab manager's address to a professor is worse than leaving the field empty.

import fs from 'fs';
import path from 'path';

const PROFILES_PATH = path.join(process.cwd(), 'data', 'profiles.json');
const UA = 'Mozilla/5.0 (compatible; SloanBot/1.0; academic directory backfill)';
const FETCH_TIMEOUT_MS = 12000;

/** Department people listings, per school, that are known to publish addresses. */
const DIRECTORIES = {
  Stanford: [
    'https://dbds.stanford.edu/people/',
    'https://dbds.stanford.edu/people/faculty/',
    'https://msande.stanford.edu/people/faculty',
    'https://icme.stanford.edu/people/faculty',
    'https://statistics.stanford.edu/people/faculty',
    'https://bioengineering.stanford.edu/people/faculty',
    'https://cs.stanford.edu/directory/faculty',
    'https://profiles.stanford.edu/',
  ],
};

/**
 * Where a department puts a person's own page. Index pages miss people, so
 * these are tried by name as well: a wrong URL simply 404s, and the address
 * still has to be published on the page and match the name before it counts.
 */
const URL_PATTERNS = {
  Stanford: [
    'https://dbds.stanford.edu/people/{first}-{last}/',
    'https://profiles.stanford.edu/{first}-{last}',
    'https://med.stanford.edu/profiles/{first}-{last}',
    'https://msande.stanford.edu/people/{first}-{last}',
    'https://icme.stanford.edu/people/{first}-{last}',
    'https://statistics.stanford.edu/people/{first}-{last}',
    'https://bioengineering.stanford.edu/people/{first}-{last}',
  ],
};

const ROLE_ACCOUNT =
  /^(?:webmaster|postmaster|no-?reply|donotreply|privacy|accessibility|help|support|helpdesk|it|security|abuse|legal|hr|jobs|careers|apply|admissions|giving|alumni|press|media|news|marketing|comms|events|feedback|info|contact|inquiries|general|office|mail|email|admin|operations|dbds-\w+|\w+-operations|\w+-admissions|\w+-info|\w+-help)@/i;

// The local part must start and end alphanumeric. Without the anchors a page
// reading "email: .akundaje@stanford.edu" or "(see jane@x.edu)" yields an
// address with punctuation glued to it, which then bounces on send.
const ADDRESS_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function stripHtml(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** "jane [at] stanford [dot] edu" is still an address the page chose to show. */
function deobfuscate(text) {
  return text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+@\s+/g, '@');
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function normalize(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameParts(name) {
  const parts = normalize(name).split(' ').filter(Boolean);
  return { first: parts[0] ?? '', last: parts[parts.length - 1] ?? '', all: parts };
}

/**
 * Does this address plausibly belong to this person? University local parts
 * are built from the name in a handful of predictable ways, and requiring one
 * of them keeps a colleague's address from being written to the wrong record.
 */
function addressMatchesName(email, name) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const { first, last } = nameParts(name);
  if (!first || !last) return false;
  const candidates = [
    `${first}${last}`,
    `${first[0]}${last}`,
    `${first}${last[0]}`,
    `${first}`,
    `${last}`,
    `${last}${first[0]}`,
    `${first[0]}${last[0]}`,
  ];
  if (candidates.some((c) => c.length > 2 && local === c)) return true;
  // Initials around the surname: "amnewman" is Aaron M Newman, "jrsmith" is
  // J R Smith. Both are ordinary university conventions.
  if (local.length === last.length + 2 && local[0] === first[0] && local.slice(2) === last) return true;
  if (local.length === last.length + 1 && local[0] === first[0] && local.slice(1) === last) return true;
  // Truncated forms are common: "andrewg" for Andrew Gentles, "sabatin" for
  // Sabatini. Require a real prefix of one part plus a piece of the other.
  if (local.startsWith(first) && local.length >= first.length + 1 && last.startsWith(local.slice(first.length))) return true;
  // Truncations of the surname: "sabatti", "sabatin". A prefix of the name is
  // fine; the name plus extra tokens is not, which is how "covert.lab" was
  // being read as belonging to Markus Covert.
  if (last.length >= 5 && last.startsWith(local) && local.length >= 5) return true;
  if (last.length >= 5 && local.startsWith(last) && local.length - last.length <= 1) return true;
  return false;
}

/**
 * Institutional addresses only. A lab's shared gmail is published on plenty of
 * official pages, but it is the lab's mailbox rather than the professor's, and
 * a directory of faculty contacts is more useful when it holds the one the
 * university itself assigns.
 */
function isInstitutional(email) {
  const domain = email.split('@')[1] ?? '';
  return domain.endsWith('.edu');
}

/** Addresses on a page, with how far each sits from the person's name. */
function addressesNear(text, name) {
  const clean = deobfuscate(text);
  const lower = clean.toLowerCase();
  const { first, last } = nameParts(name);
  const nameIndex = lower.indexOf(`${first} ${last}`);
  const lastIndex = lower.indexOf(last);
  const anchor = nameIndex !== -1 ? nameIndex : lastIndex;

  const out = [];
  ADDRESS_RE.lastIndex = 0;
  let match;
  while ((match = ADDRESS_RE.exec(clean))) {
    const email = match[0].toLowerCase();
    if (ROLE_ACCOUNT.test(email) || !isInstitutional(email)) continue;
    out.push({ email, distance: anchor === -1 ? Infinity : Math.abs(match.index - anchor) });
  }
  return out;
}

/**
 * Accept an address only when its local part is built from this person's name.
 *
 * An earlier version also accepted the single address found on a person's own
 * page, which is how one run proposed "jackie.nguyen@stanford.edu" for Amin
 * Saberi: the only address on his profile belongs to the assistant who handles
 * his scheduling. Proximity on a page proves association, not ownership, and a
 * cold email delivered to the wrong person is worse than an empty field.
 */
function pickForPerson(text, name) {
  const byName = addressesNear(text, name).filter((f) => addressMatchesName(f.email, name));
  if (!byName.length) return null;
  byName.sort((a, b) => a.distance - b.distance);
  return { ...byName[0], basis: 'name-match' };
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      links.push({ href: new URL(m[1], baseUrl).toString(), text: stripHtml(m[2]).trim() });
    } catch {
      // skip malformed hrefs
    }
  }
  return links;
}

/** Person pages discovered from a department listing, keyed by normalized name. */
async function crawlDirectory(url) {
  const html = await fetchPage(url);
  if (!html) return { pages: new Map(), listingText: '' };
  const pages = new Map();
  for (const link of extractLinks(html, url)) {
    const key = normalize(link.text);
    if (key.split(' ').length < 2 || key.length > 50) continue;
    if (!pages.has(key)) pages.set(key, link.href);
  }
  return { pages, listingText: stripHtml(html) };
}

async function main() {
  const args = process.argv.slice(2);
  const school = args.includes('--school') ? args[args.indexOf('--school') + 1] : 'Stanford';
  const write = args.includes('--write');
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  const missing = profiles.filter((p) => p.school === school && !p.email).slice(0, limit);
  console.log(`${missing.length} ${school} profiles without an email\n`);

  const directories = DIRECTORIES[school] ?? [];
  const indexes = [];
  for (const url of directories) {
    const crawled = await crawlDirectory(url);
    console.log(`  indexed ${crawled.pages.size.toString().padStart(4)} names from ${url}`);
    indexes.push({ url, ...crawled });
  }
  console.log('');

  const found = [];
  for (const profile of missing) {
    const key = normalize(profile.name);
    const { first, last } = nameParts(profile.name);

    // The person's own page on a department site is the best source: one
    // person, one address, their name at the top.
    let hit = null;
    for (const index of indexes) {
      const href =
        index.pages.get(key) ??
        [...index.pages.entries()].find(([n]) => {
          const parts = n.split(' ');
          return parts[0] === first && parts[parts.length - 1] === last;
        })?.[1];
      if (!href) continue;
      const html = await fetchPage(href);
      if (!html) continue;
      const picked = pickForPerson(stripHtml(html), profile.name);
      if (picked) {
        hit = { ...picked, source: href };
        break;
      }
    }

    // Index pages leave people off. Try the conventional URL for a person's
    // page on each department site, plus their own lab site.
    if (!hit) {
      const slugs = [`${first}-${last}`, ...(profile.name.includes('.') ? [] : [])];
      const candidates = [
        ...(URL_PATTERNS[school] ?? []).flatMap((pattern) =>
          slugs.map((slug) => pattern.replace('{first}', first).replace('{last}', last).replace('{slug}', slug))
        ),
        profile.website,
        profile.sourceUrl,
      ].filter(Boolean);

      // Fetched together rather than one after another: most candidates 404,
      // and waiting out nine timeouts per person makes a 110-person run
      // impractical. Priority order is preserved when picking the winner.
      const urls = [...new Set(candidates)];
      const pages = await Promise.all(urls.map((url) => fetchPage(url)));
      for (let i = 0; i < urls.length; i++) {
        if (!pages[i]) continue;
        const picked = pickForPerson(stripHtml(pages[i]), profile.name);
        if (picked) {
          hit = { ...picked, source: urls[i] };
          break;
        }
      }
    }

    // Otherwise the listing page itself sometimes prints the address inline.
    if (!hit) {
      for (const index of indexes) {
        if (!index.listingText) continue;
        const picked = pickForPerson(index.listingText, profile.name);
        if (picked && picked.distance < 400) {
          hit = { ...picked, source: index.url };
          break;
        }
      }
    }

    if (hit) {
      found.push({ profile, ...hit });
      console.log(`  ${profile.name.padEnd(28)} ${hit.email.padEnd(34)} ${hit.basis}  ${hit.source}`);
    }
  }

  console.log(`\n${found.length} of ${missing.length} resolved`);

  if (!write) {
    console.log('\nDry run. Re-run with --write to save.');
    return;
  }
  const byId = new Map(found.map((f) => [f.profile.id, f.email]));
  const updated = profiles.map((p) => (byId.has(p.id) ? { ...p, email: byId.get(p.id) } : p));
  fs.writeFileSync(PROFILES_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`\nWrote ${byId.size} addresses to data/profiles.json`);
}

main();
