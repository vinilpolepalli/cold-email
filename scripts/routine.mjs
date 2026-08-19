#!/usr/bin/env node
// Run a routine against a running Sloan instance, with no browser session.
//
//   node scripts/routine.mjs daily
//   node scripts/routine.mjs write-drafts --dry-run
//   node scripts/routine.mjs send-due --limit 2
//   node scripts/routine.mjs daily --base https://sloan.example.com
//
// This is the entry point a scheduler uses: Vercel Cron, a crontab, or a
// Claude Code Routine waking up on a schedule. It is a thin client over
// POST /api/routines/<name>, so the routine itself runs inside the app with
// the app's storage and credentials, and this script holds nothing but a
// secret and a URL.
//
// Environment:
//   SLOAN_BASE_URL   where the app is (default http://localhost:3000)
//   ROUTINE_SECRET   must match the server's, or the call is refused
//   ROUTINE_USER_ID  whose queue to run, when the server has no default

const ROUTINES = [
  'daily',
  'find-emails',
  'find-opportunities',
  'build-queue',
  'write-drafts',
  'send-due',
  'follow-up',
];

function parseArgs(argv) {
  const args = { routine: '', dryRun: false, limit: null, base: '', userId: '', quiet: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--user') args.userId = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
    else rest.push(arg);
  }
  args.routine = rest[0] ?? '';
  return args;
}

function usage() {
  console.log(`Usage: node scripts/routine.mjs <routine> [options]

Routines:
${ROUTINES.map((r) => `  ${r}`).join('\n')}

Options:
  --dry-run        Do everything except send
  --limit N        Cap how many items this run touches
  --base URL       App base URL (default $SLOAN_BASE_URL or http://localhost:3000)
  --user ID        Run as this user id (default $ROUTINE_USER_ID or the server's)
  --quiet          Print the summary only, not the per-item detail
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.routine || args.routine === 'help') {
    usage();
    process.exit(args.routine ? 0 : 1);
  }
  if (!ROUTINES.includes(args.routine)) {
    console.error(`Unknown routine "${args.routine}". One of: ${ROUTINES.join(', ')}`);
    process.exit(1);
  }

  const base = (args.base || process.env.SLOAN_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const secret = process.env.ROUTINE_SECRET ?? '';
  const userId = args.userId || process.env.ROUTINE_USER_ID || '';

  if (!secret) {
    console.error(
      'ROUTINE_SECRET is not set. Set the same value here and on the server, or the call is rejected.'
    );
    process.exit(1);
  }

  const payload = { dryRun: args.dryRun };
  if (Number.isFinite(args.limit)) payload.limit = args.limit;
  if (userId) payload.userId = userId;

  const url = `${base}/api/routines/${args.routine}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      // Crawling several labs and drafting several emails is genuinely slow.
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
  } catch (err) {
    console.error(`Could not reach ${url}: ${err.message}`);
    console.error('Is the app running? Set SLOAN_BASE_URL if it is somewhere else.');
    process.exit(1);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`${res.status} from ${url}: ${text.slice(0, 400)}`);
    process.exit(1);
  }

  if (!res.ok && !data.report) {
    console.error(`${res.status}: ${data.error ?? text.slice(0, 400)}`);
    process.exit(1);
  }

  const report = data.report;
  const stamp = new Date(report.startedAt).toISOString();
  console.log(`[${stamp}] ${report.routine}${report.dryRun ? ' (dry run)' : ''}: ${report.summary}`);

  if (!args.quiet && report.details?.length) {
    for (const line of report.details) console.log(`  ${line}`);
  }
  if (report.error) {
    console.error(`  error: ${report.error}`);
    process.exit(1);
  }
  // A non-zero exit on failure is what makes a scheduler notice.
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
