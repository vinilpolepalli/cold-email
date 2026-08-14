import nodemailer from 'nodemailer';

// Mail the app sends on its own behalf, as opposed to a draft a user sends to
// a professor. Separate from send.ts on purpose: that path signs as the user,
// records an outbox entry, and honours EMAIL_TEST_REDIRECT. None of that
// applies to an operational note addressed to the person running the site.
//
// Optional like every other service here: with no SMTP or Resend credentials
// this is a no-op and the caller carries on.

const TIMEOUT_MS = 10_000;

/** Strip CR/LF so a value can never open a second header. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function notifyConfigured(): boolean {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, RESEND_API_KEY } = process.env;
  return Boolean((SMTP_HOST && SMTP_USER && SMTP_PASS) || RESEND_API_KEY);
}

async function viaSmtp(to: string, subject: string, text: string): Promise<boolean> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return false;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transport.sendMail({ from: SMTP_FROM ?? SMTP_USER, to, subject, text });
  return true;
}

async function viaResend(to: string, subject: string, text: string): Promise<boolean> {
  const { RESEND_API_KEY, RESEND_FROM } = process.env;
  if (!RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM ?? 'onboarding@resend.dev', to: [to], subject, text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

/**
 * Send an operational email. Returns whether it went out; never throws, since
 * no caller should fail a user's request because a notification did not send.
 */
export async function sendSystemEmail(to: string, subject: string, text: string): Promise<boolean> {
  const recipient = headerSafe(to);
  if (!recipient) return false;
  try {
    return (await viaSmtp(recipient, headerSafe(subject), text)) || (await viaResend(recipient, headerSafe(subject), text));
  } catch {
    return false;
  }
}
