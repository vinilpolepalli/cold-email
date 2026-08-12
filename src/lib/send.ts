import nodemailer from 'nodemailer';
import { OutboxEntry } from './types';
import { newId, readStore, writeStore } from './store';
import { clerkConfigured } from './user';

export interface SendRequest {
  userId: string;
  researcherId: string;
  researcherName: string;
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
}

export interface SendResult {
  method: OutboxEntry['method'];
  status: OutboxEntry['status'];
  detail: string | null;
}

function buildMime(opts: { from: string; to: string; subject: string; body: string; replyTo?: string }): string {
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${opts.body}`;
}

/**
 * Send as the signed-in user via the Gmail API, using the Google OAuth access
 * token Clerk stores when the user signs in with Google (requires the
 * https://www.googleapis.com/auth/gmail.send scope enabled in the Clerk
 * dashboard's Google connection).
 */
async function sendViaClerkGmail(req: SendRequest): Promise<SendResult | null> {
  if (!clerkConfigured()) return null;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(req.userId, 'google');
    const accessToken = tokens.data?.[0]?.token;
    if (!accessToken) return null;

    const mime = buildMime({ from: 'me', to: req.to, subject: req.subject, body: req.body });
    const raw = Buffer.from(mime).toString('base64url');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      return { method: 'gmail-oauth', status: 'failed', detail: `Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { method: 'gmail-oauth', status: 'sent', detail: 'Sent from your Gmail account' };
  } catch {
    return null; // e.g. user didn't sign in with Google — fall through to next method
  }
}

async function sendViaSmtp(req: SendRequest): Promise<SendResult | null> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  try {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: Number(SMTP_PORT ?? 587) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transport.sendMail({
      from: SMTP_FROM ?? `"${req.fromName}" <${SMTP_USER}>`,
      to: req.to,
      replyTo: req.replyTo,
      subject: req.subject,
      text: req.body,
    });
    return { method: 'smtp', status: 'sent', detail: `Sent via SMTP (${SMTP_HOST})` };
  } catch (err) {
    return { method: 'smtp', status: 'failed', detail: String(err).slice(0, 300) };
  }
}

async function sendViaResend(req: SendRequest): Promise<SendResult | null> {
  const { RESEND_API_KEY, RESEND_FROM } = process.env;
  if (!RESEND_API_KEY) return null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM ?? 'onboarding@resend.dev',
        to: [req.to],
        reply_to: req.replyTo,
        subject: req.subject,
        text: req.body,
      }),
    });
    if (!res.ok) {
      return { method: 'resend', status: 'failed', detail: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { method: 'resend', status: 'sent', detail: 'Sent via Resend' };
  } catch (err) {
    return { method: 'resend', status: 'failed', detail: String(err).slice(0, 300) };
  }
}

export async function sendEmail(req: SendRequest): Promise<OutboxEntry> {
  // Safety valve for demos/testing: redirect every outgoing email to one
  // address so no real researcher is contacted accidentally.
  const redirect = process.env.EMAIL_TEST_REDIRECT;
  const effectiveTo = redirect || req.to;
  const subject = redirect ? `[TEST → intended for ${req.to}] ${req.subject}` : req.subject;

  const attempt = { ...req, to: effectiveTo, subject };
  const result: SendResult =
    (await sendViaClerkGmail(attempt)) ??
    (await sendViaSmtp(attempt)) ??
    (await sendViaResend(attempt)) ??
    ({
      method: 'demo-outbox',
      status: 'queued',
      detail: 'No email credentials configured — saved to the local outbox. Configure Clerk Google OAuth, SMTP_*, or RESEND_API_KEY to send for real.',
    } satisfies SendResult);

  const entry: OutboxEntry = {
    id: newId('out'),
    userId: req.userId,
    researcherId: req.researcherId,
    researcherName: req.researcherName,
    to: effectiveTo,
    subject,
    body: req.body,
    method: result.method,
    status: result.status,
    detail: result.detail,
    createdAt: new Date().toISOString(),
  };
  const outbox = readStore<OutboxEntry[]>('outbox', []);
  outbox.unshift(entry);
  writeStore('outbox', outbox);
  return entry;
}

export function getOutbox(userId: string): OutboxEntry[] {
  return readStore<OutboxEntry[]>('outbox', []).filter((e) => e.userId === userId);
}
