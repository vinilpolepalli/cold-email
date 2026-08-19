#!/usr/bin/env node
// Mint a Gmail refresh token without a callback server.
//
//   node scripts/oauth-consent.mjs                     # step 1: print the consent URL
//   node scripts/oauth-consent.mjs "<pasted url|code>" # step 2: swap it for a token
//
// This is the sibling of connect-school-account.mjs, for the case where there
// is nowhere to run a callback server: a cloud session, a container with no
// inbound network, a phone. Both do the same OAuth round trip; they differ only
// in how the authorization code gets back.
//
// The trick is that the code arrives in the *browser's address bar* before
// anything has to answer for it. Google redirects to whichever URI is
// registered, and if nothing is listening there the browser shows an error page
// while the URL still reads
//
//   http://localhost:3000/api/auth/google/callback?code=4/0AX...&scope=...
//
// That code is the whole handoff. Paste the URL back here and this exchanges it
// over plain outbound HTTPS, which any container has.
//
// The code is single-use and expires in minutes, and it is useless on its own —
// the exchange also requires the client secret. The refresh token it returns is
// not: that is the live grant to the mailbox, so it is printed once and belongs
// in an environment variable from then on, never in the repository.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Must match a URI registered on the OAuth client byte for byte, at both the
// consent step and the exchange step. Nothing needs to be listening on it.
const REDIRECT =
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';

const SCOPES = [
  SEND,
  // Storing a draft is a separate permission from sending one; gmail.send
  // alone gets a 403 from the drafts endpoint.
  COMPOSE,
  // Lets a follow-up check whether the professor already replied before
  // nudging. Decline it and follow-ups skip rather than going out blind.
  READ,
  'https://www.googleapis.com/auth/userinfo.email',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.

Create them at https://console.cloud.google.com/apis/credentials:
  1. OAuth 2.0 Client ID, type "Web application"
  2. Authorized redirect URI:  ${REDIRECT}
  3. Enable the Gmail API for the project
  4. On the consent screen, add yourself as a test user
`);
  process.exit(1);
}

/**
 * Accept either a bare code or the whole pasted URL, because copying the
 * address bar is one action and picking the code out of it is three.
 */
function extractCode(input) {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  if (!raw.includes('://') && !raw.includes('code=')) return raw;
  try {
    const code = new URL(raw).searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a parseable URL; fall through to the query-string match below so a
    // half-copied address still works.
  }
  return raw.match(/[?&]code=([^&\s]+)/)?.[1] ?? null;
}

const input = process.argv[2];

if (!input) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // Both are required to get a refresh token back. Without them Google
    // returns an access token that stops working in an hour, which fails at 4am
    // rather than now.
    access_type: 'offline',
    prompt: 'consent',
  });
  if (process.env.SCHOOL_EMAIL) params.set('login_hint', process.env.SCHOOL_EMAIL);

  console.log(`
Open this on any device and sign in as the account emails should come FROM.
If your school address is Google Workspace, pick that one, not a personal Gmail.

${`https://accounts.google.com/o/oauth2/v2/auth?${params}`}

You will land on an error page — nothing is listening at ${new URL(REDIRECT).host}.
That is expected. Copy the whole URL out of the address bar and run:

  node scripts/oauth-consent.mjs "<paste the url>"
`);
  process.exit(0);
}

const code = extractCode(input);
if (!code) {
  console.error('No authorization code in that. Paste the full redirected URL, or just the code= value.');
  process.exit(1);
}

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }),
});
const token = await res.json();

if (!token.refresh_token) {
  const why = token.error_description || token.error || 'Google returned no refresh token.';
  console.error(`\nNot connected: ${why}\n`);
  if (token.error === 'invalid_grant') {
    console.error('An authorization code works once and expires in minutes. Re-run with no');
    console.error('arguments to get a fresh consent URL.\n');
  } else if (token.error === 'redirect_uri_mismatch') {
    console.error(`The exchange used ${REDIRECT}, which is not registered on this OAuth client.`);
    console.error('Add it under Authorized redirect URIs, or set GOOGLE_REDIRECT_URI to match.\n');
  } else {
    console.error('If the account was authorized before, Google reuses the existing grant and');
    console.error('sends no new refresh token. Remove the app at');
    console.error('https://myaccount.google.com/permissions and run this again.\n');
  }
  process.exit(1);
}

const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
  headers: { Authorization: `Bearer ${token.access_token}` },
});
const email = who.ok ? (await who.json()).email : null;

const granted = (token.scope ?? '').split(/\s+/);
console.log(`\n  Connected: ${email ?? '(address unavailable)'}`);
console.log(`  Can send:   ${granted.includes(SEND) ? 'yes' : 'NO — sending will not work'}`);
console.log(`  Can draft:  ${granted.includes(COMPOSE) ? 'yes' : 'no, "Draft in Gmail" will fail'}`);
console.log(`  Can check replies: ${granted.includes(READ) ? 'yes' : 'no, follow-ups will skip'}`);
console.log('\nSet these on whatever runs the campaign. Never commit them.\n');
console.log(`SCHOOL_EMAIL=${email ?? 'you@school.edu'}`);
console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}\n`);
console.log('Revoke any time at https://myaccount.google.com/permissions.\n');
