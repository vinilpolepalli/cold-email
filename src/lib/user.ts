import { UserProfile } from './types';
import { readStore, writeStore } from './store';
import { NimAuth } from './nim';

export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/** The single local identity used when Clerk is not configured. */
const DEMO_USER_ID = 'demo-user';

/**
 * Resolve the current user id. With Clerk configured this is the Clerk user id
 * (auth required); otherwise the app runs in demo mode as one fixed local user.
 *
 * Demo mode deliberately ignores any client-supplied identity. Echoing a cookie
 * back as the user id would let an anonymous caller name any account, read its
 * data, and steer that id into storage keys.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (clerkConfigured()) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    return userId;
  }
  return DEMO_USER_ID;
}

/** Clerk ids are safe as key material, but confirm before building a key. */
function userKey(prefix: string, userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId)) throw new Error('Unsupported user id');
  return `${prefix}:${userId}`;
}

/**
 * A dash in front of a number is a minus sign, not a sentence break. Resume
 * parsing gets this right now, but profiles stored before it did carry "at -
 * 7.5% max drawdown", which reads as a stray bullet mid-sentence. Repaired on
 * read so an existing account does not have to re-upload a resume to stop the
 * artefact reaching a professor.
 */
function repairNumericMinus(text: string): string {
  return text.replace(/(\S)\s-\s(?=\d)/g, '$1 -');
}

const REPAIRED_FIELDS = ['education', 'experience', 'projects', 'publications', 'awards'] as const;

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const profile = await readStore<UserProfile | null>(userKey('user', userId), null);
  if (!profile) return null;
  const repaired = { ...profile };
  for (const field of REPAIRED_FIELDS) {
    const value = repaired[field];
    if (Array.isArray(value)) repaired[field] = value.map((entry) => repairNumericMinus(String(entry)));
  }
  if (repaired.aiSummary) repaired.aiSummary = repairNumericMinus(repaired.aiSummary);
  return repaired;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await writeStore(userKey('user', profile.id), profile);
}

// ── Per-user settings (BYOK NVIDIA NIM key, model override) ─────────────────

export interface UserSettings {
  nimApiKey: string | null;
  nimModel: string | null;
}

const EMPTY_SETTINGS: UserSettings = { nimApiKey: null, nimModel: null };

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const stored = await readStore<UserSettings | null>(userKey('settings', userId), null);
  return { ...EMPTY_SETTINGS, ...(stored ?? {}) };
}

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  await writeStore(userKey('settings', userId), settings);
}

/** NIM auth for a user: their own key first, server env key as fallback. */
export async function getNimAuth(userId: string): Promise<NimAuth> {
  const settings = await getUserSettings(userId);
  return { apiKey: settings.nimApiKey, model: settings.nimModel };
}
