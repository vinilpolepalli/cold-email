#!/usr/bin/env node
// Find published addresses for the Stanford faculty the directory has none for.
//
//   node scripts/stanford-emails.mjs [--limit N] [--write]
//
// Stanford is the campaign's first-choice school and has its worst coverage:
// 88 of 170 entries carry an address, against 97% at Harvard. The reason is
// specific rather than technical. profiles.stanford.edu renders completely in
// plain HTML, several hundred kilobytes of it, and publishes no address at
// all. Rendering the page in a browser finds nothing extra, because there is
// nothing extra to find.
//
// What those pages do carry is a list of the departments the person belongs
// to, and Stanford departments publish addresses freely. So the route to an
// address runs through the department, and that is what this does:
//
//   A. harvest every Stanford department faculty listing we know of, reading
//      each published address together with the name printed beside it;
//   B. for anyone still missing, open their profiles.stanford.edu page, take
//      the department and lab sites it links to, and search those;
//   C. try the person-page URL patterns those departments use.
//
// The rule from the rest of the codebase is unchanged and is the reason this
// is careful rather than clever: an address is only ever read off a page, and
// only accepted when its local part is built from that person's own name.
// Nothing is constructed, and proximity on a page is never enough on its own.

import fs from 'node:fs';
import path from 'node:path';

const PROFILES = path.join(process.cwd(), 'data', 'profiles.json');
const STATE_DIR = process.env.CAMPAIGN_STATE_DIR ?? 'campaign-state';
const UA = 'Mozilla/5.0 (compatible; SloanBot/1.0; academic directory backfill)';
const TIMEOUT_MS = 20_000;
const GAP_MS = 250;

// ── the same matching rules the in-app finder uses ──────────────────────────

const ADDRESS_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ROLE_ACCOUNT =
  /^(?:webmaster|postmaster|no-?reply|donotreply|privacy|accessibility|help|support|helpdesk|it|security|abuse|legal|hr|jobs|careers|apply|admissions|giving|alumni|press|media|news|marketing|comms|events|feedback|info|contact|inquiries|general|office|mail|email|admin|operations|events|seminars?|webteam)@/i;

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

function parts(name) {
  const p = norm(name).split(' ').filter(Boolean);
  return { first: p[0] ?? '', last: p[p.length - 1] ?? '', all: p };
}

/** Local part has to be built from this person's name. Ported verbatim. */
function matchesName(email, name) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const { first, last } = parts(name);
  if (!first || !last) return false;
  const c = [
    `${first}${last}`, `${first[0]}${last}`, `${first}${last[0]}`,
    first, last, `${last}${first[0]}`, `${first[0]}${last[0]}`,
  ];
  if (c.some((x) => x.length > 2 && local === x)) return true;
  if (local.length === last.length + 2 && local[0] === first[0] && local.slice(2) === last) return true;
  if (local.length === last.length + 1 && local[0] === first[0] && local.slice(1) === last) return true;
  if (local.startsWith(first) && local.length >= first.length + 1 && last.startsWith(local.slice(first.length))) return true;
  if (last.length >= 5 && last.startsWith(local) && local.length >= 5) return true;
  return false;
}

const institutional = (e) => (e.split('@')[1] ?? '').endsWith('.edu');

function deobfuscate(t) {
  return t
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
    .replace(/\s+@\s+/g, '@');
}

function stripHtml(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── A. department listings ──────────────────────────────────────────────────

/**
 * Stanford department and centre faculty listings. Seeded from the schools and
 * institutes the missing entries actually belong to, then widened by whatever
 * their own profile pages link to (see stage B).
 */
const SEED_LISTINGS = [
  'https://cs.stanford.edu/directory/faculty',
  'https://profiles.stanford.edu/browse/school-of-engineering',
  'https://bioengineering.stanford.edu/people/faculty',
  'https://me.stanford.edu/people/faculty',
  'https://ee.stanford.edu/people/faculty',
  'https://statistics.stanford.edu/people/faculty',
  'https://icme.stanford.edu/people/faculty',
  'https://msande.stanford.edu/people/faculty',
  'https://dbds.stanford.edu/people/',
  'https://dbds.stanford.edu/people/faculty/',
  'https://biology.stanford.edu/people/faculty',
  'https://cheme.stanford.edu/people/faculty',
  'https://aa.stanford.edu/people/faculty',
  'https://cee.stanford.edu/people/faculty',
  'https://mse.stanford.edu/people/faculty',
  'https://appliedphysics.stanford.edu/people/faculty',
  'https://chemistry.stanford.edu/people/faculty',
  'https://physics.stanford.edu/people/faculty',
  'https://bmir.stanford.edu/people',
  'https://hai.stanford.edu/people',
  'https://med.stanford.edu/bmi/people.html',
  'https://med.stanford.edu/genetics/people.html',
  'https://neuroscience.stanford.edu/people/faculty',
  'https://psychology.stanford.edu/people/faculty',
  'https://sisl.stanford.edu/people/',
  'https://cardiovascularinstitute.stanford.edu/people.html',
  'https://chemh.stanford.edu/people',
  'https://biox.stanford.edu/people/faculty',
];

/** Person-page URL shapes these departments use. */
const PERSON_PATTERNS = [
  '{host}/people/{first}-{last}',
  '{host}/people/{first}-{last}/',
  '{host}/person/{first}-{last}',
  '{host}/faculty/{first}-{last}',
  '{host}/profiles/{first}-{last}',
  '{host}/people/{last}',
  '{host}/~{first}{last}',
];

function links(html, base) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push({ href: new URL(m[1].replace(/&amp;/g, '&'), base).toString(), text: stripHtml(m[2]).trim() });
    } catch {
      /* malformed href */
    }
  }
  return out;
}

/**
 * Every (name, address) pair a listing publishes.
 *
 * Two readings, because departments format listings differently: a linked
 * address whose anchor text or neighbourhood carries the name, and a plain
 * text address sitting near a name. Both are checked against the name before
 * they count for anything, so a generous reading here cannot produce a wrong
 * attribution later.
 */
function harvest(html, url, wanted) {
  const found = [];
  const text = deobfuscate(stripHtml(html));
  const flat = deobfuscate(html);

  for (const person of wanted) {
    const { first, last } = parts(person.name);
    if (!first || !last) continue;

    // Every address on the page that could belong to this person by name.
    const candidates = new Set();
    for (const re of [ADDRESS_RE, /mailto:([^"'?<>\s]+)/gi]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(flat))) {
        const addr = decodeURIComponent(m[1] ?? m[0]).toLowerCase();
        if (!addr.includes('@')) continue;
        if (ROLE_ACCOUNT.test(addr) || !institutional(addr)) continue;
        if (matchesName(addr, person.name)) candidates.add(addr);
      }
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        const addr = decodeURIComponent(m[1] ?? m[0]).toLowerCase();
        if (!addr.includes('@')) continue;
        if (ROLE_ACCOUNT.test(addr) || !institutional(addr)) continue;
        if (matchesName(addr, person.name)) candidates.add(addr);
      }
    }
    if (!candidates.size) continue;

    // The page also has to actually be about this person, so a name-shaped
    // coincidence on an unrelated listing does not get attributed to them.
    const lower = text.toLowerCase();
    if (!lower.includes(`${first} ${last}`) && !lower.includes(last)) continue;

    for (const email of candidates) found.push({ id: person.id, name: person.name, email, url });
  }
  return found;
}

// ── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const WRITE = args.includes('--write');

const all = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));

// Anything the finder agent already turned up counts as covered.
const already = new Set();
try {
  for (const f of fs.readdirSync(STATE_DIR).filter((x) => x.startsWith('email__'))) {
    already.add(JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')).researcherId);
  }
} catch {
  /* no state yet */
}

const missing = all
  .filter((p) => p.school === 'Stanford' && !p.email && !already.has(p.id))
  .slice(0, LIMIT);

console.log(`${missing.length} Stanford entries without an address\n`);

const results = new Map(); // researcherId -> { email, url }
const record = (hit) => {
  if (results.has(hit.id)) return false;
  results.set(hit.id, { email: hit.email, url: hit.url, name: hit.name });
  console.log(`  + ${hit.name.padEnd(26)} ${hit.email.padEnd(34)} ${new URL(hit.url).host}`);
  return true;
};

const seen = new Set();
async function scan(url, wanted) {
  if (seen.has(url) || !wanted.length) return;
  seen.add(url);
  const html = await get(url);
  await wait(GAP_MS);
  if (!html) return;
  for (const hit of harvest(html, url, wanted)) record(hit);
  return html;
}

// ── stage A: the department listings ───────────────────────────────────────
console.log('A. department listings');
const extraListings = new Set();
for (const url of SEED_LISTINGS) {
  const outstanding = missing.filter((p) => !results.has(p.id));
  if (!outstanding.length) break;
  const html = await scan(url, outstanding);
  if (!html) continue;
  // A listing links to its own person pages; keep the ones naming someone we want.
  for (const l of links(html, url)) {
    const t = norm(l.text);
    if (t.split(' ').length < 2) continue;
    if (outstanding.some((p) => { const { first, last } = parts(p.name); return t.includes(first) && t.includes(last); })) {
      extraListings.add(l.href);
    }
  }
}
console.log(`   ${results.size} found, ${extraListings.size} person pages to open\n`);

// ── stage B: person pages discovered from those listings ───────────────────
console.log('B. person pages from listings');
for (const url of [...extraListings].slice(0, 300)) {
  const outstanding = missing.filter((p) => !results.has(p.id));
  if (!outstanding.length) break;
  await scan(url, outstanding);
}
console.log(`   ${results.size} found\n`);

// ── stage C: departments and labs each profile links to ────────────────────
console.log('C. departments and labs linked from each profile');
for (const person of missing) {
  if (results.has(person.id)) continue;
  const profile = await get(person.sourceUrl);
  await wait(GAP_MS);
  if (!profile) continue;

  const hosts = new Set();
  const labPages = [];
  for (const l of links(profile, person.sourceUrl)) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (/profiles\.stanford\.edu|cap\.stanford\.edu|^www\.stanford\.edu$/.test(u.host)) continue;
    if (u.host.endsWith('stanford.edu')) hosts.add(`${u.protocol}//${u.host}`);
    else if (/lab|group|research|\.io$|\.org$/.test(u.host + u.pathname) && !/orcid|linkedin|doi|ncbi|pubmed|google|twitter|github/.test(u.host)) {
      labPages.push(u.toString());
    }
  }

  // The person's own page on each department they belong to.
  const { first, last } = parts(person.name);
  const tries = [];
  for (const host of hosts) {
    for (const pat of PERSON_PATTERNS) tries.push(pat.replace('{host}', host).replace('{first}', first).replace('{last}', last));
  }
  for (const url of [...labPages, ...tries].slice(0, 14)) {
    if (results.has(person.id)) break;
    await scan(url, [person]);
  }
}
console.log(`   ${results.size} found\n`);

// ── report ─────────────────────────────────────────────────────────────────
const pct = missing.length ? ((results.size / missing.length) * 100).toFixed(0) : '0';
console.log('─'.repeat(70));
console.log(`Found ${results.size} of ${missing.length} (${pct}%)`);

if (WRITE) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let n = 0;
  for (const [id, r] of results) {
    fs.writeFileSync(
      path.join(STATE_DIR, `email__${id}.json`),
      JSON.stringify({ researcherId: id, email: r.email, sourceUrl: r.url, discoveredAt: new Date().toISOString() }, null, 2)
    );
    n++;
  }
  console.log(`Wrote ${n} address records to ${STATE_DIR}/`);
} else {
  console.log('Dry run. Re-run with --write to save.');
}

const stillMissing = missing.filter((p) => !results.has(p.id));
if (stillMissing.length) {
  console.log(`\nStill missing (${stillMissing.length}):`);
  stillMissing.slice(0, 40).forEach((p) => console.log(`  - ${p.name}  ${p.sourceUrl}`));
}
