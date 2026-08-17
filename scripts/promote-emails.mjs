#!/usr/bin/env node
// Promote agent-discovered addresses into the checked-in directory.
//
//   node scripts/promote-emails.mjs [--write]
//
// The email-finder and paper-emails agents write one `email__<id>.json` record
// per address into campaign-state/. Those records are merged into the
// directory at request time by getAllProfiles(), which is enough for the app
// to use them but leaves data/profiles.json — the file the site actually ships
// — still showing a blank where an address is known.
//
// This script closes that gap by folding reviewed records into the checked-in
// file, so the directory is complete for anyone reading it, with or without a
// campaign-state directory alongside.
//
// Two rules it will not break:
//
//   1. An entry that already has an address keeps it. The checked-in value was
//      read off a department page by a human; a discovered one was not, and a
//      silent overwrite would be impossible to notice in a 794-entry diff.
//   2. Every promoted address records where it was published, in `emailSource`.
//      The directory's whole claim is that no address in it was guessed, and
//      that claim is only checkable if each one says where it came from.

import fs from 'node:fs';
import path from 'node:path';

const PROFILES = path.join(process.cwd(), 'data', 'profiles.json');
const STATE_DIR = process.env.CAMPAIGN_STATE_DIR ?? 'campaign-state';

const write = process.argv.includes('--write');

const profiles = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));
const byId = new Map(profiles.map((p) => [p.id, p]));

const records = fs
  .readdirSync(STATE_DIR)
  .filter((f) => f.startsWith('email__') && f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')));

const promoted = [];
const kept = [];
const orphans = [];

for (const rec of records) {
  const person = byId.get(rec.researcherId);
  if (!person) {
    // The profile was removed after the address was found. Left alone: the
    // record is harmless where it is, and deleting directory entries is a
    // decision for whoever removed the profile, not for this script.
    orphans.push(rec.researcherId);
    continue;
  }
  if (person.email) {
    kept.push({ id: person.id, existing: person.email, found: rec.email });
    continue;
  }
  person.email = rec.email;
  if (rec.sourceUrl && rec.sourceUrl !== person.sourceUrl) person.emailSource = rec.sourceUrl;
  promoted.push({ name: person.name, school: person.school, email: rec.email });
}

promoted.sort((a, b) => a.school.localeCompare(b.school) || a.name.localeCompare(b.name));
for (const p of promoted) {
  console.log(`  + ${p.school.padEnd(10)} ${p.name.padEnd(26)} ${p.email}`);
}

console.log('\n' + '─'.repeat(70));
console.log(`${records.length} discovered records`);
console.log(`  promoted        ${promoted.length}`);
console.log(`  already present ${kept.length}`);
console.log(`  no such profile ${orphans.length}${orphans.length ? ` (${orphans.join(', ')})` : ''}`);

for (const k of kept) {
  if (k.existing.toLowerCase() !== k.found.toLowerCase()) {
    console.log(`  ! ${k.id} keeps ${k.existing}, discovery said ${k.found}`);
  }
}

const bySchool = {};
for (const p of profiles) {
  const s = (bySchool[p.school] ??= { total: 0, withEmail: 0 });
  s.total += 1;
  if (p.email) s.withEmail += 1;
}
console.log('\nCoverage after promotion:');
for (const [school, s] of Object.entries(bySchool).sort()) {
  const pct = ((s.withEmail / s.total) * 100).toFixed(0);
  console.log(`  ${school.padEnd(10)} ${String(s.withEmail).padStart(3)}/${String(s.total).padEnd(3)} ${pct}%`);
}
const total = profiles.length;
const withEmail = profiles.filter((p) => p.email).length;
console.log(`  ${'ALL'.padEnd(10)} ${withEmail}/${total} ${((withEmail / total) * 100).toFixed(0)}%`);

if (write) {
  fs.writeFileSync(PROFILES, JSON.stringify(profiles, null, 2) + '\n');
  console.log(`\nWrote ${PROFILES}`);
} else {
  console.log('\nDry run. Re-run with --write to save.');
}
