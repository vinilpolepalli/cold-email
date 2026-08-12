#!/usr/bin/env node
// CLI wrapper for the app's scraping agent. Requires the app to be running.
//   node scripts/scrape.mjs <faculty-directory-url> [school-label]
// Env: APP_URL (default http://localhost:3000)

const [url, school] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/scrape.mjs <faculty-directory-url> [school-label]');
  process.exit(1);
}

const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
const res = await fetch(`${appUrl}/api/scrape`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, school }),
});
const data = await res.json();
if (!res.ok) {
  console.error('Scrape failed:', data.error ?? res.status);
  process.exit(1);
}
console.log(`Extractor: ${data.extractor} | pages visited: ${data.pagesVisited} | added to directory: ${data.added}`);
for (const p of data.profiles) {
  console.log(`- ${p.name} | ${p.title} | ${p.email ?? 'no email'} | areas: ${p.researchAreas.join(', ')}`);
}
