#!/usr/bin/env node
// Mint a Gmail refresh token for the account the campaign sends from.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/connect-school-account.mjs
//
// Run once, on a machine with a browser. It prints a refresh token and the
// address it belongs to; put both in the environment of whatever runs the
// campaign and never in the repository.
//
// This exists because the app's own connect button needs the app deployed and
// a browser session, and a scheduled run has neither. The token is the whole
// grant, so it is printed once here and stored as a secret from then on.

import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.CONNECT_PORT ?? 4477);
const REDIRECT = `http://localhost:${PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  // Lets a follow-up check whether the professor already replied. Decline it
  // and nudges are skipped rather than sent blind.
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(`Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.

Create them at https://console.cloud.google.com/apis/credentials:
  1. Create an OAuth 2.0 Client ID, type "Web application"
  2. Add this exact authorized redirect URI:  ${REDIRECT}
  3. Enable the Gmail API for the project
`);
  process.exit(1);
}

const hint = process.argv[2];
const state = Math.random().toString(36).slice(2);

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // Both are needed to get a refresh token back. Without them Google returns
    // an access token that stops working in an hour, which fails at 4am rather
    // than now.
    access_type: 'offline',
    prompt: 'consent',
    state,
    ...(hint ? { login_hint: hint } : {}),
  });

function page(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#faf9f8">
<div style="max-width:420px;text-align:center;background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:28px">
<h1 style="font-size:16px;margin:0 0 8px">${title}</h1>
<p style="font-size:14px;color:#777169;line-height:1.5;margin:0">${message}</p>
</div></body>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Not connected', error ?? 'No code returned.'));
    console.error(`\nGoogle refused: ${error ?? 'no code'}`);
    server.close();
    process.exit(1);
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Not connected', 'State mismatch.'));
    console.error('\nState did not match; refusing.');
    server.close();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const token = await tokenRes.json();

    if (!token.refresh_token) {
      const why =
        token.error_description ||
        token.error ||
        'Google returned no refresh token, which usually means this app is already authorized for the account.';
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Not connected', why));
      console.error(`\n${why}`);
      console.error('Remove the app at https://myaccount.google.com/permissions and run this again.');
      server.close();
      process.exit(1);
    }

    const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const email = who.ok ? (await who.json()).email : null;

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      page('Connected', `${email ?? 'This account'} can now send. The token is in your terminal.`)
    );

    const granted = (token.scope ?? '').split(/\s+/);
    console.log(`\n  Connected: ${email ?? '(address unavailable)'}`);
    console.log(`  Can send:  ${granted.includes(SCOPES[0]) ? 'yes' : 'NO — sending will not work'}`);
    console.log(`  Can check replies: ${granted.includes(SCOPES[1]) ? 'yes' : 'no, follow-ups will skip'}`);
    console.log('\nAdd these to the environment that runs the campaign. Never commit them.\n');
    console.log(`SCHOOL_EMAIL=${email ?? 'you@school.edu'}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}`);
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log('GOOGLE_CLIENT_SECRET=(the one you used here)\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' }).end(page('Not connected', String(err)));
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\nSign in as the account you want emails to come FROM.`);
  console.log(`If your school address is a Google Workspace account, pick that one, not a personal Gmail.\n`);
  console.log(`${authUrl}\n`);
  // Best effort: opening the browser is a convenience, and the URL above works
  // when there is no browser on this machine.
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
