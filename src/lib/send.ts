import nodemailer from 'nodemailer';
import { OutboxEntry, TrackId } from './types';
import { listStore, newId, writeStore } from './store';
import { clerkConfigured } from './user';
import { getAccessToken } from './sender-identity';

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
  // ── threading, for follow-ups ────────────────────────────────────────────
  /** Put this message on an existing conversation instead of starting one. */
  threadId?: string | null;
  /** RFC822 Message-ID being replied to, so clients other than Gmail thread it. */
  inReplyTo?: string | null;
  // ── bookkeeping carried through to the outbox record ─────────────────────
  trackId?: TrackId;
  autonomous?: boolean;
  followUpOf?: string | null;
  followUpNumber?: number;
}

export interface SendResult {
  method: OutboxEntry['method'];
  status: OutboxEntry['status'];
  detail: string | null;
  /** Set by providers that can report where the message landed. */
  threadId?: string | null;
  messageId?: string | null;
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
  inReplyTo?: string | null;
}): string {
  const headers = [
    `From: ${headerSafe(opts.from)}`,
    `To: ${headerSafe(opts.to)}`,
    opts.cc?.length ? `Cc: ${opts.cc.map(headerSafe).join(', ')}` : null,
    opts.replyTo ? `Reply-To: ${headerSafe(opts.replyTo)}` : null,
    `Subject: ${encodeHeader(opts.subject)}`,
    // Gmail threads by its own thread id, but every other client threads by
    // these. Without them a follow-up arrives in the professor's inbox as an
    // unconnected second email, which reads as a stranger emailing twice.
    opts.inReplyTo ? `In-Reply-To: ${headerSafe(opts.inReplyTo)}` : null,
    opts.inReplyTo ? `References: ${headerSafe(opts.inReplyTo)}` : null,
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
 * Read back the RFC822 Message-ID Gmail assigned to a message we just sent, so
 * a later follow-up can quote it in In-Reply-To. Best effort: threading is an
 * improvement on the follow-up, not a precondition for having sent anything.
 */
async function readMessageId(token: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const msg = (await res.json()) as { payload?: { headers?: { name: string; value: string }[] } };
    return msg.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Send from the university account the sender connected on the settings page.
 *
 * This runs ahead of every other provider and, once an account is connected,
 * is the only one allowed to run at all (see sendEmail). A cold email that
 * arrives from a personal Gmail instead of a .edu address is a different email
 * as far as the professor reading it is concerned, so falling back to another
 * mailbox when this one is misconfigured would be the wrong kind of helpful.
 */
async function sendViaSchoolGmail(req: SendRequest): Promise<SendResult | null> {
  let auth;
  try {
    auth = await getAccessToken(req.userId);
  } catch (err) {
    // Connected but unusable: expired grant, revoked access, missing server
    // credentials. Surface it rather than silently sending as someone else.
    return { method: 'school-gmail', status: 'failed', detail: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
  if (!auth) return null; // nothing connected — the older providers may apply

  try {
    const mime = buildMime({
      // "me" resolves to the authorised account, so the From address is always
      // the school one and cannot drift from what the settings page displays.
      from: `${req.fromName} <${auth.email}>`,
      to: req.to,
      cc: req.cc,
      subject: req.subject,
      body: req.body,
      replyTo: req.replyTo,
      attachment: req.attachment,
      inReplyTo: req.inReplyTo,
    });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: Buffer.from(mime).toString('base64url'),
        ...(req.threadId ? { threadId: req.threadId } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return {
        method: 'school-gmail',
        status: 'failed',
        detail: `Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}`,
      };
    }
    const sent = (await res.json()) as { id?: string; threadId?: string };
    return {
      method: 'school-gmail',
      status: 'sent',
      detail: `Sent from ${auth.email}${req.attachment ? ` with ${req.attachment.fileName} attached` : ''}${
        req.cc?.length ? `, copying ${req.cc.join(', ')}` : ''
      }`,
      threadId: sent.threadId ?? req.threadId ?? null,
      messageId: sent.id ? await readMessageId(auth.token, sent.id) : null,
    };
  } catch (err) {
    return { method: 'school-gmail', status: 'failed', detail: String(err).slice(0, 300) };
  }
}

export interface DraftRequest {
  userId: string;
  to: string;
  cc?: string[];
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
  attachment?: EmailAttachment | null;
}

export type DraftResult =
  | { ok: true; draftId: string; email: string; attached: string | null }
  | { ok: false; error: string };

/**
 * Put a draft in the connected school mailbox instead of sending it.
 *
 * This exists because a draft is the only review step that shows the sender
 * exactly what the professor will get. The campaign screen can render a
 * subject and a body, but it cannot show a resume riding along as a real MIME
 * part — and the resume is the thing most likely to be silently missing, since
 * every draft claims it is attached.
 *
 * It is deliberately the same buildMime() call that sendEmail() makes, so what
 * is reviewed in Gmail is byte-for-byte what goes out. A separate, simpler
 * draft builder would defeat the point: the failure it is meant to catch is
 * precisely a difference between the reviewed message and the sent one.
 *
 * Nothing here can send. The Gmail drafts endpoint only stores.
 */
export async function createSchoolGmailDraft(req: DraftRequest): Promise<DraftResult> {
  let auth;
  try {
    auth = await getAccessToken(req.userId);
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
  if (!auth) return { ok: false, error: 'No school account connected. Connect one on the campaign screen first.' };

  try {
    const mime = buildMime({
      from: `${req.fromName} <${auth.email}>`,
      to: req.to,
      cc: req.cc,
      subject: req.subject,
      body: req.body,
      replyTo: req.replyTo,
      attachment: req.attachment,
    });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: Buffer.from(mime).toString('base64url') } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { ok: false, error: `Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const draft = (await res.json()) as { id?: string };
    if (!draft.id) return { ok: false, error: 'Gmail accepted the draft but returned no id' };
    return { ok: true, draftId: draft.id, email: auth.email, attached: req.attachment?.fileName ?? null };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
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

  // The school account, when one is connected, is the only account allowed to
  // send. Whatever it answers stands: a failure here is reported as a failure
  // rather than retried through SMTP or a personal Gmail, because the address
  // an email arrives from is part of the email.
  const school = await sendViaSchoolGmail(attempt);
  const result: SendResult =
    school ??
    (await sendViaClerkGmail(attempt)) ??
    (await sendViaSmtp(attempt)) ??
    (await sendViaResend(attempt)) ??
    ({
      method: 'demo-outbox',
      status: 'queued',
      detail: `No email credentials configured, so this was saved to the local outbox${
        req.attachment ? ` (${req.attachment.fileName} would be attached)` : ''
      }. Connect your school account on the settings page, or configure SMTP_* or RESEND_API_KEY.`,
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
    // Threading: prefer what the provider reported, falling back to the thread
    // we were asked to join so a follow-up chain does not break when the
    // provider answers without one.
    threadId: result.threadId ?? req.threadId ?? null,
    rfcMessageId: result.messageId ?? null,
    trackId: req.trackId,
    autonomous: req.autonomous === true,
    followUpOf: req.followUpOf ?? null,
    followUpNumber: req.followUpNumber,
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
