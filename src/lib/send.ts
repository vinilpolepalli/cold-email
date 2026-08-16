import nodemailer from 'nodemailer';
import { OutboxEntry } from './types';
import { listStore, newId, writeStore } from './store';
import { clerkConfigured } from './user';

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  base64: string;
}

export interface SendRequest {
  userId: string;
  researcherId: string;
  researcherName: string;
  to: string;
  cc?: string[];
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
  attachment?: EmailAttachment | null;
}

export interface SendResult {
  method: OutboxEntry['method'];
  status: OutboxEntry['status'];
  detail: string | null;
}

// ── MIME helpers ────────────────────────────────────────────────────────────

/**
 * Strip CR/LF from anything interpolated into a header. Without this, a
 * recipient like "prof@x.edu\r\nBcc: someone@else" injects a real Bcc header.
 */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 encoded-word for header values carrying non-ASCII. Raw UTF-8 in a
 * header is not valid and renders as mojibake in many clients.
 */
function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

/** Quote a MIME parameter value, escaping backslashes and quotes. */
function quoteParam(value: string): string {
  return `"${headerSafe(value).replace(/([\\"])/g, '\\$1')}"`;
}

/** Fold a base64 string to 76-character lines, as MIME requires. */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function buildMime(opts: {
  from: string;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  replyTo?: string;
  attachment?: EmailAttachment | null;
}): string {
  const headers = [
    `From: ${headerSafe(opts.from)}`,
    `To: ${headerSafe(opts.to)}`,
    opts.cc?.length ? `Cc: ${opts.cc.map(headerSafe).join(', ')}` : null,
    opts.replyTo ? `Reply-To: ${headerSafe(opts.replyTo)}` : null,
    `Subject: ${encodeHeader(opts.subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean) as string[];

  if (!opts.attachment) {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${opts.body}`;
  }

  const boundary = `sloan_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const { fileName, contentType, base64 } = opts.attachment;
  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.body,
    '',
    `--${boundary}`,
    `Content-Type: ${contentType}; name=${quoteParam(fileName)}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename=${quoteParam(fileName)}`,
    '',
    wrapBase64(base64),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// ── providers ───────────────────────────────────────────────────────────────

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

    const mime = buildMime({
      from: 'me',
      to: req.to,
      cc: req.cc,
      subject: req.subject,
      body: req.body,
      // Replies belong in the address printed in the signature, which is not
      // necessarily the Google account doing the sending.
      replyTo: req.replyTo,
      attachment: req.attachment,
    });
    const raw = Buffer.from(mime).toString('base64url');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      return { method: 'gmail-oauth', status: 'failed', detail: `Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return {
      method: 'gmail-oauth',
      status: 'sent',
      detail: `Sent from your Gmail account${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}${
        req.cc?.length ? `, copying ${req.cc.join(', ')}` : ''
      }`,
    };
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
      from: SMTP_FROM ?? { name: req.fromName, address: SMTP_USER },
      to: req.to,
      cc: req.cc?.length ? req.cc : undefined,
      replyTo: req.replyTo,
      subject: req.subject,
      text: req.body,
      attachments: req.attachment
        ? [
            {
              filename: req.attachment.fileName,
              content: Buffer.from(req.attachment.base64, 'base64'),
              contentType: req.attachment.contentType,
            },
          ]
        : undefined,
    });
    return {
      method: 'smtp',
      status: 'sent',
      detail: `Sent via SMTP (${SMTP_HOST})${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}${
        req.cc?.length ? `, copying ${req.cc.join(', ')}` : ''
      }`,
    };
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
        cc: req.cc?.length ? req.cc : undefined,
        reply_to: req.replyTo,
        subject: req.subject,
        text: req.body,
        attachments: req.attachment
          ? [{ filename: req.attachment.fileName, content: req.attachment.base64 }]
          : undefined,
      }),
    });
    if (!res.ok) {
      return { method: 'resend', status: 'failed', detail: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return {
      method: 'resend',
      status: 'sent',
      detail: `Sent via Resend${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}`,
    };
  } catch (err) {
    return { method: 'resend', status: 'failed', detail: String(err).slice(0, 300) };
  }
}

export async function sendEmail(req: SendRequest): Promise<OutboxEntry> {
  // Safety valve for demos/testing: redirect every outgoing email to one
  // address so no real researcher is contacted accidentally. The intended
  // recipient is noted with ASCII only, since it lands in a header.
  const redirect = process.env.EMAIL_TEST_REDIRECT;
  const effectiveTo = headerSafe(redirect || req.to);
  const requestedCc = (req.cc ?? []).map(headerSafe).filter(Boolean);
  // Under redirect, the copied addresses are dropped entirely. Rerouting the
  // recipient while still copying a real assistant would defeat the whole
  // point of the safety valve.
  const effectiveCc = redirect ? [] : requestedCc;
  const subject = redirect
    ? `[TEST -> intended for ${[headerSafe(req.to), ...requestedCc].join(', ')}] ${req.subject}`
    : req.subject;

  const attempt = { ...req, to: effectiveTo, cc: effectiveCc, subject };
  const result: SendResult =
    (await sendViaClerkGmail(attempt)) ??
    (await sendViaSmtp(attempt)) ??
    (await sendViaResend(attempt)) ??
    ({
      method: 'demo-outbox',
      status: 'queued',
      detail: `No email credentials configured, so this was saved to the local outbox${
        req.attachment ? ` (${req.attachment.fileName} would be attached)` : ''
      }. Configure Clerk Google OAuth, SMTP_*, or RESEND_API_KEY to send for real.`,
    } satisfies SendResult);

  const entry: OutboxEntry = {
    id: newId('out'),
    userId: req.userId,
    researcherId: req.researcherId,
    researcherName: req.researcherName,
    to: effectiveTo,
    cc: effectiveCc,
    subject,
    body: req.body,
    attachmentName: req.attachment?.fileName ?? null,
    method: result.method,
    status: result.status,
    detail: result.detail,
    createdAt: new Date().toISOString(),
  };
  // One row per email: appending to a shared array loses records when two
  // sends overlap.
  await writeStore(`outbox:${entry.id}`, entry);
  return entry;
}

// A real address check, not just "contains @". These values reach mail headers,
// so a permissive check is how CRLF and extra recipients get in.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_COPIES = 5;

export function isSendableAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Check a recipient and copy list before anything is handed to a provider. */
export function validateRecipients(
  to: string,
  cc: unknown
): { to: string; cc: string[] } | { error: string } {
  const recipient = to.trim();
  if (!isSendableAddress(recipient)) return { error: 'That recipient address is not valid' };

  const seen = new Set([recipient.toLowerCase()]);
  const copies: string[] = [];
  for (const raw of Array.isArray(cc) ? cc : []) {
    const address = typeof raw === 'string' ? raw.trim() : '';
    if (!address) continue;
    if (!isSendableAddress(address)) {
      return { error: `That CC address is not valid: ${address.slice(0, 80)}` };
    }
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    copies.push(address);
  }
  // A blast-radius limit: a cold email copying a dozen people is a mailing
  // list, not an introduction.
  if (copies.length > MAX_COPIES) return { error: `Copy at most ${MAX_COPIES} people on one email` };
  return { to: recipient, cc: copies };
}

export async function getOutbox(userId: string): Promise<OutboxEntry[]> {
  const all = await listStore<OutboxEntry>('outbox');
  return all.filter((e) => e.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
