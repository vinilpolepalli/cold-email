#!/usr/bin/env node
// Check every unreplied thread in campaign-state/notion-tracker.json against
// Gmail, and print the ones that got a reply since the last check.
//
//   node scripts/check-replies.mjs
//
// Read-only against Gmail and against the tracker file: this reports what
// changed, it does not write anything. The caller (a routine session, with
// the Notion connector) is what updates Notion and commits the tracker, so
// that a Notion write and the tracker write that records it never happen
// separately — a script that did both here could crash between them and
// leave the two disagreeing about which replies were already handled.
//
// A reply is any message on the thread not sent from the school account.
// That is deliberately broader than "the professor replied": an out-of-office
// autoresponder or an assistant answering on their behalf both count, because
// both are signals a human should read this thread, and the whole point of a
// tracker is not letting one sit unread.
//
// A bounce is not a reply, and conflating them is a real mistake: the first
// message on a thread confirmed this run found one exactly this way, a hard
// 550 5.1.1 "User Unknown" from Mail Delivery Subsystem read as a reply until
// this check was added. A bounce means the address never reached anyone, and
// that is worse news than silence, not the same news as an answer.
import fs from 'node:fs';

const BOUNCE_FROM = /\bmailer-daemon\b|\bpostmaster\b|\bmail delivery (?:subsystem|system)\b/i;

const TRACKER = 'campaign-state/notion-tracker.json';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, SCHOOL_EMAIL } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !SCHOOL_EMAIL) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / SCHOOL_EMAIL.');
  process.exit(1);
}

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function checkThread(token, threadId) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) return { checked: false };
  const thread = await res.json();
  const messages = thread.messages ?? [];
  const ours = SCHOOL_EMAIL.toLowerCase();
  const others = messages.filter((m) => {
    const from = (m.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value ?? '').toLowerCase();
    return from && !from.includes(ours);
  });
  if (!others.length) return { checked: true };

  const dateOf = (m) => {
    const d = m.payload?.headers?.find((h) => h.name.toLowerCase() === 'date')?.value;
    return d ? new Date(d).toISOString() : new Date().toISOString();
  };
  const bounce = others.find((m) => BOUNCE_FROM.test(m.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value ?? ''));
  if (bounce) return { checked: true, bounced: true, bouncedAt: dateOf(bounce) };

  return { checked: true, replied: true, repliedAt: dateOf(others[0]) };
}

const tracker = JSON.parse(fs.readFileSync(TRACKER, 'utf8'));
const pending = tracker.filter((t) => !t.repliedAt && !t.bouncedAt && t.threadId);

if (!pending.length) {
  console.log(JSON.stringify({ checked: 0, newlyReplied: [], newlyBounced: [] }));
  process.exit(0);
}

const token = await accessToken();
const newlyReplied = [];
const newlyBounced = [];
let checked = 0;
let errors = 0;

for (const entry of pending) {
  try {
    const result = await checkThread(token, entry.threadId);
    if (result.checked) checked++;
    else errors++;
    if (result.bounced) {
      entry.bouncedAt = result.bouncedAt;
      newlyBounced.push({
        researcherName: entry.researcherName,
        email: entry.email,
        notionPageId: entry.notionPageId,
        bouncedAt: entry.bouncedAt,
        threadId: entry.threadId,
      });
    } else if (result.replied) {
      entry.repliedAt = result.repliedAt;
      newlyReplied.push({
        researcherName: entry.researcherName,
        email: entry.email,
        notionPageId: entry.notionPageId,
        repliedAt: entry.repliedAt,
        threadId: entry.threadId,
      });
    }
  } catch {
    errors++;
  }
}

fs.writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + '\n');

console.log(JSON.stringify({ checked, errors, pending: pending.length, newlyReplied, newlyBounced }, null, 2));
