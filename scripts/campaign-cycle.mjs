#!/usr/bin/env node
// One complete campaign cycle, start to finish, with nothing else running.
//
//   node scripts/campaign-cycle.mjs                  # the daily chain
//   node scripts/campaign-cycle.mjs write-drafts     # one routine
//   node scripts/campaign-cycle.mjs daily --dry-run  # everything except sending
//   node scripts/campaign-cycle.mjs daily --no-commit
//
// This is what a scheduled run calls. It boots the app against the committed
// state directory, runs the routine, shuts the app down, and commits the state
// back so the next run in a fresh container knows what this one did.
//
// The alternative to committing state is a database. This exists so there does
// not have to be one: a Claude Code Routine wakes up, clones the repo, runs
// this, and pushes. The repository is the memory.
//
// Secrets are the exception and never go in. campaign-state/.gitignore drops
// the mailbox token and the API key, which come from the environment:
//
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
//   SCHOOL_EMAIL          the address that sends
//   NVIDIA_API_KEY        optional; without it drafts use the template engine
//   ROUTINE_SECRET        optional; generated per run when unset

import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const STATE_DIR = process.env.CAMPAIGN_STATE_DIR ?? 'campaign-state';
const PORT = Number(process.env.CAMPAIGN_PORT ?? 3921);
const BOOT_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

const ROUTINES = ['daily', 'find-emails', 'find-opportunities', 'build-queue', 'write-drafts', 'send-due', 'follow-up'];

function parseArgs(argv) {
  const args = { routine: 'daily', dryRun: false, commit: true, limit: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-commit') args.commit = false;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`);
    else rest.push(a);
  }
  if (rest[0]) args.routine = rest[0];
  if (!ROUTINES.includes(args.routine)) {
    throw new Error(`Unknown routine "${args.routine}". One of: ${ROUTINES.join(', ')}`);
  }
  return args;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function log(message) {
  console.log(`[campaign] ${message}`);
}

/**
 * Whether something is already listening.
 *
 * Worth checking rather than assuming, because the failure it prevents is
 * genuinely confusing: a leftover server from an earlier run answers the
 * health probe, the routine call then goes to a process holding the previous
 * run's secret, and the whole cycle fails with "Invalid routine secret" while
 * looking like an authentication bug.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', (err) => resolve(err.code === 'EADDRINUSE'))
      .once('listening', () => probe.close(() => resolve(false)))
      .listen(port, '127.0.0.1');
  });
}

/**
 * Stop the server and everything it started.
 *
 * `npm start` is a wrapper: the process actually holding the port is the
 * `next start` it spawns. Signalling npm alone leaves that child running and
 * the port bound, so the server is started in its own process group and the
 * whole group is signalled here.
 */
async function stopServer(server) {
  if (!server?.pid) return;
  const signalGroup = (signal) => {
    try {
      process.kill(-server.pid, signal);
    } catch {
      try {
        server.kill(signal);
      } catch {
        // already gone
      }
    }
  };

  signalGroup('SIGTERM');
  for (let i = 0; i < 20; i++) {
    if (!(await portInUse(PORT))) return;
    await wait(250);
  }
  signalGroup('SIGKILL');
  await wait(500);
}

/** Poll until the app answers, so the routine is not fired at a dead port. */
async function waitForBoot(secret) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/routines`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(4000),
      });
      // Any answer at all means the server is listening; 401 is still an answer.
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await wait(700);
  }
  return false;
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Commit whatever the run changed. The nested .gitignore is what keeps secrets
 * out, so this adds the directory wholesale rather than trying to enumerate
 * safe files and getting the list wrong later.
 */
function commitState(routine, summary) {
  if (!fs.existsSync(STATE_DIR)) return false;
  execFileSync('git', ['add', '--', STATE_DIR], { stdio: 'inherit' });

  const staged = gitOutput(['diff', '--cached', '--name-only', '--', STATE_DIR]);
  if (!staged) {
    log('state unchanged, nothing to commit');
    return false;
  }
  const files = staged.split('\n').filter(Boolean).length;

  // A guard rather than a formality: if a token ever reaches the index, stop
  // before it becomes a commit that has to be rewritten out of history.
  const risky = staged
    .split('\n')
    .filter((f) => /(?:sender|settings|oauthstate)__/.test(path.basename(f)));
  if (risky.length) {
    execFileSync('git', ['reset', 'HEAD', '--', STATE_DIR], { stdio: 'ignore' });
    throw new Error(`Refusing to commit files that may hold secrets: ${risky.join(', ')}`);
  }

  const message = `Campaign ${routine}: ${summary}`.slice(0, 200);
  execFileSync('git', ['commit', '-q', '-m', message], { stdio: 'inherit' });
  log(`committed ${files} state file(s)`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secret = process.env.ROUTINE_SECRET || randomBytes(24).toString('hex');
  const userId = process.env.ROUTINE_USER_ID || 'demo-user';

  fs.mkdirSync(STATE_DIR, { recursive: true });

  if (!fs.existsSync('.next')) {
    log('no build found, running next build');
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  }

  if (await portInUse(PORT)) {
    console.error(
      `[campaign] Port ${PORT} is already in use, probably a server left over from an earlier run.\n` +
        `Stop it first, or set CAMPAIGN_PORT to a free port. Talking to a stale server would\n` +
        `run the routine against whatever state that process was started with.`
    );
    process.exit(1);
  }

  log(`starting app on :${PORT} against ${STATE_DIR}/`);
  const server = spawn('npm', ['start'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: path.resolve(STATE_DIR),
      ROUTINE_SECRET: secret,
      ROUTINE_USER_ID: userId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopServer can take the whole tree down.
    detached: true,
  });

  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  let exitCode = 0;
  try {
    if (!(await waitForBoot(secret))) {
      throw new Error(`App did not start within ${BOOT_TIMEOUT_MS / 1000}s.\n${serverLog.slice(-1500)}`);
    }

    log(`running ${args.routine}${args.dryRun ? ' (dry run)' : ''}`);
    const body = { dryRun: args.dryRun, userId };
    if (Number.isFinite(args.limit)) body.limit = args.limit;

    const res = await fetch(`http://127.0.0.1:${PORT}/api/routines/${args.routine}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    const report = data.report;

    if (!report) {
      throw new Error(`Routine did not report back (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
    }

    console.log(`\n${report.summary}\n`);
    for (const line of report.details ?? []) console.log(`  ${line}`);
    if (report.error) {
      console.error(`\nerror: ${report.error}`);
      exitCode = 1;
    }

    if (args.commit && !args.dryRun) {
      commitState(args.routine, report.summary);
    } else if (args.dryRun) {
      log('dry run, state not committed');
    }
  } catch (err) {
    console.error(`[campaign] ${err.message ?? err}`);
    exitCode = 1;
  } finally {
    // Always take the server down. A cycle that leaves a process holding the
    // port makes the next run fail in a way that looks like a different bug.
    await stopServer(server);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
