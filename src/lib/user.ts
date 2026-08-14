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

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  return readStore<UserProfile | null>(userKey('user', userId), null);
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
