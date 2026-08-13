import nodemailer from 'nodemailer';
import { OutboxEntry } from './types';
import { newId, readStore, writeStore } from './store';
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

/** Fold a base64 string to 76-char lines, as MIME requires. */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  attachment?: EmailAttachment | null;
}): string {
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
  ].filter(Boolean) as string[];

  if (!opts.attachment) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    return `${headers.join('\r\n')}\r\n\r\n${opts.body}`;
  }

  const boundary = `labreach_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const { fileName, contentType, base64 } = opts.attachment;
  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    opts.body,
    '',
    `--${boundary}`,
    `Content-Type: ${contentType}; name="${fileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fileName}"`,
    '',
    wrapBase64(base64),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
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

    const mime = buildMime({
      from: 'me',
      to: req.to,
      subject: req.subject,
      body: req.body,
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
      detail: `Sent from your Gmail account${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}`,
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
      from: SMTP_FROM ?? `"${req.fromName}" <${SMTP_USER}>`,
      to: req.to,
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
      detail: `Sent via SMTP (${SMTP_HOST})${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}`,
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
    subject,
    body: req.body,
    attachmentName: req.attachment?.fileName ?? null,
    method: result.method,
    status: result.status,
    detail: result.detail,
    createdAt: new Date().toISOString(),
  };
  const outbox = await readStore<OutboxEntry[]>('outbox', []);
  outbox.unshift(entry);
  await writeStore('outbox', outbox);
  return entry;
}

export async function getOutbox(userId: string): Promise<OutboxEntry[]> {
  return (await readStore<OutboxEntry[]>('outbox', [])).filter((e) => e.userId === userId);
}
