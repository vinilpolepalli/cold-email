#!/usr/bin/env node
// Find published addresses in researchers' own papers.
//
//   node scripts/paper-emails.mjs --school Stanford [--limit N] [--write]
//
// Written after Stanford's own web presence turned out to be a dead end. Its
// central profiles site, its department listings and its faculty person pages
// publish no addresses at all: six pages and 2.8MB of HTML returned zero, and
// the pages are plain server-rendered HTML, so a browser sees exactly what a
// fetch sees. All 22 lab and personal sites we had on file returned nothing
// either. Stanford appears to have removed them deliberately.
//
// Papers are the exception, and a legitimate one. A corresponding author
// prints their address in the paper itself, for exactly this purpose: so that
// people who read the work can write to them about it. Europe PMC indexes that
// field across PubMed, PMC and preprints.
//
// The discipline is the same as everywhere else in this codebase. Every
// address is one a person published, and it is only attributed to someone when
// its local part is built from their own name. That filter is doing real work
// here rather than being ceremonial: a paper's metadata carries every author's
// address, so without it Alison Marsden would have been assigned her
// co-author's, which is precisely the failure this rule exists to prevent.

import fs from 'node:fs';
import path from 'node:path';

const PROFILES = path.join(process.cwd(), 'data', 'profiles.json');
const STATE_DIR = process.env.CAMPAIGN_STATE_DIR ?? 'campaign-state';
const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const TIMEOUT_MS = 25_000;
const GAP_MS = 200;
const PAGE_SIZE = 25;

const ADDRESS_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ROLE_ACCOUNT =
  /^(?:webmaster|postmaster|no-?reply|donotreply|privacy|help|support|it|security|legal|hr|jobs|press|media|events|feedback|info|contact|inquiries|general|office|mail|email|admin|editor|editorial|permissions|reprints|journals?)@/i;

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

function nameParts(name) {
  const p = norm(name).split(' ').filter(Boolean);
  return { first: p[0] ?? '', last: p[p.length - 1] ?? '', all: p };
}

/** Identical to the in-app finder: the local part must be built from the name. */
function matchesName(email, name) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const { first, last } = nameParts(name);
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

/** The school's own domain, so a Stanford professor's Stanford address wins. */
function schoolDomains(school) {
  return ({
    Stanford: ['stanford.edu'],
    MIT: ['mit.edu'],
    Harvard: ['harvard.edu', 'hms.harvard.edu', 'broadinstitute.org'],
    Princeton: ['princeton.edu'],
    Penn: ['upenn.edu', 'pennmedicine.upenn.edu'],
  })[school] ?? [];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(query) {
  const url = `${API}?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=${PAGE_SIZE}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const json = await res.json();
    return json.resultList?.result ?? [];
  } catch {
    return [];
  }
}

/**
 * The addresses in a result set that belong to this person.
 *
 * Counted rather than taken first-past-the-post: an address that appears as
 * the contact on several of someone's papers is far more likely to be current
 * than one that appeared once a decade ago.
 */
function addressesFor(results, person) {
  const tally = new Map();
  for (const paper of results) {
    const seen = new Set();
    for (const m of JSON.stringify(paper).matchAll(ADDRESS_RE)) {
      const email = m[0].toLowerCase().replace(/[.,;:)]+$/, '');
      if (seen.has(email)) continue;
      seen.add(email);
      if (ROLE_ACCOUNT.test(email)) continue;
      if (!matchesName(email, person.name)) continue;
      tally.set(email, (tally.get(email) ?? 0) + 1);
    }
  }

  const domains = schoolDomains(person.school);
  return [...tally.entries()]
    .map(([email, count]) => ({ email, count }))
    // The address has to be on the school this person actually works at.
    //
    // Name matching alone is not enough here, and the first run proved it.
    // Ching-Yao Lai at Stanford was assigned chlai@tmu.edu.tw, which belongs
    // to a different person in Taiwan whose name happens to match. Benjamin
    // Van Roy was assigned bcroy@media.mit.edu, an address from a former
    // affiliation. Emily Alsentzer was assigned ealsentzer@bwh.harvard.edu,
    // correct once but predating her move.
    //
    // A paper index spans a whole career and a whole field, so a name match
    // inside it says far less than a name match on the professor's own
    // department page. Requiring the current institution is what closes that
    // gap, at the cost of the occasional genuine cross-appointment.
    .filter(({ email }) => domains.some((d) => email.endsWith(`@${d}`) || email.endsWith(`.${d}`)))
    .sort((a, b) => b.count - a.count);
}

/** Query forms, narrowest first, so a common surname does not dominate. */
function queriesFor(person) {
  const { first, last, all } = nameParts(person.name);
  const affiliation = person.school === 'Penn' ? 'Pennsylvania' : person.school;
  const initial = first[0] ?? '';
  return [
    `AUTH:"${last} ${first}" AND AFF:"${affiliation}"`,
    `AUTH:"${last} ${initial}" AND AFF:"${affiliation}"`,
    all.length > 2 ? `AUTH:"${last} ${all.slice(0, -1).map((w) => w[0]).join('')}" AND AFF:"${affiliation}"` : null,
  ].filter(Boolean);
}

// ── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const school = args.includes('--school') ? args[args.indexOf('--school') + 1] : 'Stanford';
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const write = args.includes('--write');

const all = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));

const already = new Set();
try {
  for (const f of fs.readdirSync(STATE_DIR).filter((x) => x.startsWith('email__'))) {
    already.add(JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')).researcherId);
  }
} catch {
  /* no state yet */
}

const missing = all.filter((p) => p.school === school && !p.email && !already.has(p.id)).slice(0, limit);
console.log(`${missing.length} ${school} entries without an address\n`);

const found = [];
const unresolved = [];

for (const [i, person] of missing.entries()) {
  let picked = null;
  for (const query of queriesFor(person)) {
    const results = await search(query);
    await wait(GAP_MS);
    if (!results.length) continue;
    const ranked = addressesFor(results, person);
    if (ranked.length) {
      picked = { ...ranked[0], papers: results.length, query };
      break;
    }
  }

  if (picked) {
    found.push({ person, ...picked });
    console.log(
      `  ${String(i + 1).padStart(3)}. + ${person.name.padEnd(24)} ${picked.email.padEnd(34)} (${picked.count}x)`
    );
  } else {
    unresolved.push(person);
    console.log(`  ${String(i + 1).padStart(3)}.   ${person.name.padEnd(24)} —`);
  }
}

const pct = missing.length ? ((found.length / missing.length) * 100).toFixed(0) : '0';
console.log('\n' + '─'.repeat(70));
console.log(`Found ${found.length} of ${missing.length} (${pct}%)`);

if (write && found.length) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (const f of found) {
    fs.writeFileSync(
      path.join(STATE_DIR, `email__${f.person.id}.json`),
      JSON.stringify(
        {
          researcherId: f.person.id,
          email: f.email,
          sourceUrl: `https://europepmc.org/search?query=${encodeURIComponent(f.query)}`,
          discoveredAt: new Date().toISOString(),
          basis: `corresponding-author address on ${f.count} of their own papers`,
        },
        null,
        2
      )
    );
  }
  console.log(`Wrote ${found.length} address records to ${STATE_DIR}/`);
} else if (!write) {
  console.log('Dry run. Re-run with --write to save.');
}
