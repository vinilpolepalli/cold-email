import { deleteStore, readStore, writeStore } from './store';

// The account the emails actually go out from.
//
// This is deliberately separate from the Google account Clerk knows about.
// Signing in to the app and sending a cold email are two different acts: the
// sender signs in with whatever personal account they already use, and the
// email has to leave from their university address, because that address is
// the one a professor recognises and replies to.
//
// So the school account is connected once, on its own, and stored per user:
// a refresh token plus the address it authorises. Nothing here is ever handed
// to the browser except the address itself.

export interface SenderIdentity {
  /** The address mail will be sent from, as Google reports it. */
  email: string;
  /** Long-lived grant. Server-side only, never serialised to a client. */
  refreshToken: string;
  /** Scopes Google actually granted, which can be fewer than we asked for. */
  scopes: string[];
  connectedAt: string;
  /** Set when a refresh last failed, so the UI can say "reconnect" and why. */
  lastError: string | null;
}

/** What the UI is allowed to see. */
export interface SenderIdentityView {
  email: string;
  connectedAt: string;
  /** Whether follow-up nudges can tell that somebody already replied. */
  canDetectReplies: boolean;
  /** Whether a draft can be stored in the mailbox for review before sending. */
  canDraft: boolean;
  lastError: string | null;
}

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/**
 * Storing a draft is a different permission from sending one. gmail.send
 * authorises messages.send and nothing else, so the drafts endpoint answers
 * "insufficient authentication scopes" without it — a 403 that reads like a
 * broken token rather than a missing permission.
 */
const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

/**
 * Read access is requested because the follow-up routine needs it, and the
 * worst thing this system could do is nudge a professor who already replied.
 * Google may still grant only a subset; everything downstream checks the
 * granted scopes rather than assuming.
 */
const SCOPES = [GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_READ_SCOPE, EMAIL_SCOPE];

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function identityKey(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `sender:${userId}`;
}

function stateKey(nonce: string): string {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(nonce)) throw new Error('Unsupported state');
  return `oauthstate:${nonce}`;
}

// ── the consent round trip ──────────────────────────────────────────────────

/**
 * Where Google should send the browser back to. Configured explicitly when
 * set, because it has to match the console entry byte for byte; otherwise
 * derived from the request so localhost and a deployment both work.
 */
export function redirectUri(origin: string): string {
  return process.env.GOOGLE_REDIRECT_URI || `${origin.replace(/\/+$/, '')}/api/auth/google/callback`;
}

export interface StartedConsent {
  url: string;
  nonce: string;
}

/**
 * Build the consent URL and remember the state nonce against the user who
 * asked for it. Without that binding, anyone could hand the signed-in user a
 * callback URL and attach their own mailbox to this account.
 */
export async function startConsent(userId: string, origin: string, loginHint?: string): Promise<StartedConsent> {
  const nonce = `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  await writeStore(stateKey(nonce), { userId, createdAt: new Date().toISOString() });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent is what produces a refresh token. Without both, a
    // re-connection returns only an access token and the routines stop
    // working an hour later with no obvious cause.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: nonce,
  });
  // Pre-fills the account chooser with the school address so the sender does
  // not connect their personal Gmail by muscle memory, which is the whole
  // mistake this module exists to prevent.
  if (loginHint) params.set('login_hint', loginHint);

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, nonce };
}

/** Consume a state nonce, returning the user it was issued to. Single use. */
export async function consumeState(nonce: string): Promise<string | null> {
  let record: { userId?: string; createdAt?: string } | null = null;
  try {
    record = await readStore<{ userId?: string; createdAt?: string } | null>(stateKey(nonce), null);
  } catch {
    return null;
  }
  if (!record?.userId) return null;
  await deleteStore(stateKey(nonce)).catch(() => {});

  // A nonce left lying around for an hour is a stale tab, not a live consent.
  const age = Date.now() - Date.parse(record.createdAt ?? '');
  if (!Number.isFinite(age) || age > 60 * 60 * 1000) return null;
  return record.userId;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json()) as TokenResponse;
}

/**
 * Finish the round trip: swap the code for tokens, ask Google which address
 * was actually authorised, and store the grant.
 */
export async function completeConsent(
  userId: string,
  code: string,
  origin: string
): Promise<{ ok: true; identity: SenderIdentityView } | { ok: false; error: string }> {
  const token = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(origin),
    grant_type: 'authorization_code',
  });

  if (token.error || !token.access_token) {
    return { ok: false, error: token.error_description || token.error || 'Google did not return a token' };
  }
  if (!token.refresh_token) {
    // Happens when the account was connected before and Google decides a new
    // refresh token is unnecessary. Revoking and reconnecting is the fix, and
    // saying so beats storing a grant that expires in an hour.
    return {
      ok: false,
      error:
        'Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.',
    };
  }
  if (!(token.scope ?? '').includes(GMAIL_SEND_SCOPE)) {
    return { ok: false, error: 'Permission to send mail was not granted, so this account cannot be used to send.' };
  }

  const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  const profile = who.ok ? ((await who.json()) as { email?: string }) : {};
  if (!profile.email) return { ok: false, error: 'Could not read the address for the connected account.' };

  const identity: SenderIdentity = {
    email: profile.email,
    refreshToken: token.refresh_token,
    scopes: (token.scope ?? '').split(/\s+/).filter(Boolean),
    connectedAt: new Date().toISOString(),
    lastError: null,
  };
  await writeStore(identityKey(userId), identity);
  return { ok: true, identity: toView(identity) };
}

// ── using the grant ─────────────────────────────────────────────────────────

/**
 * A mailbox configured entirely through the environment, for runs with no
 * browser and no database.
 *
 * A scheduled run happens in a container that is thrown away afterwards, so
 * the grant cannot live in a store that does not survive it. The alternative,
 * committing it alongside the campaign state, would put a live token for the
 * sender's university mailbox into a git repository, which is not a trade
 * worth making for any amount of convenience.
 *
 * So the token comes from the environment, where a secret belongs, and this
 * takes precedence over anything stored.
 */
function identityFromEnv(): SenderIdentity | null {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const email = process.env.SCHOOL_EMAIL;
  if (!refreshToken || !email) return null;
  return {
    email,
    refreshToken,
    // Assume both scopes were granted. If read access was not, the reply check
    // fails and follow-ups skip rather than nudging blind, which is the safe
    // direction for a wrong guess here.
    scopes: [GMAIL_SEND_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_READ_SCOPE, EMAIL_SCOPE],
    connectedAt: 'from environment',
    lastError: null,
  };
}

export async function getSenderIdentity(userId: string): Promise<SenderIdentity | null> {
  const fromEnv = identityFromEnv();
  if (fromEnv) return fromEnv;
  const stored = await readStore<SenderIdentity | null>(identityKey(userId), null);
  return stored?.refreshToken ? stored : null;
}

export function toView(identity: SenderIdentity): SenderIdentityView {
  return {
    email: identity.email,
    connectedAt: identity.connectedAt,
    canDetectReplies: identity.scopes.includes(GMAIL_READ_SCOPE),
    canDraft: identity.scopes.includes(GMAIL_COMPOSE_SCOPE),
    lastError: identity.lastError,
  };
}

export async function getSenderIdentityView(userId: string): Promise<SenderIdentityView | null> {
  const identity = await getSenderIdentity(userId);
  return identity ? toView(identity) : null;
}

export async function disconnectSender(userId: string): Promise<void> {
  const identity = await getSenderIdentity(userId);
  // Best effort: tell Google to drop the grant too, so disconnecting here does
  // not leave a live token attached to the account forever.
  if (identity) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(identity.refreshToken)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
  await deleteStore(identityKey(userId));
}

/** Note a failure on the stored grant so the UI can prompt a reconnect. */
async function noteError(userId: string, message: string): Promise<void> {
  // An environment-supplied grant has nothing to write back to, and writing a
  // record would put the token into the store this exists to keep it out of.
  if (identityFromEnv()) return;
  const identity = await getSenderIdentity(userId);
  if (!identity) return;
  await writeStore(identityKey(userId), { ...identity, lastError: message.slice(0, 300) });
}

async function clearError(userId: string, identity: SenderIdentity): Promise<void> {
  if (identityFromEnv()) return;
  if (identity.lastError) await writeStore(identityKey(userId), { ...identity, lastError: null });
}

// Access tokens last an hour. Caching them in memory saves a round trip on
// every send in a batch; the process restarting simply refreshes again.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface AccessToken {
  token: string;
  email: string;
  canDetectReplies: boolean;
  canDraft: boolean;
}

/**
 * A usable access token for the user's school account, or null when no account
 * is connected. Throws when an account *is* connected but the grant no longer
 * works: callers must not quietly fall back to a different mailbox, because
 * "sent from the wrong address" is worse than "not sent".
 */
export async function getAccessToken(userId: string): Promise<AccessToken | null> {
  const identity = await getSenderIdentity(userId);
  if (!identity) return null;
  if (!googleOAuthConfigured()) {
    throw new Error('A school account is connected but GOOGLE_CLIENT_ID/SECRET are not set on this server.');
  }

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    const view = toView(identity);
    return {
      token: cached.token,
      email: identity.email,
      canDetectReplies: view.canDetectReplies,
      canDraft: view.canDraft,
    };
  }

  const refreshed = await tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: identity.refreshToken,
    grant_type: 'refresh_token',
  });

  if (refreshed.error || !refreshed.access_token) {
    const message = refreshed.error_description || refreshed.error || 'refresh failed';
    await noteError(userId, message);
    throw new Error(`The connection to ${identity.email} needs to be renewed (${message}).`);
  }

  tokenCache.set(userId, {
    token: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  });
  await clearError(userId, identity);
  const view = toView(identity);
  return {
    token: refreshed.access_token,
    email: identity.email,
    canDetectReplies: view.canDetectReplies,
    canDraft: view.canDraft,
  };
}

/**
 * Whether a thread has anything on it beyond what we sent. Used to cancel a
 * follow-up the moment somebody replies. Returns null when the question cannot
 * be answered — no read scope, an API error — and the caller then errs toward
 * not nudging.
 */
export async function threadHasReply(userId: string, threadId: string): Promise<boolean | null> {
  let auth: AccessToken | null;
  try {
    auth = await getAccessToken(userId);
  } catch {
    return null;
  }
  if (!auth || !auth.canDetectReplies) return null;

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return null;
    const thread = (await res.json()) as { messages?: { payload?: { headers?: { name: string; value: string }[] } }[] };
    const messages = thread.messages ?? [];
    if (messages.length < 2) return false;

    // More than one message is usually a reply, but not always: a bounce
    // notice and our own follow-up both land on the thread too. Anything from
    // an address that is not ours counts as somebody having answered.
    const ours = auth.email.toLowerCase();
    return messages.some((m) => {
      const from = m.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
      return Boolean(from) && !from.toLowerCase().includes(ours);
    });
  } catch {
    return null;
  }
}
